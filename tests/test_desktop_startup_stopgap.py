from __future__ import annotations

import os
import runpy
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


def test_bundled_server_forces_litellm_local_cost_map(monkeypatch) -> None:
    monkeypatch.setenv("LITELLM_LOCAL_MODEL_COST_MAP", "false")

    runpy.run_path(
        str(REPO_ROOT / "packaging" / "pyinstaller" / "agx_serve_entry.py"),
        run_name="agx_serve_entry_startup_test",
    )

    assert os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] == "true"
