#!/usr/bin/env bash
# Smoke test: MCP demo echo via streamable-http (no PG required for demo server).
set -euo pipefail

GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:8080}"
AGX_GATEWAY_BEARER="${AGX_GATEWAY_BEARER:-}"

if [[ -z "${AGX_GATEWAY_BEARER}" ]]; then
  echo "Set AGX_GATEWAY_BEARER to a PAT with mcp:* or mcp:server:demo:invoke scope" >&2
  exit 1
fi

echo "== initialize =="
curl -sS -X POST "${GATEWAY_URL}/mcp/demo/streamable-http" \
  -H "Authorization: Bearer ${AGX_GATEWAY_BEARER}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","clientInfo":{"name":"e2e","version":"1.0"}}}' | jq .

echo "== tools/list =="
curl -sS -X POST "${GATEWAY_URL}/mcp/demo/streamable-http" \
  -H "Authorization: Bearer ${AGX_GATEWAY_BEARER}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | jq .

echo "== tools/call echo =="
curl -sS -X POST "${GATEWAY_URL}/mcp/demo/streamable-http" \
  -H "Authorization: Bearer ${AGX_GATEWAY_BEARER}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"echo","arguments":{"message":"e2e-ok"}}}' | jq .

echo "== registry =="
curl -sS -H "Authorization: Bearer ${AGX_GATEWAY_BEARER}" \
  "${GATEWAY_URL}/mcp/registry" | jq .

echo "e2e-mcp-hosting: OK"
