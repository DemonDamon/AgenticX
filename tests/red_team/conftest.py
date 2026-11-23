#!/usr/bin/env python3
"""SP6 red-team-drill pytest 插件面：--drill-report 演练模式选项。

双形态（对齐"off 等价现状"纪律）：
  - 常规 `pytest tests/red_team/`：不设 --drill-report，只跑断言，零文件副作用；
  - 演练模式 `pytest tests/red_team/ --drill-report=<path>.jsonl`：
    每条攻击结果追加 JSONL，由 scripts/red-team-drill/run_drill.py 汇总拦截矩阵。

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path
from typing import Iterator, Optional

import pytest


def pytest_addoption(parser: pytest.Parser) -> None:
    group = parser.getgroup("red-team-drill", "SP6 攻防演练")
    group.addoption(
        "--drill-report",
        action="store",
        default=None,
        help="演练结果 JSONL 落盘路径（不设则零文件副作用）",
    )


@pytest.fixture(scope="session")
def drill_report(request: pytest.FixtureRequest) -> Iterator[Optional[Path]]:
    """演练模式下返回 JSONL 路径（每次运行截断重建）；常规模式返回 None。"""
    raw = request.config.getoption("--drill-report")
    if not raw:
        yield None
        return
    path = Path(raw)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("", encoding="utf-8")  # session 开始时截断，幂等重跑
    yield path
