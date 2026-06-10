---
name: Memory graph empty JSON response fix
overview: 修复百炼/Qwen 等思考模型在记忆图谱构建时返回空 content 导致 JSON 解析失败的问题。
todos:
  - id: t1-disable-thinking
    content: Graphiti LLM 请求对 Qwen/Kimi 关闭 thinking 并启用 json_object
    status: completed
  - id: t2-parse-fallback
    content: 空响应/解析失败时降级为空 extraction payload
    status: completed
  - id: t3-smoke-tests
    content: 补充 json_compat / llm_client 冒烟测试
    status: completed
isProject: false
---

# Memory Graph：空 LLM 响应 / JSON 解析失败修复

**Plan-Id**: 2026-06-09-memory-graph-empty-json-response-fix
**Plan-File**: `.cursor/plans/2026-06-09-memory-graph-empty-json-response-fix.plan.md`
**Made-with**: Damon Li

## 背景

- UI 展示：`构建异常：No JSON object found in LLM response: line 1 column 1 (char 0)`
- 根因：记忆图谱 ingest 走裸 `AsyncOpenAI`，未像 `BailianProvider` 一样对 Qwen 思考模型设置 `enable_thinking=false`；部分模型把输出放在 `reasoning_content` 而 `content` 为空。
- 非百炼 alias（`facts→edges`）问题，见 `2026-06-09-memory-graph-qwen-extraction-search-fix.plan.md`。

## 需求

- FR-1: DashScope/Bailian Qwen 模型须自动 `enable_thinking=false` + `response_format=json_object`。
- FR-2: Kimi/Moonshot 须通过 `extra_body.thinking.type=disabled` 关闭思考。
- FR-3: 从 `content` 与 `reasoning_content` 合并提取文本后再 `parse_llm_json`。
- FR-4: 对 Graphiti extraction schema（如 `ExtractedEdges`）解析失败或空响应时，降级为合法空列表而非整 job 失败。
- AC-1: `CompatOpenAIGenericClient._parse_completion` 在空 content 时对 `ExtractedEdges` 返回 `{"edges": []}`。
- AC-2: 冒烟测试 `tests/test_smoke_memory_graph_graphiti.py` 新增用例通过。

## 改动文件

- `agenticx/memory/graph/json_compat.py`
- `agenticx/memory/graph/llm_client.py`
- `tests/test_smoke_memory_graph_graphiti.py`

## 验收

1. 完全重启 `agx serve`（或 Near Desktop）。
2. 记忆图谱设置保存一次（触发 `reset_runtime` 清 `last_error`）。
3. 发起新对话轮次或手动 ingest；UI 不应再出现上述 JSON 解析错误。
4. 若模型仍返回不可解析文本，构建应完成（可能无新边/节点）而非红色「构建异常」。
