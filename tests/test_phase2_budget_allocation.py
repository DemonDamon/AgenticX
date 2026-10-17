#!/usr/bin/env python3
"""Phase 2 budget-allocation unit tests (P2.1/P2.2/P2.3).

Covers: budget notices + session ratio, live round iterator, exploration
lock denial, file_read budget preflight, plan pending-todo counting, and
the per-turn rounds relax latch semantics.
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from agenticx.cli.agent_tools import (
    _budget_locked_explore_denial,
    _budget_preflight_file_read,
    _estimate_content_tokens,
)
from agenticx.runtime.agent_runtime import _LiveRoundIterator, AgentRuntime
from agenticx.runtime.plan_artifacts import (
    count_active_plan_pending_todos,
    create_plan_artifact,
    update_plan_artifact,
)
from agenticx.runtime.token_budget import TokenBudgetGuard


# ---------------------------------------------------------------------------
# P2.1a: token budget notices
# ---------------------------------------------------------------------------


def test_session_ratio_reports_usage_fraction() -> None:
    guard = TokenBudgetGuard(max_tokens_per_session=1000, max_tokens_per_turn=500)
    guard.cumulative_input = 400
    guard.cumulative_output = 200
    assert guard.session_ratio() == 0.6


def test_session_ratio_zero_when_unlimited() -> None:
    guard = TokenBudgetGuard(max_tokens_per_session=0, max_tokens_per_turn=0)
    # max_session <= 0 falls back to resolved config; force zero for the test
    guard.max_session = 0
    assert guard.session_ratio() == 0.0


def test_convergence_hint_carries_hard_lock_semantics() -> None:
    guard = TokenBudgetGuard(max_tokens_per_session=1000, max_tokens_per_turn=500)
    guard.cumulative_input = 850
    hint = guard.convergence_hint()
    assert "EXPLORATION IS LOCKED" in hint
    assert "85%" in hint
    assert "will be rejected" in hint


def test_explore_budget_notice_mentions_structure() -> None:
    guard = TokenBudgetGuard(max_tokens_per_session=1000, max_tokens_per_turn=500)
    guard.cumulative_input = 550
    guard.cumulative_output = 50
    notice = guard.explore_budget_notice()
    assert "60%" in notice
    assert "<=60%" in notice
    assert ">=30%" in notice


# ---------------------------------------------------------------------------
# P2.3a: live round iterator + relax latch
# ---------------------------------------------------------------------------


class _FakeRuntime:
    def __init__(self, cap: int) -> None:
        self.max_tool_rounds = cap


def test_live_round_iterator_extends_when_cap_raised_midway() -> None:
    runtime = _FakeRuntime(cap=3)
    rounds: list[int] = []
    for idx, round_idx in enumerate(_LiveRoundIterator(runtime, 1)):  # type: ignore[arg-type]
        rounds.append(round_idx)
        if idx == 0:
            runtime.max_tool_rounds = 5  # relax during round 1
    assert rounds == [1, 2, 3, 4, 5]


def test_live_round_iterator_respects_original_cap_without_relax() -> None:
    runtime = _FakeRuntime(cap=3)
    assert list(_LiveRoundIterator(runtime, 1)) == [1, 2, 3]  # type: ignore[arg-type]


def test_live_round_iterator_resume_start_round() -> None:
    runtime = _FakeRuntime(cap=5)
    assert list(_LiveRoundIterator(runtime, 4)) == [4, 5]  # type: ignore[arg-type]


def test_rounds_relax_latch_defaults_false_and_resets_per_turn() -> None:
    # The latch must start off per runtime so each new turn gets one relax.
    runtime = AgentRuntime.__new__(AgentRuntime)
    assert runtime._rounds_relaxed is False  # type: ignore[attr-defined]


def test_count_pending_todos_reads_todo_manager() -> None:
    from agenticx.runtime.todo_manager import TodoManager

    manager = TodoManager()
    manager.update(
        [
            {"content": "a", "status": "completed"},
            {"content": "b", "status": "in_progress"},
            {"content": "c", "status": "pending"},
        ]
    )
    session = SimpleNamespace(todo_manager=manager, session_id="no-plan-session")
    fake_runtime = SimpleNamespace()
    # Call unbound: only uses `session`, no runtime state.
    pending = AgentRuntime._count_pending_todos(fake_runtime, session)  # type: ignore[arg-type]
    assert pending == 2


def test_count_pending_todos_reads_active_plan_artifact(tmp_path) -> None:
    session = SimpleNamespace(workspace_dir=str(tmp_path), session_id="plan-session")
    result = create_plan_artifact(
        session,
        {
            "name": "评标任务",
            "overview": "读取 10 份标书并输出评分",
            "todos": [
                {"id": "t1", "content": "读文档 1"},
                {"id": "t2", "content": "读文档 2"},
                {"id": "t3", "content": "写评分报告"},
            ],
            "body_markdown": "# plan",
        },
    )
    import json

    payload = json.loads(result)
    assert count_active_plan_pending_todos(session) == 3

    update_plan_artifact(
        session,
        {
            "plan_id": payload["plan_id"],
            "plan_path": payload["path"],
            "action": "set_todo",
            "todo_id": "t1",
            "todo_status": "completed",
        },
    )
    assert count_active_plan_pending_todos(session) == 2

    update_plan_artifact(
        session,
        {
            "plan_id": payload["plan_id"],
            "plan_path": payload["path"],
            "action": "set_todo",
            "todo_id": "t2",
            "todo_status": "completed",
        },
    )
    update_plan_artifact(
        session,
        {
            "plan_id": payload["plan_id"],
            "plan_path": payload["path"],
            "action": "set_todo",
            "todo_id": "t3",
            "todo_status": "completed",
        },
    )
    # All todos completed -> plan completed -> no pending signal.
    assert count_active_plan_pending_todos(session) == 0


# ---------------------------------------------------------------------------
# P2.1c: exploration lock denial
# ---------------------------------------------------------------------------


def _locked_session() -> SimpleNamespace:
    return SimpleNamespace(
        scratchpad={
            "budget_pct": "82",
            "budget_remaining": "90000",
            "budget_max": "500000",
            "budget_locked": "1",
        }
    )


def test_explore_denial_blocks_file_read_when_locked() -> None:
    denial = _budget_locked_explore_denial("file_read", {"path": "/tmp/x"}, _locked_session())
    assert denial is not None
    assert "[budget-guard]" in denial


def test_explore_denial_blocks_bash_read_commands_when_locked() -> None:
    session = _locked_session()
    assert _budget_locked_explore_denial(
        "bash_exec", {"command": "cat big.md"}, session
    ) is not None
    assert _budget_locked_explore_denial(
        "bash_exec", {"command": "grep -r TODO ."}, session
    ) is not None
    # Write-ish commands still allowed.
    assert (
        _budget_locked_explore_denial(
            "bash_exec", {"command": "python3 build_report.py"}, session
        )
        is None
    )


def test_explore_denial_never_blocks_writes_or_plans() -> None:
    session = _locked_session()
    for tool in ("file_write", "file_edit", "plan_update", "todo_write", "codegen"):
        assert _budget_locked_explore_denial(tool, {}, session) is None


def test_explore_denial_inactive_without_lock() -> None:
    session = SimpleNamespace(
        scratchpad={"budget_pct": "42", "budget_locked": "0"}
    )
    assert _budget_locked_explore_denial("file_read", {}, session) is None
    # No watermark at all (turn not started / no budget published).
    assert _budget_locked_explore_denial("file_read", {}, SimpleNamespace()) is None
    assert _budget_locked_explore_denial("file_read", {}, None) is None


# ---------------------------------------------------------------------------
# P2.2: file_read budget preflight
# ---------------------------------------------------------------------------


def test_estimate_content_tokens_cjk_heavier_than_ascii() -> None:
    ascii_est = _estimate_content_tokens("abcdefghij" * 10)  # 100 ascii chars
    cjk_est = _estimate_content_tokens("中文内容测试" * 10)  # 60 cjk chars
    assert ascii_est == 25
    assert cjk_est == 60


def test_preflight_none_when_budget_watermark_absent(tmp_path) -> None:
    target = tmp_path / "big.md"
    target.write_text("内容" * 5000, encoding="utf-8")
    assert _budget_preflight_file_read(None, target, target.read_text()) is None
    assert (
        _budget_preflight_file_read(SimpleNamespace(), target, target.read_text())
        is None
    )


def test_preflight_none_when_file_fits_budget(tmp_path) -> None:
    target = tmp_path / "small.md"
    target.write_text("hello world", encoding="utf-8")
    session = SimpleNamespace(scratchpad={"budget_remaining": "400000", "budget_pct": "10"})
    assert _budget_preflight_file_read(session, target, target.read_text()) is None


def test_preflight_degrades_large_read_with_report(tmp_path) -> None:
    target = tmp_path / "big.md"
    body = "\n".join(f"第 {i} 行内容" for i in range(1, 4001))
    target.write_text(body, encoding="utf-8")
    session = SimpleNamespace(
        scratchpad={"budget_remaining": "20000", "budget_pct": "96"}
    )
    report = _budget_preflight_file_read(session, target, body)
    assert report is not None
    assert report.startswith("[budget-guard]")
    assert "总行数: 4000" in report
    assert "code_outline" in report
    assert "start_line/end_line" in report
    # Head preview capped at 200 lines.
    assert "1|第 1 行内容" in report
    assert "200|" in report
    assert "201|" not in report


def test_file_read_tool_returns_degraded_report_under_budget_pressure(
    monkeypatch, tmp_path
) -> None:
    """Whole-file read through _tool_file_read degrades instead of dumping content."""
    import agenticx.cli.agent_tools as tools

    target = tmp_path / "big.md"
    body = "\n".join(f"行 {i}" for i in range(1, 3001))
    target.write_text(body, encoding="utf-8")
    monkeypatch.setattr(
        tools, "_resolve_workspace_path", lambda p, session=None, **_kw: Path(p)
    )
    session = SimpleNamespace(
        scratchpad={"budget_remaining": "8000", "budget_pct": "98"},
        file_state_tracker=None,
    )
    result = tools._tool_file_read({"path": str(target)}, session)
    assert result.startswith("[budget-guard]")
    assert "已降级读取" in result
    # Full content must NOT be returned: head preview only (3000 -> 200 lines).
    assert "行 2500" not in result
    assert "行 200" in result


# ---------------------------------------------------------------------------
# P2.3b: request-level round override protocol
# ---------------------------------------------------------------------------


def test_chat_request_accepts_max_tool_rounds_override() -> None:
    from agenticx.studio.protocols import ChatRequest

    req = ChatRequest(session_id="s", user_input="hi", max_tool_rounds=25)
    assert req.max_tool_rounds == 25
    default_req = ChatRequest(session_id="s", user_input="hi")
    assert default_req.max_tool_rounds is None


# ---------------------------------------------------------------------------
# run_turn integration: watermark + 60% hint + 80% lock publish (P2.1b)
# ---------------------------------------------------------------------------


class _FakeResponse:
    def __init__(self, content: str, tool_calls) -> None:
        self.content = content
        self.tool_calls = tool_calls


class _ToolThenFinalCaptureLLM:
    """Round 1: tool call. Round 2: final. Captures messages each invoke."""

    def __init__(self) -> None:
        self.calls = 0
        self.seen_messages: list[list[dict]] = []

    def invoke(self, messages, **_kwargs):
        self.calls += 1
        self.seen_messages.append([dict(m) for m in messages])
        if self.calls == 1:
            return _FakeResponse(
                "need tool",
                [
                    {
                        "id": "call-1",
                        "type": "function",
                        "function": {
                            "name": "bash_exec",
                            "arguments": {"command": "echo hi"},
                        },
                    }
                ],
            )
        return _FakeResponse("done", [])

    def stream(self, *_args, **_kwargs):
        yield "done"


class _AlwaysToolLLM:
    def invoke(self, *_args, **_kwargs):
        return _FakeResponse(
            "loop",
            [
                {
                    "id": "call-x",
                    "type": "function",
                    "function": {"name": "list_files", "arguments": {"path": ".", "limit": 1}},
                }
            ],
        )

    def stream(self, *_args, **_kwargs):
        yield ""


class _ApproveGate:
    async def request_confirm(self, question, context=None) -> bool:
        return True


def _run_turn_sync(runtime, session, text="do it"):
    import asyncio

    async def _collect():
        items = []
        async for event in runtime.run_turn(text, session):
            items.append(event)
        return items

    return asyncio.run(_collect())


def test_run_turn_publishes_watermark_and_budget_hints(monkeypatch, tmp_path) -> None:
    from agenticx.cli.studio import StudioSession
    from agenticx.runtime import AgentRuntime
    from agenticx.runtime import agent_runtime as runtime_module

    async def _fake_dispatch(*_args, **_kwargs):
        return "tool-ok"

    monkeypatch.setattr(runtime_module, "dispatch_tool_async", _fake_dispatch)
    llm = _ToolThenFinalCaptureLLM()
    runtime = AgentRuntime(llm, _ApproveGate())
    # 85% session budget: crosses the 60% guidance and the 80% lock at once.
    guard = TokenBudgetGuard(max_tokens_per_session=1000, max_tokens_per_turn=500)
    guard.cumulative_input = 850
    runtime.token_budget = guard
    session = StudioSession()

    events = _run_turn_sync(runtime, session)

    # Watermark published for tool dispatch.
    assert session.scratchpad.get("budget_pct") == "85"
    assert session.scratchpad.get("budget_locked") == "1"
    assert session.scratchpad.get("budget_remaining") == "150"
    # 60% guidance latched exactly once.
    assert session.scratchpad.get("budget_explore_hint_sent") == "1"
    # Round 2 LLM call saw both the 60% guidance and the 80% lock hint.
    round2_messages = llm.seen_messages[1]
    texts = [str(m.get("content", "")) for m in round2_messages]
    assert any("<budget_guidance>" in t for t in texts)
    assert any("<budget_warning>" in t and "EXPLORATION IS LOCKED" in t for t in texts)
    # Turn still completes normally with a FINAL event.
    assert any(e.type == "final" for e in events)


def test_run_turn_budget_hint_latches_once_per_session(monkeypatch, tmp_path) -> None:
    from agenticx.cli.studio import StudioSession
    from agenticx.runtime import AgentRuntime
    from agenticx.runtime import agent_runtime as runtime_module

    async def _fake_dispatch(*_args, **_kwargs):
        return "tool-ok"

    monkeypatch.setattr(runtime_module, "dispatch_tool_async", _fake_dispatch)
    llm = _ToolThenFinalCaptureLLM()
    runtime = AgentRuntime(llm, _ApproveGate())
    guard = TokenBudgetGuard(max_tokens_per_session=1000, max_tokens_per_turn=500)
    guard.cumulative_input = 650
    runtime.token_budget = guard
    session = StudioSession()

    _run_turn_sync(runtime, session)

    assert session.scratchpad.get("budget_pct") == "65"
    assert session.scratchpad.get("budget_locked") == "0"
    assert session.scratchpad.get("budget_explore_hint_sent") == "1"
    # Second turn with the same session: latch prevents re-injecting guidance.
    llm2 = _ToolThenFinalCaptureLLM()
    runtime2 = AgentRuntime(llm2, _ApproveGate())
    guard2 = TokenBudgetGuard(max_tokens_per_session=1000, max_tokens_per_turn=500)
    guard2.cumulative_input = 700
    runtime2.token_budget = guard2
    _run_turn_sync(runtime2, session, "continue")
    round2_texts = [str(m.get("content", "")) for m in llm2.seen_messages[1]]
    assert not any("<budget_guidance>" in t for t in round2_texts)


# ---------------------------------------------------------------------------
# run_turn integration: rounds auto-relax (P2.3a)
# ---------------------------------------------------------------------------


def test_run_turn_relaxes_rounds_with_pending_todos_then_exhausts(monkeypatch, tmp_path) -> None:
    from agenticx.cli.studio import StudioSession
    from agenticx.runtime import AgentRuntime
    from agenticx.runtime import agent_runtime as runtime_module

    async def _fake_dispatch(*_args, **_kwargs):
        return "tool-ok"

    monkeypatch.setattr(runtime_module, "dispatch_tool_async", _fake_dispatch)
    runtime = AgentRuntime(_AlwaysToolLLM(), _ApproveGate(), max_tool_rounds=2)
    session = StudioSession()
    session.todo_manager.update(
        [
            {"content": "t1", "status": "in_progress"},
            {"content": "t2", "status": "pending"},
        ]
    )

    events = _run_turn_sync(runtime, session)

    round_starts = [e for e in events if e.type == "round_start"]
    relax_errors = [
        e.data for e in events if e.type == "error" and e.data.get("detector") == "rounds_auto_relax"
    ]
    exhausted = [
        e.data for e in events if e.type == "error" and e.data.get("detector") == "rounds_exhausted"
    ]

    # 2 pending todos -> cap 2 + max(3, 1) = 5 rounds actually executed.
    assert len(round_starts) == 5
    assert runtime.max_tool_rounds == 5
    assert len(relax_errors) == 1
    assert relax_errors[0]["old_max_rounds"] == 2
    assert relax_errors[0]["max_rounds"] == 5
    assert relax_errors[0]["pending_todos"] == 2
    # Phase-1 honesty preserved: exhausting the extended cap still fires the
    # rounds_exhausted terminal marker.
    assert exhausted, "extended-cap exhaustion must emit rounds_exhausted"


def test_run_turn_no_relax_without_pending_todos(monkeypatch, tmp_path) -> None:
    from agenticx.cli.studio import StudioSession
    from agenticx.runtime import AgentRuntime
    from agenticx.runtime import agent_runtime as runtime_module

    async def _fake_dispatch(*_args, **_kwargs):
        return "tool-ok"

    monkeypatch.setattr(runtime_module, "dispatch_tool_async", _fake_dispatch)
    runtime = AgentRuntime(_AlwaysToolLLM(), _ApproveGate(), max_tool_rounds=2)
    session = StudioSession()  # no todos

    events = _run_turn_sync(runtime, session)

    round_starts = [e for e in events if e.type == "round_start"]
    relax_errors = [
        e for e in events if e.type == "error" and e.data.get("detector") == "rounds_auto_relax"
    ]
    exhausted = [
        e for e in events if e.type == "error" and e.data.get("detector") == "rounds_exhausted"
    ]
    assert len(round_starts) == 2
    assert runtime.max_tool_rounds == 2
    assert not relax_errors
    assert exhausted, "plain exhaustion still emits rounds_exhausted"
