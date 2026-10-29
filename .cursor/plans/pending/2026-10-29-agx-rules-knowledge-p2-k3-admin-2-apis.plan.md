# K3 Admin A2 — Writable graph-incremental APIs

**Goal:** Admin routes (auth scopes like knowledge-lifecycle / rules: `provider:read` / `provider:update`).

**Routes under `/api/admin/graph-incremental/`:**
- `GET sources` — list sources + fingerprints snapshot
- `GET sync/runs` — list sync runs
- `GET sync/runs/[id]` — one SyncReport
- `POST sync` — trigger mock sync (re-fingerprint seeded sources / append report) or append supplied report body
- `GET object-index` — full source→object links
- `GET object-index/affected?sourceId=` — objects linked to a source (affected-set lite)
- `POST seed` — reseed Brand-A demos

**Envelope:** `{ code, message, data }`; unauthorized fails auth.

**Done when:** routes compile; unauthorized returns auth failure; happy-path JSON ok.

## Status

Done.
