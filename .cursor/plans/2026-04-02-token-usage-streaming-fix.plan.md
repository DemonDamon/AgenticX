---
id: 2026-04-02-token-usage-streaming-fix
title: 修复流式对话 token 显示始终为 0
status: completed
owner: Damon Li
created: 2026-04-02
---

## 背景

在 Desktop 对话中，即使模型已返回完整内容，输入区上方 token 指标仍持续显示 `0 tokens`。

## 需求

- FR-1: `stream_with_tools` 路径需要透传 usage 信息，不能仅透传 content/tool delta。
- FR-2: `agent_runtime` 必须在 FINAL 事件中附带可映射 usage 数据，以便 server 发出 `token_usage` SSE。
- FR-3: 兼容 usage-only 末包（无 choices/delta）场景，不能丢失 token 统计。

## 验收标准

- AC-1: 非工具与工具调用对话场景中，前端 token 指标不再固定为 `0 tokens`。
- AC-2: 相关 smoke tests 通过：`tests/test_smoke_deerflow_token_usage.py`、`tests/test_smoke_bailian_streaming.py`、`tests/test_smoke_ark_provider.py`。

## 实施结果

- 在 provider 流式路径新增 usage chunk 处理与透传。
- 在 runtime 聚合流式 usage 并挂载到 FINAL。
- 已执行上述测试并全部通过。
