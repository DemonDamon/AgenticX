---
name: Memory graph qwen extraction and search fix
overview: 修复百炼/qwen 关系抽取 JSON 字段别名（facts→edges）与图谱搜索 cross_encoder 超时问题。
todos:
  - id: t1-facts-alias
    content: json_compat 将 facts 映射为 ExtractedEdges.edges
    status: completed
  - id: t2-status-reconcile
    content: 重启后清理幽灵 pending_jobs 与 UI 错误展示逻辑
    status: completed
  - id: t3-search-rrf
    content: 搜索改用 COMBINED_HYBRID_SEARCH_RRF 并返回可读错误
    status: completed
isProject: false
---

# Memory Graph：百炼抽取 + 搜索修复

**Plan-Id**: 2026-06-09-memory-graph-qwen-extraction-search-fix
**Plan-File**: `.cursor/plans/2026-06-09-memory-graph-qwen-extraction-search-fix.plan.md`
**Made-with**: Damon Li

## 背景

- 构建异常：`ExtractedEdges` 期望 `edges`，qwen3.5-plus 返回 `{'facts': []}`。
- 搜索「Machi」：30s 超时/500，因 `COMBINED_HYBRID_SEARCH_CROSS_ENCODER` 对每段 passage 调 LLM logprobs，百炼不支持。

## 需求

- FR-1: `coerce_to_response_model` 须将 `facts` 等别名规范为 `edges`。
- FR-2: agx serve 重启且内存队列为空时，须清理持久化 `pending_jobs` 幽灵计数。
- FR-3: 图谱搜索须使用 RRF 混合检索，避免 cross_encoder；失败须返回可读 JSON 错误。
- AC-1: `ExtractedEdges(**coerce({'facts':[]}))` 通过校验。
- AC-2: `/api/memory/graph/search` 在已初始化图谱上数秒内返回或返回明确 timeout 消息。
