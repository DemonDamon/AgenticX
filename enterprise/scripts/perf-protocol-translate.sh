#!/usr/bin/env bash
# Compare TTFT/latency: OpenAI passthrough vs Claude inbound encode path (local smoke).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GATEWAY_DIR="$ROOT/apps/gateway"

echo "== perf-protocol-translate (smoke) =="
echo "Running Go benchmarks for transform + outbound encode..."

cd "$GATEWAY_DIR"
go test ./internal/transform/... ./internal/outbound/... -bench=. -benchtime=100ms -run=^$ 2>/dev/null || {
  echo "No benchmarks defined; running unit tests as fallback timing check"
  go test ./internal/transform/... ./internal/inbound/... ./internal/outbound/... -count=1
}

echo "Done. For full TTFT regression against live gateway, point anthropic/openai SDK at local gateway and compare stream first-byte timestamps."
