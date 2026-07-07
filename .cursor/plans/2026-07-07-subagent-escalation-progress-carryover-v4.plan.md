# 子智能体升级重试携带记忆：复用 context.agent_messages 避免重跑重新解析

Planned-with: claude-4.6-sonnet
Suggested-Impl-Model: gpt-5.5-codex（现有基础设施改造，非新协议设计，纯后端逻辑，风险中等需仔细核对时序）

> 背景：`.cursor/plans/2026-07-07-subagent-escalation-cap-v3.plan.md`（v3）已把升级重试次数从 3 次降到 1 次，避免长时间空转，但**没有解决"重试从零开始重新解析所有文档"这个根因**——只是把代价从 4 次全量重跑降到 2 次。本 plan 补上"重试携带已完成进度"的机制。v3 plan 原本把这个机制标为"改动面大，需要新的状态序列化协议，需单独立项"，但代码复核发现：**该机制已有九成基础设施**（`context.agent_messages` + `_rebuild_agent_session`），只是 `_run_subagent` 的重试路径没有复用它。本 plan 是一次**低风险的接线修复**，而非从零设计新协议。

---

## 0. 复核证据：基础设施已存在，只是没接上

**证据 1**：`_run_subagent` 每次运行结束（无论成功失败）都会把完整消息历史存回 `context.agent_messages`：

```1449:1449:agenticx/runtime/team_manager.py
            context.agent_messages = list(session.agent_messages)
```

这发生在 `finally` 块内，**在 `_auto_escalate` 被调用之前**（`_auto_escalate` 在同一 `finally` 块的第 1526 行才被调用），所以触发重试时 `context.agent_messages` 已经是包含本轮全部工具调用（含已解析的简历内容、已生成的评分文字）的完整历史。

**证据 2**：紧接着同一 `finally` 块会把该 agent 的会话从缓存中移除：

```1519:1520:agenticx/runtime/team_manager.py
            if context.mode != "session" or context.cleanup == "delete":
                self._agent_sessions.pop(context.agent_id, None)
```

招聘任务子智能体默认 `mode="run"`，所以这里**必然**执行 pop，缓存中的 session 对象被清空。

**证据 3**：`_auto_escalate` 触发的重试直接调用 `_run_subagent(context, allowed_tools=..., resume_input=retry_task)`（`team_manager.py:1662-1668`），进入 `_run_subagent` 顶部的会话构建逻辑：

```1238:1250:agenticx/runtime/team_manager.py
        existing_session = self._agent_sessions.get(context.agent_id)
        if context.mode == "session" and existing_session is not None:
            session = existing_session
        else:
            session = self._build_isolated_session(workspace_dir=context.workspace_dir)
            session.context_files.update(context.context_files)
            session.artifacts.update(context.artifacts)
            setattr(session, "_team_manager", self)
            if context.attachments:
                session.scratchpad.update(
                    {f"attachment::{k}": v for k, v in context.attachments.items()}
                )
            self._agent_sessions[context.agent_id] = session
```

因为 `context.mode == "run"`（不等于 `"session"`），且缓存已被 pop 为 `None`，**必然走 else 分支重建一个全新 `StudioSession`**——这个新 session 的 `agent_messages` 是空列表（`StudioSession.__init__` 默认值），`context.agent_messages` 里保存的完整历史**完全没有被读取**。这就是"重试从零开始"的直接代码原因。

**证据 4**：项目里已经有一模一样的场景在正确处理——用户对已完成/失败的子智能体追问（`send_message` → `_ensure_agent_session` → `_rebuild_agent_session`）：

```742:755:agenticx/runtime/team_manager.py
    def _rebuild_agent_session(self, context: SubAgentContext) -> StudioSession:
        """Rebuild a session from saved context (used when resuming completed/failed agents)."""
        session = self._build_isolated_session(workspace_dir=context.workspace_dir)
        session.context_files.update(context.context_files)
        session.artifacts.update(context.artifacts)
        if context.agent_messages:
            session.agent_messages = list(context.agent_messages)
        if context.attachments:
            session.scratchpad.update(
                {f"attachment::{k}": v for k, v in context.attachments.items()}
            )
        setattr(session, "_team_manager", self)
        self._agent_sessions[context.agent_id] = session
        return session
```

这个函数**已经实现了"重建会话 + 恢复历史消息"**，只是 `_run_subagent` 内部重试路径的 else 分支（第 1242-1250 行）没有调用它、也没有做同等的 `session.agent_messages = list(context.agent_messages)` 赋值。

**结论**：本次修复不需要设计新的状态序列化协议，只需让 `_run_subagent` 在"这是一次重试"（`context.agent_messages` 已非空）时，复用已有的 `_rebuild_agent_session` 逻辑或等价地补上 `session.agent_messages` 赋值。

---

## 1. 目标与范围

### In scope
- `agenticx/runtime/team_manager.py`：`_run_subagent` 顶部会话构建逻辑（第 1238-1250 行），当 `context.agent_messages` 非空时，让新建的 isolated session 复用这些历史消息，避免升级重试从零重新解析已处理过的文档
- `tests/`：新增冒烟测试验证该行为

### Out of scope
- 不改变 `_auto_escalate` 的重试触发条件、次数、熔断文案（v3 已定，本次不动）
- 不改 `mode="session"` 路径（该路径本来就复用 `existing_session`，不受影响）
- 不引入跨进程持久化的"部分进度"序列化格式（`context.agent_messages` 本身已经是内存态的完整历史，够用，不需要额外落盘协议）
- 不处理"消息历史无限增长导致上下文溢出"的通用问题（`context_budget.py` 的既有压缩机制独立生效，本次不改）

---

## 2. 需求（FR / AC）

- **FR-H1**：在 `_run_subagent` 的 else 分支（新建 isolated session 时），若 `context.agent_messages` 非空，则设置 `session.agent_messages = list(context.agent_messages)`，使重试的模型能看到上一次尝试里已经解析过的文件内容和已生成的部分结论，不需要重新调用 `liteparse`。
- **FR-H2**：`retry_task` / `escalation_task` 的措辞需要相应调整——现有文案是"Previous attempt failed with: ... Original task: ..."（暗示这是全新开始）；应改为强调"你的历史消息中已包含此前的工作进度，请直接检查哪些文件已经解析过、哪些结论已经得出，只需完成剩余部分，不要重复解析已处理的文件"。
- **AC-H1**：新增单测：构造一个带有非空 `agent_messages` 的 `SubAgentContext`，验证 `_run_subagent` 内部用于新建 session 的代码路径确实把 `context.agent_messages` 复制进了新 session（可通过抽取一个小的纯函数 `_seed_session_history(session, context)` 来做单元测试，见 §3.2）。
- **AC-H2**：`retry_task` / `escalation_task` 文案包含"已包含此前的工作进度"或等价关键词的断言测试。
- **NFR-H1**：首次 spawn（`context.agent_messages` 为空列表）时行为不变——`session.agent_messages` 保持默认空列表，不受本次改动影响（零误伤）。

---

## 3. 实现细节（Composer 2.5 零上下文可直接照抄）

### 3.1 `_run_subagent` 复用历史消息

**文件**：`agenticx/runtime/team_manager.py`
**位置**：第 1238-1250 行（else 分支内）

```python
# ---------- before ----------
        existing_session = self._agent_sessions.get(context.agent_id)
        if context.mode == "session" and existing_session is not None:
            session = existing_session
        else:
            session = self._build_isolated_session(workspace_dir=context.workspace_dir)
            session.context_files.update(context.context_files)
            session.artifacts.update(context.artifacts)
            setattr(session, "_team_manager", self)
            if context.attachments:
                session.scratchpad.update(
                    {f"attachment::{k}": v for k, v in context.attachments.items()}
                )
            self._agent_sessions[context.agent_id] = session
```

```python
# ---------- after ----------
        existing_session = self._agent_sessions.get(context.agent_id)
        if context.mode == "session" and existing_session is not None:
            session = existing_session
        else:
            session = self._build_isolated_session(workspace_dir=context.workspace_dir)
            session.context_files.update(context.context_files)
            session.artifacts.update(context.artifacts)
            setattr(session, "_team_manager", self)
            if context.attachments:
                session.scratchpad.update(
                    {f"attachment::{k}": v for k, v in context.attachments.items()}
                )
            self._seed_session_history(session, context)
            self._agent_sessions[context.agent_id] = session
```

紧跟 `_rebuild_agent_session`（`team_manager.py:742-755`）之后新增静态方法：

```python
    @staticmethod
    def _seed_session_history(session: StudioSession, context: "SubAgentContext") -> None:
        """Carry forward prior agent_messages into a freshly built session.

        Used when retrying/escalating a failed sub-agent so the model retains
        memory of already-parsed files and already-derived conclusions instead
        of restarting from a blank context (which forces full re-parsing of
        every document on each retry).
        """
        if context.agent_messages:
            session.agent_messages = list(context.agent_messages)
```

同时把 `_rebuild_agent_session`（`team_manager.py:747-748`）里重复的两行替换为对该静态方法的调用，避免逻辑漂移：

```python
# ---------- before（_rebuild_agent_session 内） ----------
        if context.agent_messages:
            session.agent_messages = list(context.agent_messages)

# ---------- after ----------
        self._seed_session_history(session, context)
```

### 3.2 重试/升级文案调整

**文件**：`agenticx/runtime/team_manager.py`，`_auto_escalate` 内两处任务文案（约 L1639-1645 与 L1685-1692）

```python
# ---------- before（retry_task，约 L1639-1645） ----------
            retry_task = (
                f"RETRY (attempt {context.failure_count}/{max_escalation}): "
                f"Previous attempt failed with: {error_summary}\n\n"
                f"Original task: {context.task}\n\n"
                "Focus on the core objective. Simplify your approach and avoid "
                "repeating the actions that caused the failure."
            )
```

```python
# ---------- after ----------
            retry_task = (
                f"RETRY (attempt {context.failure_count}/{max_escalation}): "
                f"Previous attempt failed with: {error_summary}\n\n"
                f"Original task: {context.task}\n\n"
                "你的历史消息中已包含此前的工作进度（已解析的文件内容、已生成的部分结论）。"
                "请先检查哪些文件/条目已经处理过、哪些结论已经得出，"
                "只需完成剩余未处理的部分并产出最终文件，不要重复解析已处理过的文件。"
            )
```

```python
# ---------- before（escalation_task，约 L1685-1692） ----------
        escalation_task = (
            f"ESCALATION (attempt {context.failure_count}/{max_escalation}): "
            f"Previous {context.failure_count - 1} attempts all failed.\n"
            f"Last error: {error_summary}\n\n"
            f"Original task: {context.task}\n\n"
            "This is an escalated retry. Take a completely different approach. "
            "Analyze why previous attempts failed and devise a new strategy."
        )
```

```python
# ---------- after ----------
        escalation_task = (
            f"ESCALATION (attempt {context.failure_count}/{max_escalation}): "
            f"Previous {context.failure_count - 1} attempts all failed.\n"
            f"Last error: {error_summary}\n\n"
            f"Original task: {context.task}\n\n"
            "你的历史消息中已包含此前的工作进度（已解析的文件内容、已生成的部分结论）。"
            "这是升级重试：请分析之前失败的原因，但不要重新解析已经处理过的文件，"
            "直接基于已有结论完成剩余部分。"
        )
```

> 注：由于 v3 已将 `max_escalation` 默认降为 1，`failure_count <= 2` 分支（retry_task）在默认配置下是唯一会被触发的路径；`escalation_task` 分支仅在用户通过 `AGX_SUBAGENT_MAX_ESCALATION` 环境变量调大重试次数时才会用到，仍需同步修正保持一致性。

### 3.3 测试

新增到 `tests/test_smoke_subagent_completion.py`：

```python
def test_seed_session_history_copies_messages():
    from agenticx.runtime.team_manager import AgentTeamManager, SubAgentContext
    from agenticx.cli.studio import StudioSession

    m = _mgr()
    prior_messages = [
        {"role": "user", "content": "task"},
        {"role": "assistant", "content": "解析了简历A：评分8分"},
    ]
    ctx = SubAgentContext(
        agent_id="sa-test", name="t", role="worker", task="read docs",
        agent_messages=prior_messages,
    )
    session = StudioSession()
    AgentTeamManager._seed_session_history(session, ctx)
    assert session.agent_messages == prior_messages
    # 未修改原始列表（防止别名污染）
    session.agent_messages.append({"role": "user", "content": "extra"})
    assert len(ctx.agent_messages) == 2


def test_seed_session_history_noop_when_empty():
    from agenticx.runtime.team_manager import AgentTeamManager, SubAgentContext
    from agenticx.cli.studio import StudioSession

    m = _mgr()
    ctx = SubAgentContext(agent_id="sa-test2", name="t", role="worker", task="read docs")
    session = StudioSession()
    original = session.agent_messages
    AgentTeamManager._seed_session_history(session, ctx)
    assert session.agent_messages == original
```

### 3.4 落点清单（Composer 2.5 checklist）
- [ ] `team_manager.py` 新增 `_seed_session_history` 静态方法（3.1）
- [ ] `team_manager.py` `_run_subagent` else 分支调用 `_seed_session_history`（3.1）
- [ ] `team_manager.py` `_rebuild_agent_session` 复用 `_seed_session_history`，去重复逻辑（3.1）
- [ ] `team_manager.py` `retry_task` 文案更新（3.2）
- [ ] `team_manager.py` `escalation_task` 文案更新（3.2）
- [ ] `tests/test_smoke_subagent_completion.py` 追加 2 条测试（3.3）

---

## 4. 验证方案

1. 单测：`pytest tests/test_smoke_subagent_completion.py tests/test_tool_result_budget_defaults.py tests/test_team_manager.py tests/test_enhanced_spawn.py -q` 全绿。
2. 手动回归：重跑触发本次问题的招聘任务（项目经理 11 份），若第一次尝试因预算耗尽在解析到第 N 份时失败，触发的唯一 1 次重试应能：
   - 观察到模型在 system/历史消息中已经"看到"前 N 份文件的解析结果，不再对它们重新调用 `liteparse`
   - 只需处理剩余 (11-N) 份并直接产出评估报告
   - `liteparse` 总调用次数应显著低于此前的 95 次（理想：接近 11~15 次，即"总文件数 + 少量必要的二次确认"）

## 5. 提交计划

- commit `feat(subagent): 升级重试复用历史消息，避免重复解析已处理文档`
- `Plan-Id: 2026-07-07-subagent-escalation-progress-carryover-v4`
- `Plan-File: .cursor/plans/2026-07-07-subagent-escalation-progress-carryover-v4.plan.md`
- `Plan-Model: claude-4.6-sonnet`
- `Impl-Model: <待定>`
- `Made-with: Damon Li`

## 6. 风险

- **上下文膨胀**：携带完整历史消息重试，会让 retry 这一轮的起始 prompt 显著变长（尤其是之前已解析的多份 liteparse 大结果，如果尚未被 `tool_result_budget` 归档）。缓解：v2 已有的 `keep_rounds=8` 归档机制在历史消息层面依然生效（归档判断基于消息内容标记，不依赖 session 是否新建）；此外 v3 已将重试次数限制为 1 次，膨胀不会跨多轮累积。
- **归档 round 计数错位**：新的 `AgentRuntime` 实例（`team_manager.py:1260` 附近）在重试时重新创建，其内部 round 计数器从 0 开始，而历史消息里的 `tool_result_budget` 元数据 `round_idx` 是相对上一次运行记录的。需要在实施后人工验证：拼接历史后第一轮 `apply_tool_result_budget` 计算 `age = current_round(=0) - meta.round_idx(>0)` 得到**负数**，不会被误判超过 `keep_rounds` 而重复归档或提前放行，属于安全的一侧（即最多是"该轮不归档"，不会导致内容丢失或异常报错）。若观察到异常需要追加单测锁定该边界行为，但本轮不预先改动 `tool_result_budget.py` 的计数逻辑（out of scope，避免过度设计）。
- **`_rebuild_agent_session` 复用点改动**：抽取 `_seed_session_history` 后其调用点从"内联赋值"变成"方法调用"，语义完全等价（同样的 `if context.agent_messages: session.agent_messages = list(context.agent_messages)`），回归风险低，但仍需保留 AC 测试锁定行为不变。
