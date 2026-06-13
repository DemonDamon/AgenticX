# Provider 展示名点击/右键重命名

## What & Why

模型服务侧栏与详情标题中的厂商展示名（如「OpenAI 兼容」）此前仅对部分自定义厂商在表单底部提供输入框，内置 `openai` 配自定义网关时无法改名，且入口不直观。用户期望点击标题或侧栏右键即可重命名。

## Requirements

- FR-1: 可编辑展示名的厂商（自定义 OpenAI 范式、`openai` 非官方 base）支持点击详情标题进入行内编辑。
- FR-2: 侧栏厂商项右键菜单提供「重命名」，行为与点击标题一致。
- FR-3: 重命名写入 `displayName` / `display_name`，保存设置后持久化；不改配置 id。
- FR-4: 移除底部重复的「服务厂商显示名」表单项，统一由标题编辑。

## Acceptance

- AC-1: `openai` + 自定义 API 地址显示「OpenAI 兼容」时，点击标题可改为自定义名并保存生效。
- AC-2: 自定义 `custom_openai_*` 厂商侧栏右键「重命名」可改展示名。
- AC-3: 内置 Anthropic 等不可编辑项无铅笔图标、无右键重命名。

## Implementation

- `desktop/src/utils/provider-display.ts`: `isProviderDisplayNameEditable`
- `desktop/src/components/SettingsPanel.tsx`: 行内编辑 + 右键菜单
- `desktop/src/utils/model-display.test.ts`: 单测
