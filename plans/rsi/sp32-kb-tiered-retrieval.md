# SP32 — KB 检索分级：L0 索引视图 + L1 按需全文（OpenViking tiered reading 内化）

## 背景与动机

现状：模型调 `knowledge_search` 后，每次检索把 **top_k 个 hit 的全文**（含 parent-child 扩展，
单条可达 4096 字符）整体注入模型上下文；多轮会话多次检索 = token 燃烧，而模型往往只用其中
一两条。桌面端 UI 引用卡只消费 `source.title / source.chunk_index / metadata.document_id /
text 前 240 字符`，全文注入对 UI 无增量价值。

OpenViking / LLM-Wiki 的 tiered reading 机制：
- **L0（索引视图）**：模型先看到紧凑摘要（id/标题/分数/查询相关摘录），足以判断相关性、
  生成引用、决定是否深挖。
- **L1（全文按需）**：模型只对真正需要的 hit 调 `knowledge_read(hit_id)` 取全文。

## 改动落点（核心产品仓，价值直达 Near 聊天）

1. `agenticx/brain/search.py`
   - `_make_query_snippet(text, query, limit=280)`：关键词窗口摘录（空格分词 + CJK 2-gram 定位，未命中取头部）。
   - `_HitFulltextCache`：模块级 LRU（上限 256），key=`{brain_id}::{hit_id}` → full hit。
   - `search_docs_brains(..., detail="full")`：`detail="compact"` 时 full hit 先入缓存，返回
     hit 的 `text` 替换为 snippet，并附 `read` 提示；去掉 `by_brain` 冗余（模型侧无用，
     compactor 投影本来也删它）。`detail="full"` 行为不变（synthesis / brain routes 不受影响）。
   - `read_kb_hit(hit_id, brain_id=None)`：缓存精确命中 → 后缀匹配，miss 返回错误。
2. `agenticx/cli/agent_tools.py`
   - `_tool_knowledge_search`：KB disabled 短路返回（与 `/api/kb/search` 语义一致）；
     新增 `detail` 参数，**默认 compact（L0）**——聊天链路自动生效省 token。
   - 新工具 `_tool_knowledge_read`（L1）+ STUDIO_TOOLS schema + 分发表 + allowed 白名单。
   - eager search（KB always 模式首轮）自动走 L0。
3. UI 契约不变：`/api/kb/search` 端点（设置面板测试搜索）走 `runtime.search` 全量，不经
   `search_docs_brains`；引用卡 fallback 解析只读 `hits[].text[:240]`，L0 snippet 兼容。

## 验收标准

- `knowledge_search` 默认返回 L0：单 hit `text` ≤ 280 字符，保留 id/score/source/metadata
  （UI 字段齐全），payload 显著小于 full（长文档场景）。
- `knowledge_read(hit_id)` 返回该 hit 全文；缓存 miss 给明确错误。
- `detail="full"` 完全保持旧行为（存量测试回归）。
- compactor 投影（`_project_knowledge_search_hits`）无需修改即兼容 L0 小 payload 直通。
- 修复存量 `tests/test_kb_agent_tool.py`（`_runtime`→`runtime` API 漂移 + disabled 断言）。
- 新增 `tests/test_kb_tiered_retrieval.py` 覆盖以上全部；核心仓相关测试全绿。

## 非目标

- 不动 chroma/FTS 检索算法本身（hybrid/RRF 不变）。
- 不动桌面端 TS 代码（契约零变更）。
- Enterprise 统一上下文服务为下一项（SP33），本 SP 只落单机聊天链路分级。
