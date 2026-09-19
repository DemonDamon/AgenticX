import json
from pathlib import Path
from agenticx.learning.trajectory.session_collector import collect_session, collect_sessions

def make_session(root: Path, sid: str) -> Path:
    s = root / sid
    s.mkdir(parents=True)
    json.dump([{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}],
              open(s / "messages.json", "w"))
    json.dump([{"tool_name": "bash", "arguments": {"cmd": "ls"}, "success": True,
                "result": "ok"}],
              open(s / "tool_call_observations.json", "w"))
    return s

def test_collect_session_unlabeled(tmp_path):
    make_session(tmp_path, "s1")
    t = collect_session(tmp_path / "s1")
    assert t is not None
    assert t.status == "unlabeled"
    assert t.reward.label == -1.0 and t.reward.source == "user"
    assert t.source == "agenticx-session"
    assert t.task_id == "" and t.model == "unknown"
    assert t.tool_calls[0].name == "bash" and t.tool_calls[0].ok is True
    assert any(s.kind == "correction" for s in t.decision_lineage) is False

def test_collect_session_missing_messages_returns_none(tmp_path):
    (tmp_path / "empty").mkdir()
    assert collect_session(tmp_path / "empty") is None

def test_collect_sessions_yields_all(tmp_path):
    make_session(tmp_path, "s1"); make_session(tmp_path, "s2")
    assert len(list(collect_sessions(tmp_path))) == 2
