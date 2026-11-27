// Package app runs the server: what the open binary's main and the closed
// binary's main both call (ADR 0014). The open binary has no extensions; the
// closed one registers its own through package edition before Main runs.
package app

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"golang.org/x/net/publicsuffix"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/artifacts"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/auth"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/config"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/gateway"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/httpapi"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/knowledge"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/objectstore"
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
	if cfg.MigratePackagePaths {
		store, err := objectstore.FromEnv(cfg.DataDir, os.Getenv)
		if err != nil {
			return err
		}
		count, err := (&team.Service{DB: client, Objects: store}).MigratePackagePaths(ctx)
		if err != nil {
			return err
		}
		slog.Info("package paths verified", "count", count)
		return nil
	}
	if cfg.MigratePackages {
		store, err := objectstore.FromEnv(cfg.DataDir, os.Getenv)
		if err != nil {
			return err
		}
		if _, ok := store.(*objectstore.S3); !ok {
			return errors.New("--migrate-artifacts requires ARTIFACT_STORAGE_PROVIDER=s3")
		}
		dir := os.Getenv("ARTIFACT_LOCAL_DIR")
		if dir == "" {
			dir = filepath.Join(cfg.DataDir, "artifacts")
		}
		count, err := (&team.Service{DB: client, Objects: store}).MigratePackages(ctx, dir)
		if err != nil {
			return err
		}
		slog.Info("package migration verified", "count", count)
		return nil
	}

	srv, handler, stopExtensions, err := Build(cfg, client, conn, target.Dialect, extensions, os.Getenv)
	if err != nil {
		return err
	}
	// After the server stops taking requests, and before the deferred close
	// of the database.
	defer stopExtensions()
	if srv.Team.Objects != nil {
		count, err := srv.Team.MigratePackagePaths(ctx)
		if err != nil {
			return err
		}
		slog.Info("package paths verified", "count", count)
	}
	if remote, ok := srv.Team.Objects.(*objectstore.S3); ok {
		checkCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		err := remote.Check(checkCtx)
		cancel()
		if err != nil {
			return fmt.Errorf("S3 object storage check: %w", err)
		}
		slog.Info("object storage verified", "provider", "s3")
	}
	// A management process never offers the first account: the database is
	// shared, so it is claimed where members sign in. Elsewhere the sign-in
	// page offers it to whoever opens it first (ADR 0070); this line only
	// says where to go.
	if cfg.Passwords() && cfg.ServiceRole != "manage" {
		if open, err := srv.Auth.SetupOpen(ctx); err != nil {
			slog.Error("could not check for a first account", "error", err)
		} else if open {
			fmt.Printf("No account exists yet. Create the first one at %s/setup\n", cfg.AppURL)
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
	authn := &auth.Service{DB: client, Sealer: auth.NewSealer(cfg.AuthSecret, nil), Secret: cfg.AuthSecret,
		ReviewEmail: cfg.ReviewEmail, ReviewCode: cfg.ReviewCode}
	if cfg.ReviewEmail != "" {
		slog.Warn("REVIEW_SIGN_IN: this address signs in with a fixed code; unset it once store review is over", "email", cfg.ReviewEmail)
	}
	teams := &team.Service{DB: client, Keys: keys, Network: network, Auth: authn, Passwords: cfg.Passwords()}
	if cfg.ServiceRole != "manage" {
		teams.Objects, err = objectstore.FromEnv(cfg.DataDir, env)
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
	if cfg.ServiceRole != "manage" {
		srv.Artifacts = &artifacts.Service{DB: client, Store: teams.Objects, Team: teams, Sealer: authn.Sealer, ContentURL: cfg.ContentURL}
		srv.Knowledge = &knowledge.Service{DB: client, Team: teams, Store: teams.Objects}
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
	var push edition.SendPush
	console := edition.AdminConsole{Base: "/manage"}
	var webFiles fs.FS
	var adminRoutes []edition.AdminRoute
	host := edition.Host{
		AppLogin:        srv.AppLoginIdentity,
		ServiceRole:     cfg.ServiceRole,
		AddAdminRoutes:  func(routes []edition.AdminRoute) { adminRoutes = append(adminRoutes, routes...) },
		SetAdminConsole: func(c edition.AdminConsole) { console = c },
		SetWebConsole:   func(files fs.FS) { webFiles = files },
		DB:              conn, Dialect: dialect, AppURL: cfg.AppURL, AuthSecret: cfg.AuthSecret, Mux: srv.Mux,
		OnSignOut: func(f func(context.Context, *edition.Identity) error) {
			srv.SignOutHandlers = append(srv.SignOutHandlers, f)
		},
		RegisterSignInGate: func(g edition.SignInGate) { srv.SignInGate = g }, PendingLogin: srv.PendingLogin, CompleteLogin: srv.CompleteLogin,
		Bearer: srv.BearerIdentity, Session: srv.SessionIdentity, SameOrigin: srv.SameOrigin,
		MintComputerToken: srv.MintComputerToken,
		SetPush: func(send edition.SendPush) error {
			if send == nil || push != nil {
				return errors.New("invalid or duplicate push sender")
			}
			push = send
			return nil
		},
		Push: func() edition.SendPush { return push },
		ServeSubdomains: func(domain string, h http.Handler) error {
			domain = strings.ToLower(strings.Trim(domain, "."))
			if h == nil {
				return fmt.Errorf("no handler for the subdomains of %q", domain)
			}
			if err := checkSubdomains(cfg.AppURL, domain, srv.Subdomains); err != nil {
				return err
			}
			if srv.Subdomains == nil {
				srv.Subdomains = map[string]http.Handler{}
			}
			srv.Subdomains[domain] = h
			return nil
		},
		Objects: objects(teams.Objects),
		Users:   NewUsers(client), Env: env,
		Activity:            manage.Activity(client),
		ActivityInsights:    manage.ActivityInsights(client),
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
		CreateSystemTeam: teams.CreateSystemTeam,
		JoinMember:       teams.JoinMember,
		ResetTeamContent: teams.ResetTeamContent,
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
		// An extension's secrets are bound to its name; no team id has a colon.
		host.Seal = func(name, secret string) string { return keys.Seal("edition:"+e.Name, name, secret) }
		host.Unseal = func(name, sealed string) (string, error) { return keys.Open("edition:"+e.Name, name, sealed) }
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

// objects lends an edition the server's object store, beside its plugin
// archives; nil on a process without one.
func objects(store objectstore.Store) edition.Objects {
	if store == nil {
		return nil
	}
	return storeObjects{store}
}

type storeObjects struct{ store objectstore.Store }

func (o storeObjects) Put(ctx context.Context, teamID, kind, id string, body io.ReadSeeker, size int64) error {
	return o.store.PutObject(ctx, teamID, kind, id, body, size)
}

func (o storeObjects) Open(ctx context.Context, teamID, kind, id string) (io.ReadCloser, error) {
	return o.store.OpenObject(ctx, teamID, kind, id)
}

func (o storeObjects) Delete(ctx context.Context, teamID, kind, id string) error {
	return o.store.DeleteObject(ctx, teamID, kind, id)
}

// checkSubdomains says whether an edition may serve every subdomain of domain
// (edition.Host.ServeSubdomains): a registrable name on another site than
// APP_URL's, so no page there shares the platform's cookies' site, and
// neither inside nor around a domain already served, so each request has one
// handler. Registrations may share a site with each other (c.dshteam.work and
// d.dshteam.work): each handler refuses its siblings' requests itself.
func checkSubdomains(appURL, domain string, served map[string]http.Handler) error {
	app, err := url.Parse(appURL)
	if err != nil {
		return err
	}
	site, err := publicsuffix.EffectiveTLDPlusOne(domain)
	if err != nil || net.ParseIP(domain) != nil {
		return fmt.Errorf("invalid subdomains of %q", domain)
	}
	appHost := strings.ToLower(strings.TrimSuffix(app.Hostname(), "."))
	if appSite, err := publicsuffix.EffectiveTLDPlusOne(appHost); domain == appHost || strings.HasSuffix(appHost, "."+domain) || err == nil && appSite == site {
		return fmt.Errorf("subdomains of %q share the platform's site", domain)
	}
	for other := range served {
		if other == domain || strings.HasSuffix(other, "."+domain) || strings.HasSuffix(domain, "."+other) {
			return fmt.Errorf("subdomains of %q overlap those of %q", domain, other)
		}
	}
	return nil
}
