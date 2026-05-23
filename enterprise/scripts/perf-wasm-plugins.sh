#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/apps/gateway"

echo "[perf-wasm] running wasmhost microbench via go test"
GATEWAY_PLUGINS_DIR="$ROOT/plugins" go test ./internal/wasmhost/... -bench=. -benchtime=1s -run=^$ 2>/dev/null || \
  go test ./internal/wasmhost/... -count=5

echo "[perf-wasm] baseline note: compare p95 with 0/1/4 plugins enabled in staging"
echo "[perf-wasm] ok"
