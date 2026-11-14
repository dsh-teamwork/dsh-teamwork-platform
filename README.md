# DSH Teamwork

Team configuration for DeepSeek Harness: a team publishes models, presets and
plugin pins once, and every member's DSH picks them up through the
`@dsh-teamwork/dsh-teamwork` plugin. Model calls go through this platform, so
provider keys never leave the server.

| | |
| --- | --- |
| `server` | Go · one binary: the API the plugin calls, sign-in, the model gateway, the console and the public pages, on SQLite, Postgres or MySQL (ADR 0014) |
| `apps/console` | Vite · React · Tailwind v4 · the console and the public pages, embedded into `server` |
| `api/openapi.yaml` | The wire contract the server is tested against and the console is typed from |
| `packages/shared` | The languages and the rule that picks one |

## Quick start

```bash
nvm use                 # Node 24.19.0, for the console and the tooling
pnpm install
pnpm build              # the console, embedded into the server
cd server && go run ./cmd/dsh-teamwork   # :3800, SQLite in ~/.dsh-teamwork
```

It prints a link that claims the first account. `CLAUDE.md` has the rest:
the gate, the databases the suites run on, and working on the console with
`pnpm dev`.

## Self-hosting

The server is one program (ADR 0014): the API, the console and the public
pages, over a SQLite file in its data directory unless `DATABASE_URL` names a
Postgres or MySQL database. No Google, PostHog or mail account is needed:
without `SMTP_URL`, people sign in with an email and a password. It writes
its own `AUTH_SECRET` and `PROVIDER_KEYS_SECRET` into `secrets.json` in the
data directory on first start, unless the environment sets them.

1. **Start it**, one of three ways:

   - With Node installed, to try it: `npx @dsh-teamwork/server` (data in
     `~/.dsh-teamwork`, served on `http://localhost:3800`). Node is needed to
     install it, not to run it.
   - As a service: download the binary for your platform from the
     [releases](https://github.com/dsh-teamwork/dsh-teamwork-platform/releases)
     (checked against `SHA256SUMS`) and run `dsh-teamwork --data <dir>` from
     your service manager. Run the binary itself, never `npx`: npm does not
     pass a stop signal on.
   - In a container: `docker compose up -d --build` beside `compose.yaml`,
     which keeps the data in a volume and publishes port 3000 (`PORT` in a
     `.env` beside it changes that; the container's own address is fixed).

   Every setting is an environment variable (in compose, a `.env` beside
   `compose.yaml`): `APP_URL`, the address members open; `DATABASE_URL`;
   `SMTP_URL` and `AUTH_EMAIL_FROM` to send sign-in codes instead of using
   passwords; `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` for a Google button;
   `HOST` and `PORT` to listen elsewhere than `127.0.0.1:3800`.

2. **Serve it over HTTPS.** A member's DSH plugin refuses plain HTTP anywhere
   but on loopback, so put a TLS proxy in front, for example
   `caddy reverse-proxy --from teamwork.example.com --to localhost:3000`, and
   set `APP_URL` to that address.
3. **Claim the first account.** The server prints
   `Create the first one at …/setup?token=…` when it starts
   (`docker compose logs server`). Open it, then create your team and add the
   others by email in its console under `/teams`: each gets a first password
   to change when they first sign in.
4. Point each member's DSH plugin at `APP_URL`: in its Teamwork panel, change
   the server on the sign-in screen (or set `apiEndpoint` in the DSH profile's
   `cordis.patch.yml`). Then they sign in from the panel or with `/teamwork login`.

Providers and their keys are the team's own: its admin adds them in the
team's console, and the keys are stored encrypted under `PROVIDER_KEYS_SECRET`. A model the
team serves itself on the same network (Ollama, vLLM) can be added by its
private address, over plain HTTP too, with `ALLOW_PRIVATE_PROVIDERS=true`,
which `compose.yaml` sets. Set it to `false` if people you do not trust
share the instance.

The documents — architecture, the community edition, decisions, analytics — are indexed
in [`docs/README.md`](docs/README.md).

## Contributing

Pull requests are welcome. Every commit carries a `Signed-off-by:` line
(`git commit -s`), certifying the [Developer Certificate of
Origin](https://developercertificate.org/): that you wrote the change, or have
the right to submit it under this repository's licence. A pull request runs the
same gate as `.husky/pre-push`; `CLAUDE.md` is the working agreement.

## License

Apache License 2.0 (`LICENSE`). The name and the whale mark are not licensed
with the code (`NOTICE`), so a fork uses its own. A directory with its own
`LICENSE` is covered by that file instead.
