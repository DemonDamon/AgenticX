# K3-GraphViz V3 — Admin graph explorer canvas

> **Parent:** index · **Depends on:** V2

**Goal:** `/admin/graph-explorer` in-browser force-directed (or similar) canvas; click node → attrs panel; show backend badge.

## File map

| Path | Responsibility |
|------|----------------|
| `…/_sections/graph-explorer.tsx` | Page: seed/refresh, canvas, detail panel |
| `…/components/graph-explorer-canvas.tsx` | SVG force layout (no new deps) |
| `admin-platform-sections.ts` / `[section]/page.tsx` / `AppShell.tsx` | Register section + nav |
| `messages/en.json` + `zh.json` | i18n |

### Tasks

- [ ] Section + canvas + nav + i18n
- [ ] data-testid hooks for e2e
- [ ] Commit: `feat(admin): graph-explorer force canvas UI`

## Status

Pending
