# agenticx/rl/model_server.py
"""OpenAI 兼容模型服务（P1 · M3）：把训练中的 CausalLM 暴露给 agent/harbor。

stdlib http.server 实现（零额外依赖）。GET /v1/models 供 agent 启动探测；
POST /v1/chat/completions 采样生成（单锁串行——模型对象非线程安全）。
M4 将扩展响应聚合 token logprobs（rollout 记录用）。
"""
from __future__ import annotations

import json
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import torch


def _render_prompt(tokenizer, messages) -> str:
    """有 chat_template 用之；否则拼接 fallback（FakeTokenizer/无模板模型）。"""
    if getattr(tokenizer, "chat_template", None):
        return tokenizer.apply_chat_template(messages, tokenize=False,
                                             add_generation_prompt=True)
    parts = []
    for m in messages:
        role = m.get("role", "user")
        parts.append(f"{role.capitalize()}: {m.get('content', '')}")
    return "\n".join(parts) + "\nAssistant:"


def _make_handler(lm, tokenizer, model_id: str):
    lock = threading.Lock()
    device = next(lm.parameters()).device

    class Handler(BaseHTTPRequestHandler):
        server_version = "agenticx-rl/0.1"

        def log_message(self, *args):        # 静默访问日志
            pass

        def _json(self, code: int, payload: dict) -> None:
            body = json.dumps(payload).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/v1/models":
                self._json(200, {"object": "list", "data": [
                    {"id": model_id, "object": "model", "owned_by": "agenticx"}]})
            else:
                self._json(404, {"error": {"message": "not found"}})

        def do_POST(self):
            if self.path != "/v1/chat/completions":
                self._json(404, {"error": {"message": "not found"}})
                return
            n = int(self.headers.get("Content-Length", 0))
            try:
                req = json.loads(self.rfile.read(n) or b"{}")
            except json.JSONDecodeError:
                self._json(400, {"error": {"message": "bad json"}})
                return
            text = _render_prompt(tokenizer, req.get("messages", []))
            max_tokens = min(int(req.get("max_tokens", 32)), 512)
            temperature = float(req.get("temperature", 1.0))
            try:
                content, n_tok = self._complete(text, max_tokens, temperature)
            except Exception as e:                        # noqa: BLE001
                self._json(500, {"error": {"message": str(e)}})
                return
            self._json(200, {
                "id": f"chatcmpl-{uuid.uuid4().hex[:12]}",
                "object": "chat.completion", "model": model_id,
                "choices": [{"index": 0, "finish_reason": "stop",
                             "message": {"role": "assistant", "content": content}}],
                "usage": {"prompt_tokens": len(tokenizer.encode(
                    text, add_special_tokens=False)),
                    "completion_tokens": n_tok, "total_tokens": 0}})

        def _complete(self, text, max_tokens, temperature):
            with lock:
                ids = torch.tensor(
                    [tokenizer.encode(text, add_special_tokens=False)],
                    dtype=torch.long, device=device)
                kw = dict(input_ids=ids, attention_mask=torch.ones_like(ids),
                          max_new_tokens=max_tokens,
                          pad_token_id=tokenizer.eos_token_id or 0,
                          return_dict_in_generate=True)
                if temperature > 0:
                    kw.update(do_sample=True, temperature=temperature,
                              top_p=1.0, top_k=0)
                else:
                    kw.update(do_sample=False)
                was_training = lm.training
                lm.eval()
                try:
                    with torch.no_grad():
                        out = lm.generate(**kw)
                finally:
                    lm.train(was_training)
                new = out.sequences[0, ids.shape[1]:]
                content = tokenizer.decode(new.tolist(), skip_special_tokens=True)
                return (content if content else " ", int(new.shape[0]))

    return Handler


def serve_model(lm, tokenizer, *, host: str = "127.0.0.1", port: int = 0,
                model_id: str = "agenticx-rl") -> ThreadingHTTPServer:
    """起 OpenAI 兼容服务（阻塞前先返回 server 对象；调用方线程跑 serve_forever）。

    用法:
        srv = serve_model(lm, tok, port=8000)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        ...  # srv.server_address[1] 为实际端口（port=0 时自动分配）
        srv.shutdown()
    """
    handler = _make_handler(lm, tokenizer, model_id)
    srv = ThreadingHTTPServer((host, port), handler)
    srv.daemon_threads = True
    return srv
