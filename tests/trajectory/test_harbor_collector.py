import json
import pytest
from pathlib import Path
from agenticx.learning.trajectory.harbor_collector import collect_trial, collect_jobs

def make_trial(root: Path, task: str, suffix: str, reward: float, tool_calls=True) -> Path:
    trial = root / "agenticx-tb40-r1" / f"{task}__{suffix}"
    trial.mkdir(parents=True)
    json.dump({"task": {"name": f"terminal-bench/{task}"}}, open(trial / "config.json", "w"))
    json.dump(
        {"task_name": task, "verifier_result": {"rewards": {"reward": reward}},
         "exception_info": None, "started_at": "2026-09-01T00:00:00Z"},
        open(trial / "result.json", "w"),
    )
    agent = trial / "agent"
    agent.mkdir()
    messages = [
        {"role": "user", "content": f"solve {task}"},
        {"role": "assistant", "content": "thinking", "tool_calls": [
            {"id": "tc1", "type": "function",
             "function": {"name": "bash", "arguments": "{\"cmd\": \"ls\"}"}},
        ]},
        {"role": "tool", "tool_call_id": "tc1", "content": "file1\nfile2"},
        {"role": "assistant", "content": "done"},
    ]
    json.dump({"agent": "agenticx", "model": "openai/glm-5.3-flash", "success": reward == 1.0,
               "messages": messages, "totals": {"input_tokens": 1000, "output_tokens": 200},
               "iterations": 4},
              open(agent / "agenticx.trajectory.json", "w"))
    return trial

def test_collect_trial_pass(tmp_path):
    make_trial(tmp_path, "fin-saccr-rwa", "abc123", 1.0)
    t = collect_trial(next((tmp_path / "agenticx-tb40-r1").iterdir()))
    assert t is not None
    assert t.status == "pass"
    assert t.reward.label == 1.0 and t.reward.source == "verifier"
    assert t.task_id == "fin-saccr-rwa"
    assert t.model == "openai/glm-5.3-flash"
    assert t.tool_calls[0].name == "bash"
    assert t.tool_calls[0].ok is True
    assert any(s.kind == "verification" for s in t.decision_lineage)
    assert t.token_usage == {"input_tokens": 1000, "output_tokens": 200}

def test_collect_trial_fail(tmp_path):
    make_trial(tmp_path, "react-lead-form", "def456", 0.0)
    t = collect_trial(next((tmp_path / "agenticx-tb40-r1").iterdir()))
    assert t.status == "fail" and t.reward.label == 0.0

def test_collect_trial_partial(tmp_path):
    make_trial(tmp_path, "half-credit", "xyz", 0.5)
    t = collect_trial(next((tmp_path / "agenticx-tb40-r1").iterdir()))
    assert t.status == "partial" and t.reward.label == 0.5

def test_collect_trial_missing_result_returns_none(tmp_path):
    trial = make_trial(tmp_path, "no-result", "aaa", 1.0)
    (trial / "result.json").unlink()
    assert collect_trial(trial) is None

def test_collect_jobs_skips_broken_dirs(tmp_path):
    make_trial(tmp_path, "t1", "a1", 1.0)
    broken = tmp_path / "agenticx-broken-tb21mix-r1" / "t2__b2"
    broken.mkdir(parents=True)
    json.dump({"task": {"name": "t2"}}, open(broken / "config.json", "w"))
    json.dump({"verifier_result": {"rewards": {"reward": 1.0}}, "exception_info": None},
              open(broken / "result.json", "w"))
    trajs = list(collect_jobs(tmp_path, job_pattern="*tb40*"))
    assert [t.task_id for t in trajs] == ["t1"]
