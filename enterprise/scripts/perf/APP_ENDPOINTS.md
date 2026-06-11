# Web Portal Endpoints (B1 contract)

Discovered from `enterprise/apps/web-portal/src/app/api/` for app full-chain perf.

## Login

| Field | Value |
|---|---|
| Method | `POST` |
| Path | `/api/auth/login` |
| Body | `{ "email": "<email>", "password": "<password>" }` |
| Success | `200`, `{ "code": "00000", "message": "ok", "data": { "expiresInSeconds": number } }` |
| Cookies | `agenticx_access_token`, `agenticx_refresh_token` (httpOnly) |

Dev default: `admin@agenticx.local` + `AUTH_DEV_OWNER_PASSWORD` (see `enterprise/.env.local`).

## Create chat session

| Field | Value |
|---|---|
| Method | `POST` |
| Path | `/api/chat/sessions` |
| Auth | Cookie `agenticx_access_token` |
| Body | `{ "title": "perf", "active_model": "<optional>" }` |
| Success | `200`, `{ "code": "00000", "data": { "session": { "id": "<session_id>", ... } } }` |

## Chat completion (portal -> gateway)

| Field | Value |
|---|---|
| Method | `POST` |
| Path | `/api/chat/completions` |
| Auth | Cookie `agenticx_access_token` |
| Header | `x-chat-session-id: <session_id>` |
| Body | OpenAI-compatible JSON `{ "model": "<provider>/<model>", "messages": [...], "stream": false }` |
| Success | `200`, JSON body or SSE when `stream: true` |
| Upstream | `GATEWAY_COMPLETIONS_URL` (default `http://127.0.0.1:8088/v1/chat/completions`) |

Perf baseline uses mock gateway on `:18088` with model `perf-mock/perf-mock-model`.
