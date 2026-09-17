# SP12: RL 训练核 M3 — harbor 任务 reward 通路（RSI 任务 → GRPO reward）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 打通 RSI 任务的 reward 信号通路：训练中的 LM 起 OpenAI 兼容本地服务 → agenticx agent（`OPENAI_BASE_URL` 指向本地）→ harbor trial（容器任务 + verifier）→ result.json 的 0/1 reward。**这是"RL 直接优化真任务成功率"的最后一块基础设施**；GRPO 消费 harbor reward 进训练循环属 M4（回放混合 GRPO，论文贡献点）。

**P1 路线图位置（M0✅ M1✅ M2✅ → **M3 本计划** → M4 回放混合 GRPO+演化塑形 → M5 多卡）**

**父代理已验证的环境事实（2026-09-17）:**
- harbor 0.22.0 CLI 在 PATH；`harbor trial start -p <task> -c <config.json> --trials-dir <dir>`
- Docker 29.7.2 运行中；terminal-bench 任务集在 `harness-lab/terminal-bench/`
- trial 结构（`harness-lab/jobs/*/`）：`config.json`（task + agent{name:agenticx, model_name}）→ `result.json` → `verifier_result.rewards.reward`（0.0/1.0）
- agenticx agent 连 OpenAI 兼容端点用环境变量 `OPENAI_BASE_URL`/`OPENAI_API_KEY`（harness-lab/.env 同款）
- run_full.py 先例：`harbor run -a agenticx -m <model>`，agent 超时乘数 3/6

**设计纪律:**
- server 用 stdlib `http.server`（零新依赖：不引 fastapi/uvicorn）；单锁串行采样（模型对象非线程安全）
- 采样复用 `lm.generate`（KV-cache）；temperature=0 走 greedy 保证可测确定性
- chat 模板：tokenizer 有 `chat_template` 用 `apply_chat_template`，否则 fallback `"User: ...\nAssistant:"`（测试用 FakeTokenizer 零网络依赖）
- harbor 调用走 subprocess + runner 注入点（单测 mock，不依赖真 Docker）
- 冒烟 reward 值**不设门槛**（未训过的模型 reward=0 很正常）——通路证明 = 拿到有效 verifier 分；学习曲线证据属 M4

**Tech Stack:** Python 3.13 + torch + transformers（已装）+ stdlib http.server。pytest 一律 `-o addopts="--import-mode=importlib"`。

---

### Task 1: model_server.py — OpenAI 兼容本地模型服务

**Files:**
- Create: `agenticx/rl/model_server.py`
- Test: `tests/rl/test_model_server.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/rl/test_model_server.py
import json
import threading
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `python3 -m pytest tests/rl/test_model_server.py -v -o addopts="--import-mode=importlib"`
Expected: FAIL（ModuleNotFoundError）

- [ ] **Step 3: 最小实现**

```python
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
```

- [ ] **Step 4: 跑测试确认通过**（5 PASS）

注意：`test_unknown_paths_return_404` 需 `import urllib.error`（urllib.request 只暴露部分）；若 NameError 在测试文件头部加 `import urllib.error`。

- [ ] **Step 5: Commit**

```bash
git add agenticx/rl/model_server.py tests/rl/test_model_server.py
git commit -m "feat(rl): OpenAI-compatible local model server (stdlib) for agent/harbor integration"
```

---

### Task 2: harbor_reward.py — harbor trial → reward 适配器

**Files:**
- Create: `agenticx/rl/harbor_reward.py`
- Test: `tests/rl/test_harbor_reward.py`

- [ ] **Step 1: 写失败测试**

```python
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
    cfg = make_trial_config("/tasks/foo", "test-rl-model")
    assert cfg["task"] == "/tasks/foo"
    assert cfg["agent"] == {"name": "agenticx", "model_name": "test-rl-model"}


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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `python3 -m pytest tests/rl/test_harbor_reward.py -v -o addopts="--import-mode=importlib"`
Expected: FAIL（ModuleNotFoundError）

- [ ] **Step 3: 最小实现**

```python
# agenticx/rl/harbor_reward.py
"""harbor 任务 reward 适配（P1 · M3）：RSI 任务 → GRPO reward 信号。

通路: 训练中 LM（model_server OpenAI 兼容服务）← agenticx agent
      （OPENAI_BASE_URL）→ harbor trial（容器任务+verifier）→ result.json。
M4 的 HarborRolloutEngine 将把本模块接入 GRPOTrainer 的 reward_fn。
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any, Callable


def make_agent_env(base_url: str, api_key: str = "dummy") -> dict[str, str]:
    """agenticx agent 连本地模型服务的环境变量（继承当前环境）。"""
    env = dict(os.environ)
    env["OPENAI_BASE_URL"] = base_url
    env["OPENAI_API_KEY"] = api_key
    return env


def make_trial_config(task_path: str, model_name: str) -> dict[str, Any]:
    """harbor trial config（schema 同 harness-lab/jobs/*/config.json 的子集）。"""
    return {"task": task_path,
            "agent": {"name": "agenticx", "model_name": model_name}}


def extract_reward(trial_dir: Path) -> float:
    """从 trial 目录的 result.json 提取 verifier reward（0.0/1.0）。"""
    p = Path(trial_dir) / "result.json"
    if not p.exists():
        raise FileNotFoundError(f"缺少 result.json: {p}")
    r = json.loads(p.read_text())
    return float(r["verifier_result"]["rewards"]["reward"])


def run_harbor_trial(task_path: str, model_name: str, base_url: str, *,
                     trials_dir: Path, runner: Callable | None = None,
                     timeout: float = 1800.0) -> tuple[float, Path]:
    """起一个 harbor trial 并返回 (reward, trial_dir)。

    runner 注入点供测试 mock；真实路径 = subprocess `harbor trial start`。
    trials_dir 下取 mtime 最新的含 result.json 的子目录为本次 trial。
    """
    trials_dir = Path(trials_dir)
    trials_dir.mkdir(parents=True, exist_ok=True)
    cfg_path = trials_dir / "config.json"
    cfg_path.write_text(json.dumps(make_trial_config(task_path, model_name)))

    cmd = ["harbor", "trial", "start", "-p", task_path, "-c", str(cfg_path),
           "--trials-dir", str(trials_dir)]
    if runner is None:
        def runner(cmd, env, timeout):              # noqa: F811
            subprocess.run(cmd, env=env, timeout=timeout, check=True)
    runner(cmd, make_agent_env(base_url), timeout)

    candidates = [d for d in trials_dir.iterdir()
                  if d.is_dir() and (d / "result.json").exists()]
    if not candidates:
        raise RuntimeError(f"harbor trial 未产出 result.json（{trials_dir}）")
    trial_dir = max(candidates, key=lambda d: d.stat().st_mtime)
    return extract_reward(trial_dir), trial_dir
```

- [ ] **Step 4: 跑测试确认通过**（7 PASS）

- [ ] **Step 5: Commit**

```bash
git add agenticx/rl/harbor_reward.py tests/rl/test_harbor_reward.py
git commit -m "feat(rl): harbor trial reward adapter — task container → verifier reward extraction"
```

---

### Task 3: scripts/rl_smoke_harbor.py — 端到端 reward 通路冒烟（MPS + Docker）

**Files:**
- Create: `scripts/rl_smoke_harbor.py`

- [ ] **Step 1: 实现冒烟脚本**（纯脚本；由子代理与父代理各真跑一次）

```python
#!/usr/bin/env python3
"""RSI 任务 reward 通路冒烟（P1 · M3）：本地模型服务 → harbor trial → verifier reward。

用法:
  python3 scripts/rl_smoke_harbor.py --dry                 # 只验证 server 连通+config
  python3 scripts/rl_smoke_harbor.py --task harness-lab/terminal-bench/<task> [--model Qwen/Qwen3-0.6B]
PASS 标准: dry = server 响应 /v1/models 与 chat completion；真跑 = 拿到 0/1 reward
（未训过的模型 reward=0 属预期，本门只证通路；学习曲线证据属 M4）。
"""
from __future__ import annotations

import argparse
import json
import sys
import threading
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agenticx.rl.device import detect_device  # noqa: E402
from agenticx.rl.harbor_reward import run_harbor_trial  # noqa: E402
from agenticx.rl.model_server import serve_model  # noqa: E402


def _get(port, path):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=60) as r:
        return json.loads(r.read())


def _chat(port, model_id):
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/v1/chat/completions", method="POST",
        data=json.dumps({"model": model_id, "max_tokens": 8,
                         "temperature": 0.0,
                         "messages": [{"role": "user", "content": "Say hi"}]}).encode(),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())["choices"][0]["message"]["content"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--task", default=None,
                    help="terminal-bench 任务目录（真跑模式必填）")
    ap.add_argument("--model", default="Qwen/Qwen3-0.6B")
    ap.add_argument("--dry", action="store_true",
                    help="只验证模型服务连通，不起容器")
    ap.add_argument("--trials-dir", default="/tmp/agenticx_rl_harbor_smoke")
    ap.add_argument("--timeout", type=float, default=1800.0)
    args = ap.parse_args()

    if not args.dry and not args.task:
        print("[smoke-harbor] FAIL: 真跑模式需要 --task（或用 --dry）")
        return 1

    from transformers import AutoModelForCausalLM, AutoTokenizer

    info = detect_device()
    print(f"[smoke-harbor] device={info.kind} model={args.model} dry={args.dry}")
    t0 = time.time()
    tok = AutoTokenizer.from_pretrained(args.model)
    lm = AutoModelForCausalLM.from_pretrained(args.model)
    lm.to(dtype=info.dtype, device=info.torch_device)
    srv = serve_model(lm, tok, model_id="agenticx-rl")
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]
    print(f"[smoke-harbor] server up on 127.0.0.1:{port} "
          f"(load {time.time() - t0:.1f}s)")

    try:
        models = _get(port, "/v1/models")
        assert models["data"][0]["id"] == "agenticx-rl"
        content = _chat(port, "agenticx-rl")
        print(f"[smoke-harbor] /v1/models ok; chat completion: {content!r}")
        if args.dry:
            print("[smoke-harbor] PASS (dry: server 连通)")
            return 0

        reward, trial_dir = run_harbor_trial(
            args.task, "agenticx-rl", f"http://127.0.0.1:{port}/v1",
            trials_dir=Path(args.trials_dir), timeout=args.timeout)
        print(f"[smoke-harbor] trial={trial_dir.name} reward={reward}")
        print(f"[smoke-harbor] PASS (reward 通路打通: verifier={reward})")
        return 0
    finally:
        srv.shutdown()


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: 本机真跑**
  - dry：`python3 scripts/rl_smoke_harbor.py --dry` → PASS（MPS 起 Qwen3-0.6B server，chat completion 返回文本）
  - 真跑：先从 `harness-lab/terminal-bench/` 挑一个**轻任务**（优先：Dockerfile 无大 apt 下载、`docker images` 里已有可复用镜像；任务目录含 task.yaml/Makefile 的都行），`python3 scripts/rl_smoke_harbor.py --task <path>`。容器构建+agent 跑+verifier 可能 3-15 分钟，耐心等。
  - 若镜像构建超 10 分钟或 Docker 异常：记录现象，降级为 dry PASS + 把该任务列入"真机验证清单"，不算失败（本机是通路验证，不是性能验证）。

- [ ] **Step 3: 全量回归**

Run: `python3 -m pytest tests/rl/ tests/trajectory/ tests/trainer/ -o addopts="--import-mode=importlib" -q`
Expected: 全 PASS（SP11 基线 127 + 新增 12 = 139）

- [ ] **Step 4: Commit**

```bash
git add scripts/rl_smoke_harbor.py
git commit -m "feat(rl): harbor reward-path smoke — local model server → container task → verifier reward"
```

---

## 真机验证清单（GPU/昇腾机到位后，零代码改动）

| 项 | 动作 | 验证 |
|---|---|---|
| vLLM serve 模式 | GPU 机用 vLLM 起 OpenAI 服务替代本脚本 server | harbor reward 通路同款冒烟 |
| 全量任务集 | `harbor run` 批量（run_full.py 先例） | GRPO 大 batch 训练（M4） |
| 昇腾 | vllm-ascend + torch_npu | 同上 |
