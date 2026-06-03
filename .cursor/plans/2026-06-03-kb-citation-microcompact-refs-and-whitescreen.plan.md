# 修复 KB 角标落盘消失（references 被 micro-compact 截断）+ 桌面端白屏

## 现象

1. **桌面端白屏**：只剩黑底 + 中间 "Near" 占位，React 未渲染。
2. **KB 角标消失**：流式时标题/正文可见 `[2]`，回合结束后角标被删，无法溯源。

## 根因

1. **白屏**：`desktop/src/utils/turn-reference-context.ts` 从 `search-reference-sse.ts`
   导入 `mergeSearchReferences`，但该符号实际在 `types/search-references.ts`，未被
   re-export → Vite 打包失败 → 渲染进程 JS 加载失败。

2. **角标消失（真正根因，后端）**：`agent_runtime.py` 中
   `result = self.compactor.micro_compact_tool_result(...)` 会把 tool 结果 JSON
   **中间截断**后覆盖 `result`，随后用这个**截断**的 `result` 调
   `structured_payload_for_tool_result` → `json.loads` 失败 → references 为空 →
   落盘 assistant 无 `references` → 前端 `stripOrphanCitationMarkers` 把 `[N]` 当
   游离角标删除。references 应从压缩前的 `raw_result` 提取。

## 修复

- `agent_runtime.py`：references 改用压缩前的 `raw_result`。
- `turn-reference-context.ts`：`mergeSearchReferences` 从 `types/search-references` 导入。
- `tests/test_smoke_search_references.py`：新增「full JSON 出 references / 截断 JSON 返回 None」回归。

## Requirements
- FR-1: knowledge_search/web_search 的 references 在 tool 结果被 micro-compact 截断后仍能正确产出
- FR-2: 桌面端构建通过、渲染进程正常加载
- AC-1: KB 回复落盘后 assistant 含 references，`[N]` 渲染为可点击角标
- AC-2: `npm run build` 绿、`test_smoke_search_references` 全过

Plan-Id: 2026-06-03-kb-citation-microcompact-refs-and-whitescreen
