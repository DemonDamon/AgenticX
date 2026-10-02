# tests/rl/test_mimo_harbor_bridge.py
"""物化器: private-split 提示 + hack_flag 检测（AIDE² 适配）。"""
from pathlib import Path

from agenticx.rl.mimo_harbor_bridge import (
    _PRIVATE_SPLIT_NOTE, materialize_task,
)


def _code_task() -> dict:
    return {
        "task_id": "code-format-code-task-000001",
        "domain": "code",
        "docker_image": "docker.io/format-code-task-000001:latest",
        "instruction": "Fix the failing tests.",
        "verifier_ref": "npx jest src/foo.test.js",
        "cwd": "/testbed",
        "extras": {"timeout_sec": 600, "test_patch": "diff --git a/x b/x"},
    }


def test_instruction_gets_private_split_note(tmp_path: Path):
    d = materialize_task(_code_task(), tmp_path)
    text = (d / "instruction.md").read_text()
    assert text.startswith("Fix the failing tests.")
    assert "held-out test suite" in text          # AIDE² private-split 提示
    assert (d / "task.toml").read_text().count("integrity_note = true") == 1


def test_instruction_note_can_be_disabled(tmp_path: Path):
    d = materialize_task(_code_task(), tmp_path, integrity_note=False)
    assert _PRIVATE_SPLIT_NOTE not in (d / "instruction.md").read_text()
    assert "integrity_note = false" in (d / "task.toml").read_text()


def test_test_sh_writes_hack_flag_on_patch_conflict(tmp_path: Path):
    d = materialize_task(_code_task(), tmp_path)
    sh = (d / "tests" / "test.sh").read_text()
    # patch 冲突 → hack_flag.txt + reward 0（001457 实测案例的落地检测）
    assert "hack_flag.txt" in sh
    assert sh.index("hack_flag.txt") < sh.index(
        "echo 0 > /logs/verifier/reward.txt")
    # jest 安全参数注入仍在
    assert "--runInBand" in sh


def test_mirror_applied_to_unified_image(tmp_path: Path):
    d = materialize_task(_code_task(), tmp_path)
    assert "docker.1ms.run/xiaomimimo/mimo-v2.6-rl-oss" in (
        d / "task.toml").read_text()
