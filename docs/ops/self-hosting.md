# Self-hosting the community server

> **Status:** Current · **Updated:** 2026-11-16

Run a community instance, connect a member's DSH, and retain the database,
private plugin bytes and secrets across upgrades.

## When to use it

Use this runbook for a team running its own server. The hosted service at
`https://www.dshteamwork.com` is operated separately. Its relay, mobile App and
commercial wallet/payment services are not deployed by this repository.

Source builds and Docker Compose are available now. The community npm server
package and release binaries have not been published; do not use an assumed
`npx` package or an unverified download as your installation path.

## Start an instance

With Git, Docker and Docker Compose:

```sh
git clone https://github.com/dsh-teamwork/dsh-teamwork-platform.git
cd dsh-teamwork-platform
docker compose up -d --build
docker compose logs server
```

Compose publishes port 3000 by default and retains `/data` in the `data` volume.
Set `PORT` in a `.env` beside `compose.yaml` to change the published port.
The in-container port remains 3000. The volume contains the SQLite database,
generated secrets and, by default, private plugin archives.

For source builds, use the Node version from `.nvmrc`, pnpm 10.18.1 and the Go
version from `server/go.mod`:

```sh
pnpm install --frozen-lockfile
pnpm build
./server/dist/dsh-teamwork --data ./local-data
```

This listens on `127.0.0.1:3800`. Use the binary from a service manager for a
persistent source installation. `--data` selects its private data directory.
Without `DATABASE_URL` it uses SQLite; migrations apply before serving.

Open the first-account setup link printed by the server privately. Then create
a team in `/teams` and add members by email. Without SMTP, new local accounts
receive an initial password to change on first sign-in. No Google, analytics or
mail account is needed for a local password installation.

## Configure the public address and sign-in

Each setting is an environment variable. Compose also reads `.env` beside its
configuration file.

| Setting | Purpose |
| --- | --- |
| `APP_URL` | The exact origin members open and browsers use for authorization. |
| `HOST`, `PORT` | Source binary listener; Compose fixes its internal listener. |
| `DATABASE_URL` | Optional Postgres, MySQL or SQLite URL; absent means local SQLite. |
| `SMTP_URL`, `AUTH_EMAIL_FROM` | Email sign-in codes instead of password-only sign-in. |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Optional Google sign-in client. |
| `AUTH_SECRET` | Optional session-signing secret; otherwise retained in the data directory. |
| `PROVIDER_KEYS_SECRET` | Optional provider-key encryption secret; otherwise retained in the data directory. |
| `ADMIN_EMAILS` | Explicit instance administrators, independent of team roles. |
| `SERVICE_ROLE` | `combined` by default; `user` or `manage` separates surfaces. |

For non-loopback access, serve HTTPS through a TLS proxy and set `APP_URL` to
that origin. For a Compose instance on local port 3000, one Caddy command is
`caddy reverse-proxy --from teamwork.example.com --to localhost:3000`.
Register the matching OAuth callback with Google if using that sign-in method.

In each member's DSH plugin, change the server on Teamwork's sign-in screen to
`APP_URL` and authorize. The plugin refuses plain HTTP except on loopback.
Changing servers drops the old plugin login/resources.

Admins enter providers and keys in the team's Models page. Keys are encrypted
under the provider secret. Private provider addresses and plain HTTP require
`ALLOW_PRIVATE_PROVIDERS=true`, enabled by default in Compose for trusted local
networks. Use `false` on an instance shared with untrusted people. Provider
address policy is separate from the plugin's HTTPS requirement.

## Retain private artifacts

The default `ARTIFACT_STORAGE_PROVIDER=local` stores archives under the data
directory's `artifacts/`, or `ARTIFACT_LOCAL_DIR` if specified. A disposable
container directory is not retained storage. Multiple artifact-serving processes
must read the same bytes; independent volumes do not provide a shared store.

For S3-compatible private storage, configure the supported `ARTIFACT_S3_*`
settings and follow the verified offline migration in
[team assistant storage](../tech/team-assistant.md#private-plugin-artifacts).
The service never falls back to local disk after S3 is explicitly selected.
The database keeps artifact metadata; a database backup alone cannot recreate
private archives.

Instance management is a separate privilege. Use `ADMIN_EMAILS` and `/manage`;
see [system management](../tech/system-management.md) before separating roles
or placing services on different origins.

## Verify the installation

1. Open the console, create the first account and a demonstration team. Check
   that the new team's assistant preset exists.
2. Add a test provider/model and a member. Sign in as that member in DSH, sync,
   select a preset and create a session. A model call should reach your chosen
   provider through the gateway.
3. Submit a demonstration preset as a member. Verify the member has no publish
   action; approve as the team admin and confirm it appears after sync.
4. Submit a harmless private plugin, review the archive identity/digest and
   approve it. An authenticated member download must match the recorded digest.
5. Open publication history, compare revisions and export a resource backup.
   Restart the server and repeat the private download to verify persistence.

Resource publication is not local installation. Existing DSH plugin packages
continue to use the host's own update and approval flow.

## Upgrade and recover

Before an upgrade, stop writers and capture a consistent backup of the database,
private artifact directory or bucket, and generated/encryption/signing secrets.
Use the database's supported backup mechanism and retain all archive objects
referenced by that snapshot. Keep the deployment configuration securely too.
A console resource export is scoped to team resources, not a full operator backup.

Build the reviewed revision, retain the same storage and secrets, and restart.
Append-only migrations run before serving. Check startup diagnostics and repeat
the verification above, including a retained package's authenticated download.
Do not rotate signing or provider-key secrets as part of a routine upgrade.

Before rolling back a binary, check whether its schema and accounting invariants
still support the database. Migrations are never edited or reversed manually;
prefer a forward fix. Restore a full database-and-artifact snapshot only with
writers stopped and with the understanding that later writes will be lost.
The storage migration's rollback procedure also requires all retained objects.
