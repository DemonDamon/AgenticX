# tests/trainer/test_registry_cli.py
import json
import subprocess
import sys
from pathlib import Path

def run_cli(*args, registry):
    return subprocess.run(
        [sys.executable, "-m", "agenticx.trainer", "registry", *args,
         "--registry", str(registry)],
        capture_output=True, text=True)

def test_registry_lifecycle(tmp_path):
    reg = tmp_path / "models.json"
    r = run_cli("register", "agent-coding-v1", "--model", "openai/glm-5.3-flash-tuned",
                "--backend", "litellm", registry=reg)
    assert r.returncode == 0, r.stderr
    p = run_cli("promote", "agent-coding-v1", registry=reg)
    assert p.returncode == 0, p.stderr
    v = run_cli("resolve", "agent-coding-v1", registry=reg)
    assert "glm-5.3-flash-tuned" in v.stdout
    l = run_cli("list", registry=reg)
    assert "agent-coding-v1" in l.stdout
    rb = run_cli("rollback", "agent-coding-v1", registry=reg)
    assert rb.returncode == 0
