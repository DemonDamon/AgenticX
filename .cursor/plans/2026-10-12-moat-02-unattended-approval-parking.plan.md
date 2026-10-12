# Moat-02 · 无人值守受保护操作改为「挂起等审批」

Planned-with: claude-opus-5.5
Suggested-Impl-Model: grok-4.7
Plan-Id: 2026-10-12-moat-02-unattended-approval-parking
Plan-File: `.cursor/plans/2026-10-12-moat-02-unattended-approval-parking.plan.md`
Parent-Plan: `2026-10-12-governed-longrun-moat-master`

> **For implementer:** 独立 worktree，分支 `feat/moat-02-approval-parking`。不要 commit。本子计划会改 `agenticx/studio/server.py`：只允许改 `_resolve_confirm_gate` 函数体和新增一个路由；**import 区一行不动**（新 import 一律写在函数内部）；改完必须冷启动验证（§6）。

## 1. 要解决的问题

定时任务（`avatar_id` 形如 `automation:<task_id>`）和无人值守续跑（payload `unattended_run=True`）走的是：

```1371:1382:agenticx/studio/server.py
    def _resolve_confirm_gate(
        managed: Any,
        agent_id: str = "meta",
        *,
        unattended: bool = False,
    ) -> Any:
        if unattended:
            return RiskAwareAutoConfirmGate(unattended=True)
        managed_gate = managed.get_confirm_gate(agent_id)
        if _global_auto_confirm_enabled():
            return RiskAwareAutoConfirmGate(delegate=managed_gate)
        return managed_gate
```

`RiskAwareAutoConfirmGate(unattended=True)` 对受保护操作**立即返回 False**，记 `decision="blocked_unattended"`（`agenticx/runtime/confirm.py:306-344`）。

后果：「每天 9 点帮我整理并推送周报」这类任务，只要其中一步需要批准（`git push`、发外部消息、桌面操控），这一轮就失败。用户要么放弃这个任务，要么把审批整体关掉。后者是安全倒退。

目标：受保护操作**挂起**等审批，有超时。审批渠道复用现有 `POST /api/confirm`。它能被 Desktop、手机、网关调用；03 负责做 UI。

## 2. 行为规格

| 情形 | 行为 |
|---|---|
| 无人值守 + 低风险（`risk == "low"`） | 自动批准（与现状一致） |
| 无人值守 + 受保护 + 挂起开启（默认） | 在 `parked_approvals` 注册一条；底层 `AsyncConfirmGate` 等待，超时为 `approval_timeout_seconds`（默认 1200s）；期间 `GET /api/approvals/pending` 可见；`POST /api/confirm` 可批准 / 拒绝；无论结果如何都从注册表移除 |
| 挂起超时 | 返回 False；`confirm_denial_note` 返回 `"无人值守等待审批超时（{N} 分钟）"`（N 为四舍五入的分钟数，最少 1） |
| 挂起关闭（`AGX_UNATTENDED_APPROVAL_PARKING=0` 或 config `unattended.approval_parking: false`） | 完全保持现状：`RiskAwareAutoConfirmGate(unattended=True)` |
| 进程崩溃时有挂起项 | 注册表是进程内的，随进程消失；由 HA 续跑 / 01 处理后续，本计划不做持久化 |

默认 1200s 刻意小于定时任务整轮超时 30 分钟（`agenticx/studio/automation_scheduler.py:39` `_DEFAULT_CHAT_TIMEOUT_MS`，Desktop 侧同值）。这样审批超时会先触发，任务以「审批超时」失败，而不是被外层以「执行超时」掐断。

## 3. In scope / Out of scope

**In scope**

1. `agenticx/runtime/confirm.py`：`AsyncConfirmGate.request_confirm` 增加可选关键字参数；新增 `ParkedApprovalConfirmGate`；`confirm_denial_note` 增加一个分支。
2. 新建 `agenticx/runtime/parked_approvals.py`。
3. `agenticx/studio/server.py`：`_resolve_confirm_gate` 函数体；新增 `GET /api/approvals/pending`。
4. 新建 `tests/test_parked_approval_gate.py`。

**Out of scope**

- 不改 `agenticx/runtime/team_manager.py` 的默认 gate（:127、:188）。经 server 的 `confirm_gate_factory` 创建的子智能体 gate 会自动走新逻辑；直接用默认值的路径保持现状。
- 不改 `AutoSuspendClarifyGate`（澄清问题仍立即挂起）。
- 不做 UI、不改手机端、不改网关客户端（03 做）。
- 不持久化挂起项。

## 4. 具体改动

### 4.1 `agenticx/runtime/parked_approvals.py`（新建）

```python
#!/usr/bin/env python3
"""In-process registry of unattended confirmations waiting for a human.

Author: Damon Li
"""

from __future__ import annotations

import os
import threading
import time
from dataclasses import asdict, dataclass
from typing import Any, Dict, List

DEFAULT_APPROVAL_TIMEOUT_SECONDS = 1200
MIN_APPROVAL_TIMEOUT_SECONDS = 60
MAX_APPROVAL_TIMEOUT_SECONDS = 7200


@dataclass
class ParkedApproval:
    request_id: str
    session_id: str
    agent_id: str
    question: str
    tool: str
    risk: str
    protected_reason: str
    label: str          # e.g. "automation:atask_xxx" or avatar id; may be ""
    created_at: float
    expires_at: float


_lock = threading.Lock()
_items: Dict[str, ParkedApproval] = {}


def register(item: ParkedApproval) -> None: ...
def remove(request_id: str) -> None: ...
def list_pending(now: float | None = None) -> List[Dict[str, Any]]: ...
def approval_parking_enabled() -> bool: ...
def approval_timeout_seconds() -> float: ...
```

- `list_pending`：过滤 `expires_at <= now` 的项（同时从字典删掉），按 `created_at` 升序，返回 `asdict` 列表，并给每项加 `remaining_seconds = max(0, int(expires_at - now))`。
- `approval_parking_enabled`：env `AGX_UNATTENDED_APPROVAL_PARKING`（`0/false/no/off` → False，`1/true/yes/on` → True），否则读 `ConfigManager.get_value("unattended.approval_parking")`（函数内 import；异常视为未配置）；默认 **True**。
- `approval_timeout_seconds`：env `AGX_UNATTENDED_APPROVAL_TIMEOUT_SEC` 优先，其次 config `unattended.approval_timeout_seconds`，默认 1200；解析失败用默认；结果 clamp 到 `[60, 7200]`。

### 4.2 `agenticx/runtime/confirm.py`

**(a)** `AsyncConfirmGate.request_confirm`（:204）签名改为：

```python
    async def request_confirm(
        self,
        question: str,
        context: Optional[Dict[str, Any]] = None,
        *,
        timeout_seconds: Optional[float] = None,
    ) -> bool:
```

函数体里 `asyncio.wait_for(future, timeout=self.timeout_seconds)` 改为 `timeout=effective_timeout`，其中 `effective_timeout = timeout_seconds if timeout_seconds and timeout_seconds > 0 else self.timeout_seconds`；`last_timeout_info["timeout_seconds"]` 也写 `effective_timeout`。其余逻辑不动。所有现有调用不传该参数，行为不变。

**(b)** 新增类，放在 `RiskAwareAutoConfirmGate` 之后、`AutoApproveConfirmGate` 之前：

```python
class ParkedApprovalConfirmGate(ConfirmGate):
    """Unattended gate that waits (bounded) for a human on protected requests.

    Low-risk requests are auto-approved exactly like the unattended
    RiskAwareAutoConfirmGate. Protected requests are registered in
    ``agenticx.runtime.parked_approvals`` and awaited on the session's
    managed AsyncConfirmGate so ``POST /api/confirm`` can resolve them.
    """

    def __init__(
        self,
        delegate: "AsyncConfirmGate",
        *,
        session_id: str,
        agent_id: str,
        timeout_seconds: float,
        label: str = "",
    ) -> None: ...

    async def request_confirm(self, question: str, context: Optional[Dict[str, Any]] = None) -> bool: ...
    def should_emit_prompt(self, context: Optional[Dict[str, Any]] = None) -> bool: ...
    def is_service_mode(self) -> bool: ...   # True
    def resolve(self, request_id: str, approved: bool) -> bool: ...  # delegate.resolve
    def export_state(self) -> Dict[str, Any]: ...   # delegate.export_state()
    def restore_state(self, state: Dict[str, Any]) -> None: ...  # delegate.restore_state(state)
```

- 属性 `self._pending = getattr(delegate, "_pending", {})`、`self._pending_meta = getattr(delegate, "_pending_meta", {})`、`self.last_request = None`。原因：`server.py:2733` 的「本会话记住」逻辑会读 `gate._pending_meta`。
- `request_confirm`：
  1. `payload = dict(context or {})`；`if not is_protected_confirm(payload): self.last_request = None; return True`。
  2. `request_id = str(payload.get("request_id") or uuid.uuid4())`；写回 payload。
  3. `from agenticx.runtime import parked_approvals`（函数内 import），`now = time.time()`，`register(ParkedApproval(request_id=..., session_id=self.session_id, agent_id=self.agent_id, question=question, tool=str(payload.get("tool") or ""), risk=str(payload.get("risk") or ""), protected_reason=protected_confirm_reason(payload), label=self.label, created_at=now, expires_at=now + self.timeout_seconds))`。
  4. `try: approved = await self.delegate.request_confirm(question, payload, timeout_seconds=self.timeout_seconds)`，`finally: parked_approvals.remove(request_id)`。
  5. `info = getattr(self.delegate, "last_timeout_info", None)`；若 `info` 是 dict、`info.get("request_id") == request_id`、`not approved`，则 `self.last_request = {"id": request_id, "question": question, "context": payload, "decision": "parked_timeout", "timeout_seconds": self.timeout_seconds}`，否则 `self.last_request = {"id": request_id, "question": question, "context": payload}`。
  6. `return approved`。
- `should_emit_prompt`：`return is_protected_confirm(context)`（需要 SSE 发 `confirm_required`，Desktop 若恰好开着该窗格可行内批）。
- 需要在文件顶部补 `import time`。这是 `confirm.py` 自己的 import 区，不是 server.py，允许改。

**(c)** `confirm_denial_note`（:103-121）：在 `if last.get("decision") == "blocked_unattended":` 分支之后加：

```python
        if last.get("decision") == "parked_timeout":
            seconds = float(last.get("timeout_seconds") or 0)
            minutes = max(1, round(seconds / 60))
            return f"无人值守等待审批超时（{minutes} 分钟）"
```

并保证该分支先于下面的 `last_timeout_info` 判断（否则会被「等待确认超时」抢走）。

### 4.3 `agenticx/studio/server.py`

**(a)** `_resolve_confirm_gate` 函数体改为：

```python
        if unattended:
            from agenticx.runtime.confirm import ParkedApprovalConfirmGate
            from agenticx.runtime.parked_approvals import (
                approval_parking_enabled,
                approval_timeout_seconds,
            )

            if approval_parking_enabled():
                return ParkedApprovalConfirmGate(
                    managed.get_confirm_gate(agent_id),
                    session_id=str(getattr(managed, "session_id", "") or ""),
                    agent_id=agent_id or "meta",
                    timeout_seconds=approval_timeout_seconds(),
                    label=str(getattr(managed, "avatar_id", "") or ""),
                )
            return RiskAwareAutoConfirmGate(unattended=True)
        managed_gate = managed.get_confirm_gate(agent_id)
        if _global_auto_confirm_enabled():
            return RiskAwareAutoConfirmGate(delegate=managed_gate)
        return managed_gate
```

**(b)** 在 `post_confirm`（`@app.post("/api/confirm")`，约 :2717）**之前**新增路由，与其相邻：

```python
    @app.get("/api/approvals/pending")
    async def get_pending_approvals(
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        from agenticx.runtime.parked_approvals import list_pending

        return {"ok": True, "items": list_pending()}
```

`post_confirm` 本身不改。它通过 `managed.get_confirm_gate(agent_id)` 解析，拿到的就是挂起 gate 底下的那个 `AsyncConfirmGate`。子智能体走 `managed.team_manager.get_confirm_gate(agent_id)`，返回的是 factory 建的 `ParkedApprovalConfirmGate`，它的 `resolve` 会转给 delegate。两条路径都通。

## 5. 验收标准（AC）与测试 `tests/test_parked_approval_gate.py`

全部用 `pytest.mark.asyncio`（与仓库现有异步测试一致，先 `rg -n "pytest.mark.asyncio" tests | head -3` 确认用法）。

| AC | 场景 | 断言 |
|---|---|---|
| AC-1 | context `{"risk": "low"}` | 立即 True；`list_pending()` 为空 |
| AC-2 | context `{"risk": "high", "tool": "bash_exec"}`，timeout=5；创建任务后 `await asyncio.sleep(0)` | `list_pending()` 有 1 项，`tool == "bash_exec"`，`session_id`、`agent_id`、`protected_reason` 非空，`remaining_seconds` 在 0–5 之间 |
| AC-3 | AC-2 基础上 `gate.resolve(request_id, True)` | 任务结果 True；`list_pending()` 为空 |
| AC-4 | 直接对 delegate `AsyncConfirmGate.resolve(request_id, False)`（模拟 `/api/confirm` 路径） | 结果 False；注册表清空 |
| AC-5 | timeout=0.05（测试里直接构造，绕过 clamp） | 结果 False；`confirm_denial_note(gate, request_id) == "无人值守等待审批超时（1 分钟）"`；注册表清空 |
| AC-6 | `approval_timeout_seconds()` 在 env 设 `"10"` / `"99999"` / `"abc"` | 分别 60 / 7200 / 1200 |
| AC-7 | `approval_parking_enabled()` 在 env `"0"` | False |
| AC-8 | `AsyncConfirmGate.request_confirm(q, ctx)` 不传 `timeout_seconds` | 仍使用实例 `timeout_seconds`（回归：用 timeout=0.05 实例验证超时生效） |
| AC-9 | `list_pending(now=expires_at + 1)` | 过期项被剔除 |

回归：

```bash
pytest tests/test_parked_approval_gate.py -q
pytest tests -q -k "confirm"
```

## 6. 冷启动验证（强制）

```bash
agx serve --host 127.0.0.1 --port 8765 &
sleep 8
TOKEN=$(cat ~/.agenticx/serve.token 2>/dev/null)
for p in /api/session /api/avatars /api/sessions /api/approvals/pending; do
  curl --noproxy '*' -s -o /dev/null -w "%{http_code} $p\n" -H "x-agx-desktop-token: $TOKEN" "http://127.0.0.1:8765$p"
done
```

四个都应为 200（`/api/session` 若需 query 参数返回 422 也可接受，但不得 500 或连不上）。汇报里贴输出。另用 `git diff agenticx/studio/server.py` 确认 import 区零改动。
