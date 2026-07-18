---
version: alpha
name: Near Desktop
description: Electron desktop agent chat — IM-native conversation chrome with developer-tool density.
colors:
  primary: "#3B82F6"
  on-primary: "#ffffff"
  secondary: "#10B981"
  on-secondary: "#ffffff"
  neutral: "#1C1C1E"
  surface-base: "#1C1C1E"
  surface-panel: "rgba(38, 38, 42, 0.78)"
  surface-card: "rgba(255, 255, 255, 0.05)"
  surface-card-strong: "rgba(255, 255, 255, 0.11)"
  surface-popover: "#26262a"
  text-primary: "#e6e7ea"
  text-strong: "#ffffff"
  text-muted: "rgba(255, 255, 255, 0.7)"
  text-faint: "rgba(255, 255, 255, 0.45)"
  border-subtle: "rgba(255, 255, 255, 0.11)"
  border-strong: "rgba(255, 255, 255, 0.16)"
  window-outline: "rgba(255, 255, 255, 0.22)"
  chat-user-bg: "rgba(255, 255, 255, 0.08)"
  chat-user-border: "rgba(255, 255, 255, 0.15)"
  chat-assistant-bg: "rgba(255, 255, 255, 0.08)"
  chat-assistant-border: "rgba(255, 255, 255, 0.12)"
  status-success: "rgba(120, 235, 190, 0.95)"
  status-warning: "rgba(255, 175, 85, 0.95)"
  status-error: "rgba(255, 110, 110, 0.95)"
typography:
  body-md:
    fontFamily: SF Pro Text
    fontSize: 14px
    fontWeight: "400"
    lineHeight: 1.625
  body-sm:
    fontFamily: SF Pro Text
    fontSize: 13px
    fontWeight: "400"
    lineHeight: 1.45
  label-md:
    fontFamily: SF Pro Text
    fontSize: 12px
    fontWeight: "500"
    lineHeight: 1.35
  h1:
    fontFamily: SF Pro Text
    fontSize: 20px
    fontWeight: "600"
    lineHeight: 1.4
  h2:
    fontFamily: SF Pro Text
    fontSize: 18px
    fontWeight: "600"
    lineHeight: 1.4
  h3:
    fontFamily: SF Pro Text
    fontSize: 16px
    fontWeight: "600"
    lineHeight: 1.5
  mono:
    fontFamily: ui-monospace
    fontSize: 13px
    fontWeight: "400"
    lineHeight: 1.45
rounded:
  sm: 4px
  md: 8px
  lg: 11px
  xl: 12px
  composer: 16px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
    padding: 12px
  button-primary-hover:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
  chat-bubble-user:
    backgroundColor: "{colors.chat-user-bg}"
    textColor: "{colors.text-strong}"
    rounded: "{rounded.xl}"
    padding: 12px
  chat-bubble-assistant:
    backgroundColor: "{colors.chat-assistant-bg}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.xl}"
    padding: 12px
  composer-shell:
    backgroundColor: "{colors.surface-card}"
    rounded: "{rounded.composer}"
    padding: 16px
  settings-panel:
    backgroundColor: "{colors.surface-popover}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
  status-text-success:
    textColor: "{colors.status-success}"
  status-text-warning:
    textColor: "{colors.status-warning}"
  status-text-error:
    textColor: "{colors.status-error}"
---

## Overview

Near Desktop is a **native macOS-style agent workbench** — not a marketing landing page,
not a playful consumer chat app. The visual register sits between **WeChat desktop
conversation density** and **Cursor / VS Code tool chrome**: flat surfaces, hairline
borders, semantic CSS variables, and just enough translucency to feel like a system window
without glassmorphism theatrics.

The audience is developers who live in multi-pane chat, tool traces, and settings for
hours. The UI should feel **calm, legible, and instrument-like** — every accent earns
its place; chrome stays out of the message stream.

Default presentation is **dark** (`data-theme="dark"`). **Dim** is a softer charcoal for
long sessions; **light** is a clean paper-white workspace. A separate **accent axis**
(`data-theme-color`: blue, green, pink, yellow, white) tints primary buttons, focus
rings, @file chips, and IM highlights without redefining the entire palette.

Implementation lives in `src/styles/tokens.css`, `src/styles/themes/{dark,dim,light}.css`,
and Tailwind utilities mapped to `var(--*)` in `tailwind.config.ts`. Never hardcode hex
in components when a semantic token exists.

## Colors

The palette is **neutral-first with one accent driver**.

- **Primary ({colors.primary})** — user-selectable accent (default blue `#3B82F6`). Drives
  `--ui-btn-primary-*`, focus rings, range sliders, checkbox `accent-color`, and composer
  @file/skill chips. On primary text is **{colors.on-primary}**.
- **Secondary ({colors.secondary})** — semantic success / terminal-user green in chat
  modes; not a second brand color. Do not use for generic CTAs.
- **Neutral / surface-base ({colors.neutral})** — app canvas `#1C1C1E` in dark. Sidebar,
  topbar, and message well inherit layered `--surface-*` tokens (panel, card, popover).
- **Text-primary ({colors.text-primary})** — body copy; **text-strong** for headings and
  emphasis; **text-muted** / **text-faint** for metadata, timestamps, placeholders.
- **Border-subtle ({colors.border-subtle})** — default dividers and code-block frames;
  **border-strong** for overlay sidebar edge and selection quote popover.
- **Chat bubbles** — user/assistant backgrounds are low-alpha whites on dark
  ({colors.chat-user-bg}, {colors.chat-assistant-bg}), not saturated fills. User accent
  tints come from `--theme-color-rgb`, not a second bubble color system. *Note: these
  tokens are translucent by design — evaluate text contrast against the composited
  result over `{colors.surface-base}`, not the raw alpha value in isolation.*
- **Status** — success / warning / error tokens are always used as **foreground
  color** (icon/text) — e.g. `text-status-error`, `text-[var(--status-warning)]` — or
  as a same-hue low-alpha tint background (`bg-status-warning/10`). They are **never**
  a solid fill with white text on top. Used for toasts, provider health rows, and
  inline alerts only; never decorate normal chat prose.

Avatar and group chat identity use **hash-assigned Tailwind hues** (`avatar-color.ts`) —
cyan/violet/rose for avatars; indigo/teal/pink for groups. These are identity accents,
not global brand primaries.

## Typography

One family stack: **SF Pro Text → PingFang SC → Helvetica Neue → sans-serif** (see
`:root` in `index.css`). Chinese and Latin must feel equally native on macOS.

- **body-md ({typography.body-md})** — canonical IM bubble and markdown body at **14px /
  1.625**. Model picker and composer metadata must not exceed this size.
- **body-sm** — code blocks, settings dense rows, terminal embed.
- **h1–h3** — markdown headings inside bubbles only; restrained scale (20 / 18 / 16px),
  semibold, `text-strong`. No display hero typography in the app shell.
- **mono** — tool output, file path chips, automation logs.

**Don't** introduce a separate marketing display face. **Don't** use bold for decoration;
semibold is the ceiling inside chat.

## Layout

Grid shell: **sidebar (default 260px) + main**. Sidebar collapses to overlay
on narrow widths with a scrim — chat width is never permanently sacrificed.

- Message list: full-width scroll; bubbles align IM-style (user right-ish, assistant
  left with avatar gutter). Tool cards and reasoning blocks share the assistant column
  width — no wider than the reply bubble baseline.
- Composer: rounded shell (`{rounded.composer}`) at pane bottom; attachment previews
  **above** the input, not beside it.
- Settings / avatar modals: opaque or high-opacity surfaces — **no** half-transparent
  forms that read as “muddy” over the chat (see AGENTS.md avatar settings alignment).
- Multi-pane (`PaneManager`): nested flex with dividers; each pane keeps independent
  model selection — layout must not imply shared state.

Spacing rhythm: **{spacing.sm}** inside chips and icon rows; **{spacing.lg}** between
sections in settings cards. Icon-only Topbar clusters (sidebar toggle, search, gauge,
theme, settings, pane-toolbar icons) all read the single `--agx-topbar-icon-gap` custom
property (set once on `.agx-app`, default `6px`) — never hardcode a `gap` value on a new
icon row; consume the shared token so every cluster stays visually identical.

## Elevation & Depth

Depth is **layered flatness**, not drop shadows.

1. **Base** — `{colors.surface-base}` app background.
2. **Panel** — sidebar / topbar translucent grays (`--surface-panel`, `--surface-sidebar`).
3. **Card** — `--surface-card` / `--surface-card-strong` for code blocks, tool cards,
   settings groups.
4. **Popover** — `--surface-popover` for menus, selection quote, dropdowns (solid enough
   to read over scrolling content).

Window chrome: **{rounded.lg}** outer radius with **{colors.window-outline}** 1px hairline
on transparent Electron frames — “豆包式” thin frame, not a heavy drop shadow.

Focus mode uses a frosted glass capsule (`--focus-glass-bg`) but the inner composer
reverts to dark-surface semantics — glass is a shell, not a recolor of the whole app.

## Shapes

- **Window outer** — `{rounded.lg}` (11px).
- **Composer** — `{rounded.composer}` (16px, `rounded-2xl`).
- **IM bubbles** — `{rounded.xl}` with user tail corner `{rounded.sm}` on top-right.
- **Buttons** — `{rounded.md}` for primary actions; icon-only toolbar controls may be
  `{rounded.full}` pills when showing active state.
- **Avatars** — circular for agents; **rounded-[6px] square** for group chats.

Avoid pill-everything SaaS styling. Corners are modest and consistent — architectural,
not bubbly.

## Components

### Primary button (`button-primary`)

Filled accent using `--ui-btn-primary-bg` / `--ui-btn-primary-text`. Settings save,
clarification submit, and destructive confirmations that proceed — not every icon tap.
Hover dims to 90% accent opacity (`button-primary-hover`). Use theme variables, not raw
cyan hex.

### Chat bubbles (`chat-bubble-user`, `chat-bubble-assistant`)

WeChat-influenced: soft neutral fills, 1px border, 14px body. User bubbles may pick up
accent tint via `--theme-color-rgb` when accent mode demands; assistant bubbles stay
neutral so tool cards and markdown remain the focal layer. Reasoning blocks fold inside
the bubble — no separate white card chrome.

### Composer (`composer-shell`)

`bg-surface-card`, `{rounded.composer}`, focus ring via `.agx-theme-focus-ring`
(glow from `--theme-color-rgb`). Inline @file and skill tokens use
`--chat-composer-chip-*` — same hue family as accent.

### Settings panel (`settings-panel`)

Chinese-first copy; bottom-only save; single API key field per provider. Focus states
use accent ring at 50% alpha. Range sliders fill track with `--theme-color-rgb`.

### Icon-only Topbar / toolbar buttons (`.agx-topbar-btn`)

Ghost by default, Cursor-style: **transparent background at rest**, `--surface-hover`
reveal only on `:hover`. This applies to every icon-only control sharing the class —
sidebar toggle, global search, Token gauge, theme toggle, settings, and every pane
toolbar icon (workspace/history/spawns/memory-graph/close). `--active` is the one
persistent exception: a toggled-open panel (workspace, history, memory-graph, spawns)
keeps `--surface-card-strong` so the user can tell it's open even when the pointer moves
away. Icon-only variant (`--icon-only`) is a fixed 30×30 hit target, icon centered.

This is a **background-reveal** pattern, not a **visibility** pattern — the icon itself
is always rendered; only its container box appears on hover. It does not contradict the
"don't hide message action buttons" rule below, which is about hiding controls entirely
until hover inside chat bubbles.

New icons added to any Topbar/toolbar cluster should reuse `agx-topbar-btn` (+
`agx-topbar-btn--icon-only` for icon-only) rather than inventing a bespoke button style,
so the ghost-hover behavior and spacing stay consistent automatically.

### Status text (`status-text-success`, `status-text-warning`, `status-text-error`)

Semantic only — sync indicators, MCP health, toast outcomes, credential warnings. Each
status color is used **monochromatically**: as text/icon color on a transparent surface,
or as its own color at ~10% alpha for a soft tint background with matching-color text
(never white-on-solid). Red/green dots on provider rows mean **configured & callable**
vs disabled — not decorative.

## Do's and Don'ts

- **Do** read `--text-*`, `--surface-*`, `--border-*`, `--ui-btn-primary-*` before adding
  color. Tailwind aliases (`text-text-primary`, `bg-surface-card`) map to these vars.
- **Do** respect **dark / dim / light** — test all three when changing contrast. Light
  mode needs stronger chip backgrounds (`--chat-followup-chip-bg`) so controls don't
  vanish on white.
- **Do** keep tool/progress UI **collapsed by default** in group chat — one aggregated
  card, not a bubble per tool call.
- **Do** align `ToolCallCard` and `ImBubble` to the same max-width column.
- **Don't** hardcode `#06b6d4` / cyan for primary actions — accent follows
  `data-theme-color`.
- **Don't** use heavy box shadows, gradients, or glass blur on settings forms and modals.
- **Don't** show message action buttons only on hover — copy/retry/quote stay visible.
  (This is distinct from Topbar/toolbar icon buttons, where the icon is always visible
  and only its background box reveals on hover — see "Icon-only Topbar / toolbar
  buttons" above.)
- **Don't** lock scroll-to-bottom during streaming; users must scroll up freely.
- **Don't** use `window.confirm` — use themed in-app dialogs with app icon.
- **Don't** treat avatar/group hash colors as the global primary — they identify entities,
  not brand CTAs.

**Known trade-off:** the default `blue` accent (`#3B82F6`) on white button text measures
~3.68:1, below WCAG AA's 4.5:1 for normal text. This is an accepted brand-color decision
(shared with several accent presets), not an oversight — do not "fix" it by silently
darkening the accent color; raise it with design before changing.

## Theming

Three **appearance modes** on `:root[data-theme]`:

| Mode | Intent |
|------|--------|
| `dark` | Default. `#1C1C1E` base, white-alpha surfaces. |
| `dim` | Lower contrast charcoal `#181818` for extended night use. |
| `light` | Paper white `#ffffff` messages well; inverted logo filter off. |

Five **accent presets** on `:root[data-theme-color]`: `blue` (default), `green`, `pink`,
`yellow`, `white`. They set `--theme-color-rgb` and `--theme-color-text` only — surfaces
stay neutral. Special case: `white` accent on light theme flips to dark slate RGB for
contrast.

Persisted in `localStorage` keys `agx-theme` and `agx-theme-color`. Focus Mode voice
capsule uses separate `--focus-*` tokens; it does not switch the main app to a third
color system.
