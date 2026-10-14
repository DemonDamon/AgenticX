# acp-09 设置页邮件导航

Planned-with: Grok 4.7
Suggested-Impl-Model: Grok 4.7
Parent: `.cursor/plans/2026-10-14-acp-master.plan.md`

## 目标

设置左侧导航能打开已经写好的邮件面板。`workspace` 和 `hooks` 没有面板，不加进导航。

## 落点

- `desktop/src/components/SettingsPanel.tsx`：`TAB_DEFS` 在 `voice` 后增加 `{ id: "email", icon: Mail }`。渲染分支 `tab === "email"` 已存在，不改。
- `desktop/locales/zh/settings.json` 与 `en/settings.json` 的 `tabs` 增加 `email`。

## AC

- `cd desktop && npx vitest run src/settings-email-nav.test.ts src/i18n/message-parity.test.ts` 通过。
- 导航文案中文为「邮件」，英文为「Email」。
