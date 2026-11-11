#!/usr/bin/env bash
#
# Stops the containers `pnpm dev:setup` starts, without discarding their data.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

docker compose stop
printf '\nStopped. Data is kept; start again with: pnpm dev:setup\n'
