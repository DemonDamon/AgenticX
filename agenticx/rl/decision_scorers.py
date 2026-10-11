# agenticx/rl/decision_scorers.py
"""决策头 scorer 库（SP26）：受限 softmax 标注机的可复用实现。

从 scripts/backfill_decisions.py 的脚本内实现提升为库：评测 harness
（eval_decision_baseline）、loop gating（SP27 DecisionRouter）、批量补标
（SP28）共用同一实现，杜绝"脚本一份、库一份"的漂移。

受限 softmax 协议（对齐 SP25 设计）：
- 单 token 输出 + top_logprobs，只在候选符号上映射 logprob 后归一
- choice/yes_no 用字母位（A/B/C…，v1 模板上限 8 个候选）承载，
  score 直接用数字串
- 未出现在 top_logprobs 的候选给 _MISS_LOGPROB(-30) 近零概率
- prompt 模板版本化：v1 与 SP25 脚本逐字节一致；换版即换数据集
  （与 state_compressor 同源的训推一致红线）
"""
from __future__ import annotations

import hashlib
import json
import math
from typing import Any, Callable

from agenticx.rl.decision import DecisionQuestion, DecisionRecord

PROMPT_VERSION = "v1"
_LETTERS = "ABCDEFGH"
_MAX_OPTIONS = len(_LETTERS)
_MISS_LOGPROB = -30.0
_TOP_LOGPROBS = 20
_DEFAULT_BASE_URL = "http://localhost:18791/v1"
DEFAULT_STARTLUX_MODEL = "StartLux-Decision-4B-Q4_K_M"

# scorer(record) -> {qid: 与该题 symbols 等长的 probs}（与 decision.Scorer 同形）
Scorer = Callable[[DecisionRecord], dict[str, tuple[float, ...]]]


def _softmax(vals: list[float]) -> tuple[float, ...]:
    m = max(vals)
    exps = [math.exp(v - m) for v in vals]
    z = sum(exps)
    return tuple(e / z for e in exps)


def candidate_keys(q: DecisionQuestion) -> tuple[str, ...]:
    """logprob 映射键，与 q.symbols 等长同序：choice/yes_no 用字母位，
    score 用数字串。"""
    if q.type == "score":
        return tuple(q.symbols)
    if len(q.symbols) > _MAX_OPTIONS:
        raise ValueError(
            f"prompt v1 候选上限 {_MAX_OPTIONS}（qid '{q.qid}' 有 "
            f"{len(q.symbols)} 个）——超限候选集需升模板版本，禁止静默截断")
    return tuple(_LETTERS[i] for i in range(len(q.symbols)))


def build_prompt(state: str, q: DecisionQuestion) -> str:
    """v1 模板：与 SP25 backfill_decisions.py 逐字节一致（pinned by test）。"""
    if q.type == "score":
        lines = "\n".join(str(s) for s in q.symbols)
        return (f"给定状态与问题，给出 0-5 分评分。只输出一个数字，不要解释。\n\n"
                f"状态:\n{state}\n\n问题: {q.question}\n候选:\n{lines}\n答案:")
    lines = "\n".join(f"{_LETTERS[i]}. {s}" for i, s in enumerate(q.symbols))
    return (f"给定状态与问题，从候选中选择最可能正确的选项。"
            f"只输出选项字母，不要解释。\n\n"
            f"状态:\n{state}\n\n问题: {q.question}\n候选:\n{lines}\n答案:")


def probs_from_logprobs(q: DecisionQuestion,
                        top_logprobs: dict[str, float]) -> tuple[float, ...]:
    """候选符号上的受限 softmax：未命中候选给 -30 近零概率。"""
    keys = candidate_keys(q)
    vals = [top_logprobs.get(k, _MISS_LOGPROB) for k in keys]
    return _softmax(vals)


def mock_scorer(rec: DecisionRecord) -> dict[str, tuple[float, ...]]:
    """确定性 mock：sha256(decision_id|qid|symbol) 加权 softmax，冒烟管线用。

    与 SP25 脚本版逐字节一致（迁移非重写）。
    """
    out: dict[str, tuple[float, ...]] = {}
    for q in rec.questions:
        ws = [
            int(hashlib.sha256(
                f"{rec.decision_id}|{q.qid}|{s}".encode()).hexdigest()[:4], 16)
            for s in q.symbols
        ]
        m = max(ws)
        exps = [math.exp((w - m) / 4096.0) for w in ws]  # 近均匀，冒烟无偏向要求
        z = sum(exps)
        out[q.qid] = tuple(e / z for e in exps)
    return out


class OpenAICompatScorer:
    """受限 softmax 标注机：openai 兼容端点，max_tokens=1 + top_logprobs。

    client 可注入（测试用 fake）；缺省懒加载 openai 依赖——库不引入硬依赖。
    注意：对 StartLux-Decision GGUF 直接字母读出缺少官方的温度校准与
    prompt 口径（模型卡明示 plain chat ≠ decisions），优先用 SystemOneScorer。
    """

    def __init__(self, *, base_url: str = _DEFAULT_BASE_URL, model: str,
                 temperature: float = 0.0, client: Any = None):
        if client is None:
            try:
                from openai import OpenAI
            except ImportError as e:  # pragma: no cover
                raise RuntimeError(f"缺 openai 依赖: {e}") from e
            client = OpenAI(base_url=base_url, api_key="local")
        self._client = client
        self.model = model
        self.temperature = temperature

    def _score_one(self, state: str, q: DecisionQuestion) -> tuple[float, ...]:
        resp = self._client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": build_prompt(state, q)}],
            max_tokens=1, temperature=self.temperature,
            logprobs=True, top_logprobs=_TOP_LOGPROBS,
        )
        top = resp.choices[0].logprobs.content[0].top_logprobs or []
        lp = {t.token.strip(): t.logprob for t in top}
        return probs_from_logprobs(q, lp)

    def __call__(self, rec: DecisionRecord) -> dict[str, tuple[float, ...]]:
        return {q.qid: self._score_one(rec.state, q) for q in rec.questions}


# systemone 默认端口：官方 gguf_server --port 8090（llama-server 在 8081）
_DEFAULT_SYSTEMONE_URL = "http://127.0.0.1:8090"
_MAX_SCORE_LEVELS = 10   # jevfmt.MAX_LEVELS


def _systemone_spec(q: DecisionQuestion) -> dict:
    """DecisionQuestion → /v1/systemone question spec。

    - choice：criteria = {选项名: None}（无描述时官方渲染只显示 id）
    - yes_no → noul（官方固定 true/false，渲染为 yes/no）
    - score：levels = scale 区间长度，无图例描述
    """
    if q.type == "choice":
        return {"type": "choice", "instructions": q.question,
                "criteria": {str(o): None for o in q.symbols}}
    if q.type == "yes_no":
        return {"type": "noul", "instructions": q.question}
    lo, hi = q.scale
    n = hi - lo + 1
    if not 2 <= n <= _MAX_SCORE_LEVELS:
        raise ValueError(f"score 档数 {n} 超出 systemone 支持 2..{_MAX_SCORE_LEVELS}")
    return {"type": "score", "instructions": q.question,
            "criteria": [None] * n}


def _systemone_probs(q: DecisionQuestion, ans: dict) -> tuple[float, ...]:
    """官方 answer → 与 q.symbols 等长同序的 probs。"""
    t = ans.get("type")
    if t == "noul":
        p_yes = float(ans["noul"])
        return (p_yes, 1.0 - p_yes)          # symbols 固定 (yes, no)
    probs = ans.get("probabilities") or {}
    if t == "score":
        return tuple(float(probs[str(i)]) for i in range(len(q.symbols)))
    out = [float(probs.get(str(s), 0.0)) for s in q.symbols]
    z = sum(out)
    return tuple(v / z for v in out) if z > 0 else tuple(1 / len(out) for _ in out)


class SystemOneScorer:
    """StartLux-Decision 官方 /v1/systemone 协议适配器（优先接入路径）。

    官方 server（startlux_decision.gguf_server，Apache-2.0）承担 prompt
    渲染、字母位读出与每题型温度校准（decision_config.json）——比通用
    openai 字母读出更忠实于原模型口径。单选项 choice 由官方短路 conf=1.0
    （真实 TB 轨迹 bash-only 的退化场景由此显式暴露）。

    transport 可注入（测试用 fake）；缺省 urllib，无第三方依赖。
    """

    def __init__(self, *, base_url: str = _DEFAULT_SYSTEMONE_URL,
                 transport: Any = None, timeout: float = 120.0):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._transport = transport  # callable(url, payload) -> resp_dict

    def _post(self, url: str, payload: dict) -> dict:
        if self._transport is not None:
            return self._transport(url, payload)
        import urllib.request
        body = json.dumps(payload, ensure_ascii=False).encode()
        req = urllib.request.Request(
            url, body, {"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=self.timeout) as r:
            out = json.loads(r.read())
        if "error" in out:
            raise RuntimeError(f"systemone: {out['error']}")
        return out

    def __call__(self, rec: DecisionRecord) -> dict[str, tuple[float, ...]]:
        specs = {q.qid: _systemone_spec(q) for q in rec.questions}
        resp = self._post(f"{self.base_url}/v1/systemone",
                          {"state": rec.state, "questions": specs})
        answers = resp["answers"]
        return {q.qid: _systemone_probs(q, answers[q.qid])
                for q in rec.questions}


def make_scorer(name: str, *, model: str = "",
                base_url: str = "",
                temperature: float = 0.0,
                client: Any = None,
                transport: Any = None) -> tuple[Scorer, str]:
    """scorer 工厂：返回 (scorer, teacher_model 标识)。

    - mock：确定性哈希，无网可跑
    - openai：任意 openai 兼容端点的通用字母读出（model 必填）；
      对 StartLux GGUF 缺官方温度校准，仅作 fallback
    - startlux：官方 /v1/systemone 协议（scripts/serve_decision_model.sh
      起服务）；model 参数仅用于 teacher_model 标识（含量化规格），
      实际服务名由 gguf_server 决定
    """
    if name == "mock":
        return mock_scorer, "mock-v1"
    if name == "openai":
        if not model:
            raise ValueError("openai scorer 需要 model")
        return (OpenAICompatScorer(
            base_url=base_url or _DEFAULT_BASE_URL, model=model,
            temperature=temperature, client=client),
            model)
    if name == "startlux":
        m = model or DEFAULT_STARTLUX_MODEL
        return (SystemOneScorer(
            base_url=base_url or _DEFAULT_SYSTEMONE_URL, transport=transport),
                f"startlux:{m}:systemone")
    if name == "trained":
        if not model:
            raise ValueError("trained scorer 需要 head 文件路径（--model）")
        from .decision_head import TrainedHead
        head = TrainedHead.load(model)   # 加载失败 raise（fail-open 在上层）
        return head, head.head_id
    raise ValueError(f"未知 scorer '{name}'（mock | openai | startlux | trained）")
