#!/usr/bin/env bash
# Start mock upstream + gateway (perf fixtures), run k6 scripts, archive baseline JSON.
#
# Usage (from repo root or enterprise/):
#   bash enterprise/scripts/perf/run-gateway-baseline.sh
#   PERF_K6_VUS=50 PERF_K6_DURATION=60s bash enterprise/scripts/perf/run-gateway-baseline.sh
#
# Requires: go, k6, python3; bootstrap PEM at enterprise/.local-secrets/auth_*.pem
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENTERPRISE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PERF_DIR="$SCRIPT_DIR"
FIXTURES="$PERF_DIR/fixtures"
RUNTIME="$ENTERPRISE_DIR/.runtime/perf-baseline"
BASELINES_DIR="$ENTERPRISE_DIR/docs/perf-baselines"
MOCK_ADDR="${MOCK_UPSTREAM_ADDR:-127.0.0.1:19099}"
GATEWAY_ADDR="${GATEWAY_PERF_ADDR:-127.0.0.1:18088}"
MOCK_DELAY_MS="${MOCK_UPSTREAM_DELAY_MS:-0}"
K6_VUS="${PERF_K6_VUS:-20}"
K6_DURATION="${PERF_K6_DURATION:-20s}"

MOCK_PID=""
GATEWAY_PID=""

cleanup() {
  if [ -n "$GATEWAY_PID" ] && kill -0 "$GATEWAY_PID" 2>/dev/null; then
    kill "$GATEWAY_PID" 2>/dev/null || true
    wait "$GATEWAY_PID" 2>/dev/null || true
  fi
  if [ -n "$MOCK_PID" ] && kill -0 "$MOCK_PID" 2>/dev/null; then
    kill "$MOCK_PID" 2>/dev/null || true
    wait "$MOCK_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[perf] missing command: $1" >&2
    exit 1
  fi
}

require_cmd go
require_cmd k6
require_cmd python3

PRIVATE_PEM="${AUTH_JWT_PRIVATE_KEY_FILE:-$ENTERPRISE_DIR/.local-secrets/auth_private.pem}"
PUBLIC_PEM="${AUTH_JWT_PUBLIC_KEY_FILE:-$ENTERPRISE_DIR/.local-secrets/auth_public.pem}"
if [ ! -f "$PRIVATE_PEM" ] || [ ! -f "$PUBLIC_PEM" ]; then
  echo "[perf] JWT PEM not found. Run: cd enterprise && bash scripts/bootstrap.sh" >&2
  exit 1
fi

mkdir -p "$RUNTIME" "$BASELINES_DIR" "$RUNTIME/summaries"

COMMIT="$(git -C "$ENTERPRISE_DIR/.." rev-parse --short HEAD 2>/dev/null || echo unknown)"
HOST="$(hostname -s 2>/dev/null || hostname)"
OS_INFO="$(uname -srm 2>/dev/null || uname -a)"
CPU_INFO="$(sysctl -n machdep.cpu.brand_string 2>/dev/null || lscpu 2>/dev/null | rg 'Model name' | head -1 || echo n/a)"
NOW_ISO="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
STAMP="$(date -u +"%Y%m%d")"

GATEWAY_CFG="$RUNTIME/gateway-perf.config.yaml"
sed \
  -e "s|PLACEHOLDER_POLICY_MANIFEST|$FIXTURES/moderation-perf/manifest.yaml|g" \
  -e "s|PLACEHOLDER_AUDIT_DIR|$RUNTIME/audit|g" \
  -e "s|PLACEHOLDER_MOCK_ENDPOINT|http://$MOCK_ADDR/v1|g" \
  "$FIXTURES/gateway-perf.config.yaml" > "$GATEWAY_CFG"
mkdir -p "$RUNTIME/audit"

echo "[perf] starting mock upstream on http://$MOCK_ADDR (delay_ms=$MOCK_DELAY_MS)"
(
  cd "$PERF_DIR/mock-upstream"
  exec env MOCK_UPSTREAM_DELAY_MS="$MOCK_DELAY_MS" go run . -addr "$MOCK_ADDR" -delay-ms "$MOCK_DELAY_MS"
) &
MOCK_PID=$!

for _ in $(seq 1 30); do
  if curl -sf --noproxy '*' "http://$MOCK_ADDR/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

echo "[perf] starting gateway on http://$GATEWAY_ADDR"
(
  cd "$ENTERPRISE_DIR/apps/gateway"
  exec env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
    GATEWAY_CONFIG_PATH="$GATEWAY_CFG" \
    AUTH_JWT_PUBLIC_KEY="$(cat "$PUBLIC_PEM")" \
    GATEWAY_QUOTA_CONFIG_FILE="$FIXTURES/quotas-perf.json" \
    GATEWAY_QUOTA_USAGE_FILE="$RUNTIME/quota-usage.json" \
    GATEWAY_POLICY_OVERRIDE_FILE="$FIXTURES/policy-overrides-perf.json" \
    GATEWAY_POLICY_SNAPSHOT_FILE="$RUNTIME/policy-snapshot.json" \
    GATEWAY_USAGE_LOG="$RUNTIME/usage.jsonl" \
    GATEWAY_CACHE_L1=0 \
    GATEWAY_CACHE_L2=0 \
    PERF_MOCK_API_KEY=perf-mock-key \
    go run ./cmd/gateway
) &
GATEWAY_PID=$!

for _ in $(seq 1 60); do
  if curl -sf --noproxy '*' "http://$GATEWAY_ADDR/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

export AUTH_JWT_PRIVATE_KEY_FILE="$PRIVATE_PEM"
GATEWAY_PERF_BEARER="$(cd "$PERF_DIR/mint-perf-jwt" && go run .)"
export GATEWAY_PERF_BEARER
export GATEWAY_PERF_BASE="http://$GATEWAY_ADDR"
export PERF_K6_VUS="$K6_VUS"
export PERF_K6_DURATION="$K6_DURATION"

run_k6() {
  local script="$1"
  local name="$2"
  local out="$RUNTIME/summaries/${name}.json"
  echo "[perf] k6 $script (vus=$K6_VUS duration=$K6_DURATION)"
  k6 run "$script" --summary-export "$out"
}

run_k6 "$PERF_DIR/gateway-chat-nonstream.js" "nonstream"
run_k6 "$PERF_DIR/gateway-chat-stream.js" "stream"
run_k6 "$PERF_DIR/gateway-policy-quota.js" "policy-quota"

BASELINE_JSON="$BASELINES_DIR/gateway-chat-${STAMP}-${COMMIT}.json"
python3 "$PERF_DIR/aggregate_baseline.py" \
  --output "$BASELINE_JSON" \
  --commit "$COMMIT" \
  --timestamp "$NOW_ISO" \
  --host "$HOST" \
  --os "$OS_INFO" \
  --cpu "$CPU_INFO" \
  --mock-delay-ms "$MOCK_DELAY_MS" \
  --gateway-addr "$GATEWAY_ADDR" \
  --mock-addr "$MOCK_ADDR" \
  --vus "$K6_VUS" \
  --duration "$K6_DURATION" \
  "$RUNTIME/summaries/nonstream.json" \
  "$RUNTIME/summaries/stream.json" \
  "$RUNTIME/summaries/policy-quota.json"

echo "[perf] baseline archived: $BASELINE_JSON"
