#!/usr/bin/env bash
# Builds the five binaries and lays out the six npm packages in spike/npx/out.
set -euo pipefail
cd "$(dirname "$0")"
V=0.0.1
S=@dsh-teamwork-exp
rm -rf out && mkdir -p out
targets="linux/x64/linux/amd64 linux/arm64/linux/arm64 darwin/x64/darwin/amd64 darwin/arm64/darwin/arm64 win32/x64/windows/amd64"
deps=""
for t in $targets; do
  IFS=/ read -r nos narch gos garch <<<"$t"
  ext=""; [ "$gos" = windows ] && ext=.exe
  d=out/server-$nos-$narch
  mkdir -p "$d/bin"
  GOOS=$gos GOARCH=$garch CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=$V" -o "$d/bin/dsh-teamwork$ext" .
  printf '{"name":"%s/server-%s-%s","version":"%s","os":["%s"],"cpu":["%s"],"files":["bin"],"license":"Apache-2.0","preferUnplugged":true}\n' \
    "$S" "$nos" "$narch" "$V" "$nos" "$narch" > "$d/package.json"
  deps="$deps\"$S/server-$nos-$narch\":\"$V\","
done
mkdir -p out/server/bin
cp npm/launcher.js out/server/bin/launcher.js
chmod +x out/server/bin/launcher.js
printf '{"name":"%s/server","version":"%s","bin":{"dsh-teamwork":"bin/launcher.js"},"files":["bin"],"license":"Apache-2.0","optionalDependencies":{%s}}\n' \
  "$S" "$V" "${deps%,}" > out/server/package.json
printf 'storage: ./storage\nmax_body_size: 100mb\nuplinks: { npmjs: { url: https://registry.npmjs.org/ } }\npackages:\n  "@dsh-teamwork-exp/*": { access: $all, publish: $all }\n  "**": { access: $all, proxy: npmjs }\nlog: { type: stdout, format: pretty, level: warn }\n' > out/verdaccio.yaml
