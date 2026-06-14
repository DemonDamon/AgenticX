# Plan: 记忆图谱治理 —— Episode 批量管理 + 自动 Retention + 自然语言遗忘

Plan-Id: 2026-06-14-memory-graph-governance-retention
Status: draft（待用户确认后由 composer 2.5 实施）
Owner: Damon Li

---

## 0. 给实施者（composer 2.5）的阅读须知 —— 先读这一节

你将实施一套「记忆图谱随使用膨胀后的治理能力」。在写任何代码前，**必须先用 Read 工具读完下面 §6「关键文件与现有签名」列出的每个文件的相关区段**，确认函数签名、API 形状与本 plan 一致再动手。本仓库已有约束（务必遵守）：

1. **no-scope-creep**：只改本 plan 明确点名的代码路径；不顺手重构无关逻辑；每个改动可追溯到下面某条 FR。
2. **Python 风格**（`.cursor/rules/google-python-style.mdc`）：每个 `.py` 文件模块 docstring 含 `Author: Damon Li`；注释/docstring 全英文；禁用相对导入（一律 `from agenticx...`）；代码与注释禁用 emoji（仅用户可见字符串可用）。
3. **不臆断 graphiti 行为**：凡涉及 graphiti-core 的删除/失效语义（如 `remove_episode` 是否级联清理孤立实体），**先写一个最小冒烟测试跑出真实行为**，再据此实现；不要凭想象写注释或断言。
4. **每个功能点配 pytest 冒烟测试**（见 §4）；前端改动 `cd desktop && npm run typecheck` 必须全绿。
5. **分阶段提交**：每个 Phase 一个独立可 revert 的 commit，用 `/commit --spec=.cursor/plans/2026-06-14-memory-graph-governance-retention.plan.md`，commit 含 `Made-with: Damon Li` 与 Plan-Id/Plan-File trailer。
6. **修改 Electron 主进程 / 新增 IPC 后**：必须完全退出并重启 `npm run dev`（`tsc --watch` 不会热重载主进程）。本 plan 默认走 HTTP API，不一定需要新 IPC；若需要会在对应 FR 标注。

### 核心设计心智（不要偏离）
- 用户**不手动编辑图谱的 node/edge**。治理粒度只有三种：
  1. **Episode**（一次对话/一个时间点）—— 可删、可批量删、可 pin。
  2. **文本记忆 `MEMORY.md` 条目** —— 已有增删改（`WorkspaceMemoryList`），本 plan 不重做，只在「自然语言遗忘」里联动。
  3. **自动 retention 规则** —— 用户只配「保留多少条/多少天」，系统自动淘汰最旧的非 pinned episode。
- 图谱画布是「透镜」，不是完整记忆；本 plan 让默认视图聚焦近期/高频，而非铺全量。
- 实体/关系交给系统自动抽取与淘汰；「忘记某主题」走 Agent 工具，而不是让用户在画布点节点。

### 优先级（用户可裁剪；建议至少做 P0）
- **P0**：Phase A（retention 基础设施）+ Phase B-1/B-2（批量删 episode + 删前影响预览 API）+ Phase D-1（Episode 时间轴升级为批量管理 UI）+ Phase D-2（设置页 retention 配置）。
- **P1**：Phase C（自然语言 `memory_forget` 工具）+ Phase E（图谱默认聚焦子图）+ episode pin。
- **P2**：Phase F（Community compact 定时压缩）—— 依赖 graphiti 能力验证，可能改为「仅删旧 episode 的归档式 compact」。

---

## 1. 背景与问题（事实基础）

当前记忆图谱（Graphiti + Kuzu）已可用并按主体分区（`meta_default` / `avatar_<id>` / `group_<gid>`），但**只有写入与查看，没有治理**：

- `config.py` 无任何 retention 字段；`writer.py` 每轮 ingest 成功后仅 `record_success`，图谱**只增不减**。
- `store.py` 仅暴露 `list_episodes` / `delete_episode`(→ graphiti `remove_episode`) / `get_overview` / `search_subgraph` / `get_episode_subgraph`；**没有删单个 node/edge 的能力**，也没有按时间/条数批量淘汰。
- UI（`MemoryGraphExplorer.tsx`）右栏 Episode 时间轴只能**逐条删**，无多选/批量/按时间筛选/删前预览。
- 画布默认拉 overview（cap 80 节点 / 120 边），库大了之后画布既看不全也无法治理。

结论：随着元智能体/分身/群聊各自分区内 Episode 持续累积，图谱会无限膨胀，且用户**无可用的管理手段**。本 plan 补齐治理闭环。

---

## 2. 范围（Scope）与非目标

### In scope
- 后端：`memory_graph.retention` 配置项；`MemoryGraphStore` 新增「按规则/按条件批量删 episode」「删前影响预览」「episode pin 读写」方法；writer 在 ingest 成功后触发 retention；新增 HTTP API；可选 `memory_forget` 工具。
- Near Desktop：Episode 时间轴升级为批量管理面板；设置页新增 retention 配置区；图谱默认聚焦子图。

### Out of scope（本 plan 不做，避免 scope creep）
- 不实现 node/edge 级的手动编辑/删除/连线（无底层支撑，且非产品方向）。
- 不改 `group_id.py` 的分区编码规则与 `parse_subject` 口径。
- 不改 `WorkspaceMemoryList` 文本记忆的增删改 UI（已存在）；仅在 Phase C 联动调用其后端 API。
- 不动 `enterprise/` 任何代码。
- 不引入新三方依赖（retention 用现有 graphiti API + 本地 json sidecar 实现）。
- 不改 ingest 抽取质量 / LLM prompt。

---

## 3. 需求（FR / NFR / AC）

### FR-A 自动 Retention 配置（Phase A，P0）
- FR-A.1 `agenticx/memory/graph/config.py` 新增 `MemoryGraphRetentionConfig` dataclass，挂到 `MemoryGraphConfig.retention`：
  ```python
  @dataclass
  class MemoryGraphRetentionConfig:
      enabled: bool = False          # 默认关闭，开启才淘汰
      max_episodes: int = 0          # 每分区保留的 episode 上限；0=不限
      max_age_days: int = 0          # 超过该天数的 episode 淘汰；0=不限
      on_ingest: bool = True         # 每次 ingest 成功后顺带跑一次轻量 retention
  ```
  - `load_memory_graph_config()` 解析 `memory_graph.retention` 子段（沿用现有 `_coerce_bool`/`_coerce_int`，`max_*` minimum=0）。
  - `memory_graph_config_to_dict()` 输出 `retention` 子段（供设置页读写）。
  - 环境变量可选：`AGX_MEMORY_GRAPH_RETENTION=0/1` 覆盖 `retention.enabled`（与现有 env 覆盖模式一致，env 优先）。
- FR-A.2 **不破坏旧配置**：缺省即关闭，旧 `config.yaml` 无 `retention` 段时行为不变。

### FR-B Episode pin（保护清单）（Phase A，P1 可后置）
- FR-B.1 新增轻量 sidecar 文件 `~/.agenticx/memory/graph_pins.json`，结构 `{ "<group_id>": ["<episode_uuid>", ...] }`。
- FR-B.2 在 `agenticx/memory/graph/` 新增 `pins.py`（`Author: Damon Li`），提供：
  - `load_pins(group_id) -> set[str]`
  - `set_pin(group_id, episode_uuid, pinned: bool) -> None`（原子读改写，文件不存在则创建）
  - 并发安全用简单文件写（best-effort，失败仅 warning，不抛给上层）。
- FR-B.3 retention 与批量删**必须跳过 pinned** episode。

### FR-C Store 治理方法（Phase A，P0）
在 `agenticx/memory/graph/store.py` 的 `MemoryGraphStore` 新增（均走 `run_on_graphiti_loop`，与现有 `delete_episode` 同模式）：
- FR-C.1 `async def prune_episodes(self, group_id, *, max_episodes=0, max_age_days=0, dry_run=False) -> dict`：
  - 用现有 `_list_episodes_impl(group_id, last_n=100)`（注意现有上限 100，若需更多需在 impl 放宽 `last_n` 上限，**仅放宽数值上限，不改其它逻辑**）列出 episode，按 `referenceTime` 排序。
  - 计算「应删集合」= 超过 `max_age_days` 的 + 超过 `max_episodes` 的最旧者，**排除 FR-B pinned**。
  - `dry_run=True` 只返回 `{"would_delete": [uuid...], "count": N, "kept": M}`，不删。
  - `dry_run=False` 逐个 `_delete_episode_impl(uuid)`，返回 `{"deleted": [...], "count": N}`。
- FR-C.2 `async def delete_episodes_bulk(self, group_id, episode_uuids: list[str]) -> dict`：批量删指定 uuid（跳过 pinned，返回 `{"deleted":[...], "skipped_pinned":[...]}`）。
- FR-C.3 `async def preview_episode_impact(self, group_id, episode_uuid) -> dict`：用现有 `get_episode_subgraph` 返回该 episode 关联的 `nodeCount`/`edgeCount`，并诚实标注 `note`：「实体可能被其他 episode 共享，删除该 episode 不一定移除这些实体」。
  - **实施前置冒烟**：先写测试验证 graphiti `remove_episode` 删 episode 后，仅被该 episode 引用的孤立实体是否被清理；把真实结论写进 `note` 文案与 docstring（FR-C.3 的文案以实测为准）。

### FR-D Retention 触发（Phase A，P0）
- FR-D.1 `agenticx/memory/graph/writer.py` 的 `_run_worker` 在 `record_success` 之后，若 `cfg.retention.enabled and cfg.retention.on_ingest`，best-effort 调 `store.prune_episodes(job.group_id, max_episodes=..., max_age_days=...)`；异常仅 `logger.warning`，不影响 ingest 主流程。
- FR-D.2 retention 触发**只作用于当前 ingest 的 `group_id`**（不全局扫描，避免阻塞 worker）。

### FR-E HTTP API（Phase B，P0）
在 `agenticx/memory/graph/routes.py` 新增（沿用现有 `_auth` / `validate_group_access` / `_map_error` 模式，跨分区 403）：
- FR-E.1 `POST /api/memory/graph/episodes/bulk-delete`，body `{ group_id, episode_uuids: [...], avatar_id?, session_id? }` → 调 `delete_episodes_bulk`。
- FR-E.2 `GET /api/memory/graph/episode/{uuid}/impact?group_id=...` → 调 `preview_episode_impact`（删前预览）。
- FR-E.3 `POST /api/memory/graph/retention/run`，body `{ group_id, dry_run?: bool, avatar_id?, session_id? }` → 调 `prune_episodes`（手动触发/预演，配置读 `cfg.retention`）。
- FR-E.4 `POST /api/memory/graph/episode/{uuid}/pin`，body `{ group_id, pinned: bool, avatar_id?, session_id? }` → FR-B `set_pin`（P1，可与 D-1 同期）。
- FR-E.5 retention 配置读写**复用现有** `GET/PUT /api/memory/graph/config`（FR-A 已让 config dict 含 `retention`，PUT 整段写回即可），不新增独立端点。

### FR-F 自然语言遗忘工具 `memory_forget`（Phase C，P1）
- FR-F.1 在 `agenticx/runtime/meta_tools.py` 新增工具 `memory_forget`（与现有 `memory_append`/`memory_search` 分支同位置注册），参数 `{ query: str, scope?: "graph"|"text"|"both" (default "both") }`：
  - 解析当前 session 主体 → `derive_group_id_from_avatar_id`。
  - `graph`/`both`：`search_subgraph(group_id, query)` 找相关 episode，删除命中的 episode（调 `delete_episodes_bulk`，跳过 pinned）。
  - `text`/`both`：调现有 workspace 文本删除路径（与 `WorkspaceMemoryList` 后端同源，见 §6）删除匹配 bullet。
  - 返回**可读摘要**：「已从 <主体> 记忆移除 N 条 episode、M 条文本；涉及实体：…；pinned 的 X 条已保留」。
- FR-F.2 同步在 `agenticx/cli/agent_tools.py` 的 `STUDIO_TOOLS` 注册 `memory_forget`（若该工具也需在 Studio 对话可用；与 `memory_search` 注册方式一致）。
- FR-F.3 工具描述里明确：默认 `both`；删除不可逆（pinned 受保护）；让模型在执行前向用户复述将删什么。
- FR-F.4 默认行为安全侧：若 `query` 为空或命中 0 条，返回「未找到匹配记忆」，不删任何东西。

### FR-G Desktop Episode 批量管理 UI（Phase D-1，P0）
在 `desktop/src/components/memory/MemoryGraphExplorer.tsx` 右栏「Episode 时间轴」升级（参照仓库已有的多选交互约定：左侧打勾多选）：
- FR-G.1 多选模式：每条 episode 行可勾选；顶部「全选 / 取消」；批量「删除选中」（调 FR-E.1）。
- FR-G.2 时间筛选：快捷「全部 / 近 7 天 / 近 30 天 / 30 天前」；「删除 30 天前」一键（前端先 `impact` 汇总或直接调 retention dry_run 预览，再确认删）。
- FR-G.3 删除二次确认用应用内主题化弹窗（`ds/Modal`，对齐仓库偏好，禁用原生 `window.confirm`），confirm 文案展示「将删除 N 条 episode（其中 pinned X 条将保留）」。
- FR-G.4 pin 按钮（P1）：每条 episode 可 pin/unpin（调 FR-E.4），pinned 用图标标记且不可被批量删。
- FR-G.5 前端 API 封装加到 `desktop/src/components/memory/memory-graph-api.ts`：`bulkDeleteEpisodes`、`fetchEpisodeImpact`、`runRetention`、`setEpisodePin`（沿用现有 `fetchWithTimeout` + `headers` + `appendGroupContext` 模式，错误走 `formatMemoryGraphFetchError`）。

### FR-H Desktop Retention 配置 UI（Phase D-2，P0）
- FR-H.1 在 `MemoryGraphExplorer.tsx` 的 `configStrip`（「记忆图谱设置」可折叠面板）内，或设置页记忆区，新增「保留策略」分区：
  - 开关「启用自动清理」（`retention.enabled`）
  - 数字输入「最多保留 N 条 episode」（`max_episodes`，0=不限）
  - 数字输入「保留最近 N 天」（`max_age_days`，0=不限）
  - 「立即清理」按钮 → 调 FR-E.3 `dry_run=true` 先预览数量 → 确认后 `dry_run=false` 执行。
- FR-H.2 配置读写复用现有 `fetchMemoryGraphConfig` / `updateMemoryGraphConfig`（body 带 `retention` 段，PUT 后端整段写回，已有 `refresh_config`+`reset_runtime`）。
- FR-H.3 文案保持克制：不堆长段说明（对齐仓库 UI 偏好），用 tooltip 承载「0=不限」等提示。

### FR-I 图谱默认聚焦子图（Phase E，P1）
- FR-I.1 默认 overview 视图从「全量 cap 80」改为更聚焦：优先展示「最近 ingest 的 episode 相关子图」或「高连接度 top-K 实体」。最小实现：保留现有 overview，但 UI 默认 `limit_nodes` 调小（如 40），并在画布顶部明示「显示最近/高频片段，非完整记忆」。
- FR-I.2 搜索聚焦：搜索命中后只展开 1-hop 邻域（现有 `search_subgraph` 已返回子图，确认前端不二次叠加全量即可）。
- FR-I.3 本阶段**不改后端算法**，只调展示参数与文案；若需 top-K 度排序，作为 P2 备忘（需后端新增能力，单独评估）。

### NFR
- NFR-1 向后兼容：retention 默认关闭；pins/retention 缺省时行为与现状一致。
- NFR-2 retention/批量删失败不得影响聊天与 ingest 主流程（全 best-effort + warning）。
- NFR-3 不引入新三方依赖。
- NFR-4 跨分区访问一律 403（复用 `validate_group_access`）。
- NFR-5 所有删除操作对 pinned episode 必须无效（保护优先）。
- NFR-6 每个功能点有冒烟测试；前端 typecheck 绿。

### AC（验收）
- AC-1 配置 `retention.enabled=true, max_episodes=5`，向某分区 ingest 第 6 条后，最旧的非 pinned episode 被自动删除，分区 episode 数稳定在 5。
- AC-2 pin 一条最旧 episode 后，AC-1 场景下该 episode **不被删**，被删的是次旧的。
- AC-3 `GET /episode/{uuid}/impact` 返回该 episode 关联节点/边数量与诚实 note。
- AC-4 UI 多选 3 条 episode → 批量删 → 列表与图谱 overview 计数同步下降。
- AC-5 `memory_forget(query="Kimi")` 在群聊/分身会话执行后，相关 episode 被删、`MEMORY.md` 匹配条目被删，返回可读摘要；pinned 条目保留。
- AC-6 跨分区调用任一新 API 返回 403。
- AC-7 retention 关闭时（默认），ingest 行为与改动前完全一致（无 episode 被删）。
- AC-8 全部新增冒烟测试通过；`desktop` typecheck 绿；重启 `agx serve` / Near 人工回归 AC-1/AC-4/AC-5。

---

## 4. 测试清单（pytest 冒烟 + 前端）
- `tests/test_smoke_memory_graph_remove_episode_semantics.py` — **前置探针**（FR-C.3）：验证 graphiti `remove_episode` 对孤立实体的真实行为，结论写回 plan 注释/docstring。
- `tests/test_smoke_memory_graph_retention.py` — FR-A/C/D（AC-1/AC-7）：mock 或真 Kuzu 临时库，验证 `prune_episodes` 按条数/天数淘汰、dry_run 不删。
- `tests/test_smoke_memory_graph_pins.py` — FR-B（AC-2）：pin 后 prune/bulk-delete 跳过。
- `tests/test_smoke_memory_graph_bulk_api.py` — FR-E（AC-3/AC-6）：bulk-delete / impact / retention/run 端点 + 403。
- `tests/test_smoke_memory_forget.py` — FR-F（AC-5）：memory_forget 图谱+文本联动、空 query 不删。
- 前端：`cd desktop && npm run typecheck`（FR-G/H/I，AC-4 人工）。
- 复用既有：`tests/test_memory_graph_api.py`、`tests/test_memory_graph_isolation.py` 须仍通过。

---

## 5. 实施步骤（分阶段，每阶段独立可验证 + 独立 commit）

### Phase A — Retention/Pin 后端基础设施（P0）
1. 写前置探针测试 `test_smoke_memory_graph_remove_episode_semantics.py`，跑出 `remove_episode` 真实语义。
2. `config.py`：加 `MemoryGraphRetentionConfig` + 解析 + to_dict + env 覆盖（FR-A）。
3. `pins.py`：新建（FR-B）。
4. `store.py`：加 `prune_episodes` / `delete_episodes_bulk` / `preview_episode_impact`（FR-C）；如需放宽 `_list_episodes_impl` 的 `last_n` 上限只改数值。
5. `writer.py`：`_run_worker` ingest 成功后触发 retention（FR-D）。
6. 冒烟：retention / pins。
7. commit：`feat(memory-graph): retention 与 pin 基础设施`。

### Phase B — 治理 HTTP API（P0）
8. `routes.py`：新增 bulk-delete / impact / retention/run /（pin）端点（FR-E）。
9. 冒烟：`test_smoke_memory_graph_bulk_api.py`。
10. commit：`feat(memory-graph): episode 批量删/影响预览/retention API`。

### Phase C — 自然语言遗忘工具（P1）
11. `meta_tools.py` + `agent_tools.py`：注册 `memory_forget`（FR-F）。
12. 冒烟：`test_smoke_memory_forget.py`。
13. commit：`feat(memory-graph): memory_forget 自然语言遗忘工具`。

### Phase D — Desktop 治理 UI（P0）
14. `memory-graph-api.ts`：加 4 个 API 封装（FR-G.5）。
15. `MemoryGraphExplorer.tsx`：Episode 多选/批量删/时间筛选/二次确认/(pin)（FR-G）。
16. `MemoryGraphExplorer.tsx` configStrip：retention 配置区 + 立即清理（FR-H）。
17. `npm run typecheck` 绿。
18. commit：`feat(desktop): 记忆图谱 episode 批量管理与 retention 配置`。

### Phase E — 图谱默认聚焦（P1）
19. UI 默认 `limit_nodes` 调小 + 「非完整记忆」文案 + 搜索 1-hop 聚焦（FR-I）。
20. typecheck 绿；commit：`feat(desktop): 记忆图谱默认聚焦子图`。

### Phase F — Community compact（P2，依赖验证）
21. 先验证 graphiti-core 是否提供可用的 community 构建 API；若无，降级为「归档式 compact」：把超阈值的旧 episode 摘要写入一个 `compacted` episode 后删原始。需单独小 plan 评估，不在本轮强制完成。

### Phase 收尾
22. 跑全部新增 + 既有相关冒烟；重启 `agx serve` / Near 人工回归 AC-1/AC-4/AC-5。
23. `/update-conclusion --plan=.cursor/plans/2026-06-14-memory-graph-governance-retention.plan.md`（如适用）。

---

## 6. 关键文件与现有签名（实施前必读，照此对齐，勿臆造）

### 后端
- `agenticx/memory/graph/config.py`
  - `MemoryGraphConfig`（字段：enabled/backend/db_path/default_scope/ingest/llm/embedder/telemetry/status_path/search_in_chat/search_in_chat_graph_limit）。
  - `load_memory_graph_config()`、`memory_graph_config_to_dict(cfg)`、`_coerce_bool`、`_coerce_int`。**retention 解析照搬 ingest 段的写法。**
- `agenticx/memory/graph/store.py`
  - `MemoryGraphStore.singleton()`；现有 `async list_episodes(group_id, *, last_n=20)` → `_list_episodes_impl`（内部 `last_n` clamp 到 100）；`async delete_episode(uuid)` → `_delete_episode_impl` → `self._graphiti.remove_episode(uuid)`；`async get_overview(group_id, *, limit_nodes, limit_edges)`；`async get_episode_subgraph(group_id, uuid)`；`async search_subgraph(group_id, query, center_node_uuid=None)`。
  - 所有 async 公有方法都经 `from agenticx.memory.graph.executor import run_on_graphiti_loop` 包裹。**新方法照此模式。**
- `agenticx/memory/graph/writer.py`
  - `MemoryGraphWriter._run_worker`：ingest 成功后 `self._status.record_success(...)` —— retention hook 加在此后。
  - `derive_group_id_from_avatar_id(avatar_id, session_id=...)` 已 import。
- `agenticx/memory/graph/group_id.py`
  - `derive_group_id(scope, avatar_id, session_id)`、`derive_group_id_from_avatar_id(...)`、`validate_group_access(gid, avatar_id, session_id)`、`parse_subject(avatar_id)`、`META_GROUP_ID="meta_default"`。
- `agenticx/memory/graph/routes.py`
  - `register_memory_graph_routes(app, *, check_token)`；内部 `_auth(token)`、`_map_error(exc)`、`validate_group_access`；现有 `DELETE /episode/{uuid}` 是新端点的范本。
- `agenticx/memory/graph/dto.py`
  - `map_episode_timeline_item`、`build_graph_view`、`_edge_status`（invalidated 判定）。
- `agenticx/runtime/meta_tools.py`
  - `memory_append` / `memory_search` 工具分支位置 —— `memory_forget` 注册在此。
- `agenticx/cli/agent_tools.py`
  - `STUDIO_TOOLS` 与 `_tool_memory_append` / `memory_search`；文本记忆删除的后端实现（`WorkspaceMemoryList` 调的 `deleteWorkspaceEntry`/`deleteWorkspaceEntriesBatch` 对应的后端路由）也在此一线，FR-F 文本侧复用之 —— **实施前 Grep `deleteWorkspaceEntry` / workspace memory 删除路由确认确切函数名**。

### 前端
- `desktop/src/components/memory/memory-graph-types.ts`
  - `MemoryGraphScope = "avatar" | "meta" | "group"`（user 已下线，勿加回）；`GraphEpisodeDTO`、`GraphViewDTO`、`MemoryGraphStatus`。新增 retention 相关类型放这里。
- `desktop/src/components/memory/memory-graph-api.ts`
  - `fetchWithTimeout`、`headers(token)`、`appendGroupContext`、`deriveGroupId(scope, avatarId)`、`formatMemoryGraphFetchError`、现有 `deleteMemoryGraphEpisode`、`fetchMemoryGraphConfig`、`updateMemoryGraphConfig`。**新 API 封装照此模式。**
- `desktop/src/components/memory/MemoryGraphExplorer.tsx`
  - 右栏 `rightRail` 内 Episode 时间轴（约 L813-848）；`onDeleteEpisode`（约 L461）；`configStrip`（约 L851+）；`saveConfig` patch 机制（约 L479）。
  - 多选交互：参考仓库「左侧打勾多选」约定与 `WorkspaceMemoryList.tsx`（已有 selectMode/selectedKeys/批量删）的实现风格复用。
- `desktop/src/components/memory/WorkspaceMemoryList.tsx`
  - 已有 selectMode / 批量删 / `ds/Modal` 二次确认范式，FR-G 直接借鉴。
- `desktop/src/components/ds/Modal.tsx`、`ds/Button.tsx`、`ds/Panel.tsx` —— 主题化弹窗与按钮。

---

## 7. 风险与回退
- 风险：graphiti `remove_episode` 的级联语义未知 → **Phase A 第 1 步强制探针测试**，据实结论实现 impact 文案与 prune 行为。
- 风险：retention 在 worker 内同步跑可能拖慢 ingest → 只对当前 group_id 跑、加 best-effort try/except、必要时限制单次删除数量。
- 风险：pins.json 并发写损坏 → 读改写 + 异常仅 warning + 损坏时按空集合回退（安全侧：不误删的反面是可能漏保护，故 pin 失败时 prune 应保守，建议 pin 写失败给 UI toast）。
- 回退：每个 Phase 独立 commit，可单独 revert；前端与后端解耦；retention 默认关闭，未启用即零行为变更。

---

## 8. 待用户确认项（实施前请 Damon 拍板）
1. retention 默认策略阈值建议（如 `max_episodes` 推荐默认值给 UI 占位）：建议 200 条 / 90 天，是否认可？
2. `memory_forget`（Phase C）是否纳入本轮，还是先只做 P0 治理（批量删 + retention）？
3. Episode pin（FR-B/FR-E.4/FR-G.4）是否本轮做，还是 P1 延后？
4. Phase F（Community compact）确认为 P2 备忘、本轮不实现？
