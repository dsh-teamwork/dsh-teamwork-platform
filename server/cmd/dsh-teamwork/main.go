// Command dsh-teamwork is the DSH Teamwork server: the API, the model gateway
// and the console in one binary (ADR 0014). With nothing configured it keeps
// its SQLite database and secrets in ~/.dsh-teamwork and listens on
// 127.0.0.1:3800.
package main

import (
	"context"
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

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/analytics"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/auth"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/config"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/gateway"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/httpapi"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/team"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/web"
)

var version = "dev"

func main() {
	if len(os.Args) > 1 && (os.Args[1] == "--version" || os.Args[1] == "version") {
		fmt.Println("dsh-teamwork", version)
		return
	}
	if err := run(); err != nil {
		slog.Error("dsh-teamwork stopped", "error", err)
		os.Exit(1)
	}
}

func run() error {
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
	client, _, err := db.Open(ctx, target)
	if err != nil {
		return err
	}
	defer client.Close()

	keys, err := team.NewKeys(cfg.ProviderKeysSecret)
	if err != nil {
		return err
	}
	network := &team.Network{AllowPrivate: cfg.AllowPrivateProviders}
	authn := &auth.Service{DB: client, Sealer: auth.NewSealer(cfg.AuthSecret, nil), Secret: cfg.AuthSecret}
	teams := &team.Service{DB: client, Keys: keys, Network: network, Auth: authn, Passwords: cfg.Passwords()}
	srv := &httpapi.Server{
		Config:    cfg,
		Auth:      authn,
		Team:      teams,
		Gateway:   &gateway.Gateway{Team: teams, Client: network.Client()},
		Web:       web.Handler(),
		Analytics: &analytics.Client{Key: cfg.PostHogKey, Host: cfg.PostHogHost},
	}
	if !cfg.Passwords() {
		srv.Mailer = auth.SMTP{URL: cfg.SMTPURL, From: cfg.EmailFrom}
	}
	if cfg.Google() {
		srv.Google = auth.NewGoogle(cfg.GoogleID, cfg.GoogleSecret, cfg.AppURL, nil)
	}

	if cfg.Passwords() {
		if open, err := authn.SetupOpen(ctx); err != nil {
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
	server := &http.Server{Handler: srv.Handler(), ReadHeaderTimeout: 10 * time.Second}
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
