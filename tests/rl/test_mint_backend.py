"""MinT 后端单元测试：用 mock 客户端钉死 token 对齐与优势广播语义。

真跑由 scripts/rl_smoke_mint.py 负责（需 API key + 容量）。
"""
import numpy as np
import pytest

from agenticx.rl import mint_backend


def test_mint_available_or_graceful():
    # mint 可选：装了就有，没装 require_mint 抛 ImportError
    try:
        import mint  # noqa: F401
        assert mint_backend._HAVE_MINT is True
    except ImportError:
        assert mint_backend._HAVE_MINT is False
        with pytest.raises(ImportError):
            mint_backend.require_mint()


# ---- 以下测试需 mint 已安装（提供 types） ----
pytestmark = pytest.mark.skipif(
    not mint_backend._HAVE_MINT, reason="mint SDK not installed")


def test_grpo_step_token_alignment():
    """验证 Datum 的 target_tokens/weights/logprobs/advantages 按 token 位置对齐。"""
    from mint import types

    prompt = [10, 20, 30]          # Lp=3
    resp = [40, 50, 60]            # Lr=3
    full = prompt + resp           # [10,20,30,40,50,60]
    old_lp = [0.1, -0.2, 0.3]      # 3 个 completion token 的旧 logprob

    captured = {}

    class FakeTrainingClient:
        def forward_backward(self, data, loss_fn, loss_fn_config=None):
            captured["data"] = data
            captured["loss_fn"] = loss_fn
            captured["config"] = loss_fn_config

            class R:
                loss = 0.42
                metrics = {"kl": 0.01}
            fut = type("F", (), {"result": lambda self: R()})()
            return fut

        def optim_step(self, params):
            captured["optim_params"] = params
            fut = type("F", (), {"result": lambda self: None})()
            return fut

    from agenticx.rl.rollout import RolloutSample
    sample = RolloutSample(
        prompt_ids=prompt, response_ids=resp, old_logprobs=old_lp, reward=1.0,
    )

    res = mint_backend.mint_grpo_step(
        FakeTrainingClient(), [sample], [1.0], group_size=1,
    )

    assert captured["loss_fn"] == "importance_sampling"
    assert captured["config"]["clip_eps"] == 0.2

    datum = captured["data"][0]
    # model_input = full[:-1] = [10,20,30,40,50]
    assert list(datum.model_input.chunks[0].tokens) == [10, 20, 30, 40, 50]
    # target_tokens = full[1:] = [20,30,40,50,60]
    assert list(datum.loss_fn_inputs["target_tokens"].data) == [20, 30, 40, 50, 60]
    # weights: 前 Lp-1=2 个 0，后 Lr=3 个 1
    w = list(datum.loss_fn_inputs["weights"].data)
    assert w == [0.0, 0.0, 1.0, 1.0, 1.0]
    # old_logprobs: 前 2 个 0，后 3 个 = resp 的旧 logprob
    lp = list(datum.loss_fn_inputs["logprobs"].data)
    assert lp[:2] == [0.0, 0.0]
    assert lp[2:] == pytest.approx(old_lp, abs=1e-6)
    # advantages: 组内单样本 reward=1 → std=0 → eps 保护 → adv≈0
    adv = list(datum.loss_fn_inputs["advantages"].data)
    assert adv[:2] == [0.0, 0.0]
    assert abs(adv[2]) < 1e-3   # 单组全同 reward → 优势≈0

    assert res.loss == 0.42
    assert res.metrics == {"kl": 0.01}


def test_grpo_step_replay_shaping():
    """回放基线参与优势计算：M4 配方。"""
    prompt = [1, 2]
    resp = [3, 4]

    class FakeTC:
        def forward_backward(self, data, loss_fn, loss_fn_config=None):
            self.last_data = data

            class R:
                loss = 0.1
                metrics = {}
            return type("F", (), {"result": lambda self: R()})()

        def optim_step(self, params):
            return type("F", (), {"result": lambda self: None})()

    from agenticx.rl.rollout import RolloutSample
    sample = RolloutSample(prompt_ids=prompt, response_ids=resp,
                           old_logprobs=[0.0, 0.0], reward=0.0)
    tc = FakeTC()
    mint_backend.mint_grpo_step(
        tc, [sample], [0.0], group_size=1,
        replay_baselines=[1.0], replay_weight=0.5,
    )
    adv = list(tc.last_data[0].loss_fn_inputs["advantages"].data)
    # reward=0, replay=1.0, w=0.5 → baseline=0.5*1.0+0.5*0.0=0.5
    # adv = (0 - 0.5) / std(0)  → std=0 被 eps 保护 → 负优势
    assert adv[-1] < 0   # 失败轨迹在回放基线 1.0 下得到负优势


def test_grpo_step_skips_empty_responses():
    """空 response 的样本被跳过，不构造 Datum。"""
    class FakeTC:
        def forward_backward(self, data, loss_fn, loss_fn_config=None):
            self.n = len(data)
            return type("F", (), {"result": lambda self: type("R", (), {"loss": 0, "metrics": {}})()})()

        def optim_step(self, params):
            return type("F", (), {"result": lambda self: None})()

    from agenticx.rl.rollout import RolloutSample
    empty = RolloutSample(prompt_ids=[1], response_ids=[], old_logprobs=[], reward=0.0)
    tc = FakeTC()
    res = mint_backend.mint_grpo_step(tc, [empty], [0.0], group_size=1)
    assert res.loss == 0.0
