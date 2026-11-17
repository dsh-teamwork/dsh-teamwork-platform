// Package app runs the server: what the open binary's main and the closed
// binary's main both call (ADR 0014). The open binary has no extensions; the
// closed one registers its own through package edition before Main runs.
package app

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/artifactstore"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/auth"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/config"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/gateway"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/httpapi"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/team"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/usage"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/web"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/manage"
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
	if cfg.MigrateArtifactPaths {
		store, err := artifactstore.FromEnv(cfg.DataDir, os.Getenv)
		if err != nil {
			return err
		}
		count, err := (&team.Service{DB: client, Artifacts: store}).MigrateArtifactPaths(ctx)
		if err != nil {
			return err
		}
		slog.Info("artifact paths verified", "count", count)
		return nil
	}
	if cfg.MigrateArtifacts {
		store, err := artifactstore.FromEnv(cfg.DataDir, os.Getenv)
		if err != nil {
			return err
		}
		if _, ok := store.(*artifactstore.S3); !ok {
			return errors.New("--migrate-artifacts requires ARTIFACT_STORAGE_PROVIDER=s3")
		}
		dir := os.Getenv("ARTIFACT_LOCAL_DIR")
		if dir == "" {
			dir = filepath.Join(cfg.DataDir, "artifacts")
		}
		count, err := (&team.Service{DB: client, Artifacts: store}).MigrateArtifacts(ctx, dir)
		if err != nil {
			return err
		}
		slog.Info("artifact migration verified", "count", count)
		return nil
	}

	srv, handler, stopExtensions, err := Build(cfg, client, conn, target.Dialect, extensions, os.Getenv)
	if err != nil {
		return err
	}
	// After the server stops taking requests, and before the deferred close
	// of the database.
	defer stopExtensions()
	if srv.Team.Artifacts != nil {
		count, err := srv.Team.MigrateArtifactPaths(ctx)
		if err != nil {
			return err
		}
		slog.Info("artifact paths verified", "count", count)
	}
	if remote, ok := srv.Team.Artifacts.(*artifactstore.S3); ok {
		checkCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		err := remote.Check(checkCtx)
		cancel()
		if err != nil {
			return fmt.Errorf("S3 artifact storage check: %w", err)
		}
		slog.Info("artifact storage verified", "provider", "s3")
	}
	// A management process never offers the first account: the database is
	// shared, so it is claimed where members sign in, and a management
	// service's log is no place for a live link.
	if cfg.Passwords() && cfg.ServiceRole != "manage" {
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
// tests. stop ends what the extensions hold; call it once the server has
// stopped taking requests, before the database closes.
func Build(cfg config.Config, client *ent.Client, conn *sql.DB, dialect string, exts []edition.Extension, env func(string) string) (*httpapi.Server, http.Handler, func(), error) {
	if cfg.ServiceRole == "" {
		cfg.ServiceRole = env("SERVICE_ROLE")
		if cfg.ServiceRole == "" {
			cfg.ServiceRole = "combined"
		}
	}
	if cfg.ServiceRole != "user" && cfg.ServiceRole != "manage" && cfg.ServiceRole != "combined" {
		return nil, nil, nil, errors.New("invalid SERVICE_ROLE")
	}
	keys, err := team.NewKeys(cfg.ProviderKeysSecret)
	if err != nil {
		return nil, nil, nil, err
	}
	network := &team.Network{AllowPrivate: cfg.AllowPrivateProviders}
	authn := &auth.Service{DB: client, Sealer: auth.NewSealer(cfg.AuthSecret, nil), Secret: cfg.AuthSecret}
	teams := &team.Service{DB: client, Keys: keys, Network: network, Auth: authn, Passwords: cfg.Passwords()}
	if cfg.ServiceRole != "manage" {
		teams.Artifacts, err = artifactstore.FromEnv(cfg.DataDir, env)
		if err != nil {
			return nil, nil, nil, err
		}
	}
	teams.ProtectedAccount = func(email string) bool { return manage.IsAdmin(email, env("ADMIN_EMAILS")) }
	meter := &usage.Service{DB: client, AppURL: cfg.AppURL}
	srv := &httpapi.Server{
		Config:  cfg,
		Auth:    authn,
		Team:    teams,
		Gateway: &gateway.Gateway{Team: teams, Client: network.Client(), Usage: meter},
		Usage:   meter,
	}
	if !cfg.Passwords() {
		mail := auth.SMTP{URL: cfg.SMTPURL, From: cfg.EmailFrom}
		srv.Mailer = mail
		meter.SendNotice = func(ctx context.Context, message usage.NoticeMessage) error {
			return mail.SendMessage(ctx, auth.Message{To: message.To, Subject: message.Subject, Text: message.Text, ID: message.ID})
		}
	}
	if cfg.Google() {
		// A stalled Google must not hold a sign-in, and its goroutine, for ever.
		srv.Google = auth.NewGoogle(cfg.GoogleID, cfg.GoogleSecret, cfg.AppURL, &http.Client{Timeout: 15 * time.Second})
	}

	srv.Mux = http.NewServeMux()
	var teamHandlers []struct {
		owner  string
		handle edition.TeamChangeHandler
	}
	teams.Changed = func(ctx context.Context, db *ent.Client, change edition.TeamChange) error {
		for _, subscriber := range teamHandlers {
			if err := usage.Participate(db, change.TeamID, subscriber.owner, func(tx edition.SQLExecutor) error {
				return subscriber.handle(ctx, tx, change)
			}); err != nil {
				return err
			}
		}
		return nil
	}
	console := edition.AdminConsole{Base: "/manage"}
	var webFiles fs.FS
	var adminRoutes []edition.AdminRoute
	host := edition.Host{
		ServiceRole:     cfg.ServiceRole,
		AddAdminRoutes:  func(routes []edition.AdminRoute) { adminRoutes = append(adminRoutes, routes...) },
		SetAdminConsole: func(c edition.AdminConsole) { console = c },
		SetWebConsole:   func(files fs.FS) { webFiles = files },
		DB:              conn, Dialect: dialect, AppURL: cfg.AppURL, AuthSecret: cfg.AuthSecret, Mux: srv.Mux,
		Bearer: srv.BearerIdentity, Session: srv.SessionIdentity, SameOrigin: srv.SameOrigin,
		MintComputerToken: srv.MintComputerToken,
		Users:             NewUsers(client), Env: env,
		WithTeamTx:          meter.WithTeamTx,
		ResolveFundingUsage: meter.ResolveFunding,
		TeamExists: func(ctx context.Context, id string) (bool, error) {
			_, err := client.Team.Get(ctx, id)
			if ent.IsNotFound(err) {
				return false, nil
			}
			return err == nil, err
		},
		TeamRole: func(ctx context.Context, userID, teamID string, admin bool) (string, error) {
			m, err := teams.RequireMembership(ctx, userID, teamID, admin)
			if err != nil {
				return "", err
			}
			return string(m.Role), nil
		},
	}
	stops := []func(){}
	if cfg.ServiceRole != "manage" {
		stops = append(stops, meter.StartMaintenance())
	}
	stop := func() {
		for i := len(stops) - 1; i >= 0; i-- {
			stops[i]()
		}
	}
	for _, e := range exts {
		host.RegisterFunding = func(p edition.ModelFunding) (edition.FundingHost, error) { return meter.RegisterFunding(e.Name, p) }
		host.RegisterMeters = func(m []edition.Meter, f edition.MeterFunding) (edition.MeterHost, error) {
			return meter.RegisterMeters(e.Name, m, f)
		}
		subscribed := false
		host.SubscribeTeams = func(handle edition.TeamChangeHandler) error {
			if handle == nil || subscribed {
				return errors.New("invalid or duplicate team subscription")
			}
			subscribed = true
			teamHandlers = append(teamHandlers, struct {
				owner  string
				handle edition.TeamChangeHandler
			}{e.Name, handle})
			return nil
		}
		s, err := e.Mount(host)
		if err != nil {
			stop()
			return nil, nil, nil, fmt.Errorf("%s: %w", e.Name, err)
		}
		if s != nil {
			stops = append(stops, s)
		}
	}
	webOptions := web.Options{AppURL: cfg.AppURL, PostHogKey: cfg.PostHogKey, PostHogHost: cfg.PostHogHost, Viewer: srv.Viewer}
	devManage := ""
	if cfg.DevVite {
		srv.Web, devManage = web.Dev(config.DevWebOrigin, webOptions), config.DevManageOrigin
	} else {
		srv.Web = web.Handler(webFiles, webOptions)
	}
	manage.Mount(host, client, console, adminRoutes, devManage)
	srv.ManageRoot = cfg.ServiceRole == "manage" && console.Base == "" && env("ADMIN_EMAILS") != ""
	return srv, srv.Handler(), stop, nil
}
