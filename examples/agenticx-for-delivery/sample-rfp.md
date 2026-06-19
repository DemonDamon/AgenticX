# Sample RFP — Enterprise Portal POC (Demo)

## Background

The customer needs a **read-only dashboard POC** for an internal operations portal. The MVP should demonstrate modern B2B interaction patterns aligned with indigo/violet enterprise tokens.

## Scope

1. **Dashboard** — KPI cards, recent activity feed, quick actions
2. **Task list** — filterable table with status chips
3. **Settings** — theme toggle (light/dark), profile summary (mock data)

## Non-goals

- No backend integration (static/mock JSON acceptable)
- No auth flow (assume logged-in user)

## Acceptance

- All three routes reachable from sidebar navigation
- Responsive layout from 1280px down to 1024px
- Playwright smoke: click every primary button without console errors
- Visual baseline documented in `design-system.md`

## Reference materials

- Prefer AppShell + grouped sidebar (vben-style)
- Avoid dense tables without whitespace
