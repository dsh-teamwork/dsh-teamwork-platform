// Package artifactstore stores private archive bytes independently of their
// database metadata. Authorization stays in the team service.
package artifactstore

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
)

type Store interface {
	Put(context.Context, string, string, io.ReadSeeker, int64) error
	Open(context.Context, string, string) (io.ReadCloser, error)
	Delete(context.Context, string, string) error
	// OpenLegacy is only for migrating existing flat objects; new writes are scoped.
	OpenLegacy(context.Context, string) (io.ReadCloser, error)
	// PutObject, OpenObject and DeleteObject keep an edition's own objects
	// (edition.Objects) beside the plugin archives: teamID, then kind, then id.
	PutObject(ctx context.Context, teamID, kind, id string, body io.ReadSeeker, size int64) error
	OpenObject(ctx context.Context, teamID, kind, id string) (io.ReadCloser, error)
	DeleteObject(ctx context.Context, teamID, kind, id string) error
}

var (
	validID   = regexp.MustCompile(`^[A-Za-z0-9_-]{1,32}$`)
	validKind = regexp.MustCompile(`^[a-z][a-z0-9-]{0,31}$`)
)

// objectKey is an edition's object under a team. "plugins" stays the server's
// own, so an edition can never name a plugin archive.
func objectKey(teamID, kind, id string) (string, error) {
	if !validID.MatchString(teamID) || !validKind.MatchString(kind) || kind == "plugins" || !validID.MatchString(id) {
		return "", errors.New("invalid object key")
	}
	return "teams/" + teamID + "/" + kind + "/" + id, nil
}

func legacyKey(id string) (string, error) {
	if !validID.MatchString(id) {
		return "", errors.New("invalid artifact id")
	}
	return id + ".tgz", nil
}

func key(teamID, id string) (string, error) {
	if !validID.MatchString(teamID) {
		return "", errors.New("invalid artifact team id")
	}
	name, err := legacyKey(id)
	if err != nil {
		return "", err
	}
	return "teams/" + teamID + "/plugins/" + name, nil
}

// Local uses the same team-scoped keys as object storage under Dir.
type Local struct{ Dir string }

func (s Local) filename(k string, err error) (string, error) {
	if err != nil {
		return "", err
	}
	if s.Dir == "" {
		return "", errors.New("artifact directory is empty")
	}
	return filepath.Join(s.Dir, k), nil
}

func (s Local) Put(ctx context.Context, teamID, id string, body io.ReadSeeker, size int64) error {
	target, err := s.filename(key(teamID, id))
	if err != nil {
		return err
	}
	return write(ctx, target, body, size)
}

func (s Local) PutObject(ctx context.Context, teamID, kind, id string, body io.ReadSeeker, size int64) error {
	target, err := s.filename(objectKey(teamID, kind, id))
	if err != nil {
		return err
	}
	return write(ctx, target, body, size)
}

func write(ctx context.Context, target string, body io.ReadSeeker, size int64) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	dir := filepath.Dir(target)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(dir, "upload-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	defer f.Close()
	n, err := io.Copy(f, io.LimitReader(body, size+1))
	if err != nil {
		return err
	}
	if n != size {
		return errors.New("artifact size mismatch")
	}
	if err := f.Sync(); err != nil {
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return os.Rename(f.Name(), target)
}

func (s Local) Open(ctx context.Context, teamID, id string) (io.ReadCloser, error) {
	name, err := s.filename(key(teamID, id))
	return open(ctx, name, err)
}

func (s Local) OpenObject(ctx context.Context, teamID, kind, id string) (io.ReadCloser, error) {
	name, err := s.filename(objectKey(teamID, kind, id))
	return open(ctx, name, err)
}

func open(ctx context.Context, name string, err error) (io.ReadCloser, error) {
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return os.Open(name)
}

func (s Local) Delete(ctx context.Context, teamID, id string) error {
	name, err := s.filename(key(teamID, id))
	return remove(ctx, name, err)
}

func (s Local) DeleteObject(ctx context.Context, teamID, kind, id string) error {
	name, err := s.filename(objectKey(teamID, kind, id))
	return remove(ctx, name, err)
}

func remove(ctx context.Context, name string, err error) error {
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	err = os.Remove(name)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func (s Local) OpenLegacy(ctx context.Context, id string) (io.ReadCloser, error) {
	k, err := legacyKey(id)
	if err != nil {
		return nil, err
	}
	if s.Dir == "" {
		return nil, errors.New("artifact directory is empty")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return os.Open(filepath.Join(s.Dir, k))
}
