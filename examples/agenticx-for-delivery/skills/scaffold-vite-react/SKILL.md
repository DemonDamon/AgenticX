---
name: scaffold-vite-react
description: Scaffold Vite + React POC frontend in delivery worktree output directory.
metadata:
  author: AgenticX
  version: "1.0.0"
---

# Scaffold Vite + React POC

## Output location

`output/<task_id>/frontend/` inside the delivery worktree.

## Steps

1. `pnpm create vite@latest . --template react-ts` (or equivalent) in frontend dir
2. Add React Router for routes from requirement-breakdown.md
3. Wire semantic CSS variables matching design-system.md
4. Mock data only — no real API unless specified

## Pages

Implement every route listed in requirement breakdown:

- Dashboard
- Task list (if applicable)
- Settings (if applicable)

## Verification

- `pnpm install && pnpm build` succeeds
- README.md documents dev command and port

## Constraints

- Do not modify AgenticX core packages
- Keep dependencies minimal (react, react-router-dom, vite)
