#!/usr/bin/env bash
set -euo pipefail

# Smoke perf check for gateway L1 cache hit latency.
# Requires local gateway on GATEWAY_URL (default http://127.0.0.1:8080).

GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:8080}"

if [[ -z "${AGX_GATEWAY_BEARER:-}" ]]; then
  echo "AGX_GATEWAY_BEARER is required" >&2
  exit 1
fi

payload='{"model":"gpt-4o-mini","messages":[{"role":"user","content":"perf-cache-smoke"}]}'

curl -sS --noproxy '*' -o /dev/null -w "miss_ms=%{time_total}\n" \
  -H "authorization: Bearer ${AGX_GATEWAY_BEARER}" \
  -H "content-type: application/json" \
  -d "$payload" \
  "${GATEWAY_URL}/v1/chat/completions"

curl -sS --noproxy '*' -o /dev/null -w "hit_ms=%{time_total}\n" \
  -H "authorization: Bearer ${AGX_GATEWAY_BEARER}" \
  -H "content-type: application/json" \
  -d "$payload" \
  "${GATEWAY_URL}/v1/chat/completions"

echo "Expect second request hit_ms significantly lower when L1 enabled."
