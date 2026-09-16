# tests/trajectory/test_cli.py
import json
import subprocess
import sys
from pathlib import Path
from test_harbor_collector import make_trial

def run_cli(*args):
    return subprocess.run(
        [sys.executable, "-m", "agenticx.learning.trajectory", *args],
        capture_output=True, text=True,
    )

def test_collect_harbor_and_stats(tmp_path):
    jobs = tmp_path / "jobs"; out = tmp_path / "store"
    make_trial(jobs, "t1", "a1", 1.0)
    r = run_cli("collect", "--source", "harbor", "--jobs-dir", str(jobs),
                "--out", str(out))
    assert r.returncode == 0, r.stderr
    assert '"written": 1' in r.stdout
    r2 = run_cli("stats", "--store", str(out))
    assert '"total": 1' in r2.stdout
