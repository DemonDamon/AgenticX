# tests/trainer/test_cli.py
import json
import subprocess
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "trajectory"))
from test_harbor_collector import make_trial

def run_cli(*args):
    return subprocess.run([sys.executable, "-m", "agenticx.trainer", *args],
                          capture_output=True, text=True)

def test_build_sft_end_to_end(tmp_path):
    jobs = tmp_path / "jobs"
    make_trial(jobs, "t1", "a1", 1.0)
    r = run_cli("collect", "--jobs-dir", str(jobs), "--store", str(tmp_path / "st"))
    assert r.returncode == 0, r.stderr
    b = run_cli("build", "--store", str(tmp_path / "st"),
                "--format", "sft", "--out", str(tmp_path / "ds"),
                "--name", "tb40-sft-v1")
    assert b.returncode == 0, b.stderr
    assert (tmp_path / "ds" / "tb40-sft-v1.jsonl").exists()
    assert (tmp_path / "ds" / "tb40-sft-v1.card.md").exists()
    assert '"n_samples": 1' in b.stdout or "n_samples" in b.stdout
