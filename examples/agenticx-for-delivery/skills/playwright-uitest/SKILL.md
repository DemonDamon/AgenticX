---
name: playwright-uitest
description: Generate Playwright UI tests and visual smoke reports for delivery POC frontends.
metadata:
  author: AgenticX
  version: "1.0.0"
---

# Playwright UI Test

## When to use

Frontend POC exists under `output/<task_id>/frontend/` and local preview URL is available.

## MCP

Prefer **playwright-mcp** (`@playwright/mcp`) for:

- Navigate routes from requirement-breakdown.md
- Click primary buttons, fill forms, open dialogs
- Capture ≥5 screenshots across key states
- Export HTML report under `output/<task_id>/qa/playwright-report/`

## Test categories

1. **Smoke** — each route loads without console error
2. **Interaction** — primary CTA clickable
3. **Theme** — light/dark if settings page exists
4. **Regression** — optional pixel diff vs design SVG

## Report format

- `index.html` — summary with pass/fail counts
- `screenshot-*.png` — labeled by route + state

## Failure handling

Record blocker in plan.mdc testing stage; distinguish:

- **Code bug** — route 404, uncaught exception
- **Design tweak** — spacing/color within tolerance
