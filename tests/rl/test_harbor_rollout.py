# tests/rl/test_harbor_rollout.py
import json
import threading
import urllib.request

import torch
from transformers import GPT2Config, GPT2LMHeadModel

from agenticx.rl.harbor_rollout import Episode, HarborRolloutEngine
from agenticx.rl.model_server import serve_model


class FakeTokenizer:
    eos_token_id = 2
    chat_template = None

    def encode(self, text, add_special_tokens=False):
        return [min(127, 32 + (ord(c) % 90)) for c in text][:64] or [5]

    def decode(self, ids, skip_special_tokens=True):
        return "x" * len(ids)


def _lm():
    torch.manual_seed(0)
    return GPT2LMHeadModel(GPT2Config(n_embd=32, n_layer=1, n_head=4,
                                      vocab_size=128, bos_token_id=1,
                                      eos_token_id=2, resid_pdrop=0.0,
                                      embd_pdrop=0.0, attn_pdrop=0.0))


def _hit(port, text):
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/v1/chat/completions", method="POST",
        data=json.dumps({"model": "t", "max_tokens": 3, "temperature": 0.5,
                         "messages": [{"role": "user", "content": text}]}).encode(),
        headers={"Content-Type": "application/json"})
    urllib.request.urlopen(req, timeout=30).read()


def test_run_episode_collects_segments_and_reward(tmp_path):
    lm = _lm()
    eng = HarborRolloutEngine(lm, FakeTokenizer(), model_id="openai/t")
    eng.start()

    def fake_runner(cmd, env, timeout):
        # 模拟 agent 在 trial 期间打了两次模型服务
        _hit(eng.server_port, "step one")
        _hit(eng.server_port, "step two")
        d = tmp_path / "trial-x"
        d.mkdir(parents=True, exist_ok=True)
        (d / "result.json").write_text(json.dumps(
            {"verifier_result": {"rewards": {"reward": 1.0}}}))

    ep = eng.run_episode("/tasks/demo", trials_dir=tmp_path, runner=fake_runner)
    assert isinstance(ep, Episode)
    assert ep.task == "/tasks/demo"
    assert ep.reward == 1.0
    assert len(ep.segments) == 2                      # 每次请求 = 一个段
    s0 = ep.segments[0]
    assert s0.prompt_ids.tolist() == s0.prompt_ids.tolist()   # tensor 可用
    assert s0.response_ids.shape[0] == 3
    assert s0.old_logprobs.shape[0] == 3
    # agent env 的 base_url 指向 host.docker.internal（容器可达宿主机）
    assert eng._last_env["OPENAI_BASE_URL"].startswith("http://host.docker.internal:")
    eng.stop()


def test_run_episode_empty_log_zero_segments(tmp_path):
    lm = _lm()
    eng = HarborRolloutEngine(lm, FakeTokenizer(), model_id="openai/t")
    eng.start()

    def fake_runner(cmd, env, timeout):               # agent 没打任何请求
        d = tmp_path / "trial-y"
        d.mkdir(parents=True, exist_ok=True)
        (d / "result.json").write_text(json.dumps(
            {"verifier_result": {"rewards": {"reward": 0.0}}}))

    ep = eng.run_episode("/tasks/demo", trials_dir=tmp_path, runner=fake_runner)
    assert ep.reward == 0.0 and ep.segments == []
    eng.stop()


def test_server_reused_across_episodes(tmp_path):
    lm = _lm()
    eng = HarborRolloutEngine(lm, FakeTokenizer(), model_id="openai/t")
    eng.start()
    port_before = eng.server_port

    def fake_runner(cmd, env, timeout):
        _hit(eng.server_port, "q")
        d = tmp_path / f"trial-{tmp_path.name}-{len(list(tmp_path.iterdir()))}"
        d.mkdir(parents=True, exist_ok=True)
        (d / "result.json").write_text(json.dumps(
            {"verifier_result": {"rewards": {"reward": 0.5}}}))

    e1 = eng.run_episode("/tasks/a", trials_dir=tmp_path, runner=fake_runner)
    e2 = eng.run_episode("/tasks/b", trials_dir=tmp_path, runner=fake_runner)
    assert eng.server_port == port_before             # 服务复用不重启
    assert len(e1.segments) == 1 and len(e2.segments) == 1   # 日志按 trial 分割
    eng.stop()


def test_segments_are_RolloutSample(tmp_path):
    from agenticx.rl.rollout import RolloutSample
    lm = _lm()
    eng = HarborRolloutEngine(lm, FakeTokenizer(), model_id="openai/t")
    eng.start()

    def fake_runner(cmd, env, timeout):
        _hit(eng.server_port, "hello")
        d = tmp_path / "trial-z"
        d.mkdir(parents=True, exist_ok=True)
        (d / "result.json").write_text(json.dumps(
            {"verifier_result": {"rewards": {"reward": 1.0}}}))

    ep = eng.run_episode("/tasks/demo", trials_dir=tmp_path, runner=fake_runner)
    assert all(isinstance(s, RolloutSample) for s in ep.segments)
    eng.stop()
