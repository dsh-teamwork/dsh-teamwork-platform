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
	Put(context.Context, string, io.ReadSeeker, int64) error
	Open(context.Context, string) (io.ReadCloser, error)
	Delete(context.Context, string) error
}

var validID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,32}$`)

func key(id string) (string, error) {
	if !validID.MatchString(id) {
		return "", errors.New("invalid artifact id")
	}
	return id + ".tgz", nil
}

// Local preserves the existing <data>/artifacts/<id>.tgz layout.
type Local struct{ Dir string }

func (s Local) filename(id string) (string, error) {
	k, err := key(id)
	if err != nil {
		return "", err
	}
	if s.Dir == "" {
		return "", errors.New("artifact directory is empty")
	}
	return filepath.Join(s.Dir, k), nil
}

func (s Local) Put(ctx context.Context, id string, body io.ReadSeeker, size int64) error {
	target, err := s.filename(id)
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := os.MkdirAll(s.Dir, 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(s.Dir, "upload-*")
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

func (s Local) Open(ctx context.Context, id string) (io.ReadCloser, error) {
	name, err := s.filename(id)
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return os.Open(name)
}

func (s Local) Delete(ctx context.Context, id string) error {
	name, err := s.filename(id)
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
