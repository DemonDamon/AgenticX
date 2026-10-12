"""SP30 补采集埋点：harbor trial 真实墙钟派生（wall_seconds）。

来源已验证：result.json 顶层与 agent_execution 均有 started_at/finished_at
（ISO8601 带 Z）。派生进 metadata 后，T5 compute_slo 的长任务判定从
「≥40 工具调用」代理口径升级为真实墙钟口径。
human_interventions 无真实来源——保持缺失（unknown 上报），不造假。
"""
import json
from pathlib import Path

from agenticx.learning.trajectory.harbor_collector import (
    collect_trial,
    derive_wall_seconds,
)


def _make_trial(tmp_path: Path, *, top=True, exec_times=True) -> Path:
    d = tmp_path / "task-a__hash1"
    (d / "agent").mkdir(parents=True)
    result = {
        "task_name": "task-a",
        "verifier_result": {"rewards": {"reward": 1.0}},
        "started_at": "2026-09-15T17:44:20.146309Z",
        "finished_at": "2026-09-15T19:15:11.033539Z",   # 5431s ≈ 90.8min
    }
    if not top:
        result.pop("started_at"); result.pop("finished_at")
    if exec_times:
        result["agent_execution"] = {
            "started_at": "2026-09-15T17:44:20.146309Z",
            "finished_at": "2026-09-15T19:15:11.033539Z"}
    (d / "result.json").write_text(json.dumps(result))
    (d / "agent" / "agenticx.trajectory.json").write_text(json.dumps({
        "model": "m", "messages": [{"role": "user", "content": "q"}],
        "totals": {}}))
    (d / "config.json").write_text("{}")
    return d


def test_wall_seconds_derived_from_top_level_timestamps(tmp_path):
    d = _make_trial(tmp_path, top=True, exec_times=False)
    t = collect_trial(d)
    assert t.metadata["wall_seconds"] == 5450


def test_wall_seconds_falls_back_to_agent_execution(tmp_path):
    d = _make_trial(tmp_path, top=False, exec_times=True)
    t = collect_trial(d)
    assert t.metadata["wall_seconds"] == 5450


def test_wall_seconds_absent_when_no_timestamps(tmp_path):
    d = _make_trial(tmp_path, top=False, exec_times=False)
    t = collect_trial(d)
    assert "wall_seconds" not in t.metadata   # 不造假：缺就缺


def test_derive_wall_seconds_helper_direct():
    assert derive_wall_seconds("2026-01-01T00:00:00Z",
                               "2026-01-01T00:01:30Z") == 90
    assert derive_wall_seconds(None, "2026-01-01T00:01:30Z") is None
    assert derive_wall_seconds("bad", "2026-01-01T00:01:30Z") is None
