#!/usr/bin/env python3
"""CLI registration for ``agx ma``.

Author: Damon Li
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from typer.testing import CliRunner

from agenticx.cli.ma_commands import load_fake_llm_script
from agenticx.cli.main import app

_ROOT = Path(__file__).resolve().parents[2]


def test_ma_group_registered() -> None:
    runner = CliRunner()
    help_result = runner.invoke(app, ["ma", "serve", "--help"])
    assert help_result.exit_code == 0
    assert "--agents-file" in help_result.stdout
    refused = runner.invoke(
        app,
        ["ma", "serve", "--agents-file", str(_ROOT / "examples/managed/agents.dev.yaml")],
    )
    assert refused.exit_code == 2
    steps, fallback = load_fake_llm_script(_ROOT / "examples/managed/w1_fake_script.json")
    assert len(steps) == 3
    assert steps[0].tool_calls[0]["function"]["name"] == "bash_exec"
    assert fallback == "done"


def test_host_does_not_load_studio_server() -> None:
    completed = subprocess.run(
        [
            sys.executable,
            "-c",
            "import sys, agenticx.managed.host.app; assert 'agenticx.studio.server' not in sys.modules",
        ],
        cwd=_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr
