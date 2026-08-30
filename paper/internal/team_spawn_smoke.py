#!/usr/bin/env python3
"""TeamBench 基础设施冒烟测试：验证 AgenticX 多 Agent 团队协作闭环。

目标（p0-2）：确认 TeamBench 评测 runner 可复用的基础设施：
1. 能 spawn 多个 subagent 并发执行（团队模式）
2. event_emitter 能收齐 subagent_started / completed 等事件（轨迹落盘）
3. summary_sink 能收到各 agent 产出摘要（产出物收集）
4. 能统计事件数（协调开销的代理指标）

用 MockLLM，不需要真实 API key。
运行：python paper/infra/team_spawn_smoke.py
"""

from __future__ import annotations

import asyncio
import sys
import os
import time
from collections import Counter
from typing import List

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

from agenticx.cli.studio import StudioSession
from agenticx.runtime.events import EventType, RuntimeEvent
from agenticx.runtime.team_manager import AgentTeamManager


class _FakeResponse:
    def __init__(self, content: str, tool_calls):
        self.content = content
        self.tool_calls = tool_calls


class _TeamBenchMockLLM:
    """返回固定'已完成'文本，模拟 subagent 独立完成任务。"""

    def invoke(self, *_args, **_kwargs):
        return _FakeResponse("已完成分配的任务。", [])

    def stream(self, *_args, **_kwargs):
        yield "ok"


async def _wait_until(predicate, timeout: float = 5.0) -> None:
    started = asyncio.get_running_loop().time()
    while not predicate():
        await asyncio.sleep(0.02)
        if (asyncio.get_running_loop().time() - started) > timeout:
            raise TimeoutError("condition not met in time")


async def main() -> None:
    events: List[RuntimeEvent] = []
    summaries: List[str] = []

    async def _emit(event: RuntimeEvent) -> None:
        events.append(event)

    async def _sink(summary: str, _context) -> None:
        summaries.append(summary)

    print("=" * 60)
    print("TeamBench 基础设施冒烟测试（多 Agent 团队协作闭环）")
    print("=" * 60)

    t0 = time.time()
    manager = AgentTeamManager(
        llm_factory=lambda: _TeamBenchMockLLM(),
        base_session=StudioSession(),
        event_emitter=_emit,
        summary_sink=_sink,
        max_concurrent_subagents=4,
        owner_session_id="teambench-smoke",
    )

    # 团队模式：spawn 3 个 subagent（调研员 / 分析师 / 撰写员）
    roles = [
        ("调研员", "researcher", "调研竞品 Agent 基准并整理要点"),
        ("分析师", "analyst", "分析团队级指标的数学定义"),
        ("撰写员", "writer", "撰写论文 Introduction 草稿"),
    ]
    agent_ids = []
    for name, role, task in roles:
        r = await manager.spawn_subagent(name=name, role=role, task=task)
        assert r["ok"], f"spawn {name} failed: {r.get('error')}"
        agent_ids.append(r["agent_id"])
        print(f"[spawn] {name} ({role}) -> {r['agent_id']}")

    # 等待全部完成
    await _wait_until(
        lambda: all(
            manager.get_status(aid)["subagent"]["status"] in {"completed", "failed"}
            for aid in agent_ids
        )
    )
    elapsed = time.time() - t0

    # 1. 各 agent 状态
    print("\n--- 1. Subagent 状态 ---")
    for name, _role, _task, aid in zip(
        [n for n, _, _ in roles],
        [r for _, r, _ in roles],
        [t for _, _, t in roles],
        agent_ids,
    ):
        st = manager.get_status(aid)["subagent"]
        print(f"  {name}: status={st['status']}")

    # 2. 事件流统计（协调开销的代理指标）
    print("\n--- 2. 事件流统计（协调开销代理指标） ---")
    type_counts = Counter(e.type for e in events)
    for t, c in sorted(type_counts.items()):
        print(f"  {t}: {c}")
    print(f"  事件总数: {len(events)}")

    # 3. Summary 收集（产出物收集）
    print("\n--- 3. Summary 收集（产出物收集） ---")
    print(f"  收到 summary 数: {len(summaries)}")
    for i, s in enumerate(summaries, 1):
        preview = s[:60].replace("\n", " ")
        print(f"  [{i}] {preview}...")

    # 4. 闭环确认
    print("\n--- 4. 闭环确认 ---")
    checks = {
        "多 subagent 并发 spawn": len(agent_ids) == 3,
        "事件流含 SUBAGENT_STARTED": EventType.SUBAGENT_STARTED.value in type_counts,
        "事件流含 SUBAGENT_COMPLETED": EventType.SUBAGENT_COMPLETED.value in type_counts,
        "summary_sink 收到产出": len(summaries) >= 1,
        "全部 agent completed": all(
            manager.get_status(aid)["subagent"]["status"] == "completed"
            for aid in agent_ids
        ),
    }
    all_ok = True
    for label, ok in checks.items():
        print(f"  [{'OK' if ok else 'FAIL'}] {label}")
        all_ok = all_ok and ok

    print(f"\n耗时: {elapsed:.2f}s")
    print("结论: " + ("基础设施闭环验证通过，可复用。" if all_ok else "存在失败项，需排查。"))
    manager.shutdown_now()


if __name__ == "__main__":
    asyncio.run(main())
