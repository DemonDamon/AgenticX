"""sync_lora: 27B LoRA 飞轮的权重热同步（多级降级 + 惰性路径）。"""
import types

import pytest

from agenticx.rl.vllm_rollout import VLLMRolloutEngine


class FakePeftModel:
    """PEFT 模型替身：save_pretrained 只写一个标记文件（真实现 ~2GB）。"""

    def __init__(self):
        self.saved_to = []

    def save_pretrained(self, path):
        self.saved_to.append(path)


def _req_output(tokens, logp):
    """构造 vLLM RequestOutput 形状的最小对象。"""
    lp = types.SimpleNamespace(logprob=logp)
    seq = types.SimpleNamespace(
        token_ids=tokens,
        logprobs=[{t: lp} for t in tokens])
    return types.SimpleNamespace(outputs=[seq])


class FakeEngineV1:
    """有 collective_rpc 且 load_lora_adapter 成功——最优路。"""

    def __init__(self, fail_rpc=False):
        self.calls = []
        self.fail_rpc = fail_rpc

    def collective_rpc(self, method, args=()):
        self.calls.append((method, args))
        if self.fail_rpc:
            raise RuntimeError("RPC 不支持")
        return True

    def generate(self, prompts, sampling_params=None, lora_request=None):
        self.calls.append(("generate", lora_request))
        return [_req_output([1, 2, 3], -0.5) for _ in prompts]


def _engine(fail_rpc=False):
    return VLLMRolloutEngine("fake-model", engine=FakeEngineV1(fail_rpc),
                             enable_lora=True)


def test_sync_lora_v1_rpc_path(tmp_path):
    eng, peft = _engine(), FakePeftModel()
    used = eng.sync_lora(peft, "round-1", tmp_path)
    assert used == "v1_rpc"
    # adapter 落在持久目录且按名字版本化（回滚/审计靠它）
    assert peft.saved_to == [str(tmp_path / "round-1")]
    assert eng.engine.calls[0] == ("load_lora_adapter", (str(tmp_path / "round-1"),))


def test_sync_lora_falls_back_to_lazy(tmp_path):
    """RPC 挂了 → 无 V0 API → 惰性路径，绝不抛异常让一轮训练白训。"""
    eng = VLLMRolloutEngine("fake-model", engine=FakeEngineV1(fail_rpc=True),
                           enable_lora=True)
    peft = FakePeftModel()
    used = eng.sync_lora(peft, "round-1", tmp_path)
    assert used == "lazy_request"
    assert eng.lora_request()["lora_path"] == str(tmp_path / "round-1")


def test_sync_lora_v0_api_path(tmp_path):
    class V0Engine:
        def __init__(self):
            self.added = []

        def add_adapter_lora(self, path):
            self.added.append(path)

        def generate(self, prompts, sampling_params=None, lora_request=None):
            return [_req_output([1], -0.5) for _ in prompts]

    eng = VLLMRolloutEngine("fake-model", engine=V0Engine(), enable_lora=True)
    used = eng.sync_lora(FakePeftModel(), "round-2", tmp_path)
    assert used == "v0_api"
    assert eng.engine.added == [str(tmp_path / "round-2")]


def test_sync_lora_requires_enable_lora(tmp_path):
    eng = VLLMRolloutEngine("fake-model", engine=FakeEngineV1(), enable_lora=False)
    with pytest.raises(RuntimeError, match="enable_lora"):
        eng.sync_lora(FakePeftModel(), "round-1", tmp_path)


def test_lora_request_id_advances(tmp_path):
    """lora_id 必须逐轮递增——vLLM 按 id 缓存，复用旧 id 命中旧 adapter。"""
    eng = _engine()
    eng.sync_lora(FakePeftModel(), "round-1", tmp_path)
    r1 = eng.lora_request(lora_id=1)
    eng.sync_lora(FakePeftModel(), "round-2", tmp_path)
    r2 = eng.lora_request(lora_id=2)
    assert r1["lora_id"] == 1 and r2["lora_id"] == 2
    assert r1["lora_path"] != r2["lora_path"]
    assert r1["lora_name"] == "rsi_adapter"


def test_lora_request_none_before_sync():
    eng = _engine()
    assert eng.lora_request() is None


def test_generate_passes_lora_request():
    eng = _engine()
    eng.sync_lora(FakePeftModel(), "round-1", "/tmp/whatever")
    req = eng.lora_request(lora_id=7)
    eng.generate([[1, 2, 3]], n_samples=1, max_new_tokens=5, lora_request=req)
    gen_calls = [c for c in eng.engine.calls if c[0] == "generate"]
    assert gen_calls[0][1]["lora_id"] == 7


def test_generate_without_lora_request_unchanged():
    """不开 LoRA 的老用法零回归：不传 lora_request 就不透传。"""
    eng = _engine()
    eng.generate([[1]], n_samples=1, max_new_tokens=5)
    gen_calls = [c for c in eng.engine.calls if c[0] == "generate"]
    assert gen_calls[0][1] is None
