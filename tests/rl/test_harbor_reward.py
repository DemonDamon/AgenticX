# tests/rl/test_harbor_reward.py
import json

import pytest

from agenticx.rl.harbor_reward import (
    extract_reward, make_agent_env, make_trial_config, run_harbor_trial,
)


def test_make_agent_env_overrides_openai_vars():
    env = make_agent_env("http://127.0.0.1:8999/v1", api_key="sk-test")
    assert env["OPENAI_BASE_URL"] == "http://127.0.0.1:8999/v1"
    assert env["OPENAI_API_KEY"] == "sk-test"
    assert "PATH" in env                          # 继承当前环境（harbor 在 PATH）


def test_make_trial_config_matches_harbor_schema():
    cfg = make_trial_config("/tasks/foo", "openai/test-rl-model")
    # harbor 0.22 TrialConfig：task 为 TaskConfig 对象（真机冒烟实测）
    assert cfg["task"] == {"path": "/tasks/foo"}
    assert cfg["agent"] == {"name": "agenticx",
                            "model_name": "openai/test-rl-model"}


def test_extract_reward_from_result_json(tmp_path):
    (tmp_path / "result.json").write_text(json.dumps({
        "task_name": "t", "verifier_result": {"rewards": {"reward": 1.0}}}))
    assert extract_reward(tmp_path) == 1.0


def test_extract_reward_missing_file_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        extract_reward(tmp_path / "nope")


def _write_trial(trials_dir, reward):
    d = trials_dir / "trial-abc"
    d.mkdir(parents=True, exist_ok=True)
    (d / "result.json").write_text(json.dumps({
        "verifier_result": {"rewards": {"reward": reward}}}))
    return d


def test_run_harbor_trial_invokes_cli_and_returns_reward(tmp_path):
    seen = {}

    def fake_runner(cmd, env, timeout):
        seen["cmd"] = cmd
        seen["env"] = env
        seen["timeout"] = timeout
        _write_trial(tmp_path, 1.0)

    reward, trial_dir = run_harbor_trial(
        "/tasks/foo", "test-rl-model", "http://127.0.0.1:8999/v1",
        trials_dir=tmp_path, runner=fake_runner, timeout=60.0)
    assert reward == 1.0
    assert trial_dir.name == "trial-abc"
    cmd = seen["cmd"]
    assert cmd[0] == "harbor" and cmd[1] == "trial" and cmd[2] == "start"
    assert "-p" in cmd and "/tasks/foo" in cmd
    assert "--trials-dir" in cmd and str(tmp_path) in cmd
    assert seen["env"]["OPENAI_BASE_URL"] == "http://127.0.0.1:8999/v1"
    assert seen["timeout"] == 60.0
    # config.json 已按 schema 落盘
    cfg = json.loads((tmp_path / "config.json").read_text())
    assert cfg["agent"]["model_name"] == "test-rl-model"


def test_run_harbor_trial_picks_latest_trial(tmp_path):
    def runner_with(rw):
        def r(cmd, env, timeout):
            _write_trial(tmp_path, rw)
        return r

    reward, _ = run_harbor_trial(
        "/tasks/foo", "m", "http://x/v1", trials_dir=tmp_path,
        runner=runner_with(0.0), timeout=1.0)
    assert reward == 0.0


def test_run_harbor_trial_no_result_raises(tmp_path):
    with pytest.raises(RuntimeError):
        run_harbor_trial("/tasks/foo", "m", "http://x/v1", trials_dir=tmp_path,
                         runner=lambda c, e, t: None, timeout=1.0)
