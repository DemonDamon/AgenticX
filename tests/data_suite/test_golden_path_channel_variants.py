"""H10: golden-path File / Hive channel variants (in-memory stubs)."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

from examples.data_suite.golden_path.ops_stage import run_ops_stage
from examples.data_suite.golden_path.pipeline import dst_rows
from examples.data_suite.golden_path.probe import build_golden_registry, probe_src
from examples.data_suite.golden_path.run_golden_path import main as golden_main

REPO = Path(__file__).resolve().parents[2]
RUNNER = REPO / "examples" / "data_suite" / "golden_path" / "run_golden_path.py"


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["file", "hive"])
async def test_variant_probe_ops_dst(kind: str):
    registry = build_golden_registry(kind=kind)
    probe = probe_src(registry)
    assert probe.ok is True
    assert "members" in probe.tables
    assert probe.dialect == kind

    ops = await run_ops_stage(registry=registry)
    assert ops["tick_runs"][0]["status"] == "succeeded"
    assert ops["rerun"]["status"] == "succeeded"
    rows = dst_rows(registry)
    assert len(rows) >= 1
    assert "member_id" in rows[0] or "email" in rows[0] or len(rows[0]) >= 1


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["fake", "file", "hive"])
async def test_cli_main_exit_zero(kind: str):
    code = await golden_main(["--channel", kind])
    assert code == 0


def test_cli_subprocess_file_and_hive():
    env = {**os.environ, "PYTHONPATH": str(REPO)}
    for kind in ("file", "hive"):
        proc = subprocess.run(
            [sys.executable, str(RUNNER), "--channel", kind],
            cwd=str(REPO),
            env=env,
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        assert proc.returncode == 0, proc.stderr + proc.stdout
        assert "PROBE" in proc.stdout
        assert "OPS" in proc.stdout
        assert "SUMMARY" in proc.stdout
        assert f"kind={kind}" in proc.stdout


def test_env_channel_overrides_default():
    env = {**os.environ, "PYTHONPATH": str(REPO), "AGX_GOLDEN_CHANNEL": "file"}
    proc = subprocess.run(
        [sys.executable, str(RUNNER)],
        cwd=str(REPO),
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr + proc.stdout
    assert "kind=file" in proc.stdout
