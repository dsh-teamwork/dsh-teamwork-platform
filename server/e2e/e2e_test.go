//go:build e2e

// Package e2e drives the built binary as its clients do. Run with
//
//	go test -tags e2e ./e2e
//
// It needs node and the DSH plugin's repository (../dsh-teamwork beside this
// one, or DSH_TEAMWORK_PLUGIN), and runs on SQLite, and on Postgres and MySQL
// when TEST_POSTGRES_URL and TEST_MYSQL_URL are set.
package e2e

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/auth"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
)

const secret = "e2e-auth-secret-at-least-32-characters"

func here() string {
	_, file, _, _ := runtime.Caller(0)
	return filepath.Dir(file)
}

func build(t *testing.T) string {
	t.Helper()
	bin := filepath.Join(t.TempDir(), "dsh-teamwork")
	cmd := exec.Command("go", "build", "-o", bin, "./cmd/dsh-teamwork")
	cmd.Dir = filepath.Join(here(), "..")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("build: %v\n%s", err, out)
	}
	return bin
}

func freePort(t *testing.T) int {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}

// serve starts the binary on the database and waits until it answers.
func serve(t *testing.T, bin, databaseURL string) string {
	t.Helper()
	port := freePort(t)
	base := fmt.Sprintf("http://localhost:%d", port)
	cmd := exec.Command(bin, "--data", t.TempDir(), "--port", fmt.Sprint(port))
	cmd.Env = append(os.Environ(),
		"DATABASE_URL="+databaseURL,
		"AUTH_SECRET="+secret,
		"PROVIDER_KEYS_SECRET="+base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{9}, 32)),
		"ALLOW_PRIVATE_PROVIDERS=true",
		"APP_URL="+base,
	)
	var log bytes.Buffer
	cmd.Stdout, cmd.Stderr = &log, &log
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	exited := make(chan error, 1)
	go func() { exited <- cmd.Wait() }()
	t.Cleanup(func() {
		cmd.Process.Signal(os.Interrupt)
		<-exited
		if t.Failed() {
			t.Logf("server log:\n%s", log.String())
		}
	})
	deadline := time.After(30 * time.Second)
	for {
		select {
		case err := <-exited:
			exited <- err
			t.Fatalf("the server exited: %v", err)
		case <-deadline:
			t.Fatal("the server did not answer within 30 seconds")
		case <-time.After(100 * time.Millisecond):
			if res, err := http.Get(base + "/api/auth/session"); err == nil {
				res.Body.Close()
				return base
			}
		}
	}
}

func stubProvider(t *testing.T) string {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if r.Header.Get("Authorization") != "Bearer sk-e2e" || !bytes.Contains(body, []byte(`"model":"stub-model"`)) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if bytes.Contains(body, []byte(`"stream":true`)) {
			w.Header().Set("Content-Type", "text/event-stream")
			io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\ndata: [DONE]\n\n")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"choices":[{"message":{"role":"assistant","content":"hello"}}]}`)
	}))
	t.Cleanup(s.Close)
	return s.URL
}

func TestPluginEndToEnd(t *testing.T) {
	plugin := os.Getenv("DSH_TEAMWORK_PLUGIN")
	if plugin == "" {
		plugin = filepath.Join(here(), "..", "..", "..", "dsh-teamwork")
	}
	if _, err := os.Stat(filepath.Join(plugin, "lib", "client.js")); err != nil {
		t.Fatalf("the DSH plugin is not at %s (set DSH_TEAMWORK_PLUGIN): %v", plugin, err)
	}
	bin := build(t)
	stub := stubProvider(t)
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		base := serve(t, bin, d.URL)
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, "node", filepath.Join(here(), "plugin.mjs"))
		cmd.Env = append(os.Environ(), "BASE="+base, "SETUP_TOKEN="+auth.SetupToken(secret), "STUB_URL="+stub, "PLUGIN="+plugin)
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("plugin e2e: %v\n%s", err, out)
		}
		t.Log(strings.TrimSpace(string(out)))
	})
}
