#!/usr/bin/env python3
"""Customer Desktop local-knowledge feature switch tests.

Author: Damon Li
"""

from __future__ import annotations

import os
import subprocess
import sys
from types import SimpleNamespace

from agenticx.cli.agent_tools import without_local_knowledge_tools
from agenticx.features import local_knowledge_enabled
from agenticx.runtime.agent_runtime import _kb_retrieval_always_mode
from agenticx.runtime.prompts.meta_agent import _build_kb_retrieval_policy_block


def _tool(name: str) -> dict:
    return {"type": "function", "function": {"name": name}}


def test_local_knowledge_defaults_to_enabled(monkeypatch) -> None:
    monkeypatch.delenv("AGX_LOCAL_KNOWLEDGE_ENABLED", raising=False)
    assert local_knowledge_enabled() is True


def test_disabled_flag_removes_only_local_knowledge_tools(monkeypatch) -> None:
    monkeypatch.setenv("AGX_LOCAL_KNOWLEDGE_ENABLED", "0")
    tools = [
        _tool("file_read"),
        _tool("knowledge_search"),
        _tool("knowledge_synthesize"),
        _tool("web_search"),
    ]

    assert [tool["function"]["name"] for tool in without_local_knowledge_tools(tools)] == [
        "file_read",
        "web_search",
    ]
    assert _build_kb_retrieval_policy_block("always") == ""
    assert _kb_retrieval_always_mode(SimpleNamespace(kb_retrieval_mode="always")) is False


def test_disabled_studio_import_skips_local_knowledge_packages() -> None:
    """Customer startup must not initialize KB/brain modules or their drivers."""

    env = os.environ.copy()
    env["AGX_LOCAL_KNOWLEDGE_ENABLED"] = "0"
    script = """
import sys
import agenticx.studio.server

for prefix in ("agenticx.knowledge", "agenticx.brain", "agenticx.studio.kb"):
    assert not any(name.startswith(prefix) for name in sys.modules), prefix
"""
    result = subprocess.run(
        [sys.executable, "-c", script],
        check=False,
        capture_output=True,
        text=True,
        env=env,
    )

    assert result.returncode == 0, result.stderr
    assert "Neo4j driver not available" not in result.stderr
