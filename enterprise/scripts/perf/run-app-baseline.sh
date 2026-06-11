#!/usr/bin/env bash
# App full-chain baseline: mock upstream + perf gateway + k6 login/chat (web-portal must be up).
#
# Usage (from repo root or enterprise/):
#   bash enterprise/scripts/perf/run-app-baseline.sh
#
# Prerequisites:
#   - web-portal on APP_PERF_BASE (default http://127.0.0.1:3000)
#   - portal GATEWAY_COMPLETIONS_URL=http://127.0.0.1:18088/v1/chat/completions
#   - APP_PERF_PASSWORD matches AUTH_DEV_OWNER_PASSWORD
#   - k6, go, python3; JWT PEM at enterprise/.local-secrets/
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENTERPRISE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PERF_DIR="$SCRIPT_DIR"
FIXTURES="$PERF_DIR/fixtures"
RUNTIME="$ENTERPRISE_DIR/.runtime/perf-app-baseline"
BASELINES_DIR="$ENTERPRISE_DIR/docs/perf-baselines"
MOCK_ADDR="${MOCK_UPSTREAM_ADDR:-127.0.0.1:19099}"
GATEWAY_ADDR="${GATEWAY_PERF_ADDR:-127.0.0.1:18088}"
APP_BASE="${APP_PERF_BASE:-http://127.0.0.1:3000}"
MOCK_DELAY_MS="${MOCK_UPSTREAM_DELAY_MS:-0}"
PERF_SKIP_INFRA="${PERF_SKIP_INFRA:-0}"

MOCK_PID=""
GATEWAY_PID=""

cleanup() {
  if [ "$PERF_SKIP_INFRA" = "1" ]; then
    return
  fi
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
    echo "[perf-app] missing command: $1" >&2
    exit 1
  fi
}

require_cmd go
require_cmd k6
require_cmd python3
require_cmd curl

if ! curl -sf --noproxy '*' "${APP_BASE}/" >/dev/null 2>&1; then
  echo "[perf-app] web-portal not reachable at ${APP_BASE}" >&2
  echo "[perf-app] start stack first: bash enterprise/scripts/start-dev-with-infra.sh" >&2
  exit 1
fi

mkdir -p "$RUNTIME" "$BASELINES_DIR" "$RUNTIME/summaries"

COMMIT="$(git -C "$ENTERPRISE_DIR/.." rev-parse --short HEAD 2>/dev/null || echo unknown)"
HOST="$(hostname -s 2>/dev/null || hostname)"
OS_INFO="$(uname -srm 2>/dev/null || uname -a)"
CPU_INFO="$(sysctl -n machdep.cpu.brand_string 2>/dev/null || lscpu 2>/dev/null | rg 'Model name' | head -1 || echo n/a)"
NOW_ISO="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
STAMP="$(date -u +"%Y%m%d")"

if [ "$PERF_SKIP_INFRA" != "1" ]; then
  PRIVATE_PEM="${AUTH_JWT_PRIVATE_KEY_FILE:-$ENTERPRISE_DIR/.local-secrets/auth_private.pem}"
  PUBLIC_PEM="${AUTH_JWT_PUBLIC_KEY_FILE:-$ENTERPRISE_DIR/.local-secrets/auth_public.pem}"
  if [ ! -f "$PRIVATE_PEM" ] || [ ! -f "$PUBLIC_PEM" ]; then
    echo "[perf-app] JWT PEM not found. Run: cd enterprise && bash scripts/bootstrap.sh" >&2
    exit 1
  fi

  GATEWAY_CFG="$RUNTIME/gateway-perf.config.yaml"
  sed \
    -e "s|PLACEHOLDER_POLICY_MANIFEST|$FIXTURES/moderation-perf/manifest.yaml|g" \
    -e "s|PLACEHOLDER_AUDIT_DIR|$RUNTIME/audit|g" \
    -e "s|PLACEHOLDER_MOCK_ENDPOINT|http://$MOCK_ADDR/v1|g" \
    "$FIXTURES/gateway-perf.config.yaml" > "$GATEWAY_CFG"
  mkdir -p "$RUNTIME/audit"

  echo "[perf-app] starting mock upstream on http://$MOCK_ADDR"
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

  echo "[perf-app] starting gateway on http://$GATEWAY_ADDR"
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
fi

export APP_PERF_BASE="$APP_BASE"
export APP_PERF_PASSWORD="${APP_PERF_PASSWORD:-${AUTH_DEV_OWNER_PASSWORD:-change-me}}"
export APP_PERF_MODEL="${APP_PERF_MODEL:-perf-mock/perf-mock-model}"

echo "[perf-app] ensure web-portal GATEWAY_COMPLETIONS_URL=http://$GATEWAY_ADDR/v1/chat/completions"
OUT="$RUNTIME/summaries/app-login-chat-200.json"
echo "[perf-app] k6 app-login-chat-200.js"
k6 run "$PERF_DIR/app-login-chat-200.js" --summary-export "$OUT"

BASELINE_JSON="$BASELINES_DIR/app-login-chat-${STAMP}-${COMMIT}.json"
python3 "$PERF_DIR/aggregate_baseline.py" \
  --output "$BASELINE_JSON" \
  --kind app-login-chat-perf-baseline \
  --commit "$COMMIT" \
  --timestamp "$NOW_ISO" \
  --host "$HOST" \
  --os "$OS_INFO" \
  --cpu "$CPU_INFO" \
  --mock-delay-ms "$MOCK_DELAY_MS" \
  --gateway-addr "$GATEWAY_ADDR" \
  --mock-addr "$MOCK_ADDR" \
  --vus 200 \
  --duration "60s" \
  "$OUT"

echo "[perf-app] baseline archived: $BASELINE_JSON"
