#!/usr/bin/env bash
#
# Brings up Postgres for local development, on its own. `pnpm dev:setup` wraps
# this; `stop.sh` and `clean.sh` are its siblings. `pnpm dev:shared` is the
# alternative: the ~/code/shushuo/dev stack every sibling can share.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }
fail() { printf '\033[1;31m%s\033[0m\n' "$1" >&2; exit 1; }

docker info >/dev/null 2>&1 || fail 'Docker is not running.'

# Another stack on 5432 (the shared one, or a sibling's own) would make
# `compose up` fail on the port with a message that names neither.
holder=$(docker ps --filter publish=5432 --format '{{.Names}}' | grep -v '^dsh-teamwork-dev-' || true)
if [ -n "$holder" ]; then
  fail "Port 5432 is taken by: ${holder//$'\n'/, }.
Stop that stack first (the shared one: pnpm dev:shared:stop), or keep using it
— this project's .env reaches either."
fi

step 'starting postgres'
docker compose up -d --wait postgres
docker compose ps

step 'ready'
cat <<'TXT'
postgres    postgresql://postgres:postgres_password@localhost:5432/dsh_teamwork
shadow      postgresql://postgres:postgres_password@localhost:5432/dsh_teamwork_shadow

These match apps/web, premium/apps/manage and packages/db .env.example as they are.
Apply the schema with: pnpm db:deploy

Stop:   pnpm dev:stop
Reset:  pnpm dev:clean
TXT
