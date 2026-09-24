# 子计划 02：Meta-only 与主体级访问边界

Planned-with: GPT-5.6 Sol
Suggested-Impl-Model: cursor-grok-4.6-xhigh-fast
Parent-Plan: `.cursor/plans/pending/2026-09-09-near-personal-agent-control-plane-master.plan.md`
Depends-on: `2026-09-09-near-personal-control-01-run-ledger`
Plan-Id: 2026-09-09-near-personal-control-02-meta-acl

> **For implementer:** 使用 executing-plans，TDD 实施。只收紧跨主体读取；不修改现有主体 workspace/recall 的正确隔离逻辑。不要 commit，除非用户明确要求。

**Goal:** 把“Meta 权限最高、分身只见授权范围”从 prompt 叙事变成后端强制 ACL。

**Architecture:** 新增统一 caller subject 上下文和访问判定；Meta 可查询全局 session/observation，avatar/group 默认仅可访问自身绑定会话。工具表裁剪与工具执行时校验双层防御，避免调用者伪造参数绕过。

**Tech Stack:** Python、SessionManager、SessionStore FTS、ToolPolicyStack、pytest。

## In scope

- `session_search`：Meta 全局；avatar/group 仅本 subject 会话。
- `read_avatar_workspace`、未来 `observation_pull` 保持 Meta-only。
- owner session 的 run 状态只在授权主体内可读。
- caller subject 由 server/session 绑定派生，不信任工具参数。

## Out of scope

- 用户/租户多账号 RBAC、网络 ACL、Enterprise。
- Observation Ledger 存储、Constitution、Eval。
- 改写 memory graph 或 workspace 路由。

## 根因证据

- `agenticx/cli/agent_tools.py::_tool_session_search` 调全库 FTS，未传 `avatar_id`。
- `session_search` 位于 `STUDIO_TOOLS`，普通 avatar/group 同样可见。
- `SessionManager.list_sessions(avatar_id=...)` 与 `_list_latest_sessions_sync(avatar_id=...)` 已支持绑定过滤，可复用。
- workspace recall 已由 `resolve_subject_workspace_dir` 与 `_filter_workspace_rows_for_subject` 隔离，本计划不得破坏。

## FR-02-1：统一访问判定

**Files:**
- Create: `agenticx/runtime/access_control.py`
- Test: `tests/test_subject_access_control.py`

接口：

```python
@dataclass(frozen=True)
class CallerSubject:
    kind: Literal["meta", "avatar", "group", "automation"]
    subject_id: str
    session_id: str

def can_read_session(caller: CallerSubject, target_avatar_id: str | None) -> bool: ...
def can_read_cross_subject(caller: CallerSubject) -> bool: ...
```

规则：
- meta：可读所有普通/分身/群会话，但 automation 专属历史仍不注入普通 Meta 历史。
- avatar：仅 `target_avatar_id == caller.subject_id`。
- group：仅 `target_avatar_id == caller.subject_id`。
- automation：仅自身 `automation:<task_id>`。
- 空/未知 kind fail closed。

**AC:** 覆盖四类 subject、未知拒绝、automation 不泄露给 meta history 的既有契约。

## FR-02-2：收紧 session_search

**Files:**
- Modify: `agenticx/cli/agent_tools.py::_tool_session_search`
- Modify: `agenticx/memory/session_store.py::_search_session_messages_sync`
- Modify: `tests/test_smoke_hermes_agent_session_search.py`
- Modify: `tests/test_smoke_hermes_agent_session_fts.py`

After：
- 工具 dispatch 从受信 session 注入 `caller_subject`，不允许模型传 `avatar_id` 扩权。
- Meta 不加 avatar 条件，但排除 `automation:*`，除非当前 caller 就是该 automation。
- avatar/group 先得到允许的 session ids，再让 FTS 查询按集合过滤；不得先返回全库正文再在 prompt 层过滤。
- 空允许集合返回 `[]`。
- 结果继续保持现有 limit 1–5 与数据结构。

**AC:**
- avatar-A query 不能命中 avatar-B/meta/group。
- group-G 只命中 group-G。
- Meta 命中 A/B/meta，但不命中 automation。
- 伪造工具参数不能扩大范围。
- 空 query 的“最近会话”同样隔离。

## FR-02-3：工具可见性双层防御

**Files:**
- Modify: `agenticx/cli/agent_tools.py::studio_tools_for_session`
- Modify: `agenticx/runtime/meta_tools.py::_META_ONLY_TOOLS/visible_meta_agent_tools`
- Test: `tests/test_meta_tool_visibility.py`

要求：
- `read_avatar_workspace`、`delegate_to_avatar`、未来 `observation_pull` 只出现在 Meta 工具表。
- avatar 可保留 scoped `session_search`，因为后端已强制过滤；不得仅靠从工具表删除来代替执行校验。
- automation 继续禁用 delegate/schedule 递归工具。

## FR-02-4：run ledger 授权回归

**Files:**
- Modify: `tests/test_subagent_run_resolver.py`
- Modify: `tests/test_smoke_subagent_review_api.py`

**AC:** 请求 session-B 的 token/binding 不能读取 owner session-A 的 run；Meta 也必须显式指定当前已绑定 owner session，禁止用空 id 列全局 runs。

## 验证

```bash
pytest \
  tests/test_subject_access_control.py \
  tests/test_smoke_hermes_agent_session_search.py \
  tests/test_smoke_hermes_agent_session_fts.py \
  tests/test_meta_tool_visibility.py \
  tests/test_subagent_run_resolver.py \
  tests/test_smoke_memory_subject_resolve.py \
  tests/test_smoke_memory_recall_bridge.py -q
```

若改 `server.py`，禁止改 import 区并执行 `agx serve` 冷启动及 `/api/session`、`/api/avatars`、`/api/sessions` 200 验收。

## Grok 4.6 停止条件

- 无法从受信 session 推导 caller 时，先补 session binding helper；禁止读取请求 body 的自报身份。
- FTS 无法 SQL 级过滤时，可按允许 session ids 分批查，但不得把未授权正文返回工具层后再依赖模型不使用。
- 不要顺手重构 SessionStore schema。
