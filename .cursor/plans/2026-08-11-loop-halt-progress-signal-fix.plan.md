# Loop-halt 误判修复：meta 工具 ok 进展信号 + halt 总结携带已成功事实

Planned-with: kimi-k3
Suggested-Impl-Model: gpt-5.6-terra-medium（单文件后端运行时改动 + 冒烟测试，代码专精中档够用；无需顶配规划模型）
Status: implementing
Plan-Id: 2026-08-11-loop-halt-progress-signal-fix

## 背景与根因（证据链）

会话 `a30ef9e8-46c2-405e-a8f3-4516642b5389`（2026-08-11 15:02–15:07）：用户要求按图构建 7 人游戏开发专家团。实际结果 **7 个分身全部创建成功**，但运行时以 `terminal_reason=loop_halt` 终止本轮，并向用户落盘了一句与事实相反的文案「我多次尝试后仍未取得进展（连续 12 次工具调用未观察到进展（artifacts/scratchpad 未变化）…）」。切回会话时该句是唯一可见的终态文本（过程卡默认折叠），用户观感为「任务失败」，属于误判 + 误导性文案的叠加。

证据：

1. `agenticx/runtime/agent_runtime.py:5348-5369`：`has_progress` 四选一判定——artifacts/scratchpad 签名变化、`file_write/file_edit` 写盘、磁盘写入路径增加、或工具在 `PROGRESS_TOOLS` 白名单内且返回非错误。`PROGRESS_TOOLS` 仅含 todo/scratchpad/bash/文件类/mcp/web/browser 类，**不含 `create_avatar` / `delegate_to_avatar` 等 meta 工具**；`create_avatar` 也不写 artifacts/scratchpad，因此**成功创建分身同样被记为无进展**。
2. `agenticx/runtime/loop_detector.py:295-315` `_detect_no_progress`：从尾部数连续 `has_progress=False`，streak ≥ warning(8) 且 `_classify` 到 critical(15) 前即按等级上报；`agent_runtime.py:5482-5576` 在 critical 时走 loop_halt 分支：填充剩余 tool 占位结果 → 用 `halt_prompt` 让模型生成总结 → `_finish_terminal_reply(terminal_reason="loop_halt")` 落盘。
3. 该会话 `agent_messages.json`：第 1 轮 7 次 `create_avatar`（6 成功 + 1 `missing_name`），第 2 轮 3 次（2 个 `avatar_exists` + 路远行成功），第 3 轮第 1 个又 `avatar_exists`——连续 12 次全部被记 `has_progress=False`，触发 critical 停机。
4. `halt_prompt`（`agent_runtime.py:5505-5515`）只携带「原始请求 + 触发原因」，**不携带本轮已成功的工具事实**，模型只能写出「未取得进展」式文案。
5. meta 工具统一返回 `{"ok": true/false, ...}` JSON（`agenticx/runtime/meta_tools.py` 全文约定，如 create_avatar 成功 `{"ok": true, "avatar_id": ...}`，失败 `{"ok": false, "error": "avatar_exists"}`），这是现成的、精确的进展信号。

## 目标

- FR-1：工具结果为 JSON 且含布尔 `ok` 字段时，`ok: true` 必须计为进展（`has_progress=True`），`ok: false` 不计。成功创建分身/委派等不再被 loop detector 误判为空转；真正连续失败（`avatar_exists` 等）仍会被正常停机。
- FR-2：loop_halt 终态文案必须携带「本轮已确认完成的事实」清单，禁止把已成功事项描述为失败；文案结构为：已完成事实 → 被停止原因 → 未完成部分与下一步建议。
- FR-3：新增冒烟测试锁定 FR-1/FR-2，既有 loop 相关测试不得变红。

## 非目标（Out of scope）

- 不改 Desktop 前端代码（用户可见文案由后端 halt prompt 生成，修源头即可）。
- 不调整 `PROGRESS_TOOLS` 白名单构成、不改 `request_action_confirmation` 的进展语义。
- 不改 `loop_detector.py` 的阈值（warning 8 / critical 15）与检测器组合顺序。
- 不处理「模型重复创建已存在分身」的提示词侧引导。
- 不动 `agenticx/studio/server.py`（高敏文件，本计划无需触碰）。

## 实施步骤

统一落点文件：`agenticx/runtime/agent_runtime.py`（`json` 已在第 9 行导入，无需新增依赖）。

### FR-1 修改落点 1：新增模块级纯函数 `_tool_result_ok_flag`

在 `_build_progress_signature`（当前约 2033 行）附近新增：

```python
def _tool_result_ok_flag(result: Any) -> Optional[bool]:
    """Return the boolean ``ok`` flag from a JSON tool result, if present.

    Meta tools (create_avatar / delegate_to_avatar / config writers, etc.)
    return ``{"ok": true|false, ...}``; use it as an authoritative progress
    signal. Returns None when the result is not a JSON object with a boolean
    ``ok`` field, so callers fall back to existing heuristics.
    """
    if not isinstance(result, str):
        return None
    head = result.lstrip()[:4000]
    if not head.startswith("{"):
        return None
    try:
        parsed = json.loads(head)
    except Exception:
        return None
    if not isinstance(parsed, dict):
        return None
    flag = parsed.get("ok")
    return flag if isinstance(flag, bool) else None
```

### FR-1 修改落点 2：接入 has_progress 判定

在工具结果处理块（当前约 5359-5401 行）：

Before:

```python
                logical_progress = (
                    tool_name in PROGRESS_TOOLS
                    and isinstance(result, str)
                    and not is_error_result
                    and len(result.strip()) > 10
                )
```

After（在 `logical_progress` 计算后、`record_call` 前插入两行，并改 `has_progress`）：

```python
                logical_progress = (
                    tool_name in PROGRESS_TOOLS
                    and isinstance(result, str)
                    and not is_error_result
                    and len(result.strip()) > 10
                )
                ok_flag = _tool_result_ok_flag(result)
                if ok_flag is True:
                    logical_progress = True
```

`record_call(...)` 处的 `has_progress=(... or logical_progress)` 不变——`ok: true` 经 `logical_progress` 汇入；`ok: false` 与解析失败（None）均不置位，行为与现状一致。

注意：不得把 `ok: false` 显式写成 `logical_progress = False` 去覆盖其它进展来源（如同时发生写盘），只做单向 True 提升。

### FR-2 修改落点 1：新增 `_build_loop_halt_success_digest`

模块级纯函数（放 `_tool_result_ok_flag` 旁边）：

```python
def _build_loop_halt_success_digest(session: StudioSession, *, max_items: int = 20) -> str:
    """Summarize confirmed successful tool outcomes from this session for the
    loop-halt prompt, so the final user-facing summary cannot claim "no
    progress" when concrete results were already produced."""
    lines: List[str] = []
    seen: set[str] = set()
    for msg in getattr(session, "agent_messages", []) or []:
        if not isinstance(msg, dict) or msg.get("role") != "tool":
            continue
        if _tool_result_ok_flag(msg.get("content")) is not True:
            continue
        try:
            payload = json.loads(str(msg.get("content")).lstrip()[:4000])
        except Exception:
            continue
        tool_name = str(msg.get("name") or "tool")
        label = payload.get("name") or payload.get("message") or ""
        line = f"{tool_name} 成功：{label}" if label else f"{tool_name} 成功"
        if line in seen:
            continue
        seen.add(line)
        lines.append(f"- {line}")
    if len(lines) > max_items:
        lines = lines[-max_items:]
    return "\n".join(lines)
```

### FR-2 修改落点 2：halt_prompt 注入事实清单

在 loop_halt 分支（当前约 5503-5515 行）：

Before:

```python
                    _original_task_snippet = (user_input or "").strip().replace("\n", " ")[:500]
                    halt_prompt = (
                        "[system-halt] 运行时检测到连续工具调用无进展，已自动停止重试。\n"
                        f"触发原因：{loop_issue.message}\n"
                        f"【用户原始请求】{_original_task_snippet}\n"
                        "⚠️ 严格要求：回答必须紧扣上面的【用户原始请求】，不得切换、发明或扩展到任何其它话题（例如不要自行转为配置教程、产品对比等与原始请求无关的主题）。\n"
                        "请用中文 3-5 句直接对用户说明：\n"
                        "1) 围绕【用户原始请求】你尝试过哪些工具/参数；\n"
                        "2) 失败或无进展的主要原因（参数不对 / 站点不可达 / 工具能力不足 / 需鉴权 等）；\n"
                        "3) 围绕同一个原始请求的下一步建议（换工具、补充信息、手动执行等）。\n"
                        "请直接给出正文，不要再调用任何工具，也不要讨论与原始请求无关的内容。"
                    )
```

After：

```python
                    _original_task_snippet = (user_input or "").strip().replace("\n", " ")[:500]
                    _success_digest = _build_loop_halt_success_digest(session)
                    halt_prompt = (
                        "[system-halt] 运行时检测到连续工具调用无进展，已自动停止重试。\n"
                        f"触发原因：{loop_issue.message}\n"
                        f"【用户原始请求】{_original_task_snippet}\n"
                        "【本轮已确认完成的事实】（以下工具调用已成功返回，属于已完成事项，不得描述为失败或无进展）：\n"
                        f"{_success_digest or '（无）'}\n"
                        "⚠️ 严格要求：回答必须紧扣上面的【用户原始请求】，不得切换、发明或扩展到任何其它话题（例如不要自行转为配置教程、产品对比等与原始请求无关的主题）。\n"
                        "请用中文 3-6 句直接对用户说明：\n"
                        "1) 若【本轮已确认完成的事实】非空，必须先明确告知这些事项已经成功完成；\n"
                        "2) 再说明本轮为何被自动停止（如后续重复调用已存在的对象等）以及尚未完成的部分；\n"
                        "3) 围绕同一个原始请求的下一步建议（换工具、补充信息、手动执行等）。\n"
                        "请直接给出正文，不要再调用任何工具，也不要讨论与原始请求无关的内容。"
                    )
```

fallback 文案（当前约 5560-5563 行 `summary_text.strip() or (...)`）保持不变——fallback 只在总结流失败时启用，此时无法保证事实完整性，维持原文案不扩大范围。

### FR-3：新增测试 `tests/test_loop_halt_progress.py`

```python
#!/usr/bin/env python3
"""Smoke tests for loop-halt progress signal fixes.

Author: Damon Li
"""
```

用例（AC 见下节）：

1. `test_ok_flag_true/false/none`：`_tool_result_ok_flag` 对 `{"ok": true}`、`{"ok": false}`、非 JSON、`{"ok": "yes"}`（非布尔）、JSON 数组分别返回 True/False/None/None/None。
2. `test_create_avatar_success_prevents_false_loop_halt`：用 `LoopDetector` 直录 12 次 `create_avatar`，`has_progress` 按运行时同一公式推导（`ok=True` → True），断言 `check()` 不返回 critical/no_progress。
3. `test_repeated_avatar_exists_still_halts`：12 次 `has_progress=False`（模拟连续 `avatar_exists`），断言 `_detect_no_progress` 触发且 detector == "no_progress"。
4. `test_success_digest_lists_only_confirmed_successes`：构造带 `agent_messages` 的假 session（不必真 StudioSession，`types.SimpleNamespace(agent_messages=[...])` 即可），混入 ok:true（含 name 字段，如「程基岩」）、ok:false、非 JSON、重复行，断言 digest 含成功名、不含失败行、去重。
5. `test_success_digest_truncates_to_max_items`：25 条成功 → 仅保留后 20 条。

回归：`pytest tests/test_loop_detector.py tests/test_smoke_loop_detector_nudge.py tests/test_near_stuck_prevention.py tests/test_agent_loop.py tests/test_loop_controller.py tests/test_studio_continuation.py` 必须全绿。

## Requirements

- FR-1: 工具结果为 JSON 对象且含布尔 `ok` 时，`ok:true` 计入 `has_progress`；`ok:false`/非 JSON/解析失败维持现状。
- FR-2: loop_halt halt_prompt 注入本轮 `ok:true` 工具事实清单；总结须先陈述已完成事实，再说明停止原因与建议。
- FR-3: 新增 `tests/test_loop_halt_progress.py` 5 个用例全部通过；既有 loop 相关测试不回归。
- NFR-1: 不新增依赖；JSON 解析对任意输入不得抛异常；单次解析输入截断至 4000 字符。
- NFR-2: 仅改 `agenticx/runtime/agent_runtime.py` + 新增 1 个测试文件，不触碰 `studio/server.py` 与前端。
- AC-1: `test_ok_flag_*` 覆盖 True/False/None 全分支。
- AC-2: 12 次 `create_avatar ok:true` 不再触发 no_progress critical；12 次 `ok:false` 仍触发（防止反向放空）。
- AC-3: digest 仅含 `ok:true` 行、带去重与截断；含「程基岩」类中文名。
- AC-4: 既有 loop/continuation 测试文件全绿。

## 验证

```bash
python -m pytest tests/test_loop_halt_progress.py -q
python -m pytest tests/test_loop_detector.py tests/test_smoke_loop_detector_nudge.py \
  tests/test_near_stuck_prevention.py tests/test_agent_loop.py \
  tests/test_loop_controller.py tests/test_studio_continuation.py -q
```
