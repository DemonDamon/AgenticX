"""工具执行结果的契约。

两条都是从 tests/test_m5_agent_core.py 的红灯里挖出来的：

1. ``@agenticx.tool`` 造出来的工具，ToolExecutor 根本调不动
   （``'FunctionTool' object has no attribute 'run'``）——而这正是 README 和示例里
   最常见的写法。
2. AgentExecutor 会把工具返回值无条件压成字符串，并且把 0 / False / [] 这些合法的
   假值当成"没有结果"。
"""

from __future__ import annotations

import asyncio

import pytest

from agenticx import ToolExecutor, tool
from agenticx.core.agent_executor import AgentExecutor
from agenticx.core.event import EventLog, ToolResultEvent


@tool()
def _add(x: int, y: int) -> int:
    """Add two numbers."""
    return x + y


@tool()
def _zero() -> int:
    """Return zero."""
    return 0


@tool()
def _payload() -> dict:
    """Return a dict."""
    return {"rows": [1, 2, 3], "ok": True}


def test_public_tool_decorator_is_runnable_by_tool_executor() -> None:
    """@agenticx.tool + ToolExecutor 必须能直接跑通。

    框架里并存两套工具基类（core.tool 的 execute/aexecute 和 tools.base 的
    run/arun），ToolExecutor 只认后者。少了别名的话这里会连重试 4 次然后报
    "'FunctionTool' object has no attribute 'run'"。
    """
    result = ToolExecutor().execute(_add, x=3, y=4)
    assert result.success is True, result.error
    assert result.result == 7


def test_public_tool_decorator_is_runnable_asynchronously() -> None:
    result = asyncio.run(ToolExecutor().aexecute(_add, x=10, y=5))
    assert result.success is True, result.error
    assert result.result == 15


def _run_tool_through_executor(tool_obj, **kwargs) -> ToolResultEvent:
    executor = AgentExecutor(llm_provider=None, tools=[tool_obj])
    event_log = EventLog(agent_id="agent-1", task_id="task-1")
    executor._execute_tool_call(
        {"tool": tool_obj.name, "args": kwargs},
        event_log,
    )
    events = [e for e in event_log.events if isinstance(e, ToolResultEvent)]
    assert events, "没有产生 ToolResultEvent"
    return events[-1]


def test_tool_result_keeps_its_type() -> None:
    """没有钩子改过结果时，事件里应该是工具原样的返回值，不是 str(...)。"""
    event = _run_tool_through_executor(_add, x=2, y=4)
    assert event.success is True, event.error
    assert event.result == 6
    assert isinstance(event.result, int)


def test_tool_result_keeps_a_dict_intact() -> None:
    event = _run_tool_through_executor(_payload)
    assert event.success is True, event.error
    assert event.result == {"rows": [1, 2, 3], "ok": True}


def test_falsy_tool_result_is_not_swallowed() -> None:
    """返回 0 的工具不能被当成"没有结果"。"""
    event = _run_tool_through_executor(_zero)
    assert event.success is True, event.error
    assert event.result == 0


def test_parallel_tool_calls_run_without_an_event_log() -> None:
    """execute_parallel_tool_calls 的 event_log 是 Optional，不传也必须能跑。

    原来函数体直接取 event_log.agent_id，不传就每个工具都以
    "'NoneType' object has no attribute 'agent_id'" 失败——而且错误被包进
    ParallelToolResult(success=False)，看起来像工具自己挂了。文档里的 Example
    恰好就是不传 event_log 的写法。
    """
    executor = AgentExecutor(llm_provider=None, tools=[_add, _payload])
    summary = asyncio.run(
        executor.execute_parallel_tool_calls(
            [
                {"tool": "_add", "args": {"x": 1, "y": 2}},
                {"tool": "_payload", "args": {}},
            ]
        )
    )
    assert summary.total_tools == 2
    assert summary.successful == 2, [r.error for r in summary.results]
    assert summary.results[0].result == 3


def test_parallel_tool_calls_actually_run_concurrently() -> None:
    """并行执行必须真的并行。

    原来在协程里调的是同步的 executor.execute()，它会一路阻塞到跑完才交出控制权，
    asyncio.gather 收到的任务实际是串行的——4 个各 0.3s 的工具要 1.2s。
    """
    import time

    @tool()
    def _slow(n: int) -> int:
        """Sleep a bit, then echo."""
        time.sleep(0.3)
        return n

    executor = AgentExecutor(llm_provider=None, tools=[_slow])
    calls = [{"tool": "_slow", "args": {"n": i}} for i in range(4)]

    started = time.perf_counter()
    summary = asyncio.run(executor.execute_parallel_tool_calls(calls))
    elapsed = time.perf_counter() - started

    assert summary.successful == 4, [r.error for r in summary.results]
    # 串行需要 ~1.2s；并行 ~0.3s。0.8s 的门槛留足了余量，又能把串行挡在外面。
    assert elapsed < 0.8, f"并行执行耗时 {elapsed:.2f}s，看起来仍然是串行的"
