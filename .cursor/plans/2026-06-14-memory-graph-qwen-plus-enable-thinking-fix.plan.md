---
name: Memory graph qwen-plus enable_thinking fix
overview: 修复记忆图谱对 qwen-plus 等非混合思考模型误传 enable_thinking 导致构建失败。
todos:
  - id: t1-model-detect
    content: 仅对 qwen3/qvq 混合思考模型通过 extra_body 传 enable_thinking=false
    status: completed
  - id: t2-smoke-tests
    content: 补充 qwen-plus / qwen3.5-plus 冒烟测试
    status: completed
isProject: false
---

# Memory Graph：qwen-plus enable_thinking 兼容修复

**Plan-Id**: 2026-06-14-memory-graph-qwen-plus-enable-thinking-fix
**Plan-File**: `.cursor/plans/2026-06-14-memory-graph-qwen-plus-enable-thinking-fix.plan.md`
**Made-with**: Damon Li

## 背景

- UI：`构建异常：AsyncCompletions.create() got an unexpected keyword argument 'enable_thinking'`
- 用户配置抽取模型为 `bailian/qwen-plus`（非混合思考模型）。
- 根因：`memory_graph_chat_request_extras` 对所有含 `qwen` 的模型都传 `enable_thinking=false`，且作为顶层 kwarg 传给 OpenAI SDK；`qwen-plus` 不接受该参数。

## 需求

- FR-1: 仅 `qwen3*` / `qwen3.5*` / `qvq*` 等混合思考模型通过 `extra_body.enable_thinking=false` 关闭思考。
- FR-2: `qwen-plus`、`qwen-turbo`、`qwen-max` 等非混合模型不得传 `enable_thinking`。
- FR-3: 禁止顶层 `enable_thinking` kwarg（SDK 不支持）。
- AC-1: `qwen-plus` 请求 extras 为空 dict。
- AC-2: `qwen3.5-plus` 仅在 `extra_body` 含 `enable_thinking=false`。

## 改动文件

- `agenticx/memory/graph/json_compat.py`
- `tests/test_smoke_memory_graph_graphiti.py`
