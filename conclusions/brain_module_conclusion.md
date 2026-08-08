# AgenticX Brain 模块总结

> 结论生成时间：2026-05-29（首次创建，覆盖当前代码）

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
- **bootstrap()**：一次性迁移——若无 `registry.json`，读取旧版 `config.yaml` 的 `knowledge_base` 节生成 `default_docs` 默认文档库（保留 chroma 与文档登记路径不变）。
- **create/update/delete**：创建文档脑时初始化 `chroma` 向量库目录与 `kb_data` 文档登记目录；`update` 对 `id/type/scope/storage_root/owner_avatar_id/created_at` 等字段做不可变保护。
- **relocate_visibility()**：在 global ↔ private 之间迁移脑时移动存储目录并同步 registry 与（文档脑的）向量库路径；`default_docs` 禁止改可见性或删除。
- 删除脑时会调用 `_strip_brain_from_avatars()` 从各分身的 `brains_enabled` 列表中移除该脑 id。

### BrainManager（manager.py）

按 `brain_id` 懒加载并缓存 runtime 的线程安全单例：依据 `Brain.type` 实例化 `DocsBrainRuntime` 或 `CodeBrainRuntime`，提供 `get_runtime` / `evict` / `default_docs_runtime`。

### DocsBrainRuntime / CodeBrainRuntime（runtime_docs.py / runtime_code.py）

- **DocsBrainRuntime**：包装 `agenticx.studio.kb` 的 `KBRuntime`（每脑独立 registry_dir 与 `JobRegistry`），提供 `search`、`read_config`/`write_config`、`stats`，并能把统计回写到 `BrainRegistry`。
- **CodeBrainRuntime**：包装 `agenticx.code_index` 的 `CodeIndexManager`，校验 `codebase_path` 必须为绝对路径，提供 `search`、`create_index`、`status`、`clear_index`、`cancel_index`、`update_config`。

### 挂载解析（mount.py）

- **brain_visible_to()**：global 脑对所有人可见，private 脑仅 owner 分身可见；disabled 脑不可见。
- **resolve_mounted_brain_ids()**：按 `explicit_brain_id` → `brains_enabled`（`"*"` 全可见 / 列表筛选 / None 仅全局）顺序解析出有序的待查询脑 id 列表，受 `max_brains`（默认 5）限制。
- **session_has_mounted_code_brains()**：判断当前会话是否挂载了至少一个代码脑（用于对话侧门控 `code_search`），会从 session 的 `bound_avatar_id`/`avatar_id` 归一化解析，排除 `group:` / `automation:` 前缀。
- **load_avatar_brains_enabled()**：从 `AvatarRegistry` 读取分身的 `brains_enabled` 规格。

### 多脑检索聚合（search.py）

`search_docs_brains` / `search_code_brains` 对解析出的多个脑逐一检索，返回统一结构：`hits`（按 score 降序、截断 top_k 的扁平命中列表）、`by_brain`（按脑分块、含 per-brain error）、`brains`（参与脑 id）。未挂载任何脑时返回带中文 `hint` 的空结果，引导用户去「设置 → 知识库」创建并挂载。

### REST 路由（routes.py）

`register_brain_routes()` 注册 `/api/brains` 等接口（幂等注册保护），对外暴露脑列表（文档脑会附带实时 stats）与脑管理能力；`_require_docs_brain()` 做类型校验后返回对应 runtime。

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
