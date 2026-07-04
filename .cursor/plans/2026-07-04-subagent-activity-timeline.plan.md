# 派生智能体活动日志可读性重塑

## What & Why

派生智能体「详情」展开区原先直接堆叠 `[type] content` 原始日志，含 JSON 包裹、shell stdout 壳层与重复 progress，用户难以感知推理过程与最终结论。

## Requirements

- FR-1: 详情区改为时间线式活动日志，按事件类型区分图标/颜色/时间戳
- FR-2: 解析 `tool_call`/`tool_result` 的 JSON 与 `✅ tool 结果:` 预格式化文本，展示工具名与 key/value 参数或可读 stdout
- FR-3: 子智能体 token 流在 `tool_call`/`final` 前 flush 为 `reasoning` 事件，保留 LLM 思考过程
- FR-4: 过滤冗余 progress（调用/完成工具、第 1 轮 0s、相邻重复）

## Acceptance

- AC-1: 展开详情不再出现裸 `tool_result: {"name":...}` 整段 JSON
- AC-2: bash_exec 结果展示 stdout 正文而非 `exit_code=0` 包裹
- AC-3: 时间线含推理、工具调用、工具结果，且不含「第 1/120 轮分析中（0s）」

## Files

- `desktop/src/components/SubAgentCard.tsx`
- `desktop/src/components/ChatPane.tsx`
- `desktop/src/components/ChatView.tsx`
