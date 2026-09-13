# wb-bridge 可见性 A：本轮写出路径

Planned-with: cursor-grok-4.6
Suggested-Impl-Model: composer-2.5-fast
主规划：`.cursor/plans/pending/2026-09-05-wb-bridge-desktop-visibility.plan.md`

---

## 1. 根因

`observe_line`（`agenticx/wb_bridge/session_manager.py` L91-103）已从 stdout 抽出工具**名**（`Write`），夹具 `_E2_TOOL_USE`（`tests/test_smoke_wb_bridge.py` L63-66）里其实已经有绝对路径：

```
"input":{"file_path":"/private/tmp/hello.py"}
```

但 snapshot / HTTP **没有**路径字段。Desktop 产物收集器因此看不到委派写入。本段只补「路径从哪来、挂在哪」，不改 Desktop。

---

## 2. In scope / Out of scope

### In scope

1. `agenticx/wb_bridge/events.py`：新增 `extract_written_paths(line) -> list[str]`。
2. `WbBridgeSession` 增 `written_paths: List[str]`；`observe_line` 追加；`send_user_message` 清空；`_session_to_dict` 输出。
3. `http_app.py`：`MessageResponse.written_paths`；`_build_message_response` 透传（describe 已返回 dict，加 snapshot 键即可）。
4. `tests/test_smoke_wb_bridge.py` 追加 AC。

### Out of scope

- 不改 `desktop/**`、`agent_tools.py`、`meta_agent.py`、`server.py`、`cc_bridge/**`、`agent_runtime.py`。
- 不读 `.log` 反推路径。
- 不解析 Bash `command` 里的路径（只认 Write/Edit 的 input）。

---

## 3. 硬约束

- `observe_line` 不得抛异常（包在现有 `try` 里）。
- 只取 `session.lock`。
- 路径必须是绝对路径（`/` 或 `X:\` 开头）才入列；相对路径丢弃。
- 去重保序，上限 20（与 `observed_tools` 相同）。
- `append_log` 继续用 `Path.open`，禁止出现 `open(self.log_path` 字面量（P0 AC-A10）。

---

## 4. 改动落点

### FR-A1 `extract_written_paths`

文件：`agenticx/wb_bridge/events.py`，放在 `extract_tool_activity` 之后。

```python
_WRITE_PATH_TOOLS = frozenset({"Write", "Edit"})


def extract_written_paths(line: str) -> list[str]:
    """Absolute paths from Write/Edit tool_use input. Empty when shape mismatches."""
    obj = parse_stream_line(line)
    if obj is None:
        return []
    message = obj.get("message")
    if not isinstance(message, dict):
        return []
    content = message.get("content")
    if not isinstance(content, list):
        return []
    out: list[str] = []
    for item in content:
        if not isinstance(item, dict) or item.get("type") != "tool_use":
            continue
        if str(item.get("name") or "") not in _WRITE_PATH_TOOLS:
            continue
        inp = item.get("input")
        if not isinstance(inp, dict):
            continue
        raw = inp.get("file_path") or inp.get("path")
        path = str(raw or "").strip()
        if path.startswith("/") or (len(path) >= 3 and path[1] == ":" and path[0].isalpha()):
            out.append(path)
    return out
```

夹具 `_E2_TOOL_USE` 必须得到 `["/private/tmp/hello.py"]`；`_E2_TOOL_USE_BASH` 得到 `[]`。

### FR-A2 session 字段

`agenticx/wb_bridge/session_manager.py` `WbBridgeSession`（约 L57 `observed_tools` 旁）增加：

```python
written_paths: List[str] = field(default_factory=list)  # current turn, dedup, cap 20
```

`observe_line` 在抽出 `activity` 的同一把锁内：

```python
for path in wb_events.extract_written_paths(line):
    if path not in self.written_paths and len(self.written_paths) < 20:
        self.written_paths.append(path)
```

`send_user_message`（L350 `observed_tools = []` 旁）同时 `session.written_paths = []`。

`_session_to_dict`（L214 `observed_tools` 旁）增加 `"written_paths": list(s.written_paths)`。

### FR-A3 HTTP

`agenticx/wb_bridge/http_app.py`：

- `MessageResponse`（L166 后）增加 `written_paths: List[str] = Field(default_factory=list)`。
- `_build_message_response`（L119 后）增加 `written_paths=list(snap.get("written_paths") or [])`。

`GET /v1/sessions/{id}` 直接返回 `_session_to_dict`，无需另写。

---

## 5. AC（可执行）

文件：`tests/test_smoke_wb_bridge.py`（沿用现有 fake / `_E2_*`）。

- **AC-A1** `test_extract_written_paths`：
  - `extract_written_paths(_E2_TOOL_USE) == ["/private/tmp/hello.py"]`
  - `extract_written_paths(_E2_TOOL_USE_BASH) == []`
  - `extract_written_paths(_E2_ASSISTANT) == []`
  - `extract_written_paths("not json") == []`
  - 自造一行 `input.path`（不是 `file_path`）的 Write，仍抽出该绝对路径。
- **AC-A2** `test_observe_line_records_written_paths`：`observe_line(_E2_TOOL_USE)` 后 `describe_session` 的 `written_paths == ["/private/tmp/hello.py"]` 且 `observed_tools == ["Write"]`。
- **AC-A3** `test_send_user_message_clears_written_paths`：先 observe Write，再 `send_user_message`（可 monkeypatch stdin），`written_paths == []`、`observed_tools == []`。
- **AC-A4** HTTP：monkeypatch `wait_for_turn` 返回 `("success", {..., "written_paths": ["/tmp/a.txt"]})`，`POST .../message` 体含 `written_paths == ["/tmp/a.txt"]`。
- **AC-A5** 不回归：`pytest tests/test_smoke_wb_bridge.py --no-cov` 全绿。
- **AC-A6** `git diff --name-only` 只应出现 `events.py`、`session_manager.py`、`http_app.py`、`tests/test_smoke_wb_bridge.py`（外加本 plan 移动）。不得出现 `desktop/**`、`server.py`、`cc_bridge/**`。

---

## 6. 实施顺序

1. 先写 AC-A1 使失败 → 实现 `extract_written_paths` → 绿。
2. session 字段 + observe + send 清空 + snapshot → AC-A2/A3。
3. HTTP 透传 → AC-A4。
4. 全量 AC-A5 + diff 守卫 AC-A6。

## 7. 提交

`feat(wb-bridge): record written file paths for the current turn`

Trailer：本子规划 + 主规划；`Plan-Model: cursor-grok-4.6`；`Impl-Model` 实施时填写。
