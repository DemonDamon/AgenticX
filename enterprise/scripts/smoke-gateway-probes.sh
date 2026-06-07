#!/usr/bin/env bash
# Probe gateway health/ready/metrics endpoints.
# Usage: bash enterprise/scripts/smoke-gateway-probes.sh [base_url]
set -euo pipefail

BASE="${1:-http://127.0.0.1:8088}"

probe() {
  local path="$1"
  local expect="${2:-200}"
  local url="${BASE}${path}"
  local code
  code="$(curl -sf --noproxy '*' -o /tmp/agx-smoke-body.json -w '%{http_code}' "$url" || true)"
  if [ "$code" != "$expect" ]; then
    echo "[smoke] FAIL $path status=$code (want $expect)" >&2
    cat /tmp/agx-smoke-body.json 2>/dev/null || true
    exit 1
  fi
  echo "[smoke] OK $path ($code)"
}

probe "/healthz" 200
probe "/readyz" 200

metrics="$(curl -sf --noproxy '*' "${BASE}/metrics" || true)"
if ! echo "$metrics" | rg -q 'agx_gateway_http_requests_total'; then
  echo "[smoke] FAIL /metrics missing agx_gateway_http_requests_total" >&2
  exit 1
fi
echo "[smoke] OK /metrics (prometheus text)"

# Hit a business route to increment HTTP metrics (401 without token is fine).
curl -sf --noproxy '*' -o /dev/null -w '' -X POST "${BASE}/v1/chat/completions" \
  -H 'Content-Type: application/json' \
  -d '{"model":"test","messages":[{"role":"user","content":"hi"}]}' || true

echo "[smoke] gateway probes passed at ${BASE}"
