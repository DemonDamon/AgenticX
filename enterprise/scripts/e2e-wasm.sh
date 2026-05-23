#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GATEWAY_DIR="$ROOT/apps/gateway"
BASE="${GATEWAY_INTERNAL_BASE_URL:-http://127.0.0.1:8080}"

echo "[e2e-wasm] gateway dir=$GATEWAY_DIR"

cd "$GATEWAY_DIR"
GATEWAY_PLUGINS_DIR="$ROOT/plugins" GATEWAY_WASM_PLUGINS=on go test ./internal/wasmhost/... -count=1

if curl -sf "$BASE/health" >/dev/null 2>&1 && [[ -n "${GATEWAY_INTERNAL_TOKEN:-}" ]]; then
  echo "[e2e-wasm] probing internal plugin list"
  curl -sf -H "Authorization: Bearer ${GATEWAY_INTERNAL_TOKEN}" "$BASE/internal/plugins" | head -c 400
  echo
  curl -sf -H "Authorization: Bearer ${GATEWAY_INTERNAL_TOKEN}" "$BASE/internal/errors" | head -c 400
  echo
else
  echo "[e2e-wasm] gateway not running or GATEWAY_INTERNAL_TOKEN unset — skipped live HTTP checks"
fi

echo "[e2e-wasm] ok"
