# K2 Admin A2 — Writable knowledge-lifecycle APIs

**Goal:** Admin routes (auth scopes like data-suite / rules).

**Routes:**
- `GET/PUT /api/admin/knowledge-lifecycle/objects` — list / upsert
- `GET /api/admin/knowledge-lifecycle/objects/[id]` — object + issues + trail
- `POST /api/admin/knowledge-lifecycle/objects/[id]/transition` — `{ status }`
- `GET /api/admin/knowledge-lifecycle/issues`
- `POST /api/admin/knowledge-lifecycle/issues/[id]/transition` — `{ status, actor? }`
- `POST /api/admin/knowledge-lifecycle/quality` — run checks + open_from_findings

**Done when:** routes compile; unauthorized returns auth failure; happy-path JSON `{ code, message, data }`.

## Status

Done.
