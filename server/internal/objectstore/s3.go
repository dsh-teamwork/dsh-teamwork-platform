package objectstore

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"
)

// FromEnv is shared by all editions. Management-only services do not call it.
// Explicit S3 selection never falls back to ephemeral local storage.
func FromEnv(dataDir string, env func(string) string) (Store, error) {
	get := func(k string) string { return strings.TrimSpace(env(k)) }
	switch get("ARTIFACT_STORAGE_PROVIDER") {
	case "", "local":
		dir := get("ARTIFACT_LOCAL_DIR")
		if dir == "" {
			dir = filepath.Join(dataDir, "artifacts")
		}
		return Local{Dir: dir}, nil
	case "s3":
		bucket, region := get("ARTIFACT_S3_BUCKET"), get("ARTIFACT_S3_REGION")
		access, secret := get("ARTIFACT_S3_ACCESS_KEY_ID"), get("ARTIFACT_S3_SECRET_ACCESS_KEY")
		if bucket == "" || region == "" || access == "" || secret == "" {
			return nil, errors.New("S3 object storage requires ARTIFACT_S3_BUCKET, REGION, ACCESS_KEY_ID and SECRET_ACCESS_KEY")
		}
		endpoint := get("ARTIFACT_S3_ENDPOINT")
		if endpoint != "" {
			u, err := url.Parse(endpoint)
			if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
				return nil, errors.New("ARTIFACT_S3_ENDPOINT must be an HTTPS origin")
			}
		}
		pathStyle := false
		if v := get("ARTIFACT_S3_PATH_STYLE"); v != "" {
			var err error
			pathStyle, err = strconv.ParseBool(v)
			if err != nil {
				return nil, errors.New("ARTIFACT_S3_PATH_STYLE must be a boolean")
			}
		}
		client := s3.New(s3.Options{
			Region:       region,
			Credentials:  credentials.NewStaticCredentialsProvider(access, secret, get("ARTIFACT_S3_SESSION_TOKEN")),
			HTTPClient:   &http.Client{Timeout: 60 * time.Second},
			UsePathStyle: pathStyle,
			// Compatible services need not implement optional AWS checksum extensions.
			RequestChecksumCalculation: aws.RequestChecksumCalculationWhenRequired,
			ResponseChecksumValidation: aws.ResponseChecksumValidationWhenRequired,
		}, func(o *s3.Options) {
			if endpoint != "" {
				o.BaseEndpoint = aws.String(endpoint)
			}
		})
		return &S3{Client: client, Bucket: bucket}, nil
	default:
		return nil, errors.New("ARTIFACT_STORAGE_PROVIDER must be local or s3")
	}
}

type S3 struct {
	Client *s3.Client
	Bucket string
}

func (s *S3) Put(ctx context.Context, teamID, id string, body io.ReadSeeker, size int64) error {
	k, err := key(teamID, id)
	if err != nil {
		return err
	}
	_, err = s.Client.PutObject(ctx, &s3.PutObjectInput{Bucket: &s.Bucket, Key: &k, Body: body, ContentLength: &size, ContentType: aws.String("application/gzip")})
	return err
}

func (s *S3) PutObject(ctx context.Context, teamID, kind, id string, body io.ReadSeeker, size int64) error {
	k, err := objectKey(teamID, kind, id)
	if err != nil {
		return err
	}
	_, err = s.Client.PutObject(ctx, &s3.PutObjectInput{Bucket: &s.Bucket, Key: &k, Body: body, ContentLength: &size, ContentType: aws.String("application/octet-stream")})
	return err
}

func (s *S3) OpenObject(ctx context.Context, teamID, kind, id string) (io.ReadCloser, error) {
	k, err := objectKey(teamID, kind, id)
	if err != nil {
		return nil, err
	}
	return s.open(ctx, k)
}

func (s *S3) DeleteObject(ctx context.Context, teamID, kind, id string) error {
	k, err := objectKey(teamID, kind, id)
	if err != nil {
		return err
	}
	_, err = s.Client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: &s.Bucket, Key: &k})
	return err
}

func (s *S3) Open(ctx context.Context, teamID, id string) (io.ReadCloser, error) {
	k, err := key(teamID, id)
	if err != nil {
		return nil, err
	}
	return s.open(ctx, k)
}

func (s *S3) OpenLegacy(ctx context.Context, id string) (io.ReadCloser, error) {
	k, err := legacyKey(id)
	if err != nil {
		return nil, err
	}
	return s.open(ctx, k)
}

func (s *S3) open(ctx context.Context, k string) (io.ReadCloser, error) {
	result, err := s.Client.GetObject(ctx, &s3.GetObjectInput{Bucket: &s.Bucket, Key: &k})
	if err != nil {
		var apiErr smithy.APIError
		// Only a missing object permits migration. Missing buckets, access denial
		// and network failures must not be mistaken for a missing destination.
		if errors.As(err, &apiErr) && apiErr.ErrorCode() == "NoSuchKey" {
			return nil, fmt.Errorf("object missing: %w", fs.ErrNotExist)
		}
		return nil, err
	}
	return result.Body, nil
}

func (s *S3) Delete(ctx context.Context, teamID, id string) error {
	k, err := key(teamID, id)
	if err != nil {
		return err
	}
	_, err = s.Client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: &s.Bucket, Key: &k})
	return err
}

// Check exercises the configured bucket before a user process becomes healthy.
// The random probe contains no user data and is removed even on read failure.
func (s *S3) Check(ctx context.Context) (err error) {
	data := make([]byte, 16)
	if _, err := rand.Read(data); err != nil {
		return err
	}
	id := hex.EncodeToString(data)
	defer func() {
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		defer cancel()
		err = errors.Join(err, s.Delete(cleanup, "_storage_probe", id))
	}()
	if err := s.Put(ctx, "_storage_probe", id, bytes.NewReader(data), int64(len(data))); err != nil {
		return err
	}
	r, err := s.Open(ctx, "_storage_probe", id)
	if err != nil {
		return err
	}
	defer r.Close()
	actual, err := io.ReadAll(io.LimitReader(r, int64(len(data)+1)))
	if err != nil {
		return err
	}
	if !bytes.Equal(actual, data) {
		return errors.New("S3 storage probe read different bytes")
	}
	return nil
}
