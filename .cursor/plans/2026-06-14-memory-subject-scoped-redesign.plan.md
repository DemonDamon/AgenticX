# Plan: 记忆按「主体」重构 —— 取消独立用户记忆，群聊获得自有记忆

Plan-Id: 2026-06-14-memory-subject-scoped-redesign
Status: draft (待用户确认后执行)
Owner: Damon Li

---

## 0. 背景与问题（事实基础，执行前必读）

当前记忆设计把「用户记忆 / 元智能体记忆 / 分身记忆 / 群聊记忆」混成一团，根因有四：

1. **主体上下文全局化**：`agenticx/runtime/prompts/meta_agent.py` 的
   `_build_workspace_context_block()`（约 L103/L624）调用
   `load_workspace_context()` → `ensure_workspace()`，**永远只读全局**
   `~/.agenticx/workspace/`。因此元智能体、分身、群聊三种会话注入的
   `IDENTITY.md / USER.md / SOUL.md / MEMORY.md` 是**同一份**，分身自己的
   `~/.agenticx/avatars/<id>/workspace/MEMORY.md` 根本没进 prompt。
2. **memory_append 不按主体路由**：
   - `agenticx/cli/agent_tools.py` `_tool_memory_append`（约 L3932）
   - `agenticx/runtime/meta_tools.py` `memory_append` 分支（约 L2546）
   两处都写 `resolve_workspace_dir()` / `ensure_workspace()` 的**全局** workspace，
   分身/群聊会话里「帮我记住」也会落到全局，造成串味。
3. **群聊无文本记忆**：`~/.agenticx/groups/<gid>/` 下只有 `group.yaml` 与
   `experience.json`，没有 `MEMORY.md` 类长期记忆目录；图谱虽有 `group_<gid>`
   分区，但无文本侧。
4. **"用户" 图谱 scope 误导**：`desktop/src/components/memory/memory-graph-types.ts`
   的 `MemoryGraphScope = "avatar" | "meta" | "group" | "user"`，但
   `deriveGroupId("user")` 返回空、Kuzu 里没有用户分区，设置页多出一个空的
   「用户」Tab，用户体验困惑。

### 目标心智模型（对齐 Cursor rule 类比）

| Cursor 概念 | 本系统对应 |
|---|---|
| 全局 user-level rule（用户自己写的偏好档案） | **全局用户档案** `USER.md` + 设置页「用户偏好」，手动维护，**只读基线**注入所有主体 |
| project-level rule（每个项目/聊天框记住的偏好） | **每个主体**（元智能体 / 各分身 / 群聊）在自己的 `MEMORY.md` 里**单独记录**「本主体所理解的用户偏好」，可由 agent 动态调整，也可用户手动管理 |

结论：
- **不存在独立的「用户记忆」主体**。用户偏好分两层：
  - 全局基线（手动档案，所有主体共享只读）
  - 主体私有理解（每个主体各自动态记录/可手动编辑）
- **三类记忆主体**：元智能体、数字分身、群聊。每个主体都拥有：
  自有 workspace（文本 MEMORY）+ 自有图谱分区。
- **群聊记忆由元智能体管理**（群聊会话本就走元智能体 + group_chat 上下文）。
- 记忆图谱去掉「用户」scope。

---

## 1. 范围（Scope）与非目标

### In scope
- 后端：主体 workspace 解析、群聊 workspace 落地、prompt 注入按主体、
  `memory_append/memory_search` 按主体路由、索引覆盖主体 workspace。
- Near Desktop：去掉记忆图谱「用户」Tab；记忆管理 UI 区分「全局用户档案」与
  「主体私有记忆（含本主体理解的用户偏好）」；群聊窗格记忆侧栏接入群 workspace。

### Out of scope（本 plan 不做，避免 scope creep）
- 不动 `experience.json`（群体任务经验）的现有逻辑。
- 不改图谱 ingest/Graphiti/Kuzu 的底层引擎与 `group_id` 编码规则
  （`group_<gid>` / `avatar_<id>` / `meta_default` 保持不变）。
- 不做记忆跨主体迁移/合并工具。
- 不改 `enterprise/` 任何代码。

---

## 2. 需求（FR / NFR / AC）

### FR-1 主体 workspace 统一解析
- FR-1.1 新增 `resolve_subject_workspace_dir(avatar_id, session=None) -> Path`：
  - `avatar_id` 为空 → 全局 `~/.agenticx/workspace`（元智能体）
  - `avatar_id` 形如 `group:<gid>` → `~/.agenticx/groups/<gid>/workspace`
  - 其他普通 `avatar_id` → 该分身的 `workspace_dir`（优先用 `AvatarConfig.workspace_dir`，
    缺省 `~/.agenticx/avatars/<id>/workspace`）
- FR-1.2 提供配套的「主体种类」判定 `classify_subject(avatar_id) -> "meta"|"avatar"|"group"`，
  与图谱 `derive_group_id_from_avatar_id` 的判定口径**完全一致**（复用同一份
  `group:` 前缀约定，避免双份逻辑漂移）。

### FR-2 群聊 workspace 落地
- FR-2.1 `GroupChatRegistry` 在创建群聊时 bootstrap
  `~/.agenticx/groups/<gid>/workspace/`，含 `IDENTITY.md`（群定位）、`MEMORY.md`
  （含「## 用户偏好（本群理解）」段落骨架）。
- FR-2.2 对**已存在**的群聊，首次进入群聊会话 / 首次 memory 操作时**懒创建**该目录
  （不要求一次性批量迁移）。

### FR-3 主体记忆注入 prompt
- FR-3.1 `_build_workspace_context_block()` 改为接收主体上下文，注入：
  1) **全局** `USER.md`（用户档案基线，标注「全局用户偏好（只读基线）」）
  2) **本主体** 的 `IDENTITY.md / SOUL.md / MEMORY.md`（标注主体名）
  - 元智能体主体：本主体即全局 workspace（与基线同源，去重显示，避免重复两遍）。
- FR-3.2 `build_meta_agent_system_prompt(...)` 在已有 `avatar_context` / `group_chat`
  基础上把主体 workspace 传入 FR-3.1；分身/群聊不再注入「别人的」MEMORY。

### FR-4 memory_append / memory_search 按主体路由
- FR-4.1 两处 `memory_append`（`agent_tools.py`、`meta_tools.py`）改为写
  `resolve_subject_workspace_dir(...)`：分身写分身 workspace，群聊写群 workspace，
  元智能体写全局。
- FR-4.2 `memory_append` 新增可选 `scope` 提示语义（默认 `subject`）：
  - `subject`（默认）：写当前主体 MEMORY/daily
  - `user_global`：显式写全局 `USER.md` 用户偏好基线（供「这是对所有分身都生效的偏好」场景）
  - prompt 文案需说明：默认记到「本主体」，仅当用户明确说"对所有分身/全局生效"时才用 `user_global`。
  - **跨分身共享用例（已确认）**：当用户表达「某条经验/教训要让所有分身都记得」
    （如「a 分身踩过的坑，b 分身也要避开」）时，agent 应使用 `user_global` 写入全局
    基线，从而被其它主体作为只读基线注入；plan 文案需给出这一示例引导。
- FR-4.3 `memory_search` / `search_memory_for_chat`：
  - 文本检索覆盖「全局 USER 基线 + 本主体 workspace」两个来源；
  - 图谱检索沿用既有 `derive_group_id_from_avatar_id`（已正确分区，不改）。

### FR-5 索引覆盖主体 workspace
- FR-5.1 `WorkspaceMemoryStore.index_workspace_sync` 在主体记忆写入后被调用时，
  传入的是**主体 workspace 路径**（FR-4 路由后自然满足）。
- FR-5.2 文本检索结果按 `path` 可区分来源（全局基线 vs 主体），`search_memory_for_chat`
  仅取「全局基线 + 当前主体路径前缀」命中的 chunk，避免 A 分身检索到 B 分身记忆。
  - 实现：检索后按 `row["path"]` 是否落在 `{global_workspace, subject_workspace}` 下做过滤。

### FR-6 Desktop 去掉「用户」图谱 scope
- FR-6.1 `MemoryGraphScope` 改为 `"avatar" | "meta" | "group"`（删除 `"user"`）。
- FR-6.2 `MemoryGraphExplorer.tsx` 删除 user 分支（scope 选择器列表、`scopeLabel`、
  `reload`/`onSearch` 里的 `scope === "user"` 早返回、`isUserScope`、`default_scope`
  下拉项）。
- FR-6.3 `memory-graph-api.ts` `deriveGroupId` 删除 user 分支。

### FR-7 Desktop 记忆管理 UI 重构（信息架构）
- FR-7.1 设置页「记忆」区拆成两块语义：
  - **全局用户档案**（已存在的用户档案/用户偏好区块）→ 明确标注「对所有元智能体/分身/群聊生效的基线偏好（user 级）」。
  - **记忆图谱 / 主体记忆** → 仅 meta/avatar/group 三 scope。
- FR-7.2 窗格内记忆侧栏（已做 scope lock）继续按窗格主体锁定；新增/确认
  「本主体理解的用户偏好」可读可编辑入口（最小实现：定位到主体 `MEMORY.md`
  的「用户偏好（本主体理解）」段落进行查看/编辑，复用既有 workspace 文本编辑 API）。
- FR-7.3 群聊窗格记忆侧栏 scope=group，接入群 workspace 文本 + `group_<gid>` 图谱。

### NFR
- NFR-1 向后兼容：旧的全局 `MEMORY.md` 内容保留；分身旧 workspace 不破坏。
- NFR-2 懒创建，不做启动期批量迁移；无目录时安全回退。
- NFR-3 不引入新三方依赖。
- NFR-4 每个功能点配冒烟测试（见 §4）。

### AC（验收）
- AC-1 在分身 A 会话说「记住我喜欢用 TypeScript」→ 写入分身 A 的 `MEMORY.md`，
  **不**出现在全局 `USER.md`，也不出现在分身 B 的记忆里。
- AC-2 在群聊会话说「记住本群默认用中文产出」→ 写入
  `~/.agenticx/groups/<gid>/workspace/MEMORY.md`。
- AC-3 在设置「全局用户档案」里写偏好 → 元智能体、任一分身、群聊会话的 prompt
  都注入该基线（可通过日志/调试 prompt 验证）。
- AC-4 记忆图谱设置页**不再**出现「用户」Tab；meta/avatar/group 三 scope 正常。
- AC-5 分身 A 的 `memory_search` 不会返回分身 B 的记忆 chunk。
- AC-6 全部新增/改动冒烟测试通过；`agx serve` 与 Near 重启后人工回归 AC-1~AC-4。

---

## 3. 实施步骤（分阶段，每阶段独立可验证）

### Phase 0 — 主体解析基础设施（后端，无行为变更风险最低）
1. 在 `agenticx/workspace/loader.py` 新增：
   - `resolve_subject_workspace_dir(avatar_id, session=None) -> Path`
   - `classify_subject(avatar_id) -> str`
   - `ensure_group_workspace(gid) -> Path`（bootstrap 群 workspace 模板）
   - 群 `MEMORY.md` / `IDENTITY.md` 模板常量（含「## 用户偏好（本群理解）」）。
2. 复用/对齐 `agenticx/memory/graph/group_id.py` 的 `group:` 前缀判定，避免逻辑分叉
   （可在 group_id.py 暴露一个 `parse_subject(avatar_id)` 供两边共用）。
3. 冒烟：`tests/test_smoke_memory_subject_resolve.py`
   （meta/avatar/group 三种 avatar_id → 正确路径；群 workspace 懒创建）。

### Phase 1 — memory_append/search 按主体路由（后端）
4. 改 `agenticx/cli/agent_tools.py::_tool_memory_append` 与
   `agenticx/runtime/meta_tools.py` memory_append 分支：
   - 解析当前 session 的 `avatar_id`（meta_tools 用 `session.bound_avatar_id`/group 上下文；
     agent_tools 走 session 传参），落到主体 workspace。
   - 支持 `scope=user_global` 显式写全局 `USER.md`。
   - 写后用主体 workspace 调 `index_workspace_sync`。
5. 改 `agenticx/memory/recall.py::search_memory_for_chat`：
   - 文本来源 = 全局基线 + 当前主体 workspace；按 `path` 前缀过滤（FR-5.2）。
   - 图谱分支不动。
6. 更新工具描述与 `meta_agent.py` 记忆相关 prompt 文案（FR-4.2 的 scope 说明）。
7. 冒烟：`tests/test_smoke_memory_append_routing.py`（AC-1/AC-2/AC-5 的最小复现）。

### Phase 2 — prompt 主体上下文注入（后端）
8. 改 `_build_workspace_context_block()` 接收主体 workspace；按 FR-3.1 注入
   「全局用户偏好基线 + 本主体身份/记忆」，元智能体去重。
9. `build_meta_agent_system_prompt` 把主体 workspace 透传进去（meta/avatar/group 三路径）。
10. 冒烟：`tests/test_smoke_subject_prompt_injection.py`
    （分身 prompt 含分身 MEMORY、含全局 USER 基线、不含其它分身 MEMORY）。

### Phase 3 — Desktop 去 user scope（前端）
11. `memory-graph-types.ts`：`MemoryGraphScope` 删除 `"user"`。
12. `memory-graph-api.ts`：`deriveGroupId` 删 user 分支。
13. `MemoryGraphExplorer.tsx`：删除所有 `scope === "user"` / `isUserScope` /
    scope 列表里的 `"user"` / `default_scope` 下拉 user 选项。
14. `tsc` typecheck 全绿（删除联合类型成员后所有 switch/分支需补齐）。

### Phase 4 — Desktop 记忆管理信息架构（前端）
15. 设置页文案：明确「全局用户档案 = user 级基线偏好」；记忆图谱区仅 meta/avatar/group。
16. 窗格记忆侧栏：补「本主体理解的用户偏好」查看/编辑入口（复用 workspace 文本 API，
    定位主体 `MEMORY.md` 段落）。
17. 群聊窗格记忆侧栏 scope=group 接入群 workspace 文本 + 图谱。
18. typecheck + 人工回归 AC-4。

### Phase 5 — 收尾
19. 跑全部新增冒烟 + 既有相关冒烟。
20. 重启 `agx serve` / Near，人工回归 AC-1~AC-4。
21. `/commit --spec=.cursor/plans/2026-06-14-memory-subject-scoped-redesign.plan.md`
    分阶段提交（建议：`feat(memory): 主体解析` → `feat(memory): append/search 路由` →
    `feat(prompt): 主体上下文注入` → `refactor(desktop): 去 user scope` →
    `feat(desktop): 记忆管理信息架构`），每个 commit 含 `Made-with: Damon Li` 与
    Plan-Id/Plan-File trailer。

---

## 4. 测试清单（冒烟，pytest）
- `tests/test_smoke_memory_subject_resolve.py` — Phase 0
- `tests/test_smoke_memory_append_routing.py` — Phase 1（AC-1/2/5）
- `tests/test_smoke_subject_prompt_injection.py` — Phase 2（AC-3）
- Desktop：`npm run typecheck`（Phase 3/4，AC-4 人工）

---

## 5. 关键文件索引（执行参考）
- `agenticx/workspace/loader.py` — workspace 解析/bootstrap/模板（核心改动点）
- `agenticx/memory/graph/group_id.py` — 主体判定口径共用
- `agenticx/cli/agent_tools.py` — `_tool_memory_append`、`memory_search` 工具
- `agenticx/runtime/meta_tools.py` — memory_append/search 分支
- `agenticx/memory/recall.py` — `search_memory_for_chat`（文本+图谱合并）
- `agenticx/memory/workspace_memory.py` — `index_workspace_sync` / 检索
- `agenticx/runtime/prompts/meta_agent.py` — `_build_workspace_context_block` /
  `build_meta_agent_system_prompt`
- `agenticx/avatar/group_chat.py` — `GroupChatRegistry`（群 workspace bootstrap）
- `desktop/src/components/memory/memory-graph-types.ts` — `MemoryGraphScope`
- `desktop/src/components/memory/memory-graph-api.ts` — `deriveGroupId`
- `desktop/src/components/memory/MemoryGraphExplorer.tsx` — scope UI
- `desktop/src/components/SettingsPanel.tsx` — 用户档案/记忆区信息架构

---

## 6. 风险与回退
- 风险：检索来源过滤（FR-5.2）若 path 归一化不一致，可能漏召回 → 用绝对路径
  `resolve()` 后前缀匹配，并加冒烟覆盖。
- 风险：旧会话 `bound_avatar_id` 缺失导致误判 meta → 回退到全局（安全侧）。
- 回退：各 Phase 独立 commit，可单独 revert；前端去 user scope 与后端解耦，可分开回滚。

---

## 7. 用户确认结论（已确认，2026-06-14）
1. ✅ 全局用户档案沿用 `~/.agenticx/workspace/USER.md` 作为唯一基线文件。
2. ✅ `memory_append` 默认 `scope=subject`（只记到当前主体）；支持 `user_global`
   显式写全局基线，用于「某分身的经验要让所有分身都记得」的跨分身共享。
3. ✅ 群聊记忆只由元智能体读写，不开放群内分身各自写群记忆。
