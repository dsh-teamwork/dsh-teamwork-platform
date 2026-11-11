# DSH Teamwork

Team configuration for DeepSeek Harness: a team publishes models, presets and
plugin pins once, and every member's DSH picks them up through the
`@dsh-teamwork/dsh-teamwork` plugin. Model calls go through this platform, so
provider keys never leave the server.

| | |
| --- | --- |
| `apps/web` | Next.js 16 · the site, the team console and the API (`/api/*`) the plugin calls · Tailwind v4 · next-intl |
| `packages/db` | Prisma 7 over Postgres · nanoid keys |
| `packages/shared` | Wire schemas, locales, and the sign-in strategy |

## Quick start

```bash
nvm use                 # Node 24.19.0
pnpm install
pnpm dev:setup          # Postgres in Docker (or: pnpm dev:shared, the ~/code/shushuo/dev stack)
cp apps/web/.env.example apps/web/.env
pnpm db:deploy
pnpm dev                # web :3800
```

## Self-hosting

`compose.yaml` runs one team's instance: Postgres and the web app, which
applies every migration before it starts. No Google, PostHog or Resend account
is needed, and no mail server either: without `SMTP_URL`, people sign in with
an email and a password.

1. Beside `compose.yaml`, write a `.env` (`apps/web/.env.example` explains each
   variable):

   ```bash
   POSTGRES_PASSWORD=…                        # openssl rand -hex 16
   APP_URL=https://teamwork.example.com       # the address members open
   AUTH_SECRET=…                              # openssl rand -base64 32
   LLM_ROUTES_JSON={"deepseek":{"baseURL":"https://api.deepseek.com/v1","apiKeyEnv":"DEEPSEEK_API_KEY"}}
   DEEPSEEK_API_KEY=…
   # Optional: SMTP_URL and AUTH_EMAIL_FROM send sign-in codes instead of
   # using passwords; AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET add a Google button;
   # WEB_PORT changes the host port (3000).
   ```

2. Start it:

   ```bash
   docker compose up -d --build
   ```

3. **Serve it over HTTPS.** A member's DSH plugin refuses plain HTTP anywhere
   but on loopback, so put a TLS proxy in front, for example
   `caddy reverse-proxy --from teamwork.example.com --to localhost:3000`.
4. **Claim the first account.** The web app prints
   `Create the first one at …/setup?token=…` when it starts
   (`docker compose logs web`). Open it, then create your team and add the
   others by email in `/team`: each gets a first password to change when they
   first sign in.
5. Point each member's plugin at `APP_URL` (`apiEndpoint` in the DSH profile's
   `cordis.patch.yml`). Then `/team login` signs them in.

A model the team serves itself on the same private network can be reached
over plain HTTP. The gateway allows `http://` only to a host that resolves to
loopback or private addresses. For example, for an `ollama` service:
`{"ollama":{"baseURL":"http://ollama:11434/v1","apiKeyEnv":"OLLAMA_API_KEY"}}`.
`OLLAMA_API_KEY` must be set to some value even though Ollama ignores it.

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
