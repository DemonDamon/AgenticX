# tests/trajectory/test_evolve_cli.py
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_harbor_collector import make_trial  # noqa: E402

REPO = Path(__file__).resolve().parents[2]


def run_cli(*args):
    return subprocess.run(
        [sys.executable, "-m", "agenticx.learning.trajectory", *args],
        cwd=REPO, capture_output=True, text=True,
    )


def test_evolve_cli_dry_run(tmp_path):
    # 先构造非空 store：同 task 两个 attempt（1 pass / 1 fail）再 collect
    jobs = tmp_path / "jobs"
    make_trial(jobs, "t1", "a1", 1.0)
    make_trial(jobs, "t1", "a2", 0.0)
    store_dir = tmp_path / "store"
    r = run_cli("collect", "--source", "harbor", "--jobs-dir", str(jobs),
                "--out", str(store_dir))
    assert r.returncode == 0, r.stderr
    assert '"written": 2' in r.stdout
    out = tmp_path / "policies.json"
    r2 = run_cli("evolve", "--store", str(store_dir), "--out", str(out),
                 "--iters", "2", "--dry-run", "--seed", "v1")
    assert r2.returncode == 0, r2.stderr
    payload = json.loads(r2.stdout)
    assert payload["evolution"]["iterations"] == 2
    assert payload["registry"]["promoted_version"] >= 1
    assert out.exists()


def test_evolve_cli_empty_store_fails(tmp_path):
    r = run_cli("evolve", "--store", str(tmp_path / "nonexistent-store"),
                "--out", str(tmp_path / "policies.json"), "--dry-run")
    assert r.returncode != 0
    assert "无轨迹" in r.stderr
