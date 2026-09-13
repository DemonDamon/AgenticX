# wb-bridge P0.5-B：控制面（状态上浮 / 非阻塞投递 / 在飞护栏 / 幂等键）

Planned-with: claude-opus-5-thinking
Suggested-Impl-Model: cursor-grok-4.6-xhigh-fast（FastAPI 扩字段 + 409 + 幂等短路属常规后端接线，但字段须与子规划 A 的状态机严格对齐，需中上档）

主规划：`.cursor/plans/2026-09-04-wb-bridge-session-supervision.plan.md`
**前置硬依赖**：子规划 A（`2026-09-04-wb-bridge-supervision-a-turn-semantics.plan.md`）必须先完成并全绿。本段直接消费 A 交付的 `WbBridgeSessionManager.wait_for_turn()` 与 `_session_to_dict()` 新字段。

---

## 1. 本段要修的根因

### 根因 D-2：超时无状态、无恢复

`agenticx/wb_bridge/http_app.py:88-91`：

```python
class MessageResponse(BaseModel):
    ok: bool
    tail: str
    result_text: str = ""
```

`post_message`（L121-136）拿到 `wait_for_success_result` 的 `(ok, tail)` 就返回。调用方（Meta）看到 `ok=false` 时**无法区分**三种完全不同的处境：任务还在跑 / 被权限挡住 / 子进程已死。A 段已经把这三者变成了 typed status，本段负责把它们**上浮到 HTTP 与工具返回值**。

### 根因 D-3：重复投递无护栏

`post_message`（L126）无论上一轮是否在飞，都直接 `_manager.send_user_message(...)` 再往 stdin 写一行。实测那晚同一任务被反复投递多次，CodeBuddy 侧上下文错乱、token 白烧（累计约 197k input，几乎全是 cache read）。

本段用**两道**互补护栏：

1. **在飞护栏（409）**：上一轮 `turn_state == "running"` 时拒绝新指令。挡的是「并发投递不同指令」。
2. **幂等键**：同 `idempotency_key` 的重投**不写 stdin**，直接回当前/上一轮快照。挡的是「同一指令因超时被重发」——这才是那晚的实际形态。键的**默认生成**在子规划 C 的工具层（`f"{sid}:{sha1(text)[:12]}"`）；本段 HTTP 只认调用方传入的 key，不自行从 text 推导。键的**默认生成**在子规划 C 的工具层（`f"{sid}:{sha1(text)[:12]}"`）；本段 HTTP 只认调用方传入的 key，不自行从 text 推导。

幂等键借鉴 loopx 的 task lease：`research/codedeepresearch/loopx/loopx_source_notes.md` E-011，lease 用 `version` CAS + idempotency，冲突返回 `DecisionOutcome.CONFLICT` 而非静默覆盖。

### 根因 D-5：失败被误当「什么都没发生」

A 段已在会话状态里记录 `observed_tools`。本段负责把它连同 `next_action` 一起返回，让 Meta 看见「Write 已发生，Bash 被拦」，而不是把整轮当作未执行去重跑。借鉴 loopx E-034 / E-021：settlement 失败**不回滚**已提交的 writeback，失败 ≠ 什么都没发生。

### 根因 D-4 的后半：Agent 侧拿不到用量

A 段已把 `usage_totals` 累计到会话状态。本段把它带进 `describe` 与 `message` 响应，使 Agent **不需要**读磁盘日志（那条路被 workspace 沙箱挡着，且按主规划 §1.1 属误诊解法）。

---

## 2. In scope / Out of scope

### In scope

1. 改 `agenticx/wb_bridge/http_app.py`：`SessionCreateResponse` / `MessageBody` / `MessageResponse` 扩字段；`post_message` 重写；`create_session` 回带 hint；`_extract_result_text` 改委托。
2. 改 `agenticx/wb_bridge/session_manager.py`：**仅新增**幂等键所需的最小状态与一个查询方法（见 FR-B4），不动 A 段交付的其它逻辑。
3. 追写 `tests/test_smoke_wb_bridge.py`。

### Out of scope（做了算违规）

- **不改** `agenticx/cli/agent_tools.py`、`desktop/**`（属子规划 C）。
- **不改** `agenticx/cc_bridge/**`、`agenticx/studio/server.py`（`/api/wb-bridge/*` 五个端点 server.py:7933-8068 保持原样）。
- **不新增** HTTP 路由。只改既有 5 条（`POST /v1/sessions`、`GET /v1/sessions`、`GET /v1/sessions/{sid}`、`POST /v1/sessions/{sid}/message`、`DELETE /v1/sessions/{sid}`）与 `/health`。
- **不实现** `/permission`、`/pty/*`、`/resize`（P0 已论证 WB 无批准通道）。
- 不做用量持久化 / 跨重启聚合 / 按天报表。

---

## 3. 硬约束

1. **向后兼容**：`MessageResponse` 必须保留 `ok / tail / result_text` 三个键（`desktop/src/utils/wb-bridge-ui.ts` 依赖）；`get_session` 返回体保留 A 段 `_session_to_dict` 的既有 6 键。
2. **`ok` 的语义收窄为「本轮圆满成功」**：`ok = (status == "success")`。`running` / `blocked` / `error` / `exited` 一律 `ok=false`。
3. **幂等命中不得静默成功**：必须返回 `deduplicated: true` 且带当前轮真实快照，绝不能让调用方误以为投了一条新指令。
4. **禁止函数内联 import**（`.cursor/rules` 的 `no-inline-imports`）。`http_app.py` 顶部已有 `from agenticx.cc_bridge.ndjson import line_looks_like_result_success`（L17）——本段改为改用 `agenticx.wb_bridge.events`，见 FR-B5。
5. 注释与 docstring 全英文、无 emoji。

---

## 4. 功能需求（FR）

### FR-B1 `GET /v1/sessions/{sid}` 与 `GET /v1/sessions` 自动扩字段

`get_session`（L112-118）与 `list_sessions`（L107-109）**逻辑不变**（纯透传 `_manager.describe_session` / `list_sessions`）。A 段扩了 `_session_to_dict`，这两个端点自然带上新字段。**本 FR 无需写代码，仅在 AC-B1 里断言这一点成立。**

### FR-B2 `MessageBody` 支持非阻塞与幂等键

`http_app.py:83-85`。改为：

```python
class MessageBody(BaseModel):
    text: str
    wait_seconds: float = Field(default=180.0, ge=0.0, le=3600.0)
    idempotency_key: Optional[str] = Field(
        default=None,
        max_length=200,
        description="When equal to the key of the current or last turn, the "
        "text is NOT re-dispatched; the existing turn snapshot is returned.",
    )
```

**关键改动**：`ge` 从 `1.0` 改为 `0.0`。`wait_seconds=0` 表示「投递后立刻返回，之后用 `wb_bridge_describe` 轮询」。

### FR-B3 `MessageResponse` 扩字段

`http_app.py:88-91`。保留前三键，追加：

```python
class MessageResponse(BaseModel):
    ok: bool
    tail: str
    result_text: str = ""
    status: str = "running"          # success | blocked | error | exited | running
    session_id: str = ""
    turn_seq: int = 0
    stalled: bool = False
    deduplicated: bool = False
    terminal_detail: str = ""
    observed_tools: List[str] = Field(default_factory=list)
    usage_totals: Dict[str, int] = Field(default_factory=dict)
    last_activity: str = ""
    turns_completed: int = 0
    first_activity_lag_sec: Optional[float] = None
    next_action: str = ""
```

`next_action` 是给模型看的确定性指令（英文，逐字采用下表，**不要**自行改写）：

| status | next_action |
|---|---|
| `success` | `"done"` |
| `running` | `"still running; poll wb_bridge_describe with this session_id; do NOT resend the same instruction (a resend while a turn is in flight is rejected with HTTP 409)"` |
| `blocked` | `"blocked by a CodeBuddy permission prompt and this bridge has no approval channel; check observed_tools first because side effects before the block are already committed, then start a NEW session with permission_mode=acceptEdits (edits only) or dontAsk/bypassPermissions (edits + commands); do NOT resend into this session"` |
| `error` | `"turn ended with an error; check observed_tools for side effects already committed, then read terminal_detail and tail before retrying"` |
| `exited` | `"child process exited; start a new session"` |

`blocked` / `error` 两条**必须**包含 "side effects already committed" 语义——这是修 D-5 的载体。

### FR-B4 幂等键状态与查询（`session_manager.py` 最小新增）

在 `WbBridgeSession` 追加**一个**字段（接在 A 段新增字段之后）：

```python
    last_idempotency_key: str = ""
```

在 `WbBridgeSessionManager` 追加**一个**方法：

```python
    def turn_matches_idempotency_key(self, session_id: str, key: str) -> bool:
        """True when ``key`` is non-empty and equals this session's last key."""
```

实现持 `session.lock` 读取；`session` 不存在或 `key` 为空 → False。

`send_user_message` 增加一个**可选关键字参数**（不破坏 A 段既有调用）：

```python
    def send_user_message(self, session_id: str, text: str, *, idempotency_key: str = "") -> None:
```

在 A 段已有的重置块里追加 `session.last_idempotency_key = idempotency_key`。**不要**改动 A 段其它重置逻辑。

### FR-B5 `post_message` 重写

`http_app.py:121-136`。新语义，顺序**不可调换**：

```
session_id = _parse_session_id(session_id)
sess = _manager.get(session_id)
若 sess is None: 404 "session not found"

# 1) 幂等短路（先于在飞检查，否则重发会先撞 409）
若 body.idempotency_key 且 _manager.turn_matches_idempotency_key(session_id, body.idempotency_key):
    status, snap = _manager.wait_for_turn(session_id, body.wait_seconds)
    return _build_message_response(session_id, status, snap, deduplicated=True)

# 2) 在飞护栏
snap0 = _manager.describe_session(session_id)
若 snap0 且 snap0.get("turn_state") == "running":
    raise HTTPException(409, detail=(
        "a turn is already in flight for this session "
        f"(turn_seq={snap0.get('turn_seq')}, "
        f"elapsed={snap0.get('turn_elapsed_sec')}s, "
        f"last_activity={snap0.get('last_activity') or 'n/a'}); "
        "poll GET /v1/sessions/<session_id> instead of resending"
    ))

# 3) 正常投递
try: _manager.send_user_message(session_id, body.text, idempotency_key=body.idempotency_key or "")
except KeyError: 404 "session not found"

status, snap = _manager.wait_for_turn(session_id, body.wait_seconds)
return _build_message_response(session_id, status, snap, deduplicated=False)
```

新增模块级 helper（**不是**函数内联逻辑）：

```python
def _build_message_response(
    session_id: str,
    status: str,
    snap: Dict[str, Any],
    *,
    deduplicated: bool,
) -> MessageResponse:
    """Map a wait_for_turn outcome onto the HTTP response shape."""
```

其中 `ok = (status == "success")`；`result_text` **仅在** `status == "success"` 时取 `snap.get("last_result_text", "")`，其它状态为空串；`next_action` 按 FR-B3 表查；其余字段从 `snap` 同名键取，缺失用默认值。

`_NEXT_ACTION_BY_STATUS: Dict[str, str]` 定义为模块级常量，`_build_message_response` 查表，未知 status 回落空串。

> 409 无需在 `agenticx/cli/agent_tools.py` 侧特殊处理：`_tool_wb_bridge_http`（L6126 起）已把 `>=400` 统一转成 `f"ERROR: bridge {r.status_code}: {text[:2000]}"`（L6209-6210），detail 会原样透给模型。**本段不要改那段错误处理。**

### FR-B6 `create_session` 回带无人值守提示

`SessionCreateResponse`（L77-80）追加：

```python
    permission_mode: str = "default"
    unattended_ok: bool = False
    hint: str = ""
```

`create_session`（L94-104）：`s = _manager.start_session(...)` 之后，

```python
    mode = getattr(s, "permission_mode", body.permission_mode)
    unattended_ok = mode in _UNATTENDED_MODES
    hint = "" if unattended_ok else _UNATTENDED_HINT
```

模块级常量：

```python
_UNATTENDED_MODES = frozenset({"acceptEdits", "dontAsk", "bypassPermissions", "auto"})

_UNATTENDED_HINT = (
    "permission_mode={mode} will pause on Write/Bash approval, and this bridge "
    "has no approval channel (CodeBuddy headless does not support "
    "--permission-prompt-tool, so cc_bridge_permission does NOT apply). For "
    "unattended work use acceptEdits (file edits) or dontAsk/bypassPermissions "
    "(edits + commands). plan mode only plans and never executes."
)
```

`hint` 用 `.format(mode=mode)` 填入实际 mode（`default` 与 `plan` 都会命中非 unattended 分支）。

### FR-B7 `_extract_result_text` 改委托

`http_app.py:55-66` 当前逐行找 success 行并**在函数内 `import ujson`**（违反 `no-inline-imports`）。改为：

- 模块顶部把 `from agenticx.cc_bridge.ndjson import line_looks_like_result_success`（L17）**替换**为 `from agenticx.wb_bridge import events as wb_events`。
- `_extract_result_text(tail)` 保留函数名与签名，改为倒序遍历 `tail` 各行，用 `wb_events.line_is_turn_terminal(line)` 找到终止行后 `wb_events.parse_stream_line(line)` 再 `wb_events.extract_result_text(obj)`，首个非空即返回，否则 `""`。
- 删除函数体内的 `import ujson`。

> 该函数在 FR-B5 之后**不再被 `post_message` 使用**（`result_text` 直接从 snapshot 取），但保留它作为 tail 兜底解析入口，且必须消除内联 import 违规。若实施时确认已完全无调用方，可保留函数并加 docstring 说明用途，**不要删除**（避免影响未知调用）。

---

## 5. 验收标准（AC）

全部追写到 `tests/test_smoke_wb_bridge.py`，复用 A 段新增的 `_RESULT_BLOCKED` 等夹具与既有 `TestClient` 写法（参照 L179 `test_ac7_http_auth_and_create`）。

- **AC-B1（FR-B1 字段透传）** 设好 `WB_BRIDGE_TOKEN`，monkeypatch `ha._manager.describe_session` 返回含 A 段全字段的 dict，`GET /v1/sessions/{uuid}` → 200 且响应体同时含旧 6 键与 `usage_totals` / `observed_tools` / `turn_state`。
- **AC-B2（FR-B2 wait_seconds=0 放行）** `MessageBody(text="x", wait_seconds=0)` 构造**不抛** `ValidationError`；`MessageBody(text="x", wait_seconds=-1)` 仍抛。
- **AC-B3（FR-B5 running 响应形状）** monkeypatch `_manager.get`（返回非 None）、`describe_session`（`turn_state="idle"`）、`send_user_message`（记录被调用）、`wait_for_turn`（返回 `("running", {...含 observed_tools/usage_totals/turn_seq...})`）；`POST .../message` → 200，`status == "running"`、`ok is False`、`result_text == ""`、`next_action` 含 `"do NOT resend"` 与 `"409"`。
- **AC-B4（FR-B5 success 响应形状）** `wait_for_turn` 返回 `("success", {"last_result_text": "Hello, World!", ...})` → `ok is True`、`result_text == "Hello, World!"`、`next_action == "done"`。
- **AC-B5（FR-B3 blocked 带副作用告知 —— D-5 守卫）** `wait_for_turn` 返回 `("blocked", {"observed_tools": ["Write", "Bash"], "terminal_detail": "Bash", ...})` → `ok is False`、`observed_tools == ["Write","Bash"]`、`next_action` 同时含 `"side effects"` 与 `"acceptEdits"`。**这条守住「文件已写但被当失败重跑」不再发生。**
- **AC-B6（FR-B5 在飞 409）** monkeypatch `describe_session` 返回 `{"turn_state": "running", "turn_seq": 1, "turn_elapsed_sec": 12.3, "last_activity": "Bash"}`，且 `send_user_message` 被 monkeypatch 成「一旦调用就抛 AssertionError」；`POST .../message`（**不带** idempotency_key）→ **409**，detail 含 `"already in flight"` 与 `"turn_seq=1"`，且 `send_user_message` 未被调用。
- **AC-B7（FR-B4+B5 幂等短路）** monkeypatch `turn_matches_idempotency_key` 返回 True、`describe_session` 返回 `turn_state="running"`、`send_user_message` 一旦调用就抛 AssertionError；`POST .../message` 带 `idempotency_key="k1"` → **200**（不是 409），`deduplicated is True`、`status == "running"`，且 `send_user_message` **未被调用**。**顺序守卫：证明幂等检查先于 409。**
- **AC-B8（FR-B4 幂等键落盘与比较）** 不 monkeypatch manager，直接对真实 `WbBridgeSessionManager`（Popen 已 monkeypatch，照 A 段 AC-A9 写法）：`send_user_message(sid, "t", idempotency_key="k1")` 后 `turn_matches_idempotency_key(sid, "k1") is True`、`(sid, "k2") is False`、`(sid, "") is False`；未知 sid 一律 False。
- **AC-B9（FR-B6 hint）** monkeypatch `_manager.start_session` 返回带 `permission_mode` 属性的对象：传 `permission_mode="default"` → `unattended_ok is False` 且 `hint` 含 `"--permission-prompt-tool"` 与 `"default"`；传 `"acceptEdits"` → `unattended_ok is True` 且 `hint == ""`；传 `"plan"` → `unattended_ok is False`。
- **AC-B10（FR-B7 无内联 import）** `inspect.getsource(ha)` 断言不含 `"import ujson"`；断言含 `"wb_bridge import events"` 或 `"wb_bridge.events"`；断言不含 `"cc_bridge"`。
- **AC-B11（鉴权不回归）** 既有 `test_ac7_http_auth_and_create`（L179）与 `test_health_unauthenticated`（L270）**断言原样未改**且通过（503 / 401 / 403 / 200 四态与 `/health` 免鉴权）。
- **AC-B12（全量回归）** `pytest tests/test_smoke_wb_bridge.py -q` 全绿，含 P0 的 16 条与 A 段新增用例。
- **AC-B13（Out of scope 守卫）** `git diff --name-only` 只应出现 `agenticx/wb_bridge/http_app.py`、`agenticx/wb_bridge/session_manager.py`、`tests/test_smoke_wb_bridge.py`。**不得**出现 `agenticx/cc_bridge/**`、`agenticx/studio/server.py`、`agenticx/cli/agent_tools.py`、`desktop/**`。

---

## 6. 实施顺序

1. `MessageBody` / `MessageResponse` / `SessionCreateResponse` 扩字段 + 三个模块级常量（FR-B2、FR-B3、FR-B6）→ 跑 AC-B2。
2. `session_manager.py` 幂等最小新增（FR-B4）→ 跑 AC-B8。
3. `_build_message_response` + `post_message` 重写（FR-B5）→ 跑 AC-B3~AC-B7。**AC-B7 的顺序守卫务必单独确认。**
4. `create_session` hint（FR-B6）→ 跑 AC-B9。
5. `_extract_result_text` 改委托 + 清内联 import（FR-B7）→ 跑 AC-B10。
6. 回归 AC-B1、AC-B11、AC-B12；diff 守卫 AC-B13。

---

## 7. 风险

| 风险 | 缓解 |
|---|---|
| 幂等检查放在 409 之后 → 超时重发先撞 409，等于没做幂等 | FR-B5 明确顺序；AC-B7 用「`send_user_message` 一旦被调用就抛」双向守卫 |
| 幂等命中被实现成静默丢弃指令 | §3 约束 3；AC-B7 断言 `deduplicated is True` 且返回真实 status |
| 前端旧字段被破坏 | §3 约束 1；AC-B4 断言 `result_text` 仍在成功路径正确填充 |
| `ok` 语义被放宽（把 running 也当成功） | §3 约束 2；AC-B3 断言 running 时 `ok is False` |
| 顶部 import 替换时误删 `line_looks_like_result_success` 的其它用途 | 改前先 grep `http_app.py` 内该符号全部引用；本段仅 `_extract_result_text` 用它 |
| 误改 `server.py` / `agent_tools.py` | AC-B13 |

---

## 8. 提交约定

```
Plan-Id: 2026-09-04-wb-bridge-supervision-b-control-plane
Plan-File: .cursor/plans/2026-09-04-wb-bridge-supervision-b-control-plane.plan.md
Plan-Id: 2026-09-04-wb-bridge-session-supervision
Plan-File: .cursor/plans/2026-09-04-wb-bridge-session-supervision.plan.md
Plan-Model: claude-opus-5-thinking
Impl-Model: <实际使用的模型>
Made-with: Damon Li
```

commit 示例：`feat(wb-bridge): expose turn status, usage and in-flight guard over HTTP`。不写任何对标第三方产品的措辞，**不得**在 commit 里出现 loopx 等第三方项目名。
