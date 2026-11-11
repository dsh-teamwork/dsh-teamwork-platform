#!/usr/bin/env bash
#
# Tears down the containers `pnpm dev:setup` starts and discards their volume —
# the local database goes. Data is expendable; the migrations that rebuild it
# are not (CLAUDE.md, Building). Touches only this project's stack, never the
# shared ~/code/shushuo/dev one.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

docker compose down -v --remove-orphans
printf '\nRemoved containers and volume. Start fresh with: pnpm dev:setup\n'
