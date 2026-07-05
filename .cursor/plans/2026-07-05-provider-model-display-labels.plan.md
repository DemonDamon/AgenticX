# Provider / Model 用户可见展示名统一

Planned-with: Composer 2.5 Fast
Suggested-Impl-Model: Composer 2.5 Fast

## What & Why

用户已在「模型服务」为自定义厂商配置展示名（如 MOMA、彩讯-外网），但澄清提问、Token 仪表盘、设置页模型列表等仍暴露 `custom_openai_*` 内部 id 或上游路由前缀（如 `ZHIPU/GLM-5.2`）。需全链路统一为「厂商展示名/模型短名」。

## Requirements

- FR-1: 后端 Meta-Agent 系统提示注入模型服务目录，澄清提问禁止暴露内部 provider id
- FR-2: `recommend_subagent_model` 工具结果附带用户可见 `label`
- FR-3: Token 用量 breakdown 返回 `label`（配置可读展示名，未知 custom 显示「历史厂商」）
- FR-4: Desktop 设置页模型列表、子智能体工牌、Token 仪表盘使用 `formatModelOptionLabel`
- FR-5: 剥离 LiteLLM/网关前缀（`ZHIPU/GLM-5.2` → `MOMA/GLM-5.2`）

## Acceptance

- AC-1: 模型选择器、设置页、工牌均显示 `MOMA/GLM-5.2` 而非 `ZHIPU/GLM-5.2`
- AC-2: Token 仪表盘已配置厂商显示「彩讯-外网」「MOMA」，不截断为 `CUSTOM_O...`
- AC-3: Meta-Agent 澄清卡片文案使用展示名，不出现 `custom_openai_1782269503107`

## Implementation

- `agenticx/llms/provider_display.py`（新建）
- `agenticx/runtime/prompts/meta_agent.py`
- `agenticx/runtime/meta_tools.py`
- `agenticx/runtime/usage_store.py`
- `desktop/src/utils/provider-display.ts`
- `desktop/src/components/SettingsPanel.tsx`
- `desktop/src/components/TokenDashboardPanel.tsx`
- `desktop/src/components/subagent/AgentBadge.tsx`
- `desktop/src/services/usageApi.ts`
- `tests/test_provider_display.py`
- `desktop/src/utils/model-display.test.ts`
