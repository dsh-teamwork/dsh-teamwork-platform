// Package app runs the server: what the open binary's main and the closed
// binary's main both call (ADR 0014). The open binary has no extensions; the
// closed one registers its own through package edition before Main runs.
package app

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/analytics"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/auth"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/config"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/gateway"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/httpapi"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/team"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/web"
)

// Main runs the server with the process's arguments and environment, and
// exits the process when it stops. version is printed by --version and logged.
func Main(version string) {
	if len(os.Args) > 1 && (os.Args[1] == "--version" || os.Args[1] == "version") {
		fmt.Println("dsh-teamwork", version)
		return
	}
	if err := run(version); err != nil {
		slog.Error("dsh-teamwork stopped", "error", err)
		os.Exit(1)
	}
}

func run(version string) error {
	cfg, err := config.Load(os.Args[1:], os.Getenv)
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	target, err := db.Resolve(cfg.DatabaseURL, cfg.DataDir)
	if err != nil {
		return err
	}
	extensions := edition.Registered()
	var sets []db.Set
	for _, e := range extensions {
		if e.Migrations != nil {
			sets = append(sets, db.Set{Name: e.Name, FS: e.Migrations})
		}
	}
	client, conn, err := db.Open(ctx, target, sets...)
	if err != nil {
		return err
	}
	defer client.Close()

	srv, handler, err := Build(ctx, cfg, client, conn, target.Dialect, extensions, os.Getenv)
	if err != nil {
		return err
	}
	if cfg.Passwords() {
		if open, err := srv.Auth.SetupOpen(ctx); err != nil {
			slog.Error("could not check for a first account", "error", err)
		} else if open {
			// The server's own output is the one place only its operator reads.
			fmt.Printf("No account exists yet. Create the first one at %s/setup?token=%s\n", cfg.AppURL, auth.SetupToken(cfg.AuthSecret))
		}
	}

	addr := net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port))
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 10 * time.Second}
	slog.Info("serving", "url", cfg.AppURL, "listening", ln.Addr().String(), "database", target.Dialect, "version", version)
	errs := make(chan error, 1)
	go func() { errs <- server.Serve(ln) }()
	select {
	case err := <-errs:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return server.Shutdown(shutdown)
	}
	return nil
}

// Build is the server over an opened database, with exts mounted on its
// router: what run serves, and what editiontest serves to a closed package's
// tests. ctx ending is the extensions' signal to let go of what they hold.
func Build(ctx context.Context, cfg config.Config, client *ent.Client, conn *sql.DB, dialect string, exts []edition.Extension, env func(string) string) (*httpapi.Server, http.Handler, error) {
	keys, err := team.NewKeys(cfg.ProviderKeysSecret)
	if err != nil {
		return nil, nil, err
	}
	network := &team.Network{AllowPrivate: cfg.AllowPrivateProviders}
	authn := &auth.Service{DB: client, Sealer: auth.NewSealer(cfg.AuthSecret, nil), Secret: cfg.AuthSecret}
	teams := &team.Service{DB: client, Keys: keys, Network: network, Auth: authn, Passwords: cfg.Passwords()}
	srv := &httpapi.Server{
		Config:    cfg,
		Auth:      authn,
		Team:      teams,
		Gateway:   &gateway.Gateway{Team: teams, Client: network.Client()},
		Analytics: &analytics.Client{Key: cfg.PostHogKey, Host: cfg.PostHogHost},
	}
	srv.Web = web.Handler(web.Options{AppURL: cfg.AppURL, PostHogKey: cfg.PostHogKey, PostHogHost: cfg.PostHogHost, Viewer: srv.Viewer})
	if !cfg.Passwords() {
		srv.Mailer = auth.SMTP{URL: cfg.SMTPURL, From: cfg.EmailFrom}
	}
	if cfg.Google() {
		// A stalled Google must not hold a sign-in, and its goroutine, for ever.
		srv.Google = auth.NewGoogle(cfg.GoogleID, cfg.GoogleSecret, cfg.AppURL, &http.Client{Timeout: 15 * time.Second})
	}

	srv.Mux = http.NewServeMux()
	host := edition.Host{
		DB: conn, Dialect: dialect, AppURL: cfg.AppURL, AuthSecret: cfg.AuthSecret, Mux: srv.Mux,
		Bearer: srv.BearerIdentity, Session: srv.SessionIdentity, SameOrigin: srv.SameOrigin,
		Users: NewUsers(client), Env: env, Done: ctx.Done(),
	}
	for _, e := range exts {
		if err := e.Mount(host); err != nil {
			return nil, nil, fmt.Errorf("%s: %w", e.Name, err)
		}
	}

	return srv, srv.Handler(), nil
}
