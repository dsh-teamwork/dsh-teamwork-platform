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

With Git, Docker and Docker Compose, clone the repository and write the
address members will open into a `.env` beside `compose.yaml`, so the
first-account link the server prints already uses it:

```sh
git clone https://github.com/dsh-teamwork/dsh-teamwork-platform.git
cd dsh-teamwork-platform
echo 'APP_URL=https://teamwork.example.com' > .env
docker compose up -d --build
docker compose logs server
```

Leave `.env` out to try it on this machine at `http://localhost:3000`. The
server listens on port 3000 and keeps its SQLite database, generated secrets
and private plugin archives in the `data` volume. Open the first-account link
it prints, then create a team.

Every setting goes in `.env`, one `NAME=value` per line. After changing it, run
`docker compose up -d` again.

## Make it reachable

Serve it over HTTPS at the `APP_URL` address. For example, with Caddy in front
of port 3000:

```sh
caddy reverse-proxy --from teamwork.example.com --to localhost:3000
```

Compose publishes port 3000 on every network interface, as plain HTTP. Once a
proxy serves HTTPS, close port 3000 to everything but the proxy, for example
with your firewall.

Without `SMTP_URL`, people sign in with a password the admin creates for them;
with it, they get emailed codes and invitation links. Postgres or MySQL can
replace SQLite through `DATABASE_URL`.

Compose sets `ALLOW_PRIVATE_PROVIDERS=true`, so an admin may point a team's
model provider at a machine on your own network, plain HTTP included. On an
instance people you do not trust can use, add `ALLOW_PRIVATE_PROVIDERS=false`
to `.env`: otherwise their team admins can make the server call addresses
inside your network.

## Connect members

In each member's DSH, change the server on Teamwork's sign-in screen to your
`APP_URL`, then sign in. See [Install the plugin](/docs/install).

## Back up and upgrade

Back up the database, the private plugin archives and the generated secrets
together: with the default settings all three are the `data` volume. Stop the
server so the SQLite file is consistent, copy the volume into a dated archive,
and start it again:

```sh
docker compose stop
docker run --rm -v dsh-teamwork_data:/data -v "$PWD":/backup busybox \
  tar czf /backup/dsh-teamwork-$(date +%F).tar.gz -C /data .
docker compose start
```

To upgrade, take a backup, then pull and rebuild in the same folder. The volume
and its secrets carry over, and the server applies its migrations before it
serves:

```sh
git pull
docker compose up -d --build
```

Keep the same secrets across upgrades. The full runbook, with every setting,
upgrades and recovery, is
[Self-hosting the community server](https://github.com/dsh-teamwork/dsh-teamwork-platform/blob/main/docs/ops/self-hosting.md).
