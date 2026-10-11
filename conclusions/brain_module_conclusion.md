# AgenticX Brain 模块总结

> 结论更新时间：2026-09-30（覆盖基线 `30e57496990b0e2acb18978091d9e623210eaba3` 之后的变更）

## 模块概述

AgenticX Brain（多脑知识库）模块将原先「单例全局知识库」演进为「多脑（multi-brain）」架构：一个会话/分身可挂载多个相互隔离的「知识脑」，每个脑要么是文档脑（docs），要么是代码脑（code），并支持全局（global）与分身私有（private）两种可见性范围。该模块从旧版 `knowledge_base` 单例自动迁移而来（bootstrap 生成 `default_docs` 默认文档库），是 Studio/Machi 对话侧 `knowledge_search` / `code_search` 工具背后的统一知识检索底座。

对应 Plan-Id：`2026-05-20-multi-brain-knowledge-architecture`。

## 目录结构

```
agenticx/brain/
├── __init__.py        # 对外导出：Brain/BrainManager/BrainRegistry/BrainScope/BrainType 及检索/挂载函数
├── types.py           # 领域模型：BrainType/BrainScope、Brain、CodeBrainConfig、BrainStats
├── registry.py        # BrainRegistry：CRUD + bootstrap 迁移 + 可见性迁移（relocate_visibility）
├── manager.py         # BrainManager：按 brain_id 懒加载并缓存 runtime（docs/code）
├── runtime_docs.py    # DocsBrainRuntime：封装 KBRuntime（每脑一套向量库 + 文档登记）
├── runtime_code.py    # CodeBrainRuntime：封装 CodeIndexManager（1 脑 ↔ 1 代码库）
├── mount.py           # 挂载解析：可见性判定 + resolve_mounted_brain_ids
├── search.py          # 多脑检索聚合：search_docs_brains / search_code_brains
├── wiki_compiler.py   # WikiCompiler：两步 LLM（分析 → 生成）把源文档编译为 wiki 页，支持进度回调与取消
├── wiki_compile_queue.py # WikiCompileQueue：单 worker 后台写页队列，脱离入库线程池
├── wiki_ops.py        # wiki 运维：单文档编译、写作说明草稿、示例 wiki、清理/维护
├── wiki_graph.py      # wikilink 图：构建、序列化 payload、按 query 追加相关 wiki 命中
└── routes.py          # FastAPI 路由：/api/brains 等 REST 接口
```

## 核心组件分析

### 领域模型（types.py）

- **BrainType**：枚举 `docs` / `code`，区分文档脑与代码脑。
- **BrainScope**：枚举 `global` / `private`，决定脑的可见范围；private 脑绑定 `owner_avatar_id`。
- **Brain**：核心 dataclass，含 `id`、`name`、`type`、`scope`、`storage_root`、`enabled`、`config`、`stats` 等；提供 `to_dict`/`from_dict` 序列化与 `docs_config()`/`code_config()` 类型化配置访问；`docs_config()` 返回 `KBConfig`，`code_config()` 返回 `CodeBrainConfig`。
- **CodeBrainConfig**：代码脑配置，含 `codebase_path`、`backend`（默认 `semble`）、`search_mode`（默认 `hybrid`）、`default_top_k`、`max_index_memory_mb`（128~8192 钳制）、`model`（默认 `minishlab/potion-code-16M`）等，`from_dict` 做了边界校验。
- **BrainStats**：索引统计（doc_count、indexed/failed、chunk_count、last_indexed、rebuild_required）。
- `new_brain_id()` 用 uuid 前 12 位作为脑 id；`BrainsEnabledSpec` 表示挂载规格（`"*"` / 列表 / None）。

### BrainRegistry（registry.py）

脑的 CRUD 与持久化中枢（线程安全单例）：

- **存储布局**：全局脑落在 `~/.agenticx/brains/<id>/brain.yaml`，私有脑落在 `~/.agenticx/avatars/<avatar_id>/brains/<id>/brain.yaml`；全局脑 id 列表登记在 `~/.agenticx/brains/registry.json`。
- **路径惰性解析**：`AGENTICX_HOME` / `BRAINS_ROOT` / `REGISTRY_FILE` / `CONFIG_YAML` / `AVATARS_ROOT` / `LEGACY_KB_REGISTRY` 不再是 import 时定死的模块常量，而是经 `agenticx.utils.agx_home`（`agx_home()` / `lazy_home_path()`）在调用时按当前 `$HOME` 解析，模块内部统一走 `_brains_root()` / `_registry_file()` / `_config_yaml()` / `_avatars_root()` / `_legacy_kb_registry()` 辅助函数；同时保留 PEP 562 模块级 `__getattr__`，使外部读取与 `monkeypatch.setattr("agenticx.brain.registry.BRAINS_ROOT", tmp)` 等既有测试写法继续可用（模块 `__dict__` 覆盖优先）。此举修复了 import 期 `Path.home()` 冻结导致测试数据写入开发者真实 `~/.agenticx` 的问题。
- **bootstrap()**：一次性迁移——若无 `registry.json`，读取旧版 `config.yaml` 的 `knowledge_base` 节生成 `default_docs` 默认文档库（保留 chroma 与文档登记路径不变）。
- **create/update/delete**：创建文档脑时初始化 `chroma` 向量库目录与 `kb_data` 文档登记目录；`update` 对 `id/type/scope/storage_root/owner_avatar_id/created_at` 等字段做不可变保护。
- **relocate_visibility()**：在 global ↔ private 之间迁移脑时移动存储目录并同步 registry 与（文档脑的）向量库路径；`default_docs` 禁止改可见性或删除。
- 删除脑时会调用 `_strip_brain_from_avatars()` 从各分身的 `brains_enabled` 列表中移除该脑 id。

### BrainManager（manager.py）

按 `brain_id` 懒加载并缓存 runtime 的线程安全单例：依据 `Brain.type` 实例化 `DocsBrainRuntime` 或 `CodeBrainRuntime`，提供 `get_runtime` / `evict` / `default_docs_runtime`。

### DocsBrainRuntime / CodeBrainRuntime（runtime_docs.py / runtime_code.py）

- **DocsBrainRuntime**：包装 `agenticx.studio.kb` 的 `KBRuntime`（每脑独立 registry_dir 与 `JobRegistry`），提供 `search`、`read_config`/`write_config`、`stats`，并能把统计回写到 `BrainRegistry`；每个实例另持有一个 `wiki_compiles: WikiCompileQueue`（见下文 Wiki 编译）。
- **CodeBrainRuntime**：包装 `agenticx.code_index` 的 `CodeIndexManager`，校验 `codebase_path` 必须为绝对路径，提供 `search`、`create_index`、`status`、`clear_index`、`cancel_index`、`update_config`。

### 挂载解析（mount.py）

- **brain_visible_to()**：global 脑对所有人可见，private 脑仅 owner 分身可见；disabled 脑不可见。
- **resolve_mounted_brain_ids()**：按 `explicit_brain_id` → `brains_enabled`（`"*"` 全可见 / 列表筛选 / None 仅全局）顺序解析出有序的待查询脑 id 列表，受 `max_brains`（默认 5）限制。
- **session_has_mounted_code_brains()**：判断当前会话是否挂载了至少一个代码脑（用于对话侧门控 `code_search`），会从 session 的 `bound_avatar_id`/`avatar_id` 归一化解析，排除 `group:` / `automation:` 前缀。
- **load_avatar_brains_enabled()**：从 `AvatarRegistry` 读取分身的 `brains_enabled` 规格。

### 多脑检索聚合（search.py）

`search_docs_brains` / `search_code_brains` 对解析出的多个脑逐一检索，返回统一结构：`hits`（扁平命中列表）、`by_brain`（按脑分块、含 per-brain error）、`brains`（参与脑 id）。未挂载任何脑时返回带中文 `hint` 的空结果，引导用户去「设置 → 知识库」创建并挂载。

`search_docs_brains` 的 `hits` 把普通 chunk 命中与 wiki 页命中分开排序：wiki 命中判定为 `id` 以 `wiki::` 开头或 `metadata.wiki_page` 非空；chunk 命中按 score 降序截断 `top_k`，wiki 命中按 score 降序最多取 3 条追加在后（因此 `used_top_k` 可能超过 `top_k`）。`search_code_brains` 仍按 score 降序截断。

### Wiki 编译（wiki_compiler.py / wiki_compile_queue.py / wiki_ops.py / wiki_graph.py）

文档脑可把已入库文档编译为 `<storage_root>/wiki/` 下带 frontmatter 与 `[[wikilink]]` 的 Markdown 页，受 `KBConfig.wiki_compiler`（`enabled` / `provider` / `model`）控制。

- **WikiCompiler.compile_source()**：两步 LLM（抽实体/概念 JSON → 生成 `===FILE: ... ===` 文件块），新增可选 `progress_cb(stage, message)` 与 `cancel_event: threading.Event`。阶段依次为 `reading` / `analyzing` / `generating` / `writing`；LLM 调用经 `_invoke_llm_cancellable` 在 daemon 线程中执行、每 0.25s 轮询取消事件，取消时抛 `WikiCompileCancelled` 并返回 `WikiCompileResult(ok=False, error="已取消")`（在途模型调用被放弃而非中断）。`_invoke_llm` 调用 `ProviderResolver.resolve(provider_name=..., model=...)`。
- **WikiCompileQueue**：`ThreadPoolExecutor(max_workers=1)` 单 worker，使入库线程不被模型调用阻塞。按 `doc_id` 维护状态项（`document_id` / `source_name` / `status` / `message` / `stage` / `progress` / `model`），`progress` 由阶段映射（queued 0 → reading 0.15 → analyzing 0.4 → generating 0.7 → writing 0.9 → 终态 1.0）。`enqueue` 对同一文档递增 generation 并置位旧取消事件（新任务替换旧任务）；`cancel(doc_id=None)` 只取消 `queued`/`running` 项，缺省取消全部；终态为 `done`（「写入 N 页」）/ `failed` / `cancelled` / `skipped`。
- **schedule_wiki_after_ingest(docs_rt, job)**：仅对 `IngestJobStatus.DONE` 的 job 入队并立即返回；`wiki_compiler.enabled` 为假时记为 `skipped`（「Wiki 编译未打开」）。`wiki_ops.maybe_compile_wiki_after_ingest` 现只是转调它，不再同步编译。
- **enqueue_wiki_backfill(docs_rt, document_ids=None)**：对已 `KBDocumentStatus.DONE` 的文档补排写页任务，不重新向量化，返回已入队的 doc id 列表。
- **wiki_ops.compile_document_wiki(docs_rt, doc_id, *, progress_cb, cancel_event)**：单文档编译，使用 `wiki_compiler.provider/model`（不再借用 embedding provider）；未开启返回 `skipped`，未配置供应商/模型返回中文错误，取消返回 `cancelled: True`，成功后刷新脑统计并返回 `written`。
- **wiki_ops.draft_writing_brief(docs_rt, content="")**：基于最多 40 个已入库文件名（可带原说明做润色）让模型写 2–4 句中文写作说明（`purpose`），要求已配置 wiki 供应商/模型。
- **wiki_ops.seed_sample_wiki / clear_sample_wiki**：写入/移除内置的 5 页「员工手册」示例 wiki（含 `purpose.md` 默认文本），清理仅删除示例页与空目录，`purpose.md` 仅在内容等于示例文本时清空。
- **wiki_graph.wiki_graph_payload(dir)**：把 wiki 页序列化为 `{nodes: [{id,title,type,path,sources}], edges: [{source,target}]}` 供浏览 UI。
- **wiki_graph.expand_hits_with_wiki_graph()**（由 `agenticx/studio/kb/runtime.py` 调用）：改为按 query 选页——从问题抽英文词与 4/3/2 字中文 n-gram（过滤停用词与虚词），以标题命中为种子并扩一跳出链，排除 `source*` 类型页，剔除在所有候选页都出现但不在标题中的词，按「标题分×3 + 正文分」排序，最多追加 3 条 `wiki::<id>` 命中；分数锚定为最佳 chunk 分 ×0.85 加小幅加成，`metadata.retrieval_mode = "wiki_graph"`。原有命中保持不变、不再重排或截断 `top_k`；无种子/无有效词时原样返回。

### REST 路由（routes.py）

`register_brain_routes()` 注册 `/api/brains` 等接口（幂等注册保护），对外暴露脑列表（文档脑会附带实时 stats）与脑管理能力；`_require_docs_brain()` 做类型校验后返回对应 runtime。

**(NEW，2026-09)** `POST /api/brains/{brain_id}/jobs/{job_id}/cancel`：对文档脑入库 job 调用 `rt.jobs.request_cancel(job_id, rt.runtime)`。job 不存在 → 404；已终态 → 409 `job already finished`；成功返回更新后的 `job.to_dict()`。与 Studio KB `jobs.request_cancel` / LiteParse `cancel_event` 同一取消语义。

Wiki 相关接口（均先经 `_require_docs_brain`）：

- `GET /api/brains/{brain_id}/wiki/graph` → `{ok, nodes, edges}`。
- `POST` / `DELETE /api/brains/{brain_id}/wiki/sample` → 写入（`written`）/ 移除（`removed`）示例 wiki。
- `GET /api/brains/{brain_id}/wiki/compiles` → `{ok, compiles}`（队列状态列表）。
- `POST /api/brains/{brain_id}/wiki/backfill` → `{ok, queued}`，对全部已入库文档补排写页。
- `POST /api/brains/{brain_id}/wiki/compiles/cancel`，可选 body `{document_id}`，缺省取消全部 → `{ok, cancelled}`。
- `POST /api/brains/{brain_id}/wiki/purpose/draft`，可选 body `{content}` → `{ok, content}`；业务失败 400、异常 500。
- 既有 `POST /api/brains/{brain_id}/wiki/compile/{doc_id}` 仍为同步编译，且仍以 `cfg.embedding.provider`、`model_name=None` 调用 `WikiCompiler`（未走队列与 `wiki_compiler` 模型配置）。

## 设计模式

1. **单例 + 懒加载缓存**：`BrainRegistry` 与 `BrainManager` 均为线程安全单例，runtime 按需创建并缓存，`reset_for_tests()` 便于测试隔离。
2. **策略 / 多态运行时**：`docs` 与 `code` 两类脑共享 `BrainRuntime` 联合类型，由 `BrainType` 决定具体 runtime，检索聚合层用 `isinstance` 分派。
3. **适配器模式**：runtime 层把既有的 `KBRuntime` 与 `CodeIndexManager` 适配为统一的「脑」接口。
4. **数据迁移（bootstrap）**：以一次性迁移把单例知识库平滑升级为多脑模型，保持旧数据路径不变。

## 技术亮点

1. **存储隔离与可见性范围**：global / private 双范围 + 分身归属，配合 `relocate_visibility` 的目录搬迁，实现脑的安全隔离与重定位。
2. **绝对路径强校验**：代码脑 `codebase_path` 必须为绝对路径，附中文报错引导，避免相对路径落到错误目录。
3. **检索结果双视图**：同时返回扁平排序命中与按脑分块结果，并把 per-brain 异常隔离在 `by_brain` 中不影响整体返回。
4. **空挂载友好提示**：未挂载脑时不报错，而是返回可读 `hint`，对接前端引导用户配置。
5. **会话级门控**：`session_has_mounted_code_brains` 让对话侧仅在确有代码脑时才注入 `code_search`，减少无效工具暴露。

## 应用场景

1. **多知识库并行检索**：一个分身挂载多个文档脑（如「产品文档」「合规规则」），检索时聚合多脑命中。
2. **代码库语义检索**：为某代码脑配置 `codebase_path` 后，对话中通过 `code_search` 做仓库级语义检索。
3. **分身私有知识**：为特定分身建立 private 脑，仅该分身可见，避免知识串台。
4. **旧知识库平滑升级**：老用户的全局知识库自动迁移为 `default_docs`，无需手动重建。

## 总结

Brain 模块以「多脑」抽象统一了文档与代码两类知识检索，通过 Registry（CRUD + 迁移）、Manager（懒加载 runtime）、mount（可见性/挂载解析）与 search（多脑聚合）四层清晰分工，叠加 global/private 可见性范围与绝对路径强校验等工程化细节，把 AgenticX 的知识能力从单例升级为可隔离、可组合、可按分身/会话挂载的知识底座，是 Studio/Machi 对话侧知识检索工具的核心支撑。
