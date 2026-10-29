# K2 knowledge-lifecycle RBAC

Plan-Id: 2026-10-29-k2-knowledge-lifecycle-rbac
Branch: `feat/agx-rules-knowledge-p1-k2-rbac`

## Goal

Wire knowledge-lifecycle admin writable APIs to proper `kb:*` scopes (same
family as ma-memory stores), pass session actor into transitions, prove
unauthorized fails, and gate UI write controls.

## Changes

1. Routes: `provider:read/update` → `kb:read` / `kb:update`.
2. Writable handlers use `auth.session.email || auth.session.userId` as actor.
3. Vitest: 401/403 + happy path for object transition, issue transition, quality.
4. UI: disable transition / quality / resolve when write returns 403.

## Acceptance

- Unauthorized → 401/403; authorized → 200 with actor recorded.
- Brand-A fixtures untouched; no squash-merge.
