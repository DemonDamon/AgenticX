# 03 · 副作用前落盘屏障（fail-closed）

Planned-with: Opus 5 (Cursor)
Suggested-Impl-Model: 强推理档（如 GPT-5.x）
Parent-Plan: `.cursor/plans/pending/2026-08-14-longrun-runtime-hardening.plan.md`
Gap: G-002（P1）
Depends-on: 子规划 01（同函数相邻区块，串行避免冲突）、子规划 02（跳过工具时需要合法配对的占位 tool 行语义）

## 1. 根因与证据链（不依赖对话记忆）

三处把落盘失败静默吞掉：

1. `agenticx/runtime/agent_runtime.py` L2640-2659 `_maybe_mid_turn_persist()`：`try: self._mid_turn_persist() except Exception: pass`，并且**照常**把 `_last_persist_time` / `_tools_since_persist` 重置，等于「失败也当成功」。
2. `agenticx/studio/server.py` L3272-3276 `_mid_turn_persist_cb()`：`try: manager.incremental_persist(...) except Exception: pass`——即使 runtime 侧改了，异常也到不了 runtime。
3. `agenticx/studio/session_manager.py` L1112-1116 `_persist_cb()`（resume runner 用）：同样 `except Exception: pass`。

另外 `agenticx/runtime/checkpoint.py` L71-86 `CheckpointStore.save()` 失败只 `logger.warning`。

后果：存储抖动/满盘时，「模型已决定要调用某工具」的前缀没落盘，但工具照常执行；进程随后崩溃，重启后上下文里既看不到这次调用、外部副作用却已发生——崩溃恢复的正确性被静默破坏。上游的 `session-checkpoint-policy` 是在 LLM 请求前与顶层工具执行前强制 flush（研究证据 E-009）。

## 2. In scope / Out of scope

In scope
- `agent_runtime.py`：新增 `_persist_or_abort()`；在 LLM 请求前与主路径工具分发前插入屏障。
- `server.py` / `session_manager.py`：让 persist 回调的异常可以向上传播（不再 `except: pass`）。
- 可观测：屏障触发时发结构化 ERROR 事件 + `logger.exception`。
- 单测。

Out of scope
- 不把 `messages.json` 换成事件日志。
- 不改 `incremental_persist` / 存储后端实现。
- 不改 `_persist_final_checkpoint()`（L2661-2670，已 `logger.exception`，行为可接受）。
- 不改 `agent_runtime.py` L2454 那个辅助 dispatch 路径（非主热路径），本次只加固 L5561 主路径。
- 不动 `CheckpointStore.save` 的容错策略。

## 3. FR

### FR-1 `_persist_or_abort`

在 `agenticx/runtime/agent_runtime.py` `_maybe_mid_turn_persist()`（L2640）与 `_persist_final_checkpoint()`（L2661）之间新增：

```python
def _persist_or_abort(self, reason: str) -> tuple[bool, str]:
    """Flush the turn prefix before a side effect. Returns (ok, detail)."""
    if self._mid_turn_persist is None:
        return True, ""
    try:
        self._mid_turn_persist()
    except Exception as exc:
        logger.exception("persist before %s failed", reason)
        if persist_fail_closed_enabled():
            return False, f"{type(exc).__name__}: {exc}"
        return True, ""          # flag off：只记日志，行为与今天一致
    self._last_persist_time = time.time()
    self._tools_since_persist = 0
    return True, ""
```

同时修正 FR-1a：`_maybe_mid_turn_persist()` L2653-2659 里，只有在 `self._mid_turn_persist()` 未抛异常时才重置 `_last_persist_time` / `_tools_since_persist`；抛异常时保留旧值以便下次尽快重试。这一处属于同一根因（「失败当成功」），允许在本子规划范围内修。

### FR-2 LLM 请求前屏障

位置：`agenticx/runtime/agent_runtime.py`，`messages_for_llm` 最终定型之后（当前 L3640-3642 之后）、尝试 `stream_with_tools`（当前 L3651）之前：

```python
ok, detail = self._persist_or_abort("llm_request")
if not ok:
    yield RuntimeEvent(
        type=EventType.ERROR.value,
        data={
            "text": "会话状态未能持久化，为避免崩溃后上下文与实际执行不一致，已中止本轮模型调用。请检查存储后端后重试。",
            "detail": detail,
            "detector": "persist_fail_closed",
            "severity": "error",
            "retryable": True,
        },
        agent_id=agent_id,
    )
    return
```

注意：该屏障在 `try:`（L3479）块内，`return` 会直接结束 generator，`run_turn` 外层的 checkpoint 生命周期照常处理（异常终止保留 checkpoint 供重启续跑），不需要额外处理。

### FR-3 工具分发前屏障

位置：`agenticx/runtime/agent_runtime.py` L5542-5573 区块内，`dispatch_task = asyncio.create_task(...)` **之前**（即 L5544 `effective_tm = ...` 之前）：

```python
ok, detail = self._persist_or_abort(f"tool:{tool_name}")
if not ok:
    skip_text = (
        f"未执行：调用 {tool_name} 之前会话状态落盘失败（{detail}），"
        "为避免崩溃后重复副作用已跳过本次调用。请检查存储后端后重试。"
    )
    yield RuntimeEvent(
        type=EventType.TOOL_RESULT.value,
        data={"name": tool_name, "result": skip_text, "tool_call_id": tool_call_id},
        agent_id=agent_id,
    )
    # 仍需写入配对的 tool 行，避免 dangling tool_calls
    <按该区块既有的「把 tool 结果写入 session.agent_messages / messages」的同款代码路径写入 skip_text>
    continue   # 或该循环内既有的「跳过当前 tool_call」控制流
```

实施要求：**必须复用**该函数内既有的「tool 结果落到 `messages` / `session.agent_messages`」写法（在同一区块向下找 `tool_call_id` 对应的 tool 消息构造处），不要新发明结构，确保 provider 配对合法。若该循环没有可用的 `continue` 语义，则用最小改动的等价跳过方式，并在 diff 说明。

### FR-4 回调不再吞异常

- `agenticx/studio/server.py` L3272-3276 `_mid_turn_persist_cb`：去掉 `try/except`，直接 `manager.incremental_persist(payload.session_id)`；**只改这 5 行**，禁止碰该函数上下的 `AgentRuntime(...)` 构造与 import 区（AGENTS.md 对该文件有硬约束）。
- `agenticx/studio/session_manager.py` L1112-1116 `_persist_cb`：同样去掉 `except: pass`，让 `self.incremental_persist(session_id)` 的异常向上传播。

### FR-5 冷启动验证（硬门槛）

因为改了 `agenticx/studio/server.py`，提交前必须跑一次 `agx serve --host 127.0.0.1 --port <临时端口>` 冷启动，确认进程不崩且 `/api/session`、`/api/avatars`、`/api/sessions` 返回 200。仅 diff 语义正确不算完成。

## 4. AC

新建 `tests/test_smoke_persist_fail_closed.py`：

- **AC-1**（LLM 屏障）：`persist_fail_closed` 开启 + `mid_turn_persist` 打桩为抛 `OSError("disk full")`。断言假 LLM 的 `invoke` / `stream_with_tools` 调用次数 **== 0**，且产出一条 `detector == "persist_fail_closed"` 的 ERROR。
- **AC-2**（工具屏障）：LLM 返回一个 tool_call，persist 在工具前抛错。断言被打桩的工具 dispatch 调用次数 **== 0**；断言 `session.agent_messages` 中该 `tool_call_id` 有配对 tool 行，`_sanitize_context_messages(session.agent_messages)` 后 pairing 合法（不出现 dangling `tool_calls`）。
- **AC-3**（flag off）：`AGX_PERSIST_FAIL_CLOSED=0`（默认）时，同样注入 persist 失败，断言 LLM 与工具都**照常执行**（与今天行为一致），且日志里有 exception 记录。
- **AC-4**：persist 成功时 `_last_persist_time` 被更新；persist 抛错且 flag off 时 `_tools_since_persist` **不被清零**（FR-1a）。
- **AC-5**：`tests/test_ha_checkpoint_resume.py`、`tests/test_smoke_compaction_notice_persist.py`、`tests/test_smoke_proactive_compaction_persist.py` 全绿。

## 5. 风险与灰度

- **把存储抖动放大成用户可见错误**：因此默认 **off**。上线顺序：先默认 off 跑一版（只有 `logger.exception` + 事件不发），观察日志里 `persist before ... failed` 的真实频率；确认低频后再由用户决定是否打开。
- 屏障加在热路径上会多一次同步落盘：`_persist_or_abort` 复用现有 `incremental_persist`，且每轮/每工具各一次，与既有 `_maybe_mid_turn_persist` 的量级相当；若观测到明显延迟，可退化为「仅工具前屏障」。
- 回滚：`AGX_PERSIST_FAIL_CLOSED=0`。
