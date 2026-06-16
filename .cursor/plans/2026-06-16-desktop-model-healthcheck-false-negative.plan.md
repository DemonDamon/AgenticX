# Desktop 模型健康检查误报修复

## What & Why

设置页模型健康检查对 OpenAI 兼容网关固定使用 `max_tokens: 1` 探测，部分模型（如 GPT-5.x）会返回 `max_tokens` 不足的 400，导致 UI 显示“失败”，但真实聊天可用。需要消除该类假阴性。

## Requirements

- FR-1: `health-check-model` 对 chat 探测请求不再使用 `max_tokens: 1`，改为更稳健的最小值。
- FR-2: 对“仅因 max_tokens 过小导致”的特定 400 响应判定为连通可用，避免误报失败。
- FR-3: 不改变 embeddings 探测路径，不改变真实聊天请求链路。

## Acceptance

- AC-1: 同一模型在设置页批量检测不再因 `max_tokens` 过小被标红“失败”。
- AC-2: 对错误模型 ID、鉴权失败、网关不可达仍维持失败判定。
- AC-3: 相关代码通过基础静态检查（lints）且无新增报错。
