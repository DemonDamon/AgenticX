---
name: b2b-desktop-design-system
description: Generate modern B2B desktop design system specs — tokens, layout, information hierarchy — for Near delivery POC.
metadata:
  author: AgenticX
  version: "1.0.0"
---

# B2B Desktop Design System

## Goals

Produce **leading but pragmatic** enterprise desktop visuals without copyrighted asset packs.

## Checklist

### Color & type

- Primary: indigo/violet OKLCH (`--primary` family)
- Neutral surfaces: `--background`, `--surface-card`, `--text-strong`
- Type scale: 12 / 14 / 16 / 20 / 24 — max 3 weights on one screen

### Layout & hierarchy

- AppShell: brand row + grouped sidebar + content canvas
- One primary action per view; secondary actions in overflow/menu
- Status/progress in dedicated panel — not mixed into nav labels

### Components (POC minimum)

- Sidebar nav with active left accent bar
- PageHeader + Breadcrumb
- DataTable or card grid for list views
- Dialog/Sheet for destructive confirm

### References (patterns only, do not paste assets)

- IBM Carbon spacing rhythm
- Arco Design layout density
- Ant Design Pro information architecture

## Deliverables

Under `output/<task_id>/design/`:

- `design-system.md` — tokens, spacing, component states
- Wireframe: Figma link **or** `dashboard-wireframe.svg` fallback

## Figma MCP

When `figma-mcp` connected and `FIGMA_API_KEY` set, create/update a Figma file and record URL in design-system.md.

## Accessibility

- WCAG AA contrast for primary text on surfaces
- Focus ring visible in light and dark themes
