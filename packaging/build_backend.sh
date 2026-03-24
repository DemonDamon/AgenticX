#!/usr/bin/env bash
# Build PyInstaller agx-server binary for one macOS architecture.
# Usage: packaging/build_backend.sh [arm64|x64]
# Author: Damon Li

set -euo pipefail

ARCH="${1:-arm64}"
if [[ "$ARCH" != "arm64" && "$ARCH" != "x64" ]]; then
  echo "Usage: $0 [arm64|x64]"
  exit 1
fi

pick_python() {
  for c in python3.13 python3.12 python3.11 python3.10 python3; do
    if command -v "$c" &>/dev/null; then
      if "$c" -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" 2>/dev/null; then
        echo "$c"
        return 0
      fi
    fi
  done
  return 1
}

PYTHON_BIN="$(pick_python)" || {
  echo "✗ Need Python >= 3.10 on PATH (e.g. python3.12). Got: $(command -v python3 || true)"
  exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$SCRIPT_DIR/dist/$ARCH"
WORK_DIR="$SCRIPT_DIR/build/$ARCH"
PY_DIR="$SCRIPT_DIR/pyinstaller"
VENV="$SCRIPT_DIR/.venv-packaging"

echo "=== Building agx-server for $ARCH ==="

if [[ ! -x "$VENV/bin/python" ]]; then
  "$PYTHON_BIN" -m venv "$VENV"
fi
VPY="$VENV/bin/python"
VPIP="$VENV/bin/pip"

"$VPIP" install -q -U pip
"$VPIP" install -q pyinstaller
# Non-editable install so PyInstaller sees a real site-packages tree (editable can miss subpackages).
"$VPIP" uninstall -y agenticx 2>/dev/null || true
"$VPIP" install -q "$PROJECT_ROOT"

cd "$PY_DIR"

"$VPY" -m PyInstaller agx_serve.spec \
  --distpath "$DIST_DIR" \
  --workpath "$WORK_DIR" \
  --clean \
  --noconfirm

BINARY="$DIST_DIR/agx-server"
if [[ ! -x "$BINARY" ]]; then
  echo "✗ Expected binary not found or not executable: $BINARY"
  exit 1
fi

echo "=== Built: $BINARY ($(du -sh "$BINARY" | cut -f1)) ==="

echo "=== Smoke test ==="
FREE_PORT="$("$VPY" -c "import socket; s=socket.socket(); s.bind(('127.0.0.1',0)); p=s.getsockname()[1]; s.close(); print(p)")"
AGX_DESKTOP_TOKEN="" "$BINARY" --host 127.0.0.1 --port "$FREE_PORT" &
PID=$!
cleanup() {
  kill "$PID" 2>/dev/null || true
  wait "$PID" 2>/dev/null || true
}
trap cleanup EXIT
CODE="000"
for _i in $(seq 1 60); do
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "✗ agx-server exited early"
    exit 1
  fi
  # Avoid HTTP(S)_PROXY routing localhost through a proxy (often yields 502).
  CODE="$(curl --noproxy '*' -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${FREE_PORT}/api/session" 2>/dev/null || echo "000")"
  if [[ "$CODE" == "200" ]]; then
    break
  fi
  sleep 1
done
if [[ "$CODE" != "200" ]]; then
  echo "✗ /api/session expected 200, got $CODE (after up to 60s wait)"
  exit 1
fi
echo "✓ agx-server smoke test passed"
