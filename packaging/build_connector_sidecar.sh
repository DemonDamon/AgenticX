#!/usr/bin/env bash
# Cross-compile the connector-runtime sidecar (Go single binary) and stage it
# into desktop/bundled-sidecar/ for electron-builder packaging.
# Usage: packaging/build_connector_sidecar.sh [arm64|x64|win-amd64|all]
# Author: Damon Li

set -euo pipefail

ARCH="${1:-arm64}"
if [[ "$ARCH" != "arm64" && "$ARCH" != "x64" && "$ARCH" != "win-amd64" && "$ARCH" != "all" ]]; then
  echo "Usage: $0 [arm64|x64|win-amd64|all]"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC_DIR="$PROJECT_ROOT/connector-runtime"
STAGE_DIR="$PROJECT_ROOT/desktop/bundled-sidecar"

if ! command -v go &>/dev/null; then
  echo "✗ Go toolchain not found on PATH"
  exit 1
fi

build_one() {
  local arch="$1" goos goarch ext
  case "$arch" in
    arm64)    goos="darwin";  goarch="arm64"; ext="" ;;
    x64)      goos="darwin";  goarch="amd64"; ext="" ;;
    win-amd64) goos="windows"; goarch="amd64"; ext=".exe" ;;
    *) echo "✗ Unknown arch: $arch"; exit 1 ;;
  esac

  local out="$STAGE_DIR/$arch/connector-runtime$ext"
  echo "=== Building connector-runtime ($goos/$goarch) → $out ==="
  mkdir -p "$STAGE_DIR/$arch"
  (cd "$SRC_DIR" && GOOS="$goos" GOARCH="$goarch" CGO_ENABLED=0 \
    go build -trimpath -ldflags "-s -w" -o "$out" ./cmd/connector-runtime)
  chmod 755 "$out"
  echo "✓ $(du -h "$out" | cut -f1)  $out"
}

if [[ "$ARCH" == "all" ]]; then
  for a in arm64 x64 win-amd64; do build_one "$a"; done
else
  build_one "$ARCH"
fi
