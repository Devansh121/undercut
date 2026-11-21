#!/usr/bin/env bash
# Secret scan with the gitleaks binary from its GitHub release, verified against a
# pinned sha256 before it runs. Scans the full git history of the checkout.
set -euo pipefail

VERSION=8.30.1
SHA256_LINUX_X64=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb

root=$(cd "$(dirname "$0")/../.." && pwd)
bin_dir="$root/.cache/gitleaks/$VERSION"
bin="$bin_dir/gitleaks"

if [[ "$(uname -s)-$(uname -m)" != "Linux-x86_64" ]]; then
  echo "This script pins the linux x64 build only; run it on Linux x86_64 (CI does)." >&2
  exit 1
fi

if [[ ! -x "$bin" ]]; then
  mkdir -p "$bin_dir"
  tarball="$bin_dir/gitleaks.tar.gz"
  curl -sSfL -o "$tarball" \
    "https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/gitleaks_${VERSION}_linux_x64.tar.gz"
  echo "${SHA256_LINUX_X64}  ${tarball}" | sha256sum --check --strict -
  tar -xzf "$tarball" -C "$bin_dir" gitleaks
  rm "$tarball"
fi

"$bin" version
"$bin" git --redact --no-banner --exit-code 1 "$root"
