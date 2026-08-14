# 01 · Overflow 确认后压缩历史并重试本轮

Planned-with: Opus 5 (Cursor)
Suggested-Impl-Model: 代码专精中档（如 Codex 系列）
Parent-Plan: `.cursor/plans/pending/2026-08-14-longrun-runtime-hardening.plan.md`
Gap: G-003（P1）

## 1. 根因与证据链（不依赖对话记忆）

Studio/Desktop 热路径 `AgentRuntime._run_turn_inner`（`agenticx/runtime/agent_runtime.py`）每轮把 LLM 调用包在 `try:`（L3479）里，异常统一落到 `except Exception as exc:`（L4380）。该分支现状：

1. L4381 `fault = classify_provider_fault(exc)`，`agenticx/llms/provider_fault.py` L61-67 已能识别 `context_window`（覆盖 `contextwindowexceeded` / `context window` / `maximum context length` / `context length exceeded`，是 `agenticx/runtime/context_budget.py` L143 `is_context_window_exceeded_error` 的超集，所以**不需要**再去接那个未被调用的函数）。
2. L4444-4475 有一个 context_window 分支，但同时要求 `agent_id == "meta"`、`not self._forced_budget_compact_this_turn`、且 `model_prefers_compact_meta_context(model_name, provider_name)` 为真；它做的是 `force_compact_meta_turn_context()`——**只换系统提示 + 收窄工具池**，完全不动 `session.agent_messages` 里的历史。
3. L4484-4503 有一次 `_context_chain_repair_attempted` 的配对修复重试，只在 sanitize 结果真的变了时才 `continue`。
4. 其余情况：L4504 发一条 ERROR 事件后 **`return`**，整轮任务终止。

结论：当历史本身撑爆窗口（长程任务的典型形态），或当前 agent 是子智能体、或模型不在 `model_prefers_compact_meta_context` 名单里，热路径没有任何「压历史再试」的动作，直接把长任务打断。而 `compactor.maybe_compact(force=True)` 的能力已经存在，L4137-4160 的 `BudgetLevel.COMPRESS` 分支就是现成用法。

## 2. In scope / Out of scope

In scope
- 新建 `agenticx/runtime/harden_flags.py`（FR-0，父规划共享）。
- 在 `agenticx/runtime/agent_runtime.py` 的 `except Exception as exc:` 分支内新增一个 context_window 历史压缩重试分支。
- 对应单测。

Out of scope（严禁顺手改）
- 不把 `agenticx/core/overflow_recovery.py` 的 `OverflowRecoveryPipeline` 搬进 Studio 热路径。
- 不改 `AgentExecutor` / `ContextCompiler` 既有 overflow 路径。
- 不改 `compactor.py` 内部算法。
- 不改 L4444-4475 既有 meta 压缩分支的条件与行为，只在其后追加新分支。
- 不动 `max_tool_rounds` 上限语义（见 §5 已知取舍）。

## 3. FR

### FR-0 共享 flag 模块

新建 `agenticx/runtime/harden_flags.py`，完全照抄 `agenticx/runtime/checkpoint.py` L113-137 `resume_interrupted_enabled()` 的解析顺序（env > `ConfigManager.get_value(<key>)` > 默认），提供：

```python
def overflow_retry_enabled() -> bool:          # AGX_OVERFLOW_RETRY / runtime.overflow_retry, default True
def max_overflow_retries() -> int:             # AGX_MAX_OVERFLOW_RETRIES / runtime.max_overflow_retries, default 2, clamp 0..5
def interrupted_closers_enabled() -> bool:     # AGX_INTERRUPTED_CLOSERS / runtime.interrupted_closers, default True
def persist_fail_closed_enabled() -> bool:     # AGX_PERSIST_FAIL_CLOSED / runtime.persist_fail_closed, default False
def fresh_round_loop_enabled() -> bool:        # AGX_FRESH_ROUND_LOOP / runtime.fresh_round_loop, default False
```

约束：布尔 env 取值集合与 `resume_interrupted_enabled` 一致（`1/true/yes/on` 与 `0/false/no/off`）；`ConfigManager` 导入放在函数体内（该文件既有做法，避免启动期循环导入）；解析异常一律回落默认值，不抛。

### FR-1 per-turn 重试计数器

在 `AgentRuntime.__init__`（`agenticx/runtime/agent_runtime.py`，与 `self._forced_budget_compact_this_turn` 等同类字段相邻，约 L2558 附近）新增 `self._overflow_retries_this_turn: int = 0`。在每轮 turn 起始处（与 `self._forced_budget_compact_this_turn = False` / `self._proactive_compact_this_turn = False` 的重置点同处）重置为 0。

在 LLM 成功返回后清零：`await self.hooks.run_after_model(response, session)`（L4071）之后追加 `self._overflow_retries_this_turn = 0`。

### FR-2 新增 overflow 历史压缩重试分支

位置：`agenticx/runtime/agent_runtime.py`，插在既有 meta 压缩分支之后（当前 L4475 的 `continue` 之后）、`if fault in {"billing", ...}` 计算 `err_text`（当前 L4477）之前。

意图（伪代码）：

```python
if (
    fault == "context_window"
    and overflow_retry_enabled()
    and self._overflow_retries_this_turn < max_overflow_retries()
):
    hist_before = _sanitize_context_messages(session.agent_messages)
    new_hist, did, summary, count, _pending_q = await self.compactor.maybe_compact(
        hist_before, force=True, model=model_name,
    )
    new_hist = _sanitize_context_messages(new_hist) if did else new_hist
    made_progress = bool(did) and len(new_hist) > 1 and len(new_hist) < len(hist_before)
    if made_progress:
        self._overflow_retries_this_turn += 1
        session.agent_messages = new_hist
        messages[:] = [{"role": "system", "content": current_system_prompt}, *list(new_hist)]
        # 与 L4149-4156 完全同款：重新提升附件图片
        try:
            messages = _promote_user_image_attachments(
                messages,
                str(getattr(session, "provider_name", "") or ""),
                str(getattr(session, "model_name", "") or ""),
            )
        except Exception:
            pass
        try:
            await self.hooks.run_on_compaction(count, summary, session)
        except Exception:
            pass
        yield RuntimeEvent(
            type=EventType.ERROR.value,
            data={
                "text": f"上下文超出模型窗口，已压缩历史并重试本轮（{self._overflow_retries_this_turn}/{max_overflow_retries()}）…",
                "severity": "warning",
                "detector": "context_overflow_compact_retry",
                "retryable": True,
            },
            agent_id=agent_id,
        )
        continue
```

细节约束：
- **不要**复用或设置 `self._forced_budget_compact_this_turn`（那是 token budget 分支的闩锁，复用会互相屏蔽）。
- `made_progress` 为假时**不 continue**，让控制流自然落到既有 `_context_chain_repair_attempted` 与最终 ERROR 分支，行为与今天一致。
- 事件类型沿用 `EventType.ERROR` + `severity: "warning"`，与相邻 `detector: "context_budget_compact"` 的既有约定一致，避免新增事件类型影响 Desktop 渲染。
- 该分支对 `agent_id` 不设限（子智能体同样受益），这正是相对既有 meta 分支的增量。
- 流式路径的 overflow 会先在 L3953 `except Exception as stream_exc` 被降级为 invoke 路径，再次抛出后进入本分支，无需另改流式代码。

## 4. AC

新建 `tests/test_smoke_overflow_compact_retry.py`（命名对齐仓库既有 `test_smoke_*`，不依赖真实 LLM）：

- **AC-1**：假 LLM 首次 `invoke` 抛 `RuntimeError("ContextWindowExceededError: maximum context length is 8192 tokens")`，第二次返回一个带 `content` 的对象。断言：`compactor.maybe_compact` 被以 `force=True` 调用至少一次；turn 最终产出 FINAL（不是终止性 ERROR）；`_overflow_retries_this_turn` 在成功后为 0。
- **AC-2**：假 LLM 每次都抛同一 overflow 错误、且 compactor 打桩为「无进展」（返回原历史、`did=False`）。断言：`maybe_compact` 调用次数 ≤ 1（无进展不消耗重试额度），最终 yield 一条 `detector == "context_window"` 的 ERROR 并结束，不出现死循环。
- **AC-3**：假 LLM 持续抛 overflow、compactor 每次都能缩短历史。断言：`detector == "context_overflow_compact_retry"` 的事件数量 == `max_overflow_retries()`（默认 2），之后终止。
- **AC-4**：`AGX_OVERFLOW_RETRY=0` 时，AC-1 的场景退化为直接 ERROR 终止（证明 flag 可回滚）。
- **AC-5**：`tests/test_compactor.py`、`tests/test_smoke_openclaw_overflow_recovery.py`、`tests/test_ha_checkpoint_resume.py` 全绿。

## 5. 已知取舍与风险

- **重试会消耗一个 `round_idx`**：分支用 `continue`，与该 `except` 块内既有的超时重试（L4309）、智谱抖动重试（L4406）、`max_tokens` 降档重试（L4425）行为一致。扩展 `for round_idx in range(...)` 上限属另一个需求，本次明确 out of scope。
- **死循环**：由 `max_overflow_retries()` 硬上限 + `made_progress`（消息数必须下降）双重约束。
- **误压缩丢信息**：压缩后立即 `_sanitize_context_messages`，`len(new_hist) <= 1` 视为无进展，不采用。
- 回滚：`AGX_OVERFLOW_RETRY=0` 或 `runtime.overflow_retry: false`。
