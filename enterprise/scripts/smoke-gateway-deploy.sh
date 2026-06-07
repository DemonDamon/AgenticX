#!/usr/bin/env bash
# Smoke: unit tests + K8s manifest lint + local gateway probes (optional compose).
# Usage: bash enterprise/scripts/smoke-gateway-deploy.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GW_DIR="$ROOT/enterprise/apps/gateway"
DEPLOY_DIR="$ROOT/enterprise/deploy/gateway"
PERF_FIX="$ROOT/enterprise/scripts/perf/fixtures"
SMOKE_GATEWAY_PORT="${SMOKE_GATEWAY_PORT:-28188}"
SMOKE_MOCK_PORT="${SMOKE_MOCK_PORT:-29199}"
SMOKE_GATEWAY_BASE="http://127.0.0.1:${SMOKE_GATEWAY_PORT}"
SMOKE_MOCK_ADDR="127.0.0.1:${SMOKE_MOCK_PORT}"

wait_gateway_ready() {
  local base="$1"
  local attempts="${2:-60}"
  local delay="${3:-0.25}"
  local i body
  for i in $(seq 1 "$attempts"); do
    body="$(curl -sf --noproxy '*' "${base}/readyz" 2>/dev/null || true)"
    if echo "$body" | grep -q '"status"[[:space:]]*:[[:space:]]*"ready"'; then
      return 0
    fi
    sleep "$delay"
  done
  echo "[smoke-deploy] gateway not ready at ${base} after ${attempts} attempts" >&2
  return 1
}

echo "[smoke-deploy] go test (health + hybrid routing)"
(cd "$GW_DIR" && go test ./internal/server/... ./internal/observability/... -count=1)

echo "[smoke-deploy] lint k8s manifests"
bash "$DEPLOY_DIR/lint-manifests.sh"

run_local_smoke() {
  RUNTIME="$(mktemp -d)"
  MOCK_PID=""
  GW_PID=""
  cleanup() {
    [ -n "$GW_PID" ] && kill "$GW_PID" 2>/dev/null || true
    [ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null || true
    rm -rf "$RUNTIME"
  }
  trap cleanup EXIT

  CFG="$RUNTIME/gateway.yaml"
  sed \
    -e "s|/app/plugins/moderation-perf/manifest.yaml|$PERF_FIX/moderation-perf/manifest.yaml|g" \
    -e "s|http://mock-cloud:9099/v1|http://${SMOKE_MOCK_ADDR}/v1|g" \
    -e "s|/runtime/audit|$RUNTIME/audit|g" \
    -e "s|:8088|:${SMOKE_GATEWAY_PORT}|g" \
    "$DEPLOY_DIR/hybrid/smoke-policies.yaml" > "$CFG"
  mkdir -p "$RUNTIME/audit" "$RUNTIME/admin"
  cp "$DEPLOY_DIR/hybrid/smoke-runtime/"* "$RUNTIME/admin/"
  cp "$DEPLOY_DIR/hybrid/channels.smoke.json" "$RUNTIME/admin/channels.json"
  if sed --version >/dev/null 2>&1; then
    sed -i "s|mock-cloud:9099|${SMOKE_MOCK_ADDR}|g" "$RUNTIME/admin/channels.json"
  else
    sed -i '' "s|mock-cloud:9099|${SMOKE_MOCK_ADDR}|g" "$RUNTIME/admin/channels.json"
  fi

  (cd "$ROOT/enterprise/scripts/perf/mock-upstream" && go run . -addr "$SMOKE_MOCK_ADDR") &
  MOCK_PID=$!
  sleep 1
  if ! kill -0 "$MOCK_PID" 2>/dev/null; then
    echo "[smoke-deploy] mock upstream failed to start on $SMOKE_MOCK_ADDR" >&2
    exit 1
  fi

  (
    cd "$GW_DIR"
    exec env \
      GATEWAY_HTTP_ADDR=":${SMOKE_GATEWAY_PORT}" \
      GATEWAY_CONFIG_PATH="$CFG" \
      GATEWAY_CHANNEL_REGISTRY=on \
      GATEWAY_ADMIN_CHANNELS_FILE="$RUNTIME/admin/channels.json" \
      GATEWAY_QUOTA_CONFIG_FILE="$RUNTIME/admin/quotas.json" \
      GATEWAY_POLICY_SNAPSHOT_FILE="$RUNTIME/admin/policy-snapshot.json" \
      go run ./cmd/gateway
  ) &
  GW_PID=$!

  wait_gateway_ready "$SMOKE_GATEWAY_BASE" 60 0.25

  bash "$ROOT/enterprise/scripts/smoke-gateway-probes.sh" "$SMOKE_GATEWAY_BASE"
}

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  echo "[smoke-deploy] docker compose smoke (build + probes)"
  (
    cd "$DEPLOY_DIR"
    docker compose -f compose.smoke.yml up -d --build
  )
  cleanup() {
    (cd "$DEPLOY_DIR" && docker compose -f compose.smoke.yml down -v --remove-orphans) || true
  }
  trap cleanup EXIT
  wait_gateway_ready "http://127.0.0.1:18088" 60 0.5
  bash "$ROOT/enterprise/scripts/smoke-gateway-probes.sh" http://127.0.0.1:18088
else
  echo "[smoke-deploy] docker unavailable; local go run probe fallback"
  run_local_smoke
fi

echo "[smoke-deploy] all checks passed"
