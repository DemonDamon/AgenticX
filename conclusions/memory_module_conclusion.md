# agenticx.memory 目录完整结构分析

> 结论更新时间：2026-09-01（覆盖上一基线 `f3ba65001c29` 之后的变更）

## 目录路径
`d:/myWorks/AgenticX/agenticx/memory`

## 完整目录结构与文件摘要

### 一级文件/目录概览
- README.md  
- __init__.py  
- base.py  
- component.py  
- core_memory.py  *(本轮更新：时间戳 aware 化)*  
- episodic_memory.py  
- graph/  *(本轮更新：writer.py 事件循环安全)*  
- hierarchical.py  *(本轮更新：新增 `ensure_aware`)*  
- hybrid_search.py  *(本轮更新：时间衰减读取侧兜底)*  
- intelligence/  
- knowledge_base.py  
- mcp_memory.py  
- mem0_memory.py  
- mem0_wrapper.py  
- memory_decay.py  
- semantic_memory.py  
- session_store.py  *(本轮重点更新)*  
- short_term.py  
- workspace_memory.py  *(本轮重点更新)*  

> 其余子文件及大小信息详见 `memory_structure.txt`。

---

### README.md
**文件功能**：概述 memory 子系统目标与使用说明。  
**技术实现**：Markdown 说明，不含代码。  
**关键组件**：无。  
**业务逻辑**：帮助开发者快速理解六层记忆模型设计理念。  
**依赖关系**：引用其它模块仅在示例片段中。  

### __init__.py
**文件功能**：包入口，集中重导出各 Memory 类。  
**技术实现**：通过 `from .xxx import YYY as public_name` 方式暴露统一接口；**支持 lazy import 模式以绕过沙箱环境的 SSL 限制**。  
**关键组件**：`CoreMemory`、`SemanticMemory`、`EpisodicMemory`、`ShortTermMemory`、`SOPRegistry` 等。  
**业务逻辑**：简化外部调用路径，提供工厂型便捷别名。  
**依赖关系**：内部引用 memory 各实现文件。  

### base.py (238 行)
**文件功能**：定义内存系统最底层 `BaseMemory` 抽象基类及通用异常。  
**技术实现**：使用 `abc.ABC` 与 `@abstractmethod` 描述异步接口，包括 `add/search/update/delete/get/list_all/clear` 等；利用 `dataclass` 定义 `MemoryRecord`、`SearchResult`，自动处理时间戳与得分合法性。  
**关键组件**：`BaseMemory`、`MemoryRecord`、`SearchResult`、`MemoryError` 族。  
**业务逻辑**：规范所有记忆后端的租户隔离 (`tenant_id`) 及 CRUD 语义。  
**依赖关系**：被层次化记忆实现继承。  

### hierarchical.py (341 行)
**文件功能**：实现仿生六层分层记忆核心抽象 `BaseHierarchicalMemory` 及多枚举常量。  
**技术实现**：扩展 `BaseMemory`，新增 `MemoryType/Importance/Sensitivity` 枚举、`HierarchicalMemoryRecord`（带访问计数、衰减因子）、事件日志 `MemoryEvent`；提供关联管理、层次搜索钩子函数。  
**关键组件**：`BaseHierarchicalMemory._store_record/_hierarchical_search` 抽象钩子、`add/search_hierarchical/get_associations` 等。  
**本轮变更（2026-09-01）**：新增模块级工具函数 `ensure_aware(value: datetime)`——给 naive 时间戳补**本地**时区（`value.astimezone()`），使其能与 aware 的 `datetime.now(UTC)` 相减。历史记录曾用 naive `datetime.now()` 创建，读取侧算相关度/时间衰减/max_age 过滤时会抛 `TypeError`；创建点已改 aware，此函数兜底已落盘的老记录。补本地时区而非 UTC，避免 UTC+8 老记录被凭空算老 8 小时。  
**业务逻辑**：为后续各层 (Core/Episodic/Semantic …) 提供统一增强能力（重要度、安全级、事件日志）。  
**依赖关系**：被 core/episodic/semantic 等子类继承；`ensure_aware` 被 `core_memory.py` 与 `hybrid_search.py` 引用。  

### component.py (616 行)
**文件功能**：高阶 `MemoryComponent`，封装多后端协同、智能更新流水线、操作历史。  
**技术实现**：组合 `BaseMemory` 实例列表；定义 `MemoryOperation` 历史记录 dataclass；内置四步流水线（抽取→检索→推理→更新），支持主/辅内存同步和自动合并；通过 `_record_operation` 记录 JSON 可序列化历史。  
**关键组件**：`add_intelligent`, `search_across_memories`, `_update_pipeline`。  
**业务逻辑**：在多存储后端之间路由、聚合和智能强化写入，为审计与调优提供操作记录。  
**依赖关系**：依赖 primary & secondary `BaseMemory` 实现；调用日志由 `logging`。  

### core_memory.py (607 行)
**文件功能**：核心层记忆，持久化代理身份、人格与长期上下文。  
**技术实现**：继承 `BaseHierarchicalMemory`；维护 _core_records 内存字典与关键字索引；提供 `set_agent_identity/get_agent_identity`、`set_persistent_context/get_*`、`update_agent_state` 等高阶接口；自动初始化默认 profile。  
**关键组件**：`_ensure_initialized`、`_index` 简单倒排索引。  
**本轮变更（2026-09-01）**：所有记录创建点（默认 profile、`set_persistent_context` 新建分支、`add`）由 naive `datetime.now()` 改为 aware `datetime.now(UTC)`；相关度评分的 recency 计算改用 `ensure_aware(record.created_at)` 兜底历史 naive 记录，消除 naive/aware 相减的 `TypeError`。  
**业务逻辑**：保证代理基础身份信息在所有会话中保持一致，支撑长周期行为一致性。  
**依赖关系**：使用 `uuid`, `datetime`, `asyncio`；自 `hierarchical` 导入 `ensure_aware`。  

### episodic_memory.py (653 行)
**文件功能**：时序化经历记忆层，实现事件—情节（Episode）模型。  
**技术实现**：定义 `EpisodeEvent`、`Episode` dataclass；索引映射 `time_index/event_index/keyword_index`；支持自动分段成 Episode、阈值自动摘要；提供 `add_event/create_episode/get_episodes_by_time_range`。  
**关键组件**：`EpisodicMemory.add_event`, `_find_or_create_episode`, `_update_episode_summary`。  
**业务逻辑**：对话或任务过程中以事件流方式记录信息，便于时间范围检索与上下文重构。  
**依赖关系**：继承 `BaseHierarchicalMemory`；内部依赖 core utils。  

### semantic_memory.py (883 行)
**文件功能**：语义层记忆，管理概念、知识三元组与事实。  
**技术实现**：维护多级索引 (_concept_index/_triple_index 等)；定义 `Concept`、`KnowledgeTriple` dataclass；实现 `add_knowledge/add_concept`、概念相似度合并、知识抽取占位函数；支持语义搜索。  
**关键组件**：`_extract_concepts`, `_create_or_update_concept`, `_extract_knowledge_triples`。  
**业务逻辑**：为代理提供可推理的通用知识库，通过概念-关系图加强推理能力。  
**依赖关系**：继承 `BaseHierarchicalMemory`；与 NLP 抽取算法解耦。  

### hybrid_search.py
**文件功能**：混合检索引擎，组合 BM25 全文检索与向量语义检索。  
**技术实现**：`HybridSearchEngine` 编排 `BM25SearchBackend` + `VectorSearchBackend` + `HybridRanker`；`SearchQuery`/`SearchCandidate` dataclass 承载多路得分与解释；`HybridRanker._calculate_hybrid_score` 按权重融合后叠加时间衰减、重要度与字段 boost。  
**关键组件**：`HybridSearchEngine.search`、`HybridRanker._calculate_time_decay/_calculate_importance_boost/_calculate_field_boost`。  
**本轮变更（2026-09-01）**：`_calculate_time_decay` 计算记录年龄时改用 `ensure_aware(record.created_at)`，与 core_memory 同步兜底 naive 历史时间戳。  
**业务逻辑**：提升跨层记忆召回率。  
**依赖关系**：依赖 hierarchical 记录结构与 `ensure_aware`。  

### knowledge_base.py
**文件功能**：知识库适配层，统一外部 KB 访问并映射为 memory 记录。  
**技术实现**：封装 CRUD 到外部向量数据库或全文索引。  
**关键组件**：`KnowledgeBaseMemory` 类。  
**业务逻辑**：让代理可扩展引用外部文档与多模态资源。  
**依赖关系**：与第三方数据库驱动耦合。  

### memory_decay.py
**文件功能**：实现记忆衰减策略，周期性降低不重要记录的权重或删除。  
**技术实现**：基于 `importance`, `last_accessed`, `decay_factor` 计算新分数。  
**关键组件**：`apply_decay(memory: BaseHierarchicalMemory)`。  
**业务逻辑**：逼近人类遗忘机制，缓解存储膨胀。  
**依赖关系**：遍历 hierarchical records。  

### short_term.py
**文件功能**：短期记忆缓存，实现最近对话窗口滑动存储。  
**技术实现**：环形队列或 deque 保存最近 N 条交互；支持向长时记忆写入阈值触发。  
**关键组件**：`ShortTermMemory.add_message`, `flush_to_long_term()`。  
**业务逻辑**：提供对话上下文窗口给 LLM，确保 token 限制内。  
**依赖关系**：可调用 Episodic/Semantic 层。  

### session_store.py（(NEW) 本轮重点更新：FTS5 检索 + 标题/分组修复）
**文件功能**：会话摘要与元数据的 SQLite 持久化层，并承载跨会话全文检索（默认库 `~/.agenticx/memory/sessions.sqlite`）。  
**本轮变更（2026-09-01，基线 `f3ba65001c29` 之后）**：
- **库路径惰性解析（commit `cc45657d`）**：`DEFAULT_SESSION_DB_PATH` 由模块级常量改为 `default_session_db_path()` 函数 + PEP 562 `__getattr__`，按**调用时**的 HOME 解析。原常量在 import 时被 `Path.home()` 定死，测试的 HOME 沙箱重定向拦不住，会话元数据会写进开发者真实的 `~/.agenticx/memory/sessions.sqlite`（症状：sqlite 里有记录、磁盘无会话目录，桌面端历史出现点不开的空白对话）。`SessionStore.__init__` 经模块属性读取回退值，`monkeypatch.setattr(module, "DEFAULT_SESSION_DB_PATH", ...)` 旧写法仍生效。
- **列表按 avatar 过滤（commit `42230d1b`）**：`_list_latest_sessions_sync` 新增可选 `avatar_id` 参数，SQL 层用 `json_extract(s.metadata, '$.avatar_id') = ?` 过滤；新增 `_list_all_session_ids_sync()` 返回 DISTINCT session_id 集合，供过滤列表跳过仅有 sqlite 记录的目录。
**历史变更（2026-03-18 之后）**：
- **跨会话 FTS5 检索（commit `cc0ba170`）**：新增 `session_messages` + `session_messages_fts` 外部内容表（FTS5 + 触发器）；方法 `index_session_messages` / `search_session_messages` / `backfill_from_sessions_root`；`_sanitize_fts5_query` 清洗用户查询；`AGX_SESSION_FTS` 开关默认 `1`。`SessionManager` 在 `_persist_session_state` 挂钩自动索引，并在启动时 fire-and-forget 增量回填历史 `messages.json`。该层是 `session_search` 工具的底座。
- **消息正文检索（commit `c79212c6`）**：补充对 session 消息（含助手回复）的 FTS 检索 + LIKE 回退，供 Desktop 历史面板「Search Sessions」命中后展示消息摘要。
- **标题持久化修复（commit `582aa908`）**：`cleanup_expired` 过期淘汰前先 `_persist_session_state` 写全量元数据，避免 `session_name` 被写成 null；最新元数据加载时从更早的历史行恢复标题；新建时若仍缺失则从 `chat_history` 派生。
- **Today 分组与空会话治理（commit `85dad862`）**：`list_sessions` 改按真实最后活动时间（消息 timestamp / touch / summary 恢复）分组排序；无 user/assistant 消息的内存 session 不进入历史列表，冷启动不再预建空 session。

### workspace_memory.py（(NEW) 本轮重点更新：标题感知切分 + 收藏召回）
**文件功能**：基于 SQLite + FTS + 语义排序的 workspace markdown 记忆索引（`WorkspaceMemoryStore`，默认库 `~/.agenticx/memory/main.sqlite`）。  
**技术实现**：`MemoryChunk` dataclass 记录 chunk 元数据与 embedding；`_chunk_text` 按 markdown ATX 标题（`#`..`######`）切分，单段超 `_MAX_SECTION_LINES`（60 行）在空行处再切分，无标题时回落 `_FALLBACK_CHUNK_LINES`（40 行）。  
**本轮变更（2026-09-01，commit `cc45657d`）**：`DEFAULT_WORKSPACE_MEMORY_DB` 由模块级常量改为 `_default_ws_db()` 惰性解析 + PEP 562 `__getattr__`，底层走 `agenticx/utils/agx_home.py` 的 `agx_home()`/`lazy_home_path()`——按调用时 HOME 解析，且优先读模块 `__dict__` 里的 monkeypatch 覆盖值；`WorkspaceMemoryStore.__init__` 改调 `_default_ws_db()`。与 session_store 同源修复测试 HOME 重定向失效问题。  
**历史变更（commit `1b873108`，2026-03-23）**：新增标题感知切分（章节在 60 行以内保持单 chunk）；打通「收藏 → 长期记忆」管线——`POST /api/memory/save` 向 `MEMORY.md` 追加 `[用户收藏]` 备注并 `index_workspace_sync` 重建索引（best-effort，失败不阻断）；空文件内容产出 0 chunk，不写空占位。  
**依赖关系**：由 Studio `/api/memory/*` 与 Meta-Agent 记忆召回调用；路径解析依赖 `agenticx/utils/agx_home.py`。

### graph/ 子目录（本轮更新：writer.py 事件循环安全）
记忆图谱（Graphiti）子系统目录，含 `store.py`/`config.py`/`status.py`/`group_id.py`/`routes.py` 等；本轮仅 `writer.py` 有变更。

**graph/writer.py**：`MemoryGraphWriter`——Graphiti 摄取的后台 worker，单例 + `asyncio.PriorityQueue`（`_IngestJob` 按 priority/seq 排序）；`enqueue_turn`/`enqueue_favorite` 入队，`schedule_turn_ingest_from_session` 供同步 server 代码 fire-and-forget 调度（按会话归属路由 group_id：群聊→`group:<gid>`、分身→`avatar:<aid>`、Meta→`meta:default`）。

**本轮变更（2026-09-01，commit `f2e78393`）**——围绕「单例被多个事件循环复用」与「task 被 GC」两类泄漏/崩溃：
- `_ensure_worker` 记录 `_worker_loop`；检测到运行循环变更时调 `_drop_stale_worker()` 重建 worker **连同队列**（`asyncio.Queue` 内部 `_finished` Event 一旦被 `join()` await 过就绑定旧循环，跨循环复用直接抛「bound to a different event loop」）；待处理 job 为纯数据，搬入新队列，旧循环存活时 `call_soon_threadsafe` 取消旧 task。
- `_run_worker` 改用 `get_nowait()` 排空队列后即退出，不再悬挂在 `await queue.get()`——悬挂协程会在队列内留下绑定当前循环的 future，循环关闭后 GC 收尾时抛无法捕获的 `RuntimeError: Event loop is closed`；下次 `enqueue_turn` 会重新拉起 worker（`put_nowait` 与 `_ensure_worker` 间无 await，无竞态）。
- 新增 `aclose()` 供 shutdown 时取消并 await worker。
- `schedule_turn_ingest_from_session` 把 dispatch task 存入模块级 `_pending_dispatches` 集合并以 `add_done_callback` 自摘——asyncio 对运行中 task 只持弱引用，不留强引用 ingest 可能跑到一半被 GC，静默丢一轮图谱写入。

### sop_registry.py (新增，参考 JoyAgent)
**文件功能**：实现轻量级的标准作业程序（SOP）注册与召回
**技术实现**：基于词袋重叠相似度的召回机制，内置 LRU 缓存与去重逻辑
**关键组件**：
- `SOPRegistry` 类：核心管理类，支持 HIGH/COMMON/NO_SOP 三种匹配模式
- `SOPItem` 类：定义 SOP 结构，包含步骤与描述
- `build_prompt()`：根据查询自动生成可注入 Planner 的 SOP 引导 Prompt
**业务逻辑**：通过匹配预定义的 SOP 引导智能体按标准流程执行任务，提升复杂任务的可控性与稳定性
**依赖关系**：被 `MiningPlannerAgent` 集成，用于计划生成前的引导提示

### intelligence 子目录
| 文件 | 功能概述 |
|------|---------|
| __init__.py | 聚合子模块导出 |
| cache_manager.py | 内存缓存淘汰与多级缓存策略 |
| memory_intelligence.py | 智能策略入口，根据查询意图选择最佳记忆层 |
| models.py | Pydantic 数据模型定义检索/评分结构 |
| pattern_analyzer.py | 模式分析器，观察访问模式并调整索引 |
| retrieval_optimizer.py | 检索优化器，动态调整参数和权重 |

各文件均围绕“Memory Intelligence”提供高级推理与优化功能。

---

## 模块整体评价
1. **分层架构清晰**：通过 `BaseHierarchicalMemory` 抽象出统一元数据和事件体系，向上实现不同语义层。  
2. **异步接口**：所有 CRUD 方法均为 `async`，方便与 IO 密集型存储后端集成。  
3. **丰富元数据**：记录重要度、敏感级别、关联、衰减因子等，为后续智能算法留出空间。  
4. **可拓展性**：新增记忆层或替换后端只需继承基类并实现存储与搜索；`MemoryComponent` 支持多后端融合。  
5. **缺点与改进**：
   - 缺少真实向量/相似度实现，需接入如 FAISS/Weaviate。  
   - 部分智能抽取/总结函数占位，需补充 NLP 算法。  
   - 需要完善单元测试覆盖多租户和衰减逻辑。
6. **CAMEL 风格记忆支持（新增）**：
   - `camel_memories.py` 提供 ChatHistoryMemory、VectorDBMemory、LongtermAgentMemory 三种 CAMEL 风格记忆类型
   - `context_creators/score_based.py` 提供 ScoreBasedContextCreator，支持两阶段 token 管理和自动摘要触发
   - 所有 CAMEL 风格记忆类型都实现了 BaseMemory 接口，支持租户隔离和完整的 CRUD 操作
   - VectorDBMemory 在依赖缺失时自动降级为文本搜索，LongtermAgentMemory 在向量存储不可用时只使用聊天历史  

---

## Runtime 层记忆扩展（agenticx/runtime/hooks/memory_hook.py）

> 注：`MemoryHook` 位于 `agenticx/runtime/hooks/` 下，是 Runtime 生命周期 Hook，但其功能直接面向 memory 子系统。

### MemoryHook

**功能**：在 `on_agent_end` 钩子触发时，自动从对话历史提取关键事实并持久化到 workspace memory 文件。

**触发条件**：
- `chat_history` 长度 ≥ 6 条（MIN_CHAT_TURNS=3 × 2）
- session 的 `workspace_dir` 存在（回退 `AGX_WORKSPACE_ROOT` 或 home 目录）

**提取机制（启发式，无 LLM 调用）**：
- 从最近 20 条消息扫描，取 `role=user` 且首行包含请求关键词（`请/帮/要/需要/希望/如何/怎么`）的消息
- 取 `role=assistant` 且内容含 `已完成`/`done` 的消息
- 每次会话最多提取 8 条（MAX_FACTS_PER_SESSION）

**持久化路径**：

| 写入目标 | 路径 | 条件 |
|----------|------|------|
| Daily memory | `<workspace_dir>/memory/<YYYY-MM-DD>.md` | 每次 on_agent_end 追加，单文件上限 8000 chars |
| Long-term MEMORY.md | `<workspace_dir>/MEMORY.md` | 仅当 MEMORY.md < 4000 chars 时追加最多 4 条 facts |
| Session scratchpad | `session.scratchpad["session_facts"]` | 追加到当前 session 的内存 scratchpad |

**每日记忆压缩（`_maybe_compact_daily`）**：
- 写入后检查 daily memory 是否超 2000 chars
- 超限时按行去重（基于前 80 字符小写 key），保留 `##` 标题行，覆盖写回

**注册时机**：在 `AgentRuntime.__init__` 中以 priority=-10 自动注册，为最后执行的 Hook。

**错误处理**：所有异常静默捕获，仅 DEBUG 日志，不影响主流程。

---

### Turn Archive（对话轮次语义归档，2026-06-11）

内化 Ruflo Compaction-to-Memory Bridge 的最小机制：将完整 user+assistant 对话块写入 `WorkspaceMemoryStore` 的 `turns` 表，供 `recall.py` 语义检索。

| 组件 | 路径 | 说明 |
|------|------|------|
| 配置 | `agenticx/memory/turn_archive_config.py` | `memory.turn_archive.enabled` 默认 `false`；`AGX_TURN_ARCHIVE_ENABLED` 可覆盖 |
| 存储 | `WorkspaceMemoryStore.archive_turn_sync/search_turns_sync/reinforce_turns_sync` | `turns` + `turns_fts` 表；SHA-256 去重；复合重排 `recency×frequency×base` |
| 召回 | `agenticx/memory/recall.py` | `search_memory_for_chat` 并入 `source=turn` 结果，命中后 `reinforce_turns_sync` |