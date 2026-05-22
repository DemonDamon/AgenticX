# Multi-Protocol Gateway Runbook

## Feature flags

| Env | Default | Effect |
|-----|---------|--------|
| `GATEWAY_INBOUND_CLAUDE` | on | Mount `POST /v1/messages` |
| `GATEWAY_INBOUND_GEMINI` | on | Mount Gemini generateContent routes |
| `GATEWAY_INBOUND_RESPONSES` | on | Mount `POST /v1/responses` (minimal set) |
| `GATEWAY_RELAY_THINKING_TO_CONTENT` | off | `separate` / `merge` thinking stream modes |

Set to `off` / `0` / `false` to disable a protocol without redeploying binaries.

## Prerequisites

- Channel relay enabled (`GATEWAY_CHANNEL_REGISTRY=on` + channels configured)
- PAT or JWT with `workspace:chat` scope
- Upstream channels with correct `providerType` (`openai`, `claude`, `gemini`)

## Smoke checks

```bash
# Claude Messages inbound -> OpenAI upstream (replace token/model)
curl -sS -H "Authorization: Bearer $AGX_PAT" -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","max_tokens":64,"stream":false,"messages":[{"role":"user","content":"ping"}]}' \
  http://127.0.0.1:8088/v1/messages

# Gemini generateContent
curl -sS -H "Authorization: Bearer $AGX_PAT" -H "Content-Type: application/json" \
  -d '{"contents":[{"role":"user","parts":[{"text":"hi"}]}]}' \
  "http://127.0.0.1:8088/v1beta/models/gemini-1.5-pro:generateContent"
```

## Troubleshooting

| Symptom | Check |
|---------|-------|
| 404 on `/v1/messages` | `GATEWAY_INBOUND_CLAUDE=off` or old binary |
| 500 channel relay required | No active channels / registry off |
| Empty stream | Upstream SSE format; verify channel `providerType` |
| Rate limit mapped wrong | See `adaptor/errors_map.go` |

## Audit fields

Cross-protocol calls add `inbound_protocol`, `outbound_protocol`, `reasoning_effort`, `thinking_mode` on `gateway_audit_events` JSON payloads.

Made-with: Damon Li
