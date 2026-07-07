# 子智能体完成判定三次修复：升级重试不带记忆导致空转 44 分钟

Planned-with: claude-4.6-sonnet

> 背景：v1（`.cursor/plans/2026-07-07-subagent-must-complete-fix.plan.md`）修复了 cp/mv 产物检测；v2（`.cursor/plans/2026-07-07-subagent-completion-accuracy-v2.plan.md`）修复了声明路径误判与 `keep_rounds` 过短。v2 上线后重跑同一批招聘任务，会话 `e367ef7a-f2fc-4e13-bd48-fefb81fb78ef` 中 `sa-db15d311`（项目经理筛选）判定结果已**正确**（`FAILED`，不再假完成），但暴露了 v2 未覆盖的第三个根因：**升级重试（escalation retry）不携带任何记忆，导致每次重试都从零重新解析全部文档**。

## 0. 证据

`sa-db15d311.json`：
- `status_history`: `running`(12:07:07) → `completed`(12:15:14，第 1 次尝试结束) → `failed`(12:51:41，熔断)，跨度 44 分钟
- `error_text`: `Circuit-breaker: 4 consecutive failures. Last error: Task completed without file artifact...`

`sa-db15d311.activity.jsonl` 统计（11 份简历）：
- `liteparse` 调用共 **95 次**（远超合理值 11~22 次）
- 3 份文件被解析 18~21 次，其余 8 份各 5 次

代码复核 `team_manager.py:1231-1250`（`_run_subagent`）：

```231:1250:agenticx/runtime/team_manager.py
    async def _run_subagent(
        self,
        context: SubAgentContext,
        *,
        allowed_tools: Sequence[Dict[str, Any]],
        resume_input: Optional[str] = None,
    ) -> None:
        existing_session = self._agent_sessions.get(context.agent_id)
        if context.mode == "session" and existing_session is not None:
            session = existing_session
        else:
            session = self._build_isolated_session(workspace_dir=context.workspace_dir)
            ...
```

`spawn_subagent` 默认 `mode="run"`，因此**每次 `_auto_escalate` 触发重试/升级都会重新 `_build_isolated_session`**——全新 `chat_history`，没有任何前序已解析内容或已生成评分的记忆。`_resolve_max_escalation()`（`team_manager.py:103-111`）默认允许 **3 次重试 + 1 次原始尝试 = 4 次全量重跑**，每次都重新解析全部 11 份 PDF，最终 44 分钟耗尽仍无产出，触发熔断判 FAILED。

**根因 C**：升级重试策略"从零重跑"对批量文档类任务是灾难性的——不仅没有提高成功率，反而线性放大失败成本（4× 全量重新解析），且用户要多等 3 倍时间才能看到明确失败信号。

## 1. 目标与范围（用户已确认方案：限制重试次数为 1 次）

### In scope
- `agenticx/runtime/team_manager.py`：`_resolve_max_escalation()` 默认值从 `3` 降为 `1`（1 次原始尝试 + 1 次重试，共 2 次全量尝试后熔断，不再有"escalation"升级重试这一档）
- 熔断失败文案：在 `error_text` 中补充明确的人工介入指引（当前已产出的部分解析结论不会丢失——已解析内容仍在 `agent_messages` 但会话已结束，需提示用户可重新触发或缩小批量）

### Out of scope
- 不实现"跨重试携带部分进度"的记忆传递机制（改动面大，涉及新的状态序列化协议，需单独立项）
- 不改 `mode="run"` 默认新建 session 的机制本身
- 不改 v1/v2 已落地的声明路径校验与 `keep_rounds` 逻辑

## 2. 需求（FR / AC）

- **FR-G1**：`_resolve_max_escalation()` 默认值 `3 → 1`。保留 `AGX_SUBAGENT_MAX_ESCALATION` 环境变量覆盖（`max(1, int(raw))` 下限保持 1，逻辑不变）。
- **FR-G2**：熔断分支（`team_manager.py:1621-1629`）的 `error_text` 追加一句明确指引，说明「已减少重试次数以避免长时间空转；如需完成，请缩小单次批量或重新触发任务」。
- **AC-G1**：新增单测验证 `_resolve_max_escalation()` 默认返回 `1`。
- **AC-G2**：新增单测验证熔断 `error_text` 包含"缩小"或"重新触发"关键词。
- **AC-G3**：`_auto_escalate` 在 `failure_count > max_escalation`（即第 2 次失败）时直接进入熔断分支，不再触发 escalation_task 分支（`failure_count <= 2` 的判断需要与新默认值联动核实不产生越界）。

## 3. 实现细节

### 3.1 `_resolve_max_escalation` 默认值

**文件**：`agenticx/runtime/team_manager.py:103-111`

```python
# before
    return 3

# after
    return 1
```

### 3.2 熔断错误文案

**文件**：`agenticx/runtime/team_manager.py:1625-1628`

```python
# before
            context.error_text = (
                f"Circuit-breaker: {context.failure_count} consecutive failures. "
                f"Last error: {context.error_text}"
            )

# after
            context.error_text = (
                f"Circuit-breaker: {context.failure_count} consecutive failures. "
                f"Last error: {context.error_text} "
                "建议：缩小单次任务的文档/数据批量后重新触发，"
                "或直接向用户确认是否需要人工介入完成剩余部分。"
            )
```

### 3.3 测试

新增到 `tests/test_smoke_subagent_completion.py`：

```python
def test_max_escalation_default_is_1(monkeypatch):
    from agenticx.runtime import team_manager as tm
    monkeypatch.delenv("AGX_SUBAGENT_MAX_ESCALATION", raising=False)
    assert tm._resolve_max_escalation() == 1


def test_max_escalation_env_override(monkeypatch):
    from agenticx.runtime import team_manager as tm
    monkeypatch.setenv("AGX_SUBAGENT_MAX_ESCALATION", "5")
    assert tm._resolve_max_escalation() == 5
```

## 4. 验证方案

1. `pytest tests/test_smoke_subagent_completion.py tests/test_team_manager.py tests/test_enhanced_spawn.py -q` 全绿
2. 手动回归：重跑招聘任务，若某职位在 2 次全量尝试（≈ 15 分钟内）仍未完成，应快速判 FAILED 并给出缩小批量的建议，而非空转 44 分钟

## 5. 提交计划

- commit `fix(subagent): 限制升级重试次数为1次，避免批量文档任务空转重复解析`
- `Plan-Id: 2026-07-07-subagent-escalation-cap-v3`
- `Plan-File: .cursor/plans/2026-07-07-subagent-escalation-cap-v3.plan.md`
- `Plan-Model: claude-4.6-sonnet`
- `Impl-Model: <待定>`
- `Made-with: Damon Li`

## 6. 风险

- 重试次数减少后，原本"重试一次就能碰巧成功"的偶发失败（如网络抖动）容错性降低；但鉴于批量文档类任务失败的主因是轮次预算不足而非偶发抖动，重试并不能真正解决问题，只会线性放大等待时间，故本次以"快速失败 + 明确指引"为优先。
- 本次不解决"跨重试携带进度"的根本问题，如后续仍出现类似批量任务因预算不足而失败的情况，需要专项设计状态传递机制（记录 in scope 之外）。
