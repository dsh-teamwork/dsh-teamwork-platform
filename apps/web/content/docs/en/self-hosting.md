---
title: Run your own server
description: Start the open-source community edition, point members' DSH at it, and keep its data.
---

The community edition is open source under Apache-2.0: teams, models, presets,
plugins, the assistant, review and history, usage and budgets, the gateway,
and the relay. The hosted service's prepaid models are not
part of it. The DSH Teamwork phone app connects to your own server as
installed: on its sign-in screen, choose **Use another server** and enter the
`APP_URL` your members open, which must be HTTPS; the server needs no setting
for it.

## Start an instance

With Git, Docker and Docker Compose:

```sh
git clone https://github.com/dsh-teamwork/dsh-teamwork-platform.git
cd dsh-teamwork-platform
docker compose up -d --build
docker compose logs server
```

The server listens on port 3000 and keeps its SQLite database, generated
secrets and private plugin archives in the `data` volume. Open the first-account
link it prints, then create a team.

## Make it reachable

Serve it over HTTPS and set `APP_URL` to the address members open. For example,
with Caddy in front of port 3000:

```sh
caddy reverse-proxy --from teamwork.example.com --to localhost:3000
```

Without `SMTP_URL`, people sign in with a password the admin creates for them;
with it, they get emailed codes and invitation links. Postgres or MySQL can
replace SQLite through `DATABASE_URL`.

## Connect members

In each member's DSH, change the server on Teamwork's sign-in screen to your
`APP_URL`, then sign in. See [Install the plugin](/docs/install).

## Keep it safe

Back up the database, the private plugin archives and the generated secrets
together, and keep the same secrets across upgrades. The full runbook, with
every setting, upgrades and recovery, is
[Self-hosting the community server](https://github.com/dsh-teamwork/dsh-teamwork-platform/blob/main/docs/ops/self-hosting.md).
