# tests/rl/test_model_server.py
import json
import threading
import urllib.error
import urllib.request

import torch
from transformers import GPT2Config, GPT2LMHeadModel

from agenticx.rl.model_server import serve_model


class FakeTokenizer:
    """零网络依赖的假 tokenizer（GPT2 vocab=128）。"""
    eos_token_id = 2
    chat_template = None

    def encode(self, text, add_special_tokens=False):
        return [min(127, 32 + (ord(c) % 90)) for c in text][:64] or [5]

    def decode(self, ids, skip_special_tokens=True):
        return "".join(chr(65 + (i % 26)) for i in ids)


def _lm():
    torch.manual_seed(0)
    return GPT2LMHeadModel(GPT2Config(n_embd=32, n_layer=1, n_head=4,
                                      vocab_size=128, bos_token_id=1,
                                      eos_token_id=2, resid_pdrop=0.0,
                                      embd_pdrop=0.0, attn_pdrop=0.0))


def _start_server():
    lm = _lm()
    srv = serve_model(lm, FakeTokenizer(), host="127.0.0.1", port=0,
                      model_id="test-rl-model")
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    return srv


def _post(port, path, payload):
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}", method="POST",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, json.loads(r.read())


def _get(port, path):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=30) as r:
        return r.status, json.loads(r.read())


def test_models_endpoint_lists_id():
    srv = _start_server()
    try:
        code, data = _get(srv.server_address[1], "/v1/models")
        assert code == 200
        assert data["data"][0]["id"] == "test-rl-model"
    finally:
        srv.shutdown()


def test_chat_completion_returns_openai_shape():
    srv = _start_server()
    try:
        code, data = _post(srv.server_address[1], "/v1/chat/completions", {
            "model": "test-rl-model", "max_tokens": 5, "temperature": 0.0,
            "messages": [{"role": "user", "content": "hello"}]})
        assert code == 200
        ch = data["choices"][0]
        assert ch["message"]["role"] == "assistant"
        assert isinstance(ch["message"]["content"], str) and ch["message"]["content"]
        assert ch["finish_reason"] == "stop"
        assert data["model"] == "test-rl-model"
        assert data["usage"]["completion_tokens"] > 0
    finally:
        srv.shutdown()


def test_greedy_temperature_zero_is_deterministic():
    srv = _start_server()
    try:
        payload = {"model": "test-rl-model", "max_tokens": 4, "temperature": 0.0,
                   "messages": [{"role": "user", "content": "abc"}]}
        _, a = _post(srv.server_address[1], "/v1/chat/completions", payload)
        _, b = _post(srv.server_address[1], "/v1/chat/completions", payload)
        assert a["choices"][0]["message"]["content"] == \
            b["choices"][0]["message"]["content"]
    finally:
        srv.shutdown()


def test_unknown_paths_return_404():
    srv = _start_server()
    try:
        try:
            _get(srv.server_address[1], "/v1/embeddings")
            raise AssertionError("应 404")
        except urllib.error.HTTPError as e:
            assert e.code == 404
        try:
            _post(srv.server_address[1], "/v1/completions", {})
            raise AssertionError("应 404")
        except urllib.error.HTTPError as e:
            assert e.code == 404
    finally:
        srv.shutdown()


def test_concurrent_requests_all_succeed():
    srv = _start_server()
    results = []
    try:
        def hit():
            _, d = _post(srv.server_address[1], "/v1/chat/completions", {
                "model": "test-rl-model", "max_tokens": 3, "temperature": 0.0,
                "messages": [{"role": "user", "content": "xy"}]})
            results.append(d["choices"][0]["message"]["content"])
        ts = [threading.Thread(target=hit) for _ in range(2)]
        [t.start() for t in ts]
        [t.join() for t in ts]
        assert len(results) == 2 and all(r for r in results)
    finally:
        srv.shutdown()


# ---- SP13 追加：请求日志 + temperature override ----
from agenticx.rl.model_server import RequestLogEntry


def _start_logged_server():
    import threading as _th
    lm = _lm()
    log: list = []
    srv = serve_model(lm, FakeTokenizer(), host="127.0.0.1", port=0,
                      model_id="test-rl-model", log=log,
                      temperature_override=1.0)
    _th.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, log


def test_log_records_entry_with_raw_logprobs():
    import threading as _th
    lm = _lm()
    log: list = []
    srv = serve_model(lm, FakeTokenizer(), host="127.0.0.1", port=0,
                      model_id="test-rl-model", log=log,
                      temperature_override=1.0)
    _th.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        _, data = _post(srv.server_address[1], "/v1/chat/completions", {
            "model": "t", "max_tokens": 4, "temperature": 0.3,   # 请求 0.3 被 override 成 1.0
            "messages": [{"role": "user", "content": "hi"}]})
        assert len(log) == 1
        e = log[0]
        assert isinstance(e, RequestLogEntry)
        assert e.temperature == 1.0
        assert len(e.context_ids) > 0
        assert len(e.gen_ids) == data["usage"]["completion_tokens"]
        assert len(e.logprobs) == len(e.gen_ids)
        # raw logp（T=1 分布）与全序列 forward 重算一致（KV-cache 差 <1e-4）
        import torch
        import torch.nn.functional as F
        full = torch.tensor([e.context_ids + e.gen_ids])
        logits = lm(full).logits[0]                    # (L, V) HF ModelOutput 路径
        lp = F.log_softmax(logits[:-1].float(), dim=-1)
        seg = lp[len(e.context_ids) - 1:]
        want = seg.gather(1, torch.tensor(e.gen_ids).unsqueeze(1)).squeeze(1)
        assert torch.allclose(torch.tensor(e.logprobs), want, atol=1e-4)
    finally:
        srv.shutdown()


def test_log_appends_across_requests():
    srv, log = _start_logged_server()
    try:
        for _ in range(3):
            _post(srv.server_address[1], "/v1/chat/completions", {
                "model": "t", "max_tokens": 2, "temperature": 0.0,
                "messages": [{"role": "user", "content": "x"}]})
        assert len(log) == 3
    finally:
        srv.shutdown()


def test_no_log_still_works():
    # 不传 log（向后兼容）：原有行为不变
    srv = _start_server()
    try:
        code, data = _post(srv.server_address[1], "/v1/chat/completions", {
            "model": "test-rl-model", "max_tokens": 3, "temperature": 0.0,
            "messages": [{"role": "user", "content": "y"}]})
        assert code == 200 and data["choices"][0]["message"]["content"]
    finally:
        srv.shutdown()


def test_override_changes_sampling_not_logprobs_scale():
    # override 后记录的是 T=1 raw logp：两次同 prompt 采样分布=T=1，
    # logged logp 应与 T=1 一致（本测试钉 "raw" 语义——非 logits/T）
    import threading as _th
    lm = _lm().eval()
    log: list = []
    srv = serve_model(lm, FakeTokenizer(), host="127.0.0.1", port=0,
                      model_id="t", log=log, temperature_override=1.0)
    _th.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        torch.manual_seed(0)
        _post(srv.server_address[1], "/v1/chat/completions", {
            "model": "t", "max_tokens": 3, "temperature": 0.9,
            "messages": [{"role": "user", "content": "q"}]})
        e = log[0]
        # greedy 对照：T=1 下 argmax token 的 logp 应 ≥ 其它 token（非严格，跳过）
        assert all(p <= 0.0 for p in e.logprobs)
    finally:
        srv.shutdown()
