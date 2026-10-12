# 子计划 05：User Constitution 与 Preference Graph

Planned-with: GPT-5.6 Sol
Suggested-Impl-Model: cursor-grok-4.6-xhigh-fast
Parent-Plan: `.cursor/plans/pending/2026-09-09-near-personal-agent-control-plane-master.plan.md`
Depends-on: `2026-09-09-near-personal-control-03-observation-ledger`
Plan-Id: 2026-09-09-near-personal-control-05-user-constitution

> **For implementer:** 使用 executing-plans。Constitution 是 USER.md/localStorage 的增量治理层，首版不得破坏旧配置读写。

**Goal:** 把用户偏好从不可追溯文本升级为有来源、置信度、作用域、版本、冲突和撤销能力的用户宪法。

**Architecture:** SQLite 保存 immutable revisions 与 active node 投影；显式用户指令直接 active，推断偏好默认 pending_review。编译器按 channel/subject/tool 生成固定预算 role view，Meta/avatar/group prompt 只读编译结果。

**Tech Stack:** SQLite WAL、Pydantic、workspace loader、prompt builder、FastAPI、pytest。

## In scope

- Directive/Boundary/InferredPreference/StyleProfile/Goal/Value。
- provenance、confidence、scope、priority、status、supersedes/conflict。
- upsert/revoke/query/compile API 与 Meta tools。
- USER.md/MEMORY.md/localStorage 兼容迁移。

## Out of scope

- 自动从所有聊天批量生成 active 偏好。
- 知识图谱引擎、跨用户画像、训练数据。
- Desktop 大型图编辑器；仅 API 与后续演进中心所需契约。

## 数据模型

```python
ConstitutionNode(
    node_id: str,
    kind: Literal["UserDirective","InferredPreference","Boundary","StyleProfile","RelationshipPolicy","Goal","Value"],
    text: str,
    structured: dict,
    channels: list[str],
    subjects: list[str],
    tools: list[str],
    provenance: dict,
    confidence: float,
    sensitivity: Literal["public","internal","pii","secret"],
    priority: int,
    version: int,
    status: Literal["active","superseded","revoked","pending_review"],
    conflict_group_id: str | None,
    conflict_resolution: Literal["latest_wins","user_pick","meta_arbitrate"] | None,
    evidence_refs: list[str],
    expires_at: str | None,
    created_at: str,
    updated_at: str,
)
```

优先级：显式 UserDirective > Boundary > 用户批准的 Preference > inferred。推断 confidence ≤0.7；legacy import confidence=0.5。

## FR-05-1：Store 与版本

**Files:**
- Create: `agenticx/memory/constitution_store.py`
- Create: `tests/test_constitution_store.py`

接口：`upsert_node`, `revoke_node`, `get_node`, `list_nodes`, `list_pending`, `resolve_conflict`, `history`。

**AC:** 每次更新新增 revision；revoke 不物理删除；旧 version 可查询；同 evidence+text 幂等；非法 confidence/scope 拒绝；secret 不进入普通 compile。

## FR-05-2：按角色编译

**Files:**
- Create: `agenticx/memory/constitution_compiler.py`
- Create: `tests/test_constitution_compiler.py`

接口：

```python
compile_role_view(
    *,
    channel: str,
    subject_kind: str,
    subject_id: str,
    allowed_tools: set[str],
    max_chars: int = 800,
) -> str
```

规则：
- 只含 active、未过期、scope 命中的节点。
- Boundary/Directive 优先；冲突未解决则不注入 inferred，并输出内部 warning。
- avatar/group 只见授权编译子集，不见 provenance 中其他会话原文。
- hard max 800 字符，稳定排序保证 prompt cache。

## FR-05-3：写入与批准

**Files:**
- Modify: `agenticx/runtime/meta_tools.py`，新增 `constitution_upsert/query/revoke/approve`
- Test: `tests/test_meta_constitution_tools.py`

规则：
- 用户显式通过设置/API 写 `UserDirective` 可 active，confidence=1。
- Meta 从 Observation Ledger 提议必须 `InferredPreference + pending_review`。
- Meta 不得把自身推断伪装为 `source=user_edit`。
- avatar 只能读取编译视图，不可 upsert/revoke。
- approve/revoke 写 Observation Ledger 审计事件。

## FR-05-4：Prompt 接线

**Files:**
- Modify: `agenticx/runtime/prompts/meta_agent.py::_build_user_profile_block/build_meta_agent_system_prompt`
- Modify: avatar/group prompt 对应 builder（按现有调用定位）
- Modify: `tests/test_prompt_token_diet.py`
- Create: `tests/test_constitution_prompt.py`

After：
- nickname 继续来自请求字段。
- preference 部分优先 constitution digest；若 store 无 active 节点，回退现有 `user_preference` 文本。
- 添加 `## 用户宪法（编译）`，不注入 provenance/secret。
- revoke 后下一轮 prompt 不含该条。

## FR-05-5：Legacy 迁移

**Files:**
- Create: `agenticx/cli/constitution_commands.py`
- Modify: `agenticx/workspace/loader.py`（仅复用解析 helper，避免破坏加载）
- Test: `tests/test_constitution_legacy_import.py`

命令：`agx constitution import-legacy --dry-run|--apply`。

来源：
- `~/.agenticx/workspace/USER.md` Preferences。
- `MEMORY.md` 明确用户偏好段。
- Desktop 保存时仍写 USER.md；新 API 同步 active Directive，保持旧读者兼容。

**AC:** dry-run 无写入；重复 apply 幂等；无法判断的条目 pending_review；不删除/重写 legacy 文件。

## FR-05-6：REST 契约

**Files:**
- Modify: `agenticx/studio/server.py`，仅 avatar/settings 邻近 handler body/路由区，禁止 import 区大块编辑
- Test: `tests/test_constitution_api.py`

路由：
- `GET /api/constitution`
- `POST /api/constitution/nodes`
- `POST /api/constitution/nodes/{id}/approve`
- `POST /api/constitution/nodes/{id}/revoke`
- `GET /api/constitution/compiled?subject=...`

所有写操作返回 node version；错误透出可读原因。

## 验证

```bash
pytest \
  tests/test_constitution_store.py \
  tests/test_constitution_compiler.py \
  tests/test_meta_constitution_tools.py \
  tests/test_constitution_prompt.py \
  tests/test_constitution_legacy_import.py \
  tests/test_constitution_api.py \
  tests/test_smoke_memory_append_routing.py \
  tests/test_smoke_memory_recall_bridge.py \
  tests/test_prompt_token_diet.py -q
```

改 `server.py` 后必须冷启动 `agx serve` 并验证核心 API 200。

## 停止条件

- 无法判断 legacy 条目 scope 时放 pending_review，不得默认全局 active。
- Constitution 不替代普通事实记忆；不要迁移项目知识。
- 不允许为了“更智能”自动解决高优先级冲突。
