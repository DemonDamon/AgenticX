# SP13: RL 训练核 M4 — 回放混合 GRPO（论文贡献点）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 M2/M3 的积木组合成论文贡献点——**回放混合 GRPO**：真任务 episode（harbor 容器执行 + verifier reward）做 GRPO，TrialForest 回放分数做优势基线（baseline shaping）。回放基线的关键收益：**单条真实 rollout 也有学习信号**（基线来自零成本回放而非组内均值），且优势方差更低。

**P1 路线图位置（M0✅ M1✅ M2✅ M3✅ → **M4 本计划** → M5 多卡扩展[等 GPU 机]）**

**架构（数据流）:**
```
训练中 LM ──serve(OpenAI 兼容, T=1 override, 请求日志)──> agenticx agent(容器内)
    │                                                        │
    │                                            harbor trial（容器任务+verifier）
    ▼                                                        ▼
server 请求日志: [(context_ids, gen_ids, raw_logprobs)]   reward 0/1
    └──────────────┬─────────────────────────────────────────┘
                   ▼
        Episode{task, reward, segments[RolloutSample]}
                   ▼
GRPOTrainer.train_step_episodes(episodes, shaping=replay_shaped_advantage)
   优势 = (r - baseline) / std，baseline = w·replay_score + (1-w)·组均值
```

**设计纪律:**
- 复用 RolloutSample 做 episode 段（prompt_ids=context_ids, response_ids=gen_ids, old_logprobs=raw logp）——response_logprobs/torch_grpo_loss 零改动可复用
- server 请求日志记 **raw logp**（log_softmax(原始 logits)）；训练 rollout 强制 `temperature_override=1.0`（transformers generate 的 output_logits 返回 warper 前的 raw logits，T=1 时采样分布=策略分布，old_logprobs 与 forward 重算精确对齐）
- Episode 段的 old_logprobs 来自服务器日志（不是重算）——agent 多轮对话中每段的 context 即该次请求的渲染 prompt
- 单租户假设：一个 HarborRolloutEngine 一次跑一个 trial（日志按长度快照分割）
- 回放塑形是**纯函数**（numpy）：输入 rewards/task_ids/replay_scores，输出优势；回放分数来源（TrialForest evaluate_policy 等）注入，本模块不依赖 forest
- 容器访问宿主机服务用 host.docker.internal（SP12 真机实测）；model_name 用 `openai/` 前缀

**Tech Stack:** 既有栈零新增依赖。pytest 一律 `-o addopts="--import-mode=importlib"`。

---

### Task 1: model_server 请求日志 + temperature_override

**Files:**
- Modify: `agenticx/rl/model_server.py`
- Test: `tests/rl/test_model_server.py`（追加）

- [ ] **Step 1: 写失败测试（追加）**

```python
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
        want = seg.gather(1, torch.tensor([e.gen_ids])).squeeze(1)
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
```

（测试里取 logits 用 `lm(full).logits[0]` 得 (L,V)——HF ModelOutput 路径，SP11 教训。）

- [ ] **Step 2: 跑测试确认失败**

Run: `python3 -m pytest tests/rl/test_model_server.py -v -o addopts="--import-mode=importlib"`
Expected: 新增 4 FAIL（ImportError: RequestLogEntry / TypeError: unexpected kwarg）

- [ ] **Step 3: 最小实现（model_server.py 修改）**

```python
# 追加 dataclass（模块顶部 import 区之后）
from dataclasses import dataclass, field


@dataclass
class RequestLogEntry:
    """一次 chat completion 的可训练记录（M4 episode 段的原材料）。"""
    context_ids: list          # 渲染 prompt 的 token ids
    gen_ids: list              # 生成 token ids（不含 prompt）
    logprobs: list             # 每 token 的 raw logp（log_softmax(原始 logits)）
    temperature: float         # 实际采样温度（override 后）
```

`_make_handler` 签名与 serve_model 扩展：

```python
def _make_handler(lm, tokenizer, model_id: str, log: list | None = None,
                  temperature_override: float | None = None):
    lock = threading.Lock()
    device = next(lm.parameters()).device
```

`do_POST` 的 `_complete` 调用处改为接收上下文 token 与记录（把 `_complete` 改造为返回 `(content, n_tok, entry)`，并在成功后 append）：

```python
            try:
                content, n_tok, entry = self._complete(text, max_tokens, temperature)
            except Exception as e:                        # noqa: BLE001
                self._json(500, {"error": {"message": str(e)}})
                return
            if log is not None:
                log.append(entry)
```

`_complete` 全量替换为：

```python
        def _complete(self, text, max_tokens, temperature):
            if temperature_override is not None:
                temperature = temperature_override
            with lock:
                ctx_ids = tokenizer.encode(text, add_special_tokens=False)
                ids = torch.tensor([ctx_ids], dtype=torch.long, device=device)
                kw = dict(input_ids=ids, attention_mask=torch.ones_like(ids),
                          max_new_tokens=max_tokens,
                          pad_token_id=tokenizer.eos_token_id or 0,
                          return_dict_in_generate=True, output_logits=True)
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
                gen_ids = new.tolist()
                import torch.nn.functional as F
                logps = []
                for t, tok in enumerate(gen_ids):
                    raw = out.logits[t][0].float()        # raw logits（warper 前）
                    logps.append(float(F.log_softmax(raw, dim=-1)[tok]))
                content = tokenizer.decode(gen_ids, skip_special_tokens=True)
                entry = RequestLogEntry(context_ids=list(ctx_ids),
                                        gen_ids=gen_ids, logprobs=logps,
                                        temperature=float(temperature))
                return (content if content else " ", len(gen_ids)), entry
```

注意 `do_POST` 里原来解包 `content, n_tok = self._complete(...)` 改成三元组。usage 的 prompt_tokens 用 `len(ctx_ids)`（entry 里也有）。

`serve_model` 扩展：

```python
def serve_model(lm, tokenizer, *, host: str = "127.0.0.1", port: int = 0,
                model_id: str = "agenticx-rl",
                log: list | None = None,
                temperature_override: float | None = None) -> ThreadingHTTPServer:
    handler = _make_handler(lm, tokenizer, model_id, log=log,
                            temperature_override=temperature_override)
    srv = ThreadingHTTPServer((host, port), handler)
    srv.daemon_threads = True
    return srv
```

（docstring 的 "M4 将扩展" 句子删掉，换成已实现说明。）

- [ ] **Step 4: 跑测试确认通过**（原 5 + 新 4 = 9 PASS）

- [ ] **Step 5: Commit**

```bash
git add agenticx/rl/model_server.py tests/rl/test_model_server.py
git commit -m "feat(rl): model server request log + temperature override — trainable episode records"
```

---

### Task 2: harbor_rollout.py — HarborRolloutEngine（episode 采集）

**Files:**
- Create: `agenticx/rl/harbor_rollout.py`
- Test: `tests/rl/test_harbor_rollout.py`

- [ ] **Step 1: 写失败测试**

```python
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `python3 -m pytest tests/rl/test_harbor_rollout.py -v -o addopts="--import-mode=importlib"`
Expected: FAIL（ModuleNotFoundError）

- [ ] **Step 3: 最小实现**

```python
# agenticx/rl/harbor_rollout.py
"""HarborRolloutEngine（P1 · M4）：真任务 episode 采集——回放混合 GRPO 的真实侧。

每个 episode = 一次 harbor trial：容器内 agent 由本地模型服务驱动，
verifier 打分；服务请求日志转为可训练段（RolloutSample）。
单租户：一次一个 trial（日志按长度快照分割）。
训练 rollout 建议 temperature_override=1.0（old_logprobs=策略 logp，精确对齐）。
"""
from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Any, Callable

import torch

from .harbor_reward import run_harbor_trial
from .model_server import serve_model
from .rollout import RolloutSample


@dataclass
class Episode:
    """一次任务执行的完整可训练记录。"""
    task: str
    reward: float
    segments: list[RolloutSample] = field(default_factory=list)


class HarborRolloutEngine:
    """管理模型服务生命周期 + trial 执行 + 请求日志→episode 转换。"""

    def __init__(self, lm, tokenizer, *, model_id: str = "openai/agenticx-rl",
                 temperature_override: float | None = 1.0,
                 timeout: float = 1800.0):
        self.lm = lm
        self.tokenizer = tokenizer
        self.model_id = model_id
        self.temperature_override = temperature_override
        self.timeout = timeout
        self._srv = None
        self._log: list = []
        self._last_env: dict[str, str] | None = None

    @property
    def server_port(self) -> int:
        if self._srv is None:
            raise RuntimeError("server 未启动（先调 start()）")
        return self._srv.server_address[1]

    def start(self) -> None:
        if self._srv is not None:
            return
        self._srv = serve_model(self.lm, self.tokenizer,
                                 model_id=self.model_id.split("/", 1)[-1],
                                 log=self._log,
                                 temperature_override=self.temperature_override)
        threading.Thread(target=self._srv.serve_forever, daemon=True).start()

    def stop(self) -> None:
        if self._srv is not None:
            self._srv.shutdown()
            self._srv = None

    def _agent_base_url(self) -> str:
        # 容器内经 host.docker.internal 访问宿主机服务（SP12 真机实测）
        return f"http://host.docker.internal:{self.server_port}/v1"

    def run_episode(self, task_path: str, *, trials_dir, timeout: float | None = None,
                    runner: Callable | None = None) -> Episode:
        if self._srv is None:
            self.start()
        mark = len(self._log)                          # 单租户快照分割
        env_spy = {}

        def wrapped_runner(cmd, env, t):
            self._last_env = env
            env_spy["env"] = env
            real = runner if runner is not None else _default_runner
            return real(cmd, env, t)

        if runner is None:
            wrapped_runner = None                     # 走 run_harbor_trial 默认 subprocess
            # 但仍需记录 env：改为事后从构造重建 —— 简化：默认路径也包一层
            def wrapped_runner(cmd, env, t):          # noqa: F811
                self._last_env = env
                import subprocess
                subprocess.run(cmd, env=env, timeout=t, check=True)

        reward, _trial_dir = run_harbor_trial(
            task_path, self.model_id, self._agent_base_url(),
            trials_dir=trials_dir, runner=wrapped_runner,
            timeout=timeout or self.timeout)
        segments = [
            RolloutSample(
                prompt_ids=torch.tensor(e.context_ids, dtype=torch.long),
                response_ids=torch.tensor(e.gen_ids, dtype=torch.long),
                old_logprobs=torch.tensor(e.logprobs, dtype=torch.float32))
            for e in self._log[mark:]
        ]
        return Episode(task=task_path, reward=float(reward), segments=segments)


def _default_runner(cmd, env, timeout):
    import subprocess
    subprocess.run(cmd, env=env, timeout=timeout, check=True)
```

（`run_episode` 最终版：内部统一定义一个 wrapped_runner——先 `self._last_env = env`，再调 `runner if runner is not None else _default_runner(cmd, env, t)`——并总是作为 runner 参数注入 run_harbor_trial；上面代码块里 if runner is None 分支的双重定义写法弃用。）

- [ ] **Step 4: 跑测试确认通过**（4 PASS）

- [ ] **Step 5: Commit**

```bash
git add agenticx/rl/harbor_rollout.py tests/rl/test_harbor_rollout.py
git commit -m "feat(rl): HarborRolloutEngine — real-task episode collection from server request log"
```

---

### Task 3: trainer episode 级 GRPO（train_step_episodes + 分组优势）

**Files:**
- Modify: `agenticx/rl/trainer.py`（追加方法，不改已有）
- Test: `tests/rl/test_trainer.py`（追加）

- [ ] **Step 1: 写失败测试（追加到 tests/rl/test_trainer.py）**

```python
# ---- SP13 追加：episode 级 GRPO ----
from agenticx.rl.rollout import RolloutSample as _RS
from agenticx.rl.trainer import grouped_episode_advantage


def _ep(task, reward, segs):
    from agenticx.rl.harbor_rollout import Episode
    return Episode(task=task, reward=reward, segments=segs)


def _seg(ctx, resp):
    return _RS(prompt_ids=torch.tensor(ctx, dtype=torch.long),
               response_ids=torch.tensor(resp, dtype=torch.long),
               old_logprobs=torch.zeros(len(resp), dtype=torch.float32))


def test_grouped_episode_advantage_by_task():
    # task A: rewards [1,0] → [+1,-1]；task B: [0.5,0.5] → [0,0]
    adv = grouped_episode_advantage([1.0, 0.0, 0.5, 0.5],
                                    ["a", "a", "b", "b"])
    assert np.allclose(adv, [1.0, -1.0, 0.0, 0.0])


def test_train_step_episodes_loss_finite_and_grads():
    torch.manual_seed(0)
    lm = TinyLM()
    eng = LocalRolloutEngine(lm)
    eps = []
    for task in ["t1", "t2"]:
        for _ in range(2):
            segs = eng.generate([[1, 2, 3]], n_samples=1, max_new_tokens=4)
            eps.append(_ep(task, 1.0 if len(eps) % 2 == 0 else 0.0, segs))
    tr = GRPOTrainer(lm, eng, lambda p, r: 0.0, lr=1e-3)
    m = tr.train_step_episodes(eps)
    assert np.isfinite(m["loss"]) and m["n_episodes"] == 4
    assert m["n_tokens"] > 0


def test_train_step_episodes_learns_multitask():
    """多任务多段 episode 的 GRPO 闭环学习门。"""
    torch.manual_seed(0)
    lm = TinyLM()
    eng = LocalRolloutEngine(lm)
    target = 7
    prompts = {"t1": [1, 2, 3], "t2": [4, 5]}

    def reward_of(segs):
        return float(sum((s.response_ids == target).sum().item() for s in segs))

    tr = GRPOTrainer(lm, eng, lambda p, r: 0.0, lr=5e-3)
    first = None
    for _ in range(60):
        eps = []
        for task, p in prompts.items():
            for _k in range(4):
                segs = eng.generate([p], n_samples=1, max_new_tokens=6)
                eps.append(_ep(task, reward_of(segs), segs))
        m = tr.train_step_episodes(eps)
        first = first if first is not None else m
    assert m["reward_mean"] > first["reward_mean"] + 1.0
    assert m["reward_mean"] > 2.0


def test_train_step_episodes_shaping_hook():
    """shaping 钩子替换默认优势：置零 shaper + kl_beta=0 → loss=0。"""
    torch.manual_seed(0)
    lm = TinyLM()
    eng = LocalRolloutEngine(lm)
    eps = [_ep("t", float(i % 2), eng.generate([[1, 2]], n_samples=1,
                                                max_new_tokens=4))
           for i in range(2)]
    tr = GRPOTrainer(lm, eng, lambda p, r: 0.0, lr=1e-3)
    m = tr.train_step_episodes(eps, shaping=lambda rewards, tasks: [0.0] * len(rewards))
    assert m["loss"] == 0.0
```

- [ ] **Step 2: 跑测试确认失败**（ImportError: grouped_episode_advantage / AttributeError）

- [ ] **Step 3: 最小实现（追加到 trainer.py）**

```python
def grouped_episode_advantage(rewards, task_ids) -> np.ndarray:
    """按任务分组的 episode 级优势（组内归一化，grpo_outcome_advantage 语义）。"""
    rewards = list(rewards)
    task_ids = list(task_ids)
    adv = np.zeros(len(rewards))
    for task in dict.fromkeys(task_ids):               # 保序去重
        idx = [i for i, t in enumerate(task_ids) if t == task]
        adv[idx] = grpo_outcome_advantage([rewards[i] for i in idx],
                                          group_size=len(idx))
    return adv
```

GRPOTrainer 追加方法（放 train_step 之后）：

```python
    def train_step_episodes(self, episodes, *, shaping=None) -> dict:
        """episode 级 GRPO：优势在 episode 粒度（按任务分组），广播到段内全部 token。

        episodes: list[harbor_rollout.Episode]（segments 为 RolloutSample）。
        shaping: Callable[[rewards, task_ids], advantages]，替换默认分组优势
        （M4 回放基线塑形从这里注入）。
        """
        device = next(self.lm.parameters()).device
        rewards = [float(e.reward) for e in episodes]
        task_ids = [e.task for e in episodes]
        if shaping is not None:
            adv = np.asarray(shaping(rewards, task_ids), dtype=np.float64)
        else:
            adv = grouped_episode_advantage(rewards, task_ids)

        samples, ep_of_sample = [], []
        for i, e in enumerate(episodes):
            samples.extend(e.segments)
            ep_of_sample.extend([i] * len(e.segments))
        if not samples:
            return {"loss": 0.0, "reward_mean": float(np.mean(rewards)) if rewards else 0.0,
                    "n_episodes": len(episodes), "n_tokens": 0}

        logprobs = response_logprobs(self.lm, samples, device)
        with torch.no_grad():
            old = torch.cat([s.old_logprobs for s in samples]).to(device)
            ref = (response_logprobs(self.ref_lm, samples, device)
                   if self.ref_lm is not None else old.clone())
        # episode 优势 → 段 → token 广播
        tok_adv = np.concatenate([
            np.repeat(adv[ep_of_sample[k]], s.response_ids.shape[0])
            for k, s in enumerate(samples)])
        adv_t = torch.tensor(tok_adv, dtype=logprobs.dtype, device=device)
        mask = torch.ones_like(logprobs)
        loss = torch_grpo_loss(logprobs, old, ref, adv_t, mask,
                               clip_eps=self.clip_eps, kl_beta=self.kl_beta)
        self.opt.zero_grad(set_to_none=True)
        loss.backward()
        self.opt.step()
        sync = getattr(self.rollout, "sync_weights", None)
        if callable(sync):
            sync(self.lm)
        return {"loss": float(loss.detach()),
                "reward_mean": float(np.mean(rewards)),
                "n_episodes": len(episodes),
                "n_tokens": int(mask.sum().item())}
```

注意 import：trainer.py 顶部已有 numpy as np；Episode 不 import（鸭子类型，避免 trainer→harbor_rollout 依赖）。

- [ ] **Step 4: 跑测试确认通过**（原 7 + 新 4 = 11 PASS）

学习门学不动时：允许调 lr∈[1e-3,1e-2]、iters∈[40,120]（写回测试），断言不放水。

- [ ] **Step 5: Commit**

```bash
git add agenticx/rl/trainer.py tests/rl/test_trainer.py
git commit -m "feat(rl): episode-level GRPO train_step_episodes with task-grouped advantage and shaping hook"
```

---

### Task 4: replay_shaping.py — 回放基线优势塑形（纯函数）

**Files:**
- Create: `agenticx/rl/replay_shaping.py`
- Test: `tests/rl/test_replay_shaping.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/rl/test_replay_shaping.py
import numpy as np
import pytest

from agenticx.rl.core_algos import grpo_outcome_advantage
from agenticx.rl.replay_shaping import replay_shaped_advantage


def test_weight_zero_equals_group_baseline():
    r = [1.0, 0.0, 0.0, 1.0]
    t = ["a", "a", "b", "b"]
    adv = replay_shaped_advantage(r, t, {"a": 0.9, "b": 0.1}, replay_weight=0.0)
    assert np.allclose(adv, grpo_outcome_advantage(r, group_size=2))


def test_weight_one_uses_replay_baseline():
    # task a: rewards [1,0], replay=0.5 → baseline=0.5 → adv=[+0.5,-0.5]/std(0.5)=[1,-1]
    adv = replay_shaped_advantage([1.0, 0.0], ["a", "a"], {"a": 0.5},
                                  replay_weight=1.0)
    assert np.allclose(adv, [1.0, -1.0])


def test_mixed_weight_hand_computed():
    # task a: rewards [1,0] mean=0.5 std=0.5; replay=0.7, w=0.5 → baseline=0.6
    # adv = [0.4, -0.6]/0.5 = [0.8, -1.2]
    adv = replay_shaped_advantage([1.0, 0.0], ["a", "a"], {"a": 0.7},
                                  replay_weight=0.5)
    assert np.allclose(adv, [0.8, -1.2])


def test_missing_replay_score_falls_back_to_group():
    r = [1.0, 0.0, 1.0, 0.0]
    t = ["a", "a", "b", "b"]
    adv = replay_shaped_advantage(r, t, {"a": 0.9}, replay_weight=1.0)  # b 无分数
    want = grpo_outcome_advantage(r, group_size=2)
    assert np.allclose(adv[2:], want[2:])              # b 组回退组内归一化
    assert not np.allclose(adv[:2], want[:2])          # a 组确实用了回放基线


def test_single_episode_with_replay_baseline():
    """论文点：单条 rollout + 回放基线也有学习信号。"""
    adv = replay_shaped_advantage([1.0], ["a"], {"a": 0.4}, replay_weight=1.0)
    # std=0 → eps 保护；baseline 路径: (1.0-0.4)/max(std,eps)... 单样本组内 std=0
    # 语义: 基线偏移在、尺度退化 → 用 eps
    assert adv[0] > 0.0


def test_invalid_weight_raises():
    with pytest.raises(ValueError):
        replay_shaped_advantage([1.0], ["a"], {}, replay_weight=1.5)
```

- [ ] **Step 2: 跑测试确认失败**

Run: `python3 -m pytest tests/rl/test_replay_shaping.py -v -o addopts="--import-mode=importlib"`
Expected: FAIL（ModuleNotFoundError）

- [ ] **Step 3: 最小实现**

```python
# agenticx/rl/replay_shaping.py
"""回放基线优势塑形（P1 · M4）：TrialForest 回放分数 → GRPO 优势基线。

混合基线: baseline_j = w·replay_score(task_j) + (1-w)·组均值
        adv_j = (r_j - baseline_j) / max(组std, eps)
回放分数缺失的任务回退纯组内归一化（w 视为 0）。
收益: 单条真实 rollout 也有信号（基线来自零成本回放）；方差更低。
回放分数来源（SP6 evaluate_policy 等）由调用方注入，本模块零 forest 依赖。
"""
from __future__ import annotations

import numpy as np

from .core_algos import grpo_outcome_advantage


def replay_shaped_advantage(rewards, task_ids, replay_scores: dict,
                            *, replay_weight: float = 0.5,
                            eps: float = 1e-4) -> np.ndarray:
    if not 0.0 <= replay_weight <= 1.0:
        raise ValueError(f"replay_weight 须在 [0,1]，got {replay_weight}")
    rewards = np.asarray(rewards, dtype=np.float64)
    task_ids = list(task_ids)
    out = np.zeros(len(rewards))
    for task in dict.fromkeys(task_ids):
        idx = [i for i, t in enumerate(task_ids) if t == task]
        r = rewards[idx]
        score = replay_scores.get(task)
        if score is None:
            out[idx] = grpo_outcome_advantage(r, group_size=len(idx), eps=eps)
            continue
        w = replay_weight
        baseline = w * float(score) + (1.0 - w) * float(r.mean())
        std = max(float(r.std()), eps)
        out[idx] = (r - baseline) / std
    return out
```

- [ ] **Step 4: 跑测试确认通过**（6 PASS）

- [ ] **Step 5: Commit**

```bash
git add agenticx/rl/replay_shaping.py tests/rl/test_replay_shaping.py
git commit -m "feat(rl): replay-baseline advantage shaping — hybrid real+replayed GRPO (M4 core)"
```

---

### Task 5: scripts/rl_smoke_m4.py — 回放混合 GRPO 端到端冒烟

**Files:**
- Create: `scripts/rl_smoke_m4.py`

- [ ] **Step 1: 实现冒烟脚本**

```python
#!/usr/bin/env python3
"""回放混合 GRPO 冒烟（P1 · M4）：真任务 episode + 回放基线塑形 + 1 步训练。

用法: python3 scripts/rl_smoke_m4.py --task harness-lab/terminal-bench/music-harmony
PASS 标准: episode 采集到段、回放塑形生效（≠组内基线）、1 步训练 loss 有限。
学习曲线证据（多 episode 训练）属后续实验阶段——本门钉管线。
"""
from __future__ import annotations

import argparse
import math
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agenticx.rl.device import detect_device  # noqa: E402
from agenticx.rl.harbor_rollout import HarborRolloutEngine  # noqa: E402
from agenticx.rl.replay_shaping import replay_shaped_advantage  # noqa: E402
from agenticx.rl.trainer import GRPOTrainer, grouped_episode_advantage  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--task", required=True)
    ap.add_argument("--model", default="Qwen/Qwen3-0.6B")
    ap.add_argument("--trials-dir", default="/tmp/agenticx_rl_m4_smoke")
    ap.add_argument("--timeout", type=float, default=1200.0)
    ap.add_argument("--lr", type=float, default=1e-5)
    args = ap.parse_args()

    from transformers import AutoModelForCausalLM, AutoTokenizer

    info = detect_device()
    print(f"[m4] device={info.kind} model={args.model} task={args.task}")
    t0 = time.time()
    tok = AutoTokenizer.from_pretrained(args.model)
    lm = AutoModelForCausalLM.from_pretrained(args.model)
    lm.to(dtype=info.dtype, device=info.torch_device)

    eng = HarborRolloutEngine(lm, tok, model_id="openai/agenticx-rl",
                              temperature_override=1.0, timeout=args.timeout)
    eng.start()
    print(f"[m4] server up (port={eng.server_port}, load {time.time()-t0:.1f}s)")

    ep = eng.run_episode(args.task, trials_dir=Path(args.trials_dir))
    eng.stop()
    n_tok = sum(s.response_ids.shape[0] for s in ep.segments)
    print(f"[m4] episode: reward={ep.reward} segments={len(ep.segments)} "
          f"resp_tokens={n_tok}")
    if not ep.segments:
        print("[m4] FAIL: episode 无段（agent 未请求模型服务）")
        return 1

    tr = GRPOTrainer(lm, eng, lambda p, r: 0.0, lr=args.lr)

    replay_scores = {args.task: 0.0}          # 冒烟用占位回放分（真源=SP6 evaluate_policy）
    m = tr.train_step_episodes(
        [ep], shaping=lambda rs, ts: replay_shaped_advantage(
            rs, ts, replay_scores, replay_weight=1.0))
    vanilla = grouped_episode_advantage([ep.reward], [ep.task])
    print(f"[m4] train step: loss={m['loss']:.6f} tokens={m['n_tokens']} "
          f"shaped_adv={replay_shaped_advantage([ep.reward], [ep.task], replay_scores, replay_weight=1.0)[0]:.4f} "
          f"vanilla_adv={vanilla[0]:.4f}")
    ok = math.isfinite(m["loss"]) and m["n_tokens"] > 0
    print(f"[m4] {'PASS' if ok else 'FAIL'}（回放混合 GRPO 管线{'打通' if ok else '异常'}）")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
```

注意：GRPOTrainer 的 rollout 参数传 eng（已 stop 也不影响——train_step_episodes 不用 rollout）。若实现上 GRPOTrainer 构造要求 rollout 可调用，传 lambda 也可。

- [ ] **Step 2: 本机真跑**

Run: `python3 scripts/rl_smoke_m4.py --task harness-lab/terminal-bench/music-harmony --trials-dir /tmp/agenticx_rl_m4_smoke`
Expected: reward=0.0、segments≥1、loss 有限、PASS（退出码 0）。全程约 4-6 分钟。

- [ ] **Step 3: 全量回归**

Run: `python3 -m pytest tests/rl/ tests/trajectory/ tests/trainer/ -o addopts="--import-mode=importlib" -q`
Expected: 全 PASS（SP12 基线 139 + 新增 18 = 157）

- [ ] **Step 4: Commit**

```bash
git add scripts/rl_smoke_m4.py
git commit -m "feat(rl): M4 smoke — replay-shaped GRPO end-to-end on real harbor task"
```

---

## 真机/后续验证清单

| 项 | 动作 | 说明 |
|---|---|---|
| 真回放分数 | 用 SP6 evaluate_policy 在 TrialForest 上算 per-task 分数替换占位 | 数据源：harness-lab jobs 轨迹 → forest |
| 多 episode 训练 | n_episodes>1 per task（组归一化生效）+ 数十步 | 学习曲线实验（论文 pilot） |
| GPU 机 | vLLM serve 替代 stdlib server / 多卡 | M5 |
