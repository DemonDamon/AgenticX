# tests/rl/test_system_extra.py
"""system_extra 注入: 冻结经验 → 系统提示词 → 模型上下文（RSIAgent 测试时复用通路）。"""
import json
import threading
import urllib.request

import pytest

from agenticx.rl.model_server import inject_system_extra, serve_model


def test_inject_prepends_system_when_absent():
    msgs = [{"role": "user", "content": "hi"}]
    out = inject_system_extra(msgs, "LESSON: check config")
    assert out[0] == {"role": "system", "content": "LESSON: check config"}
    assert out[1] == msgs[0] and msgs[0].get("role") == "user"   # 原列表不被改


def test_inject_appends_to_existing_system():
    msgs = [{"role": "system", "content": "You are an agent."},
            {"role": "user", "content": "hi"}]
    out = inject_system_extra(msgs, "LESSON: x")
    assert out[0]["content"] == "You are an agent.\n\nLESSON: x"
    assert len(out) == 2


def test_inject_empty_extra_returns_same_messages():
    msgs = [{"role": "user", "content": "hi"}]
    assert inject_system_extra(msgs, "") is msgs
    assert inject_system_extra(msgs, None) is msgs


# ---- 端到端：serve_model 带 system_extra，POST 后模型收到含注入标记的渲染文本 ----
import torch
from transformers import GPT2Config, GPT2LMHeadModel


class FakeTokenizer:
    """零网络依赖的假 tokenizer（GPT2 vocab=128），与 test_model_server.py 同款。"""
    eos_token_id = 2
    chat_template = None

    def encode(self, text, add_special_tokens=False):
        return [min(127, 32 + (ord(c) % 90)) for c in text][:64] or [5]

    def decode(self, ids, skip_special_tokens=True):
        return "".join(chr(65 + (i % 26)) for i in ids)


class CapturingLM:
    """包装真实 GPT2LMHeadModel，记录每次 generate 收到的 input_ids。"""

    def __init__(self, lm):
        self._lm = lm
        self.prompt_ids: list[list[int]] = []

    def parameters(self):
        return self._lm.parameters()

    @property
    def training(self):
        return self._lm.training

    def eval(self):
        return self._lm.eval()

    def train(self, mode=True):
        return self._lm.train(mode)

    def generate(self, **kw):
        self.prompt_ids.append(kw["input_ids"][0].tolist())
        return self._lm.generate(**kw)


def _lm():
    torch.manual_seed(0)
    return GPT2LMHeadModel(GPT2Config(n_embd=32, n_layer=1, n_head=4,
                                      vocab_size=128, bos_token_id=1,
                                      eos_token_id=2, resid_pdrop=0.0,
                                      embd_pdrop=0.0, attn_pdrop=0.0))


def _post(port, path, payload):
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}", method="POST",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, json.loads(r.read())


def _contains_subseq(hay: list[int], needle: list[int]) -> bool:
    return any(hay[i:i + len(needle)] == needle
               for i in range(len(hay) - len(needle) + 1))


def test_serve_model_applies_system_extra():
    tok = FakeTokenizer()
    lm = CapturingLM(_lm())
    srv = serve_model(lm, tok, host="127.0.0.1", port=0,
                      model_id="test-rl-model",
                      system_extra="SECRET_HINT_MARKER")
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        code, data = _post(srv.server_address[1], "/v1/chat/completions", {
            "model": "test-rl-model", "max_tokens": 2, "temperature": 0.0,
            "messages": [{"role": "user", "content": "hi"}]})
        assert code == 200 and data["choices"][0]["message"]["content"]
        assert len(lm.prompt_ids) == 1
        # 渲染走 fallback（chat_template=None），system 消息以 "System: ..." 行出现；
        # FakeTokenizer 的 encode 逐字符确定映射，注入标记的 ids 应是 prompt ids 的子序列
        marker = tok.encode("SECRET_HINT_MARKER", add_special_tokens=False)
        rendered = tok.encode("System: SECRET_HINT_MARKER",
                              add_special_tokens=False)
        assert _contains_subseq(lm.prompt_ids[0], marker)
        assert _contains_subseq(lm.prompt_ids[0], rendered)
    finally:
        srv.shutdown()
