"""Smoke tests for the default observability box files.

Author: Damon Li
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def test_casting_yaml_is_signoz_compose_not_lgtm():
    text = (ROOT / "deploy/observability/casting.yaml").read_text(encoding="utf-8")
    assert "flavor: compose" in text
    assert "loki" not in text.lower()
    assert "grafana" not in text.lower()
    assert "tempo" not in text.lower()


def test_readme_mentions_memory_and_otlp_ports():
    text = (ROOT / "deploy/observability/README.md").read_text(encoding="utf-8")
    assert "4" in text and "4317" in text and "4318" in text
    assert "AGENTICX_OTEL_ENABLED" in text


def test_gateway_scrape_compose_config():
    compose = ROOT / "deploy/observability/gateway-scrape/docker-compose.yml"
    assert compose.is_file()
    docker = shutil.which("docker")
    if docker is None:
        pytest.skip("docker not installed")
    proc = subprocess.run(
        [docker, "compose", "-f", str(compose), "config"],
        capture_output=True,
        text=True,
        check=False,
    )
    err = (proc.stderr or "") + (proc.stdout or "")
    if proc.returncode != 0 and any(
        token in err.lower()
        for token in ("compose", "plugin", "unknown shorthand", "usage:  docker")
    ):
        pytest.skip("docker compose plugin unavailable")
    assert proc.returncode == 0, proc.stderr
