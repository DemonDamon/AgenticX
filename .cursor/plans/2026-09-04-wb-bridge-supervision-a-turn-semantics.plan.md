# wb-bridge P0.5-A：轮次语义内核（events.py + 会话状态机）

Planned-with: claude-opus-5-thinking
Suggested-Impl-Model: cursor-grok-4.6-xhigh-fast（线程观测 + 加锁顺序 + 终止判定属序列/一致性敏感段，是本组唯一高风险子规划；本文件已把锁序、异常兜底、字段清单、夹具数值写死，高性价比强档足够。若对并发段不放心可换 `gpt-5.6-sol-medium` 收口）

主规划：`.cursor/plans/2026-09-04-wb-bridge-session-supervision.plan.md`（根因、误诊纠正、loopx 借鉴来源、Out of scope 全在那里；本文件只做 A 段）
前置：`.cursor/plans/2026-09-03-wb-bridge-local-session.plan.md`（P0，已实施）

---

## 1. 本段要修的根因（不依赖对话上下文，实施者据此判断改动是否对症）

### 根因 D-1：终止判定只认成功，导致空等满超时

`agenticx/cc_bridge/ndjson.py:90`：

```python
def line_looks_like_result_success(line: str) -> bool:
    ...
    return obj.get("type") == "result" and obj.get("subtype") == "success"
```

`agenticx/wb_bridge/session_manager.py` 的 `wait_for_turn` 前身 `wait_for_success_result`（L254-283）**只**用这一个判定（L272、L279）。后果：CodeBuddy 那一轮只要不是圆满成功——被权限拦下、报错、撞 max_turns——AGX 完全收不到「本轮已结束」的信号，必然空等满 `wait_seconds`（默认 180s）。调用方看到的唯一信息是 `timeout`，于是重发。

**这不是模型慢，是判定条件太窄。** 修法：终止判定改为「任何 `type == "result"` 行都终结本轮」，再对终止**分类**。这个改动不依赖任何未实测的字段形状。

> `cc_bridge/ndjson.py` 是 Claude Code 生产链路，**禁止修改**。新语义必须落在新建的 `agenticx/wb_bridge/events.py`。

### 根因 D-4：stdout 里已有用量与进度，但没人解析

`_reader_thread`（L73-85）只做 `append_line` + `append_log`。`result` 行里已有 `usage`（四项 token）、`num_turns`、`duration_ms`；`assistant` 行里已有 `tool_use` 的工具名。这些全被丢在原始行里，`_session_to_dict`（L121-131）只回 6 个键。Agent 侧又因 workspace 沙箱读不到磁盘日志，形成「有数据但拿不到」。

### 根因 D-5：失败被误当「什么都没发生」

无任何字段告知本轮已执行过哪些工具。实测那晚 `hello.py` 在 Bash 被拦**之前**已落盘，Meta 却按失败重跑三次。借鉴 loopx 的 settlement 语义（`research/codedeepresearch/loopx/loopx_source_notes.md` E-034 / E-021：失败不回滚已提交的 writeback），本段必须记录本轮 `observed_tools`，让上层看见「Write 已发生」。

### 证据边界（勿猜）

P0 的 E-3 已实测 codebuddy **不支持** `--permission-prompt-tool`，headless 下不吐 `control_request`，逐工具批准不成立。但**「default 模式撞 Write 时 stdout 到底吐什么」没有实测样本**。因此：

- 终止判定只依赖 `type == "result"`（与 subtype 无关）。
- 分类只依赖已实测存在的字段：`permission_denials`（`tests/test_smoke_wb_bridge.py:49` 的 `_E2_RESULT` 中确有 `"permission_denials":[]`）、`is_error`、`subtype`。
- AC-A11 是人工采样，负责回填真实 subtype；若采样发现被挡住时**根本不吐 result 行**，则依赖本段的 timeline / stalled 兜底，并把结论追写回主规划 §1.2，**不要临场改设计**。

---

## 2. In scope / Out of scope

### In scope

1. 新建 `agenticx/wb_bridge/events.py`。
2. 改 `agenticx/wb_bridge/session_manager.py`：`WbBridgeSession` 扩字段 + `observe_line` + `wait_for_turn` + `wait_for_success_result` 改薄封装 + `send_user_message` 置 running + `_session_to_dict` 扩字段 + 记录 `permission_mode`。
3. 追写 `tests/test_smoke_wb_bridge.py`（复用既有夹具与 fake）。

### Out of scope（做了算违规）

- **不改** `agenticx/wb_bridge/http_app.py`（属子规划 B）。
- **不改** `agenticx/cli/agent_tools.py`、`desktop/**`（属子规划 C）。
- **不改** `agenticx/cc_bridge/**`、`agenticx/studio/server.py`、`agenticx/runtime/**`。
- **不读** `log_path` 指向的文件来生成状态（见 §3 约束 1）。
- 不做用量持久化 / 跨重启聚合 / 按天报表。

---

## 3. 硬约束（违反即返工）

1. **单一数据源**：所有状态字段只能来自 reader 线程解析 stdout 时写入的**内存观测态**。**禁止**为拿状态去读 `log_path` 文件。（借鉴 loopx E-023/E-024：`event_ledger_summary` 与 `events.jsonl` 是两本账，混用即错。）
2. **加锁顺序固定 `_global_lock` → `session.lock`**，不得反向。`observe_line` **只**持 `session.lock`。
3. **`observe_line` 绝不能抛异常**。解析路径上任何异常都必须就地兜底（回落为 `error` 分类），否则 reader 线程死掉、会话彻底失聪。
4. **向后兼容**：`wait_for_success_result` 保签名保语义；`_session_to_dict` 保留既有 6 个键。既有 16 条 P0 冒烟用例必须继续绿，**不得修改其断言**。
5. **代码风格**：新文件 docstring 含 `Author: Damon Li`；注释/docstring 全英文、无 emoji；**禁止函数内联 import**（见 `.cursor/rules/google-python-style.mdc` 与 `no-inline-imports`）。

---

## 4. 功能需求（FR）

### FR-A1 新建 `agenticx/wb_bridge/events.py`

模块顶部 `import ujson`（与 `cc_bridge/ndjson.py:12` 一致）。解析异常只吞 `(ValueError, TypeError)`。**本文件不得 import `agenticx.cc_bridge`**（见 AC-A10）。

必须导出以下纯函数（无副作用、可单测）：

```python
def parse_stream_line(line: str) -> Optional[Dict[str, Any]]:
    """Parse one NDJSON stdout line; return dict or None when not a JSON object."""


def line_is_turn_terminal(line: str) -> bool:
    """True for any ``type == "result"`` line, regardless of subtype.

    Intentionally wider than
    ``agenticx.cc_bridge.ndjson.line_looks_like_result_success``: a turn that
    was blocked or errored still ends the turn.
    """


def classify_result(obj: Optional[Dict[str, Any]]) -> Tuple[str, str]:
    """Return ``(kind, detail)`` where kind is "success" | "blocked" | "error".

    Precedence (first match wins):
      1. obj is None / not a dict        -> ("error", "unparseable result")
      2. non-empty ``permission_denials``-> ("blocked", <denied tool names>)
      3. ``is_error`` truthy             -> ("error", <subtype or "is_error">)
      4. ``subtype`` != "success"        -> ("error", <subtype or "missing subtype">)
      5. otherwise                       -> ("success", "")
    """


def extract_usage(obj: Optional[Dict[str, Any]]) -> Dict[str, int]:
    """Pull the four token counters out of a result object.

    Keys (all int; missing / non-numeric -> 0):
      input_tokens, output_tokens,
      cache_read_input_tokens, cache_creation_input_tokens
    Read from ``obj["usage"]``; returns all-zero dict when absent.
    """


def extract_result_text(obj: Optional[Dict[str, Any]]) -> str:
    """Return ``str(obj["result"])`` or "" when absent / None."""


def extract_tool_activity(line: str) -> Optional[str]:
    """Best-effort current-activity label from an assistant line.

    Scans ``obj["message"]["content"]`` for items with ``type == "tool_use"``
    and returns the LAST such item's ``name``. Returns None when the shape
    does not match. Heuristic by design.
    """
```

`classify_result` 的 `blocked` detail：遍历 `permission_denials`，元素为 dict 时取 `tool_name`（缺失则 `str(元素)`），否则 `str(元素)`；逗号连接后截断 200 字符。

### FR-A2 `WbBridgeSession` 扩字段

`session_manager.py` 的 `WbBridgeSession`（L39-70）。**追加**在 `log_lock` 之后，全部带默认值，**勿改动既有字段的顺序与含义**：

```python
    permission_mode: str = "default"
    turn_state: str = "idle"                  # "idle" | "running"
    turn_seq: int = 0                          # incremented on each send
    turns_completed: int = 0
    dispatched_at: Optional[float] = None      # time.monotonic() at send
    first_activity_at: Optional[float] = None  # first tool_use of current turn
    terminal_at: Optional[float] = None        # last terminal result
    last_activity: str = ""                    # e.g. "Write" / "Bash"
    last_activity_at: Optional[float] = None
    observed_tools: List[str] = field(default_factory=list)  # current turn, dedup, cap 20
    last_terminal_kind: str = ""               # "success" | "blocked" | "error"
    last_terminal_detail: str = ""
    last_result_text: str = ""
    last_duration_ms: Optional[int] = None
    last_num_turns: Optional[int] = None
    usage_totals: Dict[str, int] = field(default_factory=dict)
    blocked_count: int = 0
    turn_done: threading.Event = field(default_factory=threading.Event)
```

`dispatched_at / first_activity_at / terminal_at` 三点是**轮次时间线**（借鉴 loopx E-020 的 receipt 有序前缀思想），用于区分「冷启动/路由慢」（迟迟无 `first_activity_at`）与「真在执行或在等确认」（有 `first_activity_at` 但无 `terminal_at`）。

### FR-A3 reader 线程观测

`_reader_thread`（L73-85）：在既有 `session.append_line(line)` 与 `session.append_log(line)` **之后**追加一行 `session.observe_line(line)`。**不要**改动这两行与 `finally` 块。

在 `WbBridgeSession` 上新增方法：

```python
    def observe_line(self, line: str) -> None:
        """Update turn state from one stdout line. Never raises."""
```

语义（整个方法体包在 try/except Exception 里兜底，except 分支只记 `_LOG.warning` 后 return）：

```
持 self.lock:

    activity = extract_tool_activity(line)
    若 activity 非 None:
        now = time.monotonic()
        last_activity = activity
        last_activity_at = now
        若 first_activity_at is None: first_activity_at = now
        若 activity not in observed_tools 且 len(observed_tools) < 20:
            observed_tools.append(activity)

    若 line_is_turn_terminal(line):
        obj = parse_stream_line(line)
        kind, detail = classify_result(obj)
        last_terminal_kind = kind
        last_terminal_detail = detail
        last_result_text = extract_result_text(obj)
        last_duration_ms = int(obj["duration_ms"]) 若可安全转换否则保持原值
        last_num_turns   = int(obj["num_turns"])   若可安全转换否则保持原值
        for k, v in extract_usage(obj).items():
            usage_totals[k] = usage_totals.get(k, 0) + v
        turns_completed += 1
        若 kind == "blocked": blocked_count += 1
        turn_state = "idle"
        terminal_at = time.monotonic()
        turn_done.set()
```

注意：`usage_totals` 是**累计**（`+=`），不是快照覆盖。`observed_tools` **不在**此处清空（清空发生在 `send_user_message`，见 FR-A6）。

### FR-A4 新等待函数 `wait_for_turn`

```python
    def wait_for_turn(
        self,
        session_id: str,
        timeout_sec: float,
        poll_interval: float = 0.2,
    ) -> Tuple[str, Dict[str, Any]]:
        """Block until the current turn ends, the child exits, or timeout."""
```

`status` 取值与触发条件：

| status | 触发条件 |
|---|---|
| `"unknown_session"` | `self.get(session_id)` 返回 None（此时 snapshot 为 `{}`） |
| `"success"` | `turn_done` 已 set 且 `last_terminal_kind == "success"` |
| `"blocked"` | 同上，kind 为 `"blocked"` |
| `"error"` | 同上，kind 为 `"error"` |
| `"exited"` | `proc.poll()` 非 None 且**本轮**未收到 terminal（子进程死了） |
| `"running"` | 超时仍未收到 terminal。**任务仍在跑，不是失败** |

实现要点：

1. `timeout_sec <= 0` 时**立即返回**（不进 sleep 循环），status 取当前实际状态（未 send 过则 `"running"`，已有 terminal 则按 kind）。这是子规划 B 非阻塞投递的基础。
2. 主循环判定顺序：先查 `turn_done.is_set()` → 再查 `proc.poll() is not None` → 再判超时。可用 `session.turn_done.wait(poll_interval)` 替代裸 sleep，但**必须**保留对 `proc.poll()` 的检查，否则子进程猝死会一直等到超时。
3. `snapshot` = `self.describe_session(session_id)` 的返回（即 FR-A5 的字段全集），**另加**：
   - `"status"`：上表值
   - `"tail"`：`session.recent_text()`（默认 80 行）
   - `"stalled"`：bool，见下
4. **stalled 判定**：`timeout_sec > 0` 且返回 `"running"` 时，若整个等待期间 `last_activity_at` 与 `len(lines)` 都未变化 → `stalled = True`，否则 False。其它 status 一律 `stalled = False`。这是「万一被权限挡住时不吐 result 行」的唯一可观测信号，**必须实现**。

### FR-A5 `_session_to_dict` 扩字段

`session_manager.py:121-131`。**保留全部既有 6 个键**（`session_id / cwd / pid / poll / log_path / state`——前端与既有测试依赖），在其后追加：

```python
            "permission_mode": s.permission_mode,
            "turn_state": s.turn_state,
            "turn_seq": s.turn_seq,
            "turn_elapsed_sec": <round(now - s.dispatched_at, 1) if s.dispatched_at and s.turn_state == "running" else None>,
            "turns_completed": s.turns_completed,
            "last_activity": s.last_activity,
            "last_activity_age_sec": <round(now - s.last_activity_at, 1) if s.last_activity_at else None>,
            "first_activity_lag_sec": <round(s.first_activity_at - s.dispatched_at, 1) if s.first_activity_at and s.dispatched_at else None>,
            "observed_tools": list(s.observed_tools),
            "last_terminal_kind": s.last_terminal_kind,
            "terminal_detail": s.last_terminal_detail,
            "last_result_text": s.last_result_text[:2000],
            "last_duration_ms": s.last_duration_ms,
            "last_num_turns": s.last_num_turns,
            "usage_totals": dict(s.usage_totals),
            "blocked_count": s.blocked_count,
            "exit_code": s.exit_code,
```

`now` 取一次 `time.monotonic()` 复用。读 `s.*` 时持 `s.lock`（本方法在 `_global_lock` 内被调用，按 §3 约束 2 的顺序取 `s.lock` 后即释放，不得反向）。

`usage_totals` 只回累计四项 token；**不要**在此做费用换算。

### FR-A6 `send_user_message` 置 running

`send_user_message`（L234-239）。在 `self._write_stdin(session, line)` **之前**，持 `session.lock` 置：

```python
            session.turn_done.clear()
            session.turn_state = "running"
            session.turn_seq += 1
            session.dispatched_at = time.monotonic()
            session.first_activity_at = None
            session.terminal_at = None
            session.last_activity = ""
            session.observed_tools = []
```

`turns_completed` / `usage_totals` / `blocked_count` 是跨轮累计，**不清零**。

### FR-A7 `wait_for_success_result` 改薄封装（防回归）

保留签名与语义，改为：

```python
    def wait_for_success_result(
        self,
        session_id: str,
        timeout_sec: float,
        poll_interval: float = 0.2,
    ) -> Tuple[bool, str]:
        status, snap = self.wait_for_turn(session_id, timeout_sec, poll_interval)
        tail = str(snap.get("tail", ""))
        if status == "success":
            return True, tail
        if status == "unknown_session":
            return False, "unknown session"
        if status == "exited":
            return False, f"process exited code={snap.get('exit_code')}\n{tail}"
        if status == "running":
            return False, f"timeout after {timeout_sec}s\n{tail}"
        return False, f"{status}: {snap.get('terminal_detail', '')}\n{tail}"
```

`tests/test_smoke_wb_bridge.py:149 test_ac5_wait_for_success_result_uses_e2_fixture` 必须继续绿（它断言成功路径返回 `True` 且 tail 含 `_E2_RESULT`；只喂前两行时返回 `False` 且消息含 `"timeout"`）。

### FR-A8 会话记住自己的 permission_mode

`_start_session_headless`（L159-227）：`mode` 变量在 L166 已由 `_normalize_permission_mode` 算好。在构造 `WbBridgeSession(...)`（L199-204）时**新增一个 kwarg** `permission_mode=mode`。

**勿改动** argv 构造（L171-181）、`Popen` 参数（L186-195）、两个线程启动块（L212-221）、`_wait_proc` 注册（L226）。

---

## 5. 验收标准（AC）

全部**追写**到 `tests/test_smoke_wb_bridge.py`，复用 L31-57 的 `_E2_SYSTEM_INIT` / `_E2_ASSISTANT` / `_E2_RESULT` 与 L60-88 的 `_FakeStream` / `_FakeProc`。**不新建** Python 测试文件。

新增夹具（加在 `_E2_RESULT` 之后）：

```python
_E2_TOOL_USE = (
    '{"type":"assistant","message":{"role":"assistant","model":"glm-5.3",'
    '"content":[{"type":"tool_use","id":"toolu_1","name":"Write",'
    '"input":{"file_path":"/private/tmp/hello.py"}}]}}'
)
_E2_TOOL_USE_BASH = (
    '{"type":"assistant","message":{"role":"assistant","model":"glm-5.3",'
    '"content":[{"type":"tool_use","id":"toolu_2","name":"Bash",'
    '"input":{"command":"python3 /private/tmp/hello.py"}}]}}'
)
_RESULT_BLOCKED = (
    '{"type":"result","subtype":"error_during_execution","is_error":true,'
    '"result":null,"duration_ms":1200,"num_turns":3,'
    '"usage":{"input_tokens":10,"output_tokens":2,'
    '"cache_creation_input_tokens":0,"cache_read_input_tokens":5},'
    '"permission_denials":[{"tool_name":"Bash","tool_use_id":"toolu_2"}]}'
)
_RESULT_ERROR = (
    '{"type":"result","subtype":"error_max_turns","is_error":true,"result":null,'
    '"duration_ms":900,"num_turns":9,"permission_denials":[]}'
)
_MALFORMED = '{"type":"result","subtype":'  # truncated JSON
```

`_RESULT_BLOCKED` / `_RESULT_ERROR` 的 `subtype` 字面值是**占位**（判定只依赖 `permission_denials` 与 `is_error`）。AC-A11 采到真实样本后只替换 subtype 字符串，断言不变。

- **AC-A1（FR-A1 分类）** `test_events_classify_result`：
  - `classify_result(parse_stream_line(_E2_RESULT))` → `("success", "")`
  - `_RESULT_BLOCKED` → kind `"blocked"` 且 detail 含 `"Bash"`
  - `_RESULT_ERROR` → kind `"error"`
  - `classify_result(None)` → `("error", "unparseable result")`
  - `line_is_turn_terminal` 对 `_E2_RESULT` / `_RESULT_BLOCKED` / `_RESULT_ERROR` 均 True，对 `_E2_ASSISTANT` / `_E2_SYSTEM_INIT` / `_E2_TOOL_USE` 均 False
- **AC-A2（FR-A1 用量与活动）** `test_events_extract_usage_and_activity`：
  - `extract_usage(parse_stream_line(_E2_RESULT))` 四键分别为 `input_tokens=24426`、`output_tokens=3`、`cache_read_input_tokens=192`、`cache_creation_input_tokens=24234`（数值取自 `_E2_RESULT` 原文，勿改）
  - `extract_usage(None)` 与 `extract_usage({})` 四键全 0
  - `extract_tool_activity(_E2_TOOL_USE) == "Write"`；`extract_tool_activity(_E2_ASSISTANT) is None`；`extract_tool_activity(_MALFORMED) is None`
- **AC-A3（FR-A4 blocked 不再空等 —— D-1 回归守卫）** 构造 running 的 `_FakeProc` 会话注册进 manager，依次 `observe_line(_E2_TOOL_USE)`、`observe_line(_E2_TOOL_USE_BASH)`、`observe_line(_RESULT_BLOCKED)`；随后 `wait_for_turn(sid, 5.0)` 必须在 **1 秒内**返回（用 `time.monotonic()` 前后差 `< 1.0` 断言）且 `status == "blocked"`；snapshot 满足 `blocked_count == 1`、`last_activity == "Bash"`、`observed_tools == ["Write", "Bash"]`、`terminal_detail` 含 `"Bash"`。**这条是本子规划的核心守卫，不得删改。**
- **AC-A4（FR-A3 观测不抛异常）** 对同一会话依次 `observe_line(_MALFORMED)`、`observe_line("")`、`observe_line("not json at all")`，均**不得抛异常**；随后再 `observe_line(_E2_RESULT)` 仍能正确置 `last_terminal_kind == "success"`（证明 reader 未失聪）。
- **AC-A5（FR-A4 running 与 timeout<=0）** 只喂 `_E2_SYSTEM_INIT` + `_E2_TOOL_USE`：
  - `wait_for_turn(sid, 0.45, poll_interval=0.1)` → `status == "running"`，snapshot `"tail"` 非空
  - `wait_for_turn(sid, 0)` 返回耗时 `< 0.1s` 且 `status == "running"`
- **AC-A6（FR-A4 exited）** 用 `_FakeProc(running=False)` 构造会话（`poll()` 返回 0）且本轮无 terminal，`wait_for_turn(sid, 2.0)` → `status == "exited"`，且在 1 秒内返回。
- **AC-A7（FR-A3 用量累计而非快照）** 同一会话连喂两次 `_E2_RESULT`，`describe_session` 返回 `usage_totals["input_tokens"] == 24426 * 2`、`turns_completed == 2`。
- **AC-A8（FR-A5 字段全集）** `describe_session` 返回的 dict 同时包含旧 6 键与新键 `permission_mode / turn_state / turn_seq / turns_completed / last_activity / observed_tools / usage_totals / last_terminal_kind / terminal_detail / first_activity_lag_sec`。
- **AC-A9（FR-A6 + FR-A8 送轮重置）** monkeypatch `Popen` 与 `resolve_codebuddy_executable`（照 `test_ac3_and_ac4_headless_argv` L111-146 的写法），`start_session(cwd, permission_mode="acceptEdits")` 后 `describe_session` 的 `permission_mode == "acceptEdits"`；`observe_line(_E2_TOOL_USE)` 再 `send_user_message(sid, "next")` 后，`observed_tools == []`、`last_activity == ""`、`turn_state == "running"`、`turn_seq == 1`，而 `turns_completed` 保持不变。
- **AC-A10（模块边界，借鉴 loopx E-025）** `test_wb_bridge_module_boundaries`：用 `inspect.getsource(agenticx.wb_bridge.events)` 断言其中**不含** `cc_bridge`；遍历 `agenticx/wb_bridge/*.py` 源码断言均**不含** `agenticx.studio`；断言 `session_manager.py` 源码中**不含**对 `log_path` 的读取调用（正则 `open\(\s*(self\.)?log_path` 与 `read_text` 均无命中），落实 §3 约束 1。
- **AC-A11（人工采样，本机 macOS + 已装 WorkBuddy；不进 CI）** 终端 A 跑 `agx wb-bridge serve`；curl 建一个 `permission_mode=default` 的会话，投递 `write a file /tmp/agx-probe.txt with content hi`；**保存实际 stdout 的最后 5 行原文**，据此：(a) 用真实 subtype 替换 `_RESULT_BLOCKED` 占位；(b) 若确认根本不吐 `result` 行，则改为断言 `wait_for_turn` 返回 `status == "running"` 且 `snapshot["stalled"] is True`，并把该结论追写回主规划 §1.2。
- **AC-A12（不回归）** `pytest tests/test_smoke_wb_bridge.py -q` 全绿，含 P0 的 16 条既有用例；`test_ac5_wait_for_success_result_uses_e2_fixture`（L149）与 `test_ac8_no_cc_bridge_diff`（L218）**断言原样未改**。
- **AC-A13（Out of scope 守卫）** `git diff --name-only` 只应出现 `agenticx/wb_bridge/events.py`、`agenticx/wb_bridge/session_manager.py`、`tests/test_smoke_wb_bridge.py`（外加本 plan 文件的移动）。**不得**出现 `agenticx/cc_bridge/**`、`agenticx/studio/server.py`、`agenticx/wb_bridge/http_app.py`、`agenticx/cli/agent_tools.py`、`desktop/**`。

---

## 6. 实施顺序

1. `events.py`（FR-A1）→ 跑 AC-A1、AC-A2。
2. `WbBridgeSession` 扩字段 + `observe_line`（FR-A2、FR-A3）→ 跑 AC-A4、AC-A7。
3. `wait_for_turn` + `wait_for_success_result` 封装（FR-A4、FR-A7）→ 跑 AC-A3、AC-A5、AC-A6、AC-A12。
4. `_session_to_dict` 扩字段（FR-A5）→ 跑 AC-A8。
5. `send_user_message` 重置 + `permission_mode` 记录（FR-A6、FR-A8）→ 跑 AC-A9。
6. 边界测试（AC-A10）+ 全量回归（AC-A12）+ diff 守卫（AC-A13）。
7. 本机人工 AC-A11，回填夹具与主规划 §1.2。

第 3 步做完，D-1 就已修复（空等 180s 与随之而来的重复投递消失），这是本段的价值分水岭。

---

## 7. 风险

| 风险 | 缓解 |
|---|---|
| `observe_line` 抛异常打死 reader 线程 → 会话失聪 | §3 约束 3；AC-A4 用三种畸形输入正向覆盖 |
| `_global_lock` 与 `session.lock` 嵌套死锁 | §3 约束 2 固定加锁顺序；`observe_line` 只取 `session.lock` |
| 拓宽终止判定后把中间态 `result` 误当收尾 | 已实测 codebuddy 每轮只在收尾吐一条 `type=result`（P0 E-2）；AC-A1 正反双向守卫 |
| `wait_for_turn` 漏查 `proc.poll()` → 子进程猝死仍等满超时 | FR-A4 要点 2 明确要求；AC-A6 守卫 |
| 真实 blocked subtype 与占位夹具不符 | 判定不依赖 subtype 字面值；AC-A11 回填 |

---

## 8. 提交约定

```
Plan-Id: 2026-09-04-wb-bridge-supervision-a-turn-semantics
Plan-File: .cursor/plans/2026-09-04-wb-bridge-supervision-a-turn-semantics.plan.md
Plan-Id: 2026-09-04-wb-bridge-session-supervision
Plan-File: .cursor/plans/2026-09-04-wb-bridge-session-supervision.plan.md
Plan-Model: claude-opus-5-thinking
Impl-Model: <实际使用的模型>
Made-with: Damon Li
```

commit 示例：`feat(wb-bridge): classify turn terminal kinds and track per-turn usage`。不写任何对标第三方产品的措辞，**不得**在 commit 里出现 loopx 等第三方项目名。
