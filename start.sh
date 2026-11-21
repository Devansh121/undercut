#!/usr/bin/env bash
# One command: install if needed, build the client, start the rooms service and serve
# the game over HTTP and HTTPS on this machine's network. Ctrl-C stops everything.
#
# Ports: PORT (default 5173, HTTP), HTTPS_PORT (5174), ROOMS_PORT (8787, localhost only).
set -euo pipefail
cd "$(dirname "$0")"

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || fail "Node.js is not installed. Install Node 20.19 or newer: https://nodejs.org/"
node -e '
  const [maj, min] = process.versions.node.split(".").map(Number);
  if (maj < 20 || (maj === 20 && min < 19)) process.exit(1);
' || fail "Node $(node -v) is too old. Install Node 20.19 or newer: https://nodejs.org/"
command -v npm >/dev/null 2>&1 || fail "npm is not on PATH. It ships with Node.js."

# Fail fast on busy ports, before spending time on install and build.
node tools/serve/start.mjs --check-ports

# Install when node_modules is missing or was installed from a different lockfile.
lock_hash=$(node -e 'process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync("package-lock.json")).digest("hex"))')
stamp=node_modules/.install-stamp
if [[ ! -d node_modules || ! -f $stamp || $(cat "$stamp") != "$lock_hash" ]]; then
  echo "Installing dependencies (npm ci) ..."
  npm ci --no-audit --no-fund
  printf '%s' "$lock_hash" >"$stamp"
fi

echo "Building the client ..."
npm run --silent build -w @undercut/web -- --logLevel warn

exec node tools/serve/start.mjs
