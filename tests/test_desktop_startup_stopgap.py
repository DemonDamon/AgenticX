#!/usr/bin/env python3
"""Startup policy guards for the bundled Desktop backend entry point.

Author: Damon Li
"""

from __future__ import annotations

import os
import runpy
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


def test_bundled_server_forces_litellm_local_cost_map(monkeypatch) -> None:
    monkeypatch.setenv("LITELLM_LOCAL_MODEL_COST_MAP", "false")

    runpy.run_path(
        str(REPO_ROOT / "packaging" / "pyinstaller" / "agx_serve_entry.py"),
        run_name="agx_serve_entry_startup_test",
    )

    assert os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] == "true"


def test_cli_bootstrap_names_include_bundled_server() -> None:
    from agenticx import CLI_BOOTSTRAP_NAMES

    assert "agx-server" in CLI_BOOTSTRAP_NAMES
    assert "agx-server.exe" in CLI_BOOTSTRAP_NAMES


def _run_fresh_python(script: str) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = (
        f"{REPO_ROOT}{os.pathsep}{existing}" if existing else str(REPO_ROOT)
    )
    return subprocess.run(
        [sys.executable, "-c", script],
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )


def test_provider_resolver_import_skips_neo4j_exporter() -> None:
    result = _run_fresh_python(
        "\n".join(
            [
                "import sys",
                "from agenticx.llms.provider_resolver import ProviderResolver",
                "assert ProviderResolver is not None",
                "assert 'agenticx.knowledge.graphers.neo4j_exporter' not in sys.modules",
                "assert 'agenticx.knowledge.graphers' not in sys.modules",
            ]
        )
    )
    assert result.returncode == 0, result.stderr


def test_bundled_server_argv_skips_eager_framework_import() -> None:
    result = _run_fresh_python(
        "\n".join(
            [
                "import sys",
                "sys.argv[0] = 'agx-server'",
                "import agenticx",
                "assert 'agenticx.knowledge.graphers.neo4j_exporter' not in sys.modules",
                "assert 'agenticx.core' not in sys.modules",
            ]
        )
    )
    assert result.returncode == 0, result.stderr


def test_bundled_entry_import_order_skips_neo4j_exporter() -> None:
    result = _run_fresh_python(
        "\n".join(
            [
                "import sys",
                "sys.argv[0] = 'agx-server'",
                "import agenticx.core",
                "from agenticx.studio.server import create_studio_app",
                "assert create_studio_app is not None",
                "assert 'agenticx.knowledge.graphers.neo4j_exporter' not in sys.modules",
            ]
        )
    )
    assert result.returncode == 0, result.stderr


def test_neo4j_exporter_import_does_not_warn_without_driver() -> None:
    result = _run_fresh_python(
        "from agenticx.knowledge.graphers.neo4j_exporter import NEO4J_AVAILABLE, Neo4jExporter"
    )
    assert result.returncode == 0, result.stderr
    combined = f"{result.stdout}\n{result.stderr}"
    assert "pip install neo4j" not in combined
    assert "Neo4j driver not available" not in combined
