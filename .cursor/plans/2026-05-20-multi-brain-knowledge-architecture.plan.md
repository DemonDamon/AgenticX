# Multi-Brain Knowledge Architecture（多脑知识库重构）

**Plan-Id**: 2026-05-20-multi-brain-knowledge-architecture
**Plan-File**: `.cursor/plans/2026-05-20-multi-brain-knowledge-architecture.plan.md`
**Status**: Draft（待用户确认 §11 Open Questions 后转 Approved）
**Owner**: Damon
**Made-with**: Damon Li

---

## 1. 背景与动机

当前架构把"知识库"建模为**单例全局对象**：
- `agenticx/studio/kb/manager.py :: KBManager` 是进程级单例，只读写 `~/.agenticx/config.yaml` 的单个 `knowledge_base:` 节；
- `code_index` 是另一条线（按 codebase_path 分多个索引任务，但配置仍是全局单实例）；
- `AvatarConfig` 无任何"知识库挂载"字段，所有分身共享同一 KB。

实际诉求（用户原话）：
> 每一个知识库应该有多个独立的实例……不同的分身挂不同的知识库"小脑"。这个小脑可以是文件库，也可以是代码库……后续分身设置那里也可以挂载不同的脑（可以选择 1 知识库、多个知识库，甚至全选所有知识库）。那估计知识库的存储位置也应该在这个分身所在 workspace 下面才行。

抽象出来就是把"知识库"从 **process-level singleton** 升级为 **first-class instance**（命名为 **Brain / 知识脑**），支持：
1. 多实例并存（N 个 Brain，按用途分类）；
2. 每个 Brain 选择形态（文档库 / 代码库 / 未来可拓展：网页快照库、图像库…）；
3. 按 owner 隔离存储（全局 brain vs 分身私有 brain）；
4. 分身可挂载 0–N 个 brain，Meta 默认挂载"全局可见"集合；
5. Agent 工具按"当前挂载集合"自动路由检索。

## 2. 目标 & 非目标

### 2.1 目标（In-Scope）
- **G1**：引入 `Brain` 一等概念，支持 `type ∈ {docs, code}`，可扩展。
- **G2**：用户可在「设置 → 知识库」CRUD 多个 brain，每个 brain 独立配置（embedding、向量后端、文件过滤、索引根目录等）。
- **G3**：每个 brain 有 `scope`：`global`（共享）或 `private:<avatar_id>`（分身私有，物理落在该 avatar 的 workspace 下）。
- **G4**：分身配置新增 `brains_enabled: list[str] | "*"`；保存即生效，支持 1/多/全选。
- **G5**：`knowledge_search` / `code_search` 自动路由到当前会话挂载的 brain 集合；可显式指定 `brain_id=...` 单测某个。
- **G6**：现有单一 KB / code_index 配置**无损迁移**为 brain（不丢资料、不丢索引）。
- **G7**：Desktop UI 重新设计「设置 → 知识库」：左侧 brain 列表 + 新建，右侧详情按 type 渲染既有 panel。
- **G8**：「设置 → 分身」/「新建分身向导」/「编辑分身」新增「挂载知识脑」多选区。

### 2.2 非目标（Out-of-Scope）
- 不在本次重构里改 vector backend 选型逻辑（Chroma/Milvus/FAISS 复用）。
- 不实现"跨用户 / 跨设备同步"（Stage-3 议题）。
- 不引入"brain 间组合检索 / re-rank fusion"（暂按 union → top_k 截断）。
- 不实现 brain 的细粒度 ACL（除 global vs private 外不分组/角色）。
- 不重写 `code_index` 的索引算法本身（只把它"装进 Brain 容器"）。

## 3. 概念模型

```
┌─────────────────────────────────────────────────────────────┐
│  Brain（知识脑，一等实体）                                   │
│                                                              │
│  id            : str（UUID-12，例 brain_3f9c1a…）            │
│  name          : str（用户可改的中文名）                     │
│  type          : "docs" | "code"                             │
│  scope         : "global" | "private"                        │
│  owner_avatar  : Optional[str]（scope=private 时必填）       │
│  storage_root  : Path（绝对路径，按 scope 派生，见 §4）      │
│  description   : str                                         │
│  enabled       : bool（关掉则不参与任何检索路由）            │
│  config        : Union[DocsBrainConfig, CodeBrainConfig]     │
│  stats         : { doc_count / chunk_count / last_indexed }  │
│  created_at / updated_at                                     │
└─────────────────────────────────────────────────────────────┘
```

每个 brain **物理隔离**：独立的 SQLite/Chroma 目录、独立的解析队列、独立的状态。
**不复用** singleton runtime。

### 3.1 挂载关系（AvatarConfig 侧）

```python
@dataclass
class AvatarConfig:
    ...
    brains_enabled: Optional[Union[Literal["*"], List[str]]] = None
    # None         → 默认策略（仅挂全局可见 brain）
    # "*"          → 挂载当前所有 enabled brain（含 global + 该分身的 private）
    # ["b1","b2"]  → 仅挂这些 brain（必须存在且对该分身可见）
```

### 3.2 可见性规则

| Brain scope          | Meta-Agent | 分身 A 看到      | 分身 B 看到      |
|---------------------|------------|------------------|------------------|
| `global`            | ✅ 默认    | ✅ 可选挂载      | ✅ 可选挂载      |
| `private:A`         | ❌         | ✅ 可选挂载      | ❌ 不可见         |
| `private:B`         | ❌         | ❌               | ✅ 可选挂载      |

Meta-Agent 行为：默认挂载所有 `global` brain；不可挂任何 private brain（私有定义所限）。
若用户希望 Meta 也用某 brain，请把它设为 global。

## 4. 存储布局

```
~/.agenticx/
├── brains/                                  # 全局 brain 根
│   └── <brain_id>/
│       ├── brain.yaml                       # 元数据（含 type/config/stats）
│       ├── chroma/  或  semble_state/       # 按 type 选择
│       ├── materials/                       # docs 原始资料软链或拷贝
│       └── jobs.sqlite                      # 进度 / 历史
├── avatars/
│   └── <avatar_id>/
│       ├── avatar.yaml                      # 新增 brains_enabled 字段
│       ├── workspace/                       # 旧有
│       └── brains/                          # 私有 brain 根（新增）
│           └── <brain_id>/
│               └── ...（同上）
└── config.yaml                              # knowledge_base: 节弃用，迁到 brains/registry.json
```

**注**：`workspace/` 与 `brains/` 平级，不内嵌——避免 brain 数据被 agent 误删 / 误改。
用户原话"在这个分身所在 workspace 下面"理解为"在分身目录下"，更安全的实现是 sibling 而非 child。会在 UI 文案里写清楚。

## 5. 后端模块设计

### 5.1 新增包 `agenticx/brain/`

```
agenticx/brain/
├── __init__.py
├── types.py              # BrainType / BrainScope / BrainConfig 联合类型
├── registry.py           # BrainRegistry：CRUD brain.yaml + 物理目录管理
├── manager.py            # BrainManager：按 brain_id 持有 runtime（懒加载）
├── runtime_docs.py       # DocsBrainRuntime：包装现有 KBRuntime
├── runtime_code.py       # CodeBrainRuntime：包装现有 CodeIndexManager 单 codebase
├── mount.py              # Mount 解析：avatar → 实际可用 brain 列表
└── routes.py             # /api/brains/* HTTP 路由（含子路由代理到 type-specific）
```

### 5.2 关键不变量

- `BrainRegistry` 是**线程安全的进程级单例**（参照 `AvatarRegistry`）。
- `BrainManager.get_runtime(brain_id)` 懒加载并缓存；删除 brain 时同步关闭。
- **不允许**同一 brain_id 同时拥有 docs 和 code 两份 runtime。
- 私有 brain 在其 owner avatar 被删除时**级联删除**（与 workspace 同生命周期）。
- 关闭 / 重命名 brain 不影响已索引数据（只改元数据）。

### 5.3 复用既有运行时

- `DocsBrainRuntime` 内部复用 `agenticx.studio.kb.runtime.KBRuntime` 与 `agenticx.studio.kb.jobs.JobRegistry`，但**每个 brain 独立实例**。
- `CodeBrainRuntime` 内部复用 `agenticx.code_index.manager.CodeIndexManager` 与 `agenticx.code_index.backends.semble_backend.SembleBackend`，每 brain 持单 codebase。
- 现有 `agenticx/studio/kb/manager.py :: KBManager` **保留为兼容 shim**（read-only delegate to "default docs brain"），加 deprecation 日志，逐步下线。

## 6. HTTP API

### 6.1 CRUD

| Method | Path                                | 说明                              |
|--------|--------------------------------------|-----------------------------------|
| GET    | `/api/brains`                       | 列出 brain（含 stats）            |
| POST   | `/api/brains`                       | 创建（body: name/type/scope/...）|
| GET    | `/api/brains/{id}`                  | 获取详情                          |
| PATCH  | `/api/brains/{id}`                  | 更新元数据/config                |
| DELETE | `/api/brains/{id}`                  | 删除（含物理目录）               |
| POST   | `/api/brains/{id}/enable`           | 启停（不删除数据）               |

### 6.2 类型特化（按 type 路由）

| Path                                                | docs | code | 说明                       |
|------------------------------------------------------|------|------|----------------------------|
| `/api/brains/{id}/materials`（GET/POST/DELETE）     | ✅    | —     | 资料管理                   |
| `/api/brains/{id}/index`（POST / GET status）       | —    | ✅    | 触发 / 查询索引            |
| `/api/brains/{id}/search`（POST: query/top_k）      | ✅    | ✅    | 单 brain 检索（调试用）    |
| `/api/brains/{id}/preload`                          | ✅    | ✅    | 预热模型                   |

### 6.3 检索聚合

| Method | Path                          | 说明                                          |
|--------|-------------------------------|-----------------------------------------------|
| POST   | `/api/search/knowledge`       | 跨 docs brain 检索（按 mount 解析）           |
| POST   | `/api/search/code`            | 跨 code brain 检索                            |

## 7. Agent 工具改造

### 7.1 `knowledge_search` / `code_search`（`agenticx/cli/agent_tools.py`）

```python
async def dispatch_knowledge_search(
    *, query: str, top_k: int = 5,
    brain_id: Optional[str] = None,
    session_id: Optional[str] = None,
    avatar_id: Optional[str] = None,
) -> dict:
    targets = resolve_mount(
        avatar_id=avatar_id, session_id=session_id,
        explicit_brain_id=brain_id, type_filter="docs",
    )
    results = await asyncio.gather(*[
        BrainManager.instance().get_runtime(bid).search(query, top_k=top_k)
        for bid in targets
    ])
    merged = merge_topk(results, top_k=top_k)  # union → score-sort → cut
    return {"hits": merged, "brains": targets}
```

`code_search` 同理（`type_filter="code"`）。

### 7.2 路由优先级

1. 显式 `brain_id=...` → 仅用该 brain（前提：对当前 avatar 可见）；
2. session 上下文里携带的 `mounted_brains` → 用集合；
3. 否则按 avatar 配置的 `brains_enabled` 解析；
4. Meta-Agent 默认 = 所有 enabled global brains；
5. 若集合为空且工具被调用 → 返回结构化 hint（"未挂载任何 X 类型 brain，请到设置挂载或创建"）而非空数组，避免模型反复重试。

### 7.3 新增生命周期工具（可选，默认禁用）
- `brain_create` / `brain_delete` / `brain_status`（受 `AGX_BRAIN_MANAGE=1` 控制，对应技能自进化里 `skill_manage` 的模式）。

## 8. Desktop UI 重构

### 8.1 设置 → 知识库

替换当前的「文档库 / 代码索引 / 资料 / 调试」单实例 4-tab 视图，改为**列表-详情**双栏：

```
┌──────────────────────────────────────────────────────────────┐
│ 知识库（脑）                              [ + 新建 ]          │
├─────────────────────────┬────────────────────────────────────┤
│ 🧠 默认文档库  global   │  [详情区]                          │
│    docs · 12 资料       │  名称：默认文档库                  │
│ 🧠 项目代码库  global   │  类型：docs（不可改）              │
│    code · 1 codebase    │  范围：global ▾                    │
│ 🧠 私有笔记  → 玛奇     │  挂载到 ▾ Meta / 玛奇 / 其它      │
│    docs · 3 资料        │                                    │
│ + 新建知识脑            │  ── 配置（按 type 渲染） ──        │
│                         │  · embedding / 向量后端 / 过滤项   │
│                         │  · 资料管理（docs）或索引控制（code）│
│                         │  · 调试 / 删除                     │
└─────────────────────────┴────────────────────────────────────┘
```

`docs` brain 详情复用现有 `KnowledgeConfigPanel` / `KnowledgeMaterialsPanel` / `KnowledgeDebugPanel`，但 props 改为按 `brainId` 传 API base。
`code` brain 详情复用现有 `CodeIndexSettingsPanel`，但仅展示该 brain 的状态。

**新建脑**：弹层选 `type` 与 `scope`，scope=private 时要求选 owner avatar。

### 8.2 设置 → 分身（新建 / 编辑）

新增「挂载知识脑」区域：
- 选项：`默认（仅全局）` / `全部脑` / `自定义...`（弹出多选列表，仅展示对该 avatar 可见的 brain）；
- 保存即生效，写到 `avatar.yaml :: brains_enabled`。

### 8.3 聊天侧（最小入口）

模型选择器右侧已有「自动检索」三态开关，扩展 tooltip 显示**当前会话挂载的 brain 列表**，便于用户判断"为什么没搜到"。
（本期不做 inline brain 切换，避免与 avatar 配置冲突。）

## 9. 迁移策略（v0.x → v1）

启动时由 `BrainRegistry.bootstrap()` 一次性执行：

1. 若 `~/.agenticx/brains/` 不存在：
   a. 创建一个 **`默认文档库`** docs brain（`scope=global`），把现有 `~/.agenticx/config.yaml :: knowledge_base` 的 chroma 目录、materials 索引"原地接管"（**软链接**或直接 path 引用，零拷贝）；
   b. 现有 `code_index.codebases` 状态**不**自动建 brain（用户进 UI 手动决定，但提示"检测到 N 个历史 codebase，是否一键建为 global code brain？"）；
2. 写 `~/.agenticx/brains/registry.json`，列出已知 brain；
3. 老 `KBManager` 单例自此作为"指向默认 docs brain"的 read-only shim，写操作打 WARN 并 fallback 到 BrainManager；
4. `AvatarConfig.brains_enabled` 缺省时按 `None`（仅 global），保持旧行为。

回滚：删除 `~/.agenticx/brains/` 即恢复旧路径（默认 brain 是软引用，不会破坏数据）。

## 10. 实施阶段（Todo）

> 每阶段独立 commit，commit message 附 `Plan-Id: 2026-05-20-multi-brain-knowledge-architecture` + `Made-with: Damon Li`。

- [ ] **Phase 0 — Spec & Schema**（无代码改动）
  - 用户在 §11 拍板 OQ-1 / OQ-2 后把本 plan 转 Approved；
  - 在 `docs/architecture/brains.md` 落 ADR（≤ 1 页），含 §3 概念图 / §4 目录树 / §6 API 表。

- [ ] **Phase 1 — Brain core（无 UI / 不破坏现有 KB）**
  - 新增 `agenticx/brain/{types,registry,manager,mount}.py`；
  - 单元测试覆盖：CRUD、可见性、级联删除、scope 变更；
  - `BrainRegistry.bootstrap()`：检测旧 KB 数据并就地接管；
  - `KBManager` 改为 shim，加 deprecation log；不删导出符号。

- [ ] **Phase 2 — Docs Brain runtime + 路由**
  - `runtime_docs.py` 包装 `KBRuntime`；
  - HTTP `/api/brains` CRUD + `/api/brains/{id}/{materials,search,preload}`；
  - `dispatch_knowledge_search` 新增 mount 解析与多 brain union；
  - 端到端 smoke：建 2 个 docs brain，分别灌入不同语料，验证 mount 后能拿对集合。

- [ ] **Phase 3 — Code Brain runtime + 路由**
  - `runtime_code.py` 包装 `CodeIndexManager`，1 brain ↔ 1 codebase；
  - `/api/brains/{id}/index` 触发 / 取消；
  - `dispatch_code_search` 接 mount；
  - 迁移历史 `code_index.codebases`：弹窗 / API 一键建 brain。

- [ ] **Phase 4 — Avatar mount 字段**
  - `AvatarConfig.brains_enabled` 新增（含 `"*"` 通配）；
  - `AvatarRegistry.create_avatar / update_avatar` 持久化；
  - 删除 brain 时同步从所有 avatar 的 `brains_enabled` 列表中清除；
  - 删除 avatar 时清理其 private brains（含磁盘）。

- [ ] **Phase 5 — Desktop UI 重构（设置 → 知识库）**
  - 新组件 `desktop/src/components/settings/brains/BrainsListPanel.tsx` 双栏布局；
  - 复用现有 `KnowledgeConfigPanel / Materials / Debug` 与 `CodeIndexSettingsPanel`，注入 `brainId`；
  - 新建脑弹层（type/scope/name）；删除二次确认；
  - 顶部"保存"统一 flush 当前选中 brain 的草稿。

- [ ] **Phase 6 — Desktop UI（分身设置 / 新建向导）**
  - 新区域「挂载知识脑」三态：默认（None）/ 全部（`*`）/ 自定义；
  - 列表只展示对该 avatar 可见的 brain；
  - tooltip 提示 Meta 不可挂 private brain。

- [ ] **Phase 7 — 迁移、文档与回归**
  - 启动时一次性把旧 KB 接管为「默认文档库」brain（不复制数据）；
  - `docs/guides/knowledge-base-mvp.md` 同步改为「多脑」叙事；
  - `docs/guides/code-search.md` 改为「代码脑」叙事；
  - 回归：
    1. 全新装机能建 brain、灌料、search；
    2. 老用户启动后旧 KB 资料仍可检索；
    3. 删除某 avatar 后其 private brain 物理消失，其它 avatar 检索不受影响；
    4. Meta-Agent 默认不挂 private brain。

- [ ] **Phase 8 — 清理（可在后续小 PR 完成）**
  - 删除 `~/.agenticx/config.yaml :: knowledge_base` 节读写代码；
  - 移除 `KBManager` shim（保留导出符号但 raise NotImplementedError，引导到 BrainManager）；
  - 评估去掉「设置 → 工具」里残留的 `code_index` 占位（应已为空）。

## 11. Open Questions（必须用户拍板）

> 不答完不要进 Phase 1。

- **OQ-1 — 私有 brain 是否允许"提升为 global"？**
  - 选项 A：允许（用户在详情面板改 scope，物理目录从 `avatars/<id>/brains/` 移到 `~/.agenticx/brains/`，伴随路径迁移与挂载关系迁移）；
  - 选项 B：不允许，scope 不可改；需要共享就新建一个 global brain（更简单，避免迁移路径风险）。
  - **倾向**：B（更小心，先保住数据完整性）。

- **OQ-2 — 多 brain 检索如何合并？**
  - 选项 A：纯 union → 按 `score` 全局排序 → 截 `top_k`（实现最简，要求各 brain 分数同尺度，docs / code 混合时不准）；
  - 选项 B：按 brain 类型分组返回，工具结果分块（docs hits / code hits），由模型自行决定使用哪段（更稳，避免错配 ranking）；
  - 选项 C：Round-robin per-brain top_k（每 brain 取 top_k/N，保证公平）。
  - **倾向**：B（与 `knowledge_search` 和 `code_search` 本就是两个工具的现状自然对齐）。

## 12. 风险与缓解

| 风险                                              | 影响 | 缓解                                                            |
|---------------------------------------------------|------|-----------------------------------------------------------------|
| 旧 KB 数据迁移失败导致用户资料"消失"              | 高   | 不复制只软引用 + 双向回滚；启动迁移有 dry-run + 日志            |
| 多 brain 同时索引导致磁盘/内存压力暴增            | 中   | `BrainManager` 设并发上限（默认 2 个 active）；UI 提示队列状态 |
| 私有 brain 在分身被删时孤儿化                     | 中   | `AvatarRegistry.delete_avatar` hook 联动 `BrainRegistry.cleanup` |
| 用户把 brain 设为 private 后忘记 Meta 用不了      | 低   | UI 在 Meta 详情上提示"无可用 brain"并给一键设 global 入口      |
| `brains_enabled="*"` 在 brain 暴涨时检索过慢       | 低   | mount 解析时 sort by `priority` 取前 N（N 默认 5，可调）        |

## 13. 验收标准（AC）

- **AC-1**：能在 UI 创建 2 个 docs brain + 1 个 code brain，各自数据物理隔离（`~/.agenticx/brains/` 下 3 个目录）。
- **AC-2**：3 个分身分别挂"全部"/"自定义两个"/"默认（仅 global）"，对话里 `knowledge_search` 检索集合与挂载一致。
- **AC-3**：private brain 在其 owner 被删后磁盘清空、其它 avatar 检索不报错。
- **AC-4**：老用户首次升级启动后，原 KB 资料**零迁移**继续可检索（chroma 目录路径未变）。
- **AC-5**：`code_search` 不再依赖单一 `code_index.enabled` 开关；按挂载的 code brain 是否非空决定可用性。
- **AC-6**：所有新增模块单测覆盖 ≥ 70%（registry / mount / 多 brain union）。

## 14. 与既有 plan 的衔接

- `2026-04-14-machi-kb-stage1-local-mvp`：本 plan 是其 **Stage-2**（多实例化与隔离）。
- `2026-05-20-semble-code-search-integration`：本 plan 把 code_index 容器化，**不**修改其内部检索算法；该 plan 的 P6（磁盘持久化）建议合入本 plan Phase 3。
- `skill-source-config-ux`：mount 解析复用了"分身级 enabled 映射"的相同模式，避免引入第二种语义。
