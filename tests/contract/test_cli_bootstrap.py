"""CLI bootstrap must import the Studio service without package-order cycles."""

from __future__ import annotations

import subprocess
import sys


def test_agx_bootstrap_imports_studio_server_in_fresh_interpreter() -> None:
    completed = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "import sys; "
                "sys.argv[0] = 'agx'; "
                "from agenticx.studio.server import create_studio_app; "
                "assert callable(create_studio_app)"
            ),
        ],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )

    assert completed.returncode == 0, completed.stderr
