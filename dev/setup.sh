#!/usr/bin/env bash
#
# Brings up Postgres and MySQL for the Go server's suites and drift check.
# `pnpm dev:setup` wraps this; `stop.sh` and `clean.sh` are its siblings.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }
fail() { printf '\033[1;31m%s\033[0m\n' "$1" >&2; exit 1; }

docker info >/dev/null 2>&1 || fail 'Docker is not running.'

# Another stack on 5432 or 3306 would make `compose up` fail on the port with
# a message that names neither.
holder=$(docker ps --filter publish=5432 --filter publish=3306 --format '{{.Names}}' | grep -v '^dsh-teamwork-dev-' || true)
if [ -n "$holder" ]; then
  fail "Port 5432 or 3306 is taken by: ${holder//$'\n'/, }. Stop that first."
fi

step 'starting postgres and mysql'
docker compose up -d --wait
docker compose ps

step 'ready'
cat <<'TXT'
export TEST_POSTGRES_URL='postgres://postgres:postgres_password@localhost:5432/postgres?sslmode=disable'
export TEST_MYSQL_URL='mysql://root:mysql_password@localhost:3306/mysql'
export MIGRATE_DEV_POSTGRES='postgres://postgres:postgres_password@localhost:5432/go_drift?sslmode=disable'
export MIGRATE_DEV_MYSQL='mysql://root:mysql_password@localhost:3306/go_drift'

With these set, `pnpm test` runs every database case on all three dialects
and `pnpm db:drift` checks the migrations of each.

Stop:   pnpm dev:stop
Reset:  pnpm dev:clean
TXT
