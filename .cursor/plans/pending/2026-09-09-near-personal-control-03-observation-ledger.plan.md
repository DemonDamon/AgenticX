# 子计划 03：Meta-only Observation Ledger

Planned-with: GPT-5.6 Sol
Suggested-Impl-Model: cursor-grok-4.6-xhigh-fast
Parent-Plan: `.cursor/plans/pending/2026-09-09-near-personal-agent-control-plane-master.plan.md`
Depends-on: `2026-09-09-near-personal-control-01-run-ledger`, `2026-09-09-near-personal-control-02-meta-acl`
Plan-Id: 2026-09-09-near-personal-control-03-observation-ledger

> **For implementer:** 使用 executing-plans。账本只保存摘要和证据指针，禁止复制原始对话、secret 或大段工具返回。

**Goal:** 让 Meta 能按游标持续看见跨分身的重要变化，并知道事件来源、可信度、可见域和证据位置。

**Architecture:** 新建独立 SQLite append-only ledger，run/tool/用户纠正通过 emitter 写标准事件；Meta-only `observation_pull` 增量读取，prompt 只注入固定预算 digest。原始 `messages.json`、tool observations 和 run store 仍是详情 SoT。

**Tech Stack:** SQLite WAL、Pydantic/dataclass、Meta tools、prompt builder、pytest。

## In scope

- event schema、单调 seq、cursor、去重 event key。
- delegation open/close、tool outcome、user correction 三类事件。
- Meta-only pull 与 ≤500 字符 digest。
- sensitivity/visibility 强制过滤与 audit_access。

## Out of scope

- 原始消息全文复制、向量检索、跨设备同步、自动偏好晋级。
- 替换 RunStore/messages/observations。
- Desktop 完整演进中心。

## 数据模型

```python
ObservationEvent(
    event_id: str,
    seq: int,
    ts: str,
    event_type: Literal[
        "delegation_open", "delegation_close", "tool_call",
        "user_correction", "preference_signal", "audit_access"
    ],
    actor_kind: Literal["meta", "avatar", "subagent", "user", "system", "automation", "im"],
    actor_id: str,
    session_id: str,
    subject_kind: Literal["meta", "avatar", "group", "session"],
    subject_id: str,
    summary: str,                 # <=400 chars
    action: str,
    outcome: Literal["success", "fail", "partial", "cancelled", "unknown"],
    evidence_refs: list[str],     # session:/message:/run:/tool-call:/file:
    source: Literal["hook", "tool", "user_edit", "inferred", "import"],
    confidence: float,            # 0..1
    sensitivity: Literal["public", "internal", "pii", "secret"],
    meta_readable: bool,
    shared_with: list[str],
    dedupe_key: str,
    schema_version: int = 1,
)
```

SQLite：

```sql
events(seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE, dedupe_key TEXT UNIQUE, payload_json TEXT NOT NULL);
cursors(consumer_id TEXT PRIMARY KEY, last_seq INTEGER NOT NULL, updated_at TEXT NOT NULL);
```

默认路径：`~/.agenticx/memory/observation_ledger.sqlite`。

## FR-03-1：Store 与 schema

**Files:**
- Create: `agenticx/memory/observation_ledger.py`
- Create: `tests/test_observation_ledger.py`

接口：
- `append(event) -> ObservationEvent`
- `pull(consumer_id, after_seq=None, limit=50) -> list[ObservationEvent]`
- `ack(consumer_id, seq) -> None`
- `get_cursor(consumer_id) -> int`

**AC:** WAL 初始化；并发 append seq 单调；dedupe_key 幂等；limit 1–100；ack 不允许游标倒退；重启后续拉不重复；`secret` 默认 pull 不返回摘要正文，只返回 redacted 事件和证据类型。

## FR-03-2：统一 emitter

**Files:**
- Create: `agenticx/runtime/observation_emitter.py`
- Modify: `agenticx/learning/observer.py::ObservationHook`
- Modify: `agenticx/runtime/meta_tools.py::_run_delegation_in_avatar_session`
- Test: `tests/test_observation_emitter.py`

要求：
- tool result 只取已有 `result_summary`，截断 400。
- delegation 使用计划 01 canonical run id，open/close dedupe key 分离。
- 用户纠正复用 `agenticx/learning/evidence.py::CORRECTION_RE`，仅在 turn archive 后写摘要。
- ledger 写失败只记录 warning，不得导致用户主任务失败；测试必须验证。

## FR-03-3：Meta-only pull 工具

**Files:**
- Modify: `agenticx/runtime/meta_tools.py`，新增 `observation_pull`
- Modify: `agenticx/cli/agent_tools.py` 工具 registry
- Test: `tests/test_meta_observation_tool.py`

输入：`since_cursor?: int`, `limit?: int=20`, `ack?: bool=false`。

要求：
- caller ACL 复用计划 02；avatar/group/automation 调用 fail closed。
- 返回 cursor、events、has_more。
- ack 只能推进当前 Meta consumer（建议 `meta:<session_id>`），不能修改他人 cursor。
- 每次跨主体读取写一条 `audit_access`，该事件本次 pull 不递归包含。

## FR-03-4：Prompt digest

**Files:**
- Modify: `agenticx/runtime/prompts/meta_agent.py`
- Modify: `tests/test_prompt_token_diet.py`
- Create: `tests/test_meta_observation_digest.py`

新增 `_build_observation_digest_context(session, max_chars=500)`；仅 `bound_avatar_id` 为空的 Meta prompt 在 `_tail_state_block` 邻近注入。

格式只含时间、主体、动作、结果、短摘要、证据引用；不含原始 message/tool output。总字符 ≤500；无新增事件返回空字符串，不改变稳定 prompt 前缀。

## FR-03-5：兼容 backfill（可选、默认关闭）

**Files:**
- Add: `agenticx/cli/observation_commands.py`
- Test: `tests/test_observation_backfill.py`

仅导入 `tool_call_observations.json` 与 `subagent_runs` 摘要；`source=import`、`confidence<=0.6`；重复运行幂等。不得扫描消息全文自动推断偏好。

## 验证

```bash
pytest \
  tests/test_observation_ledger.py \
  tests/test_observation_emitter.py \
  tests/test_meta_observation_tool.py \
  tests/test_meta_observation_digest.py \
  tests/test_prompt_token_diet.py \
  tests/test_smoke_hermes_agent_observer.py \
  tests/test_smoke_subagent_run_store.py -q
```

## 停止条件

- 事件无法可靠获得 evidence ref 时，记录 `outcome=unknown`，禁止伪造。
- 若 prompt digest 超预算，减少事件数/摘要长度；禁止扩大既有全局 prompt 预算。
- 不把 ledger 变成第四份运行详情数据库。
