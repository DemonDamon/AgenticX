#!/usr/bin/env python3
"""W1 cloud gate against a live managed host.

Author: Damon Li
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any

import yaml

from agenticx.cli.ma_commands import load_fake_llm_script
from agenticx.managed.testing import PerSessionScriptFactory
from tests.managed.conftest import make_config

_ROOT = Path(__file__).resolve().parents[2]


def _gate_module() -> Any:
    path = _ROOT / "scripts/managed/w1_gate_demo.py"
    spec = importlib.util.spec_from_file_location("w1_gate_demo", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("w1 gate demo could not be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def test_w1_gate_cloud(tmp_path: Path, ma_live_server: Any) -> None:
    document = yaml.safe_load((_ROOT / "examples/managed/agents.dev.yaml").read_text(encoding="utf-8"))
    manifest = document["agents"][0]["manifest"]
    manifest["model"] = "fake/scripted"
    config = make_config(tmp_path, manifest=manifest)
    steps, fallback = load_fake_llm_script(_ROOT / "examples/managed/w1_fake_script.json")
    live = ma_live_server(config, PerSessionScriptFactory(steps, fallback_text=fallback))
    await _gate_module().run_w1_gate(base_url=live.base_url, token=live.token, timeout=60)
