from pathlib import Path

from agenticx.runtime.team_manager import AgentTeamManager


def _mgr() -> AgentTeamManager:
    return AgentTeamManager.__new__(AgentTeamManager)


def _cp_messages(dst_dir: str) -> list:
    return [
        {
            "role": "assistant",
            "tool_calls": [
                {
                    "function": {
                        "name": "bash_exec",
                        "arguments": f'{{"command": "cp /src/a.pdf {dst_dir}/a.pdf"}}',
                    }
                }
            ],
        },
    ]


def test_cp_target_detected(tmp_path):
    dst = tmp_path / "out"
    dst.mkdir()
    (dst / "a.pdf").write_text("x")
    m = _mgr()
    paths = m._extract_bash_copy_paths(_cp_messages(str(dst)), str(tmp_path))
    assert any(str(dst / "a.pdf") in p or p.endswith("a.pdf") for p in paths)


def test_paths_from_text(tmp_path):
    f = tmp_path / "评估报告.md"
    f.write_text("ok")
    m = _mgr()
    text = f"评估已保存到 {f} 完成。"
    got = m._extract_paths_from_text(text)
    assert str(f) in got


def test_write_action_keeps_completed(tmp_path):
    m = _mgr()
    msgs = _cp_messages(str(tmp_path))
    (tmp_path / "a.pdf").write_text("x")
    assert m._had_write_or_copy_action(msgs) is True


def test_true_empty_still_fails():
    m = _mgr()
    assert m._had_write_or_copy_action([{"role": "assistant", "content": "done"}]) is False
