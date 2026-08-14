# 02 · 崩溃续跑合成中断 closer（未开始 / 结果未知）

Planned-with: Opus 5 (Cursor)
Suggested-Impl-Model: Composer 2.5 或便宜代码专精档（如 Kimi Code / GLM）
Parent-Plan: `.cursor/plans/pending/2026-08-14-longrun-runtime-hardening.plan.md`
Gap: G-001（P1）
Depends-on: 子规划 01 的 FR-0（`agenticx/runtime/harden_flags.py`）；若 01 尚未实施，本子规划自行按 01 的 FR-0 规格创建该模块。

## 1. 根因与证据链（不依赖对话记忆）

崩溃续跑链路现状：

1. `agenticx/studio/session_manager.py` L1025 `_resume_single_session()` → L1049-1056 在重入前只做一件上下文处理：`session.agent_messages = _sanitize_context_messages(session.agent_messages)`。
2. `agenticx/runtime/agent_runtime.py` L1417-1516 `_sanitize_context_messages()` 的规则是：assistant 的 `tool_calls` 只在**每个 call id 都有对应 tool 行**时才保留（L1490-1503）；否则 L1504-1511 直接 `msg_copy.pop("tool_calls", None)`，把整段调用意图从上下文里抹掉。
3. `agenticx/runtime/checkpoint.py` L37-41 `RESUME_SYSTEM_HINT` 只笼统告诉模型「未完成的工具调用已从上下文中移除」。
4. `AgentCheckpoint`（同文件 L44-54）已经存有 `pending_tool_calls: list[dict]`，由 `AgentRuntime._write_run_checkpoint()`（`agent_runtime.py` L2672-2710）写入——也就是「崩溃时确实已经发出去」的那批调用 id 是可知的。

后果：模型看不到「我发过 `file_write` 但不知道有没有落盘」和「我压根没开始调用」的区别。前者盲目重试会重复副作用，后者不重试则任务卡住。上游 DeepSeek Harness 的 `packages/core/session/src/repair.ts::interruptedTurnClosers` 正是靠合成 tool 结果把这两种状态显式告知模型（研究证据 E-007 / E-008 / E-022）。

## 2. In scope / Out of scope

In scope
- 新建 `agenticx/runtime/interrupted_closers.py`（纯函数，无 I/O）。
- 在 `agenticx/studio/session_manager.py::_resume_single_session` 的 sanitize **之前**接线。
- 改写 `agenticx/runtime/checkpoint.py` 的 `RESUME_SYSTEM_HINT` 与模块 docstring 中描述 resume 语义的段落（L10-17），让文档与新行为一致。
- 单测。

Out of scope
- 不改 `_sanitize_context_messages` 的任何一条规则（closer 必须让它「自然地」保留 assistant 调用，而不是给它开后门）。
- 不重跑 pending tools（副作用安全，维持现状）。
- 不引入事件源 / JSONL / zstd 会话格式。
- 不在 live 生成路径伪造 turn 结束事件；只在加载/resume 补一次。

## 3. FR

### FR-1 新模块 `agenticx/runtime/interrupted_closers.py`

```python
NOT_STARTED_CONTENT = (
    "[中断] 该工具调用在运行时中断前尚未开始执行，没有产生任何副作用。"
    "如果这一步仍然必要，可以安全地重新调用。"
)
OUTCOME_UNKNOWN_CONTENT = (
    "[中断] 该工具调用已经发出，但运行时在拿到结果前中断，执行结果未知。"
    "禁止直接重试写入类操作；先用只读方式核验外部状态（文件是否已存在、命令是否已生效），"
    "确认未生效后再决定是否重做。"
)
KIND_NOT_STARTED = "interrupted_tool_not_started"
KIND_OUTCOME_UNKNOWN = "interrupted_tool_outcome_unknown"

def close_interrupted_tool_calls(
    messages: Sequence[Dict[str, Any]],
    *,
    dispatched_call_ids: Iterable[str] = (),
) -> List[Dict[str, Any]]:
    ...
```

算法（与 `_sanitize_context_messages` L1476-1489 的扫描方式保持同构，避免两套语义打架）：

1. 顺序遍历 `messages`；非 assistant 或无 `tool_calls` 的行原样输出。
2. 遇到带 `tool_calls` 的 assistant 行：收集其后**连续**的 `role == "tool"` 行，得到 `responded_ids`。
3. 对该 assistant 行里每个有 `id` 的 call，若 id ∉ `responded_ids`，在连续 tool 块之后追加一行：

```python
{
    "role": "tool",
    "tool_call_id": cid,
    "name": <call["function"]["name"] 若可取，否则 "unknown">,
    "content": OUTCOME_UNKNOWN_CONTENT if cid in dispatched else NOT_STARTED_CONTENT,
    "metadata": {"kind": KIND_OUTCOME_UNKNOWN if cid in dispatched else KIND_NOT_STARTED},
}
```

4. 合成行的顺序与 assistant 中 `tool_calls` 的原顺序一致。
5. 幂等：若某 call id 已经有一条 `metadata.kind` 属于上述两个 kind 的 tool 行，则不再重复合成。
6. 纯函数：不修改入参，返回新 list；对 `id` 为空的 call 不合成（sanitizer 也会忽略它们）。

关键约束：`_sanitize_context_messages` L1443-1450 会**丢弃** `metadata.kind` 属于 `turn_interrupted` / `continuation_notice` / `futile_resume_guard` / `clarification` 的 tool 行。新增的两个 kind 不在该名单内，因此合成行会被保留、assistant 的 `tool_calls` 随之被判定为「已配对」而保留。禁止把新 kind 加进那个名单。

### FR-2 resume 路径接线

文件 `agenticx/studio/session_manager.py`，函数 `_resume_single_session`，当前 L1049-1056 的 try 块内，改为先 closer 再 sanitize：

```python
from agenticx.runtime.agent_runtime import _sanitize_context_messages
from agenticx.runtime.harden_flags import interrupted_closers_enabled
from agenticx.runtime.interrupted_closers import close_interrupted_tool_calls

raw = getattr(session, "agent_messages", None) or []
if interrupted_closers_enabled():
    dispatched = [
        str(c.get("id", "")).strip()
        for c in (getattr(checkpoint, "pending_tool_calls", None) or [])
        if isinstance(c, dict) and str(c.get("id", "")).strip()
    ]
    raw = close_interrupted_tool_calls(raw, dispatched_call_ids=dispatched)
session.agent_messages = _sanitize_context_messages(raw)
```

保持外层 `except Exception: _log.debug(...)` 不变（closer 失败不得阻断 resume）。

### FR-3 文案与文档同步

`agenticx/runtime/checkpoint.py`：
- L37-41 `RESUME_SYSTEM_HINT` 改为说明「被中断轮次的工具调用已在上下文中标注为『未开始』或『结果未知』；对标注为结果未知的写入类操作，先核验外部状态再决定是否重做」。
- L10-17 模块 docstring 中「dangling assistant tool_calls are stripped by the sanitizer」这句已不再准确，改为描述 closer + sanitizer 的两步语义。**只改这一段文字**，不要碰同文件其它代码。

## 4. AC

新建 `tests/test_smoke_interrupted_closers.py`：

- **AC-1**：assistant 行含两个 tool_call（`c1`、`c2`），历史中只有 `c1` 的 tool 结果；`dispatched_call_ids=["c2"]`。断言 closer 后 `c2` 得到一条 `kind == interrupted_tool_outcome_unknown` 的 tool 行；再过 `_sanitize_context_messages` 后 assistant 的 `tool_calls` **仍含两个 id**，且每个 id 都有配对 tool 行（provider pairing 合法）。
- **AC-2**：同上但 `dispatched_call_ids=[]`。断言 `c2` 拿到 `interrupted_tool_not_started`，文案含「尚未开始」且不含「禁止直接重试」。
- **AC-3**：`OUTCOME_UNKNOWN_CONTENT` 必须包含「核验」类措辞（正则断言），防止后人改文案时丢掉副作用安全提示。
- **AC-4**：幂等——对同一份已 closer 过的历史再调用一次，输出与第一次完全相等。
- **AC-5**：无 dangling 调用的正常历史，closer 输出与输入逐行相等（零副作用）。
- **AC-6**：`AGX_INTERRUPTED_CLOSERS=0` 时 `_resume_single_session` 行为回退为「只 sanitize」，即 assistant 的未配对 `tool_calls` 被剥离。
- **AC-7**：`tests/test_ha_checkpoint_resume.py` 全绿；若其中有断言依赖「未完成调用被剥离」的旧语义，需在该测试里改为按 flag 显式区分两种期望，并在 diff 里说明这是 FR-2 引起的语义变更（不是顺手改测试）。

## 5. 风险

- **模型盲目重试写操作**：由 `OUTCOME_UNKNOWN_CONTENT` 的核验要求 + AC-3 的文案回归测试兜住。
- **上下文变长**：每个未完成调用多一行短文本，量级可忽略。
- 回滚：`AGX_INTERRUPTED_CLOSERS=0` / `runtime.interrupted_closers: false`。
