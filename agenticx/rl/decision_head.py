# agenticx/rl/decision_head.py
"""轻量决策头（SP29b）：continue_stop 域的自训头。

state 是 step-features-v1——StepFeatures(7) + AttemptContext(3) 的确定性
文本渲染（decision_policy.render_step_state）。表达力匹配的模型是轻量
分类器（logistic / 单隐层 MLP），不是 LM——训练目标统一为
p(abort | features)，三种标签源：

- execution：attempt 终局真值（outcome.ok），target = 0(pass)/1(fail)
- teacher  ：teacher 软标签（q_abort probs[0]），soft-target BCE
- mixed    ：execution BCE + λ·teacher KL（软标签作小样本正则）

推理协议对齐 decision_scorers.Scorer：
__call__(rec) -> {"q_abort": (p_abort, p_continue)}；state 解析失败 raise
（fail-open 由 DecisionHeadPolicy 兜底，不在此吞异常）。
"""
from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any

import torch

STATE_VERSION = "step-features-v1"

# 有序特征表（标准化前的原始值域；tool_success_rate 缺失 -1 → 0.5 中性值）
FEATURE_NAMES: tuple[str, ...] = (
    "step", "n_messages", "n_tool_calls", "tool_success_rate",
    "consecutive_failures", "rounds_since_progress", "est_tokens",
    "attempt_index", "attempts_remaining", "spent_so_far")

# render_step_state 的确定性逆——格式版本绑定 step-features-v1，
# 换渲染格式必须换版本（训推一致红线）。
_LINE_RE = re.compile(r"^(task|attempt|step|tool_calls|consecutive_failures"
                      r"|rounds_since_progress|est_tokens_so_far): (.*)$")


def parse_step_state(state: str) -> dict[str, float]:
    """render_step_state 文本 → 数值特征 dict（确定性逆函数）。

    raise ValueError：任何行缺失/格式漂移——宁崩不猜（fail-open 在上层）。
    """
    feats: dict[str, float] = {}
    for line in state.splitlines():
        line = line.strip()
        if not line:
            continue
        m = _LINE_RE.match(line)
        if not m:
            raise ValueError(f"state 行格式漂移: {line[:60]!r}")
        key, val = m.group(1), m.group(2)
        if key == "task":
            feats["task_id"] = val                      # 仅一致性检查，不入特征
        elif key == "attempt":
            # "1/3 (remaining: 2)" → attempt_index=0, attempts_remaining=2
            am = re.match(r"^(\d+)/(\d+) \(remaining: (\d+)\)$", val)
            if not am:
                raise ValueError(f"attempt 行格式漂移: {val!r}")
            a1, _, rem = int(am.group(1)), int(am.group(2)), int(am.group(3))
            feats["attempt_index"] = float(a1 - 1)
            feats["attempts_remaining"] = float(rem)
        elif key == "step":
            sm = re.match(r"^(\d+) of (\d+) messages$", val)
            if not sm:
                raise ValueError(f"step 行格式漂移: {val!r}")
            feats["step"] = float(sm.group(1))
            feats["n_messages"] = float(sm.group(2))
        elif key == "tool_calls":
            tm = re.match(r"^(\d+) \(success_rate: (.+)\)$", val)
            if not tm:
                raise ValueError(f"tool_calls 行格式漂移: {val!r}")
            feats["n_tool_calls"] = float(tm.group(1))
            rate = tm.group(2)
            feats["tool_success_rate"] = (0.5 if rate == "n/a"
                                          else float(rate))
        elif key == "consecutive_failures":
            feats["consecutive_failures"] = float(val)
        elif key == "rounds_since_progress":
            feats["rounds_since_progress"] = float(val)
        elif key == "est_tokens_so_far":
            em = re.match(r"^(\d+) \(budget_spent: (\d+)\)$", val)
            if not em:
                raise ValueError(f"est_tokens 行格式漂移: {val!r}")
            feats["est_tokens"] = float(em.group(1))
            feats["spent_so_far"] = float(em.group(2))
    missing = [k for k in FEATURE_NAMES if k not in feats]
    if missing:
        raise ValueError(f"state 缺特征行: {missing}")
    return feats


def _feature_vector(state: str) -> torch.Tensor:
    f = parse_step_state(state)
    return torch.tensor([f[k] for k in FEATURE_NAMES], dtype=torch.float32)


def _target_probs(rec: Any, label_source: str) -> tuple[torch.Tensor, float]:
    """(soft target [p_abort, p_continue], weight)。

    execution: outcome.ok → (0,1)/(1,0)；teacher: q_abort probs；
    mixed: execution 硬目标为主（KL 项在 loss 里另算，此处返回硬目标）。
    无可用标签 → weight=0（样本跳过）。
    """
    if label_source in ("execution", "mixed"):
        if rec.outcome is not None and rec.outcome.ok is not None:
            p = 0.0 if rec.outcome.ok else 1.0
            return torch.tensor([p, 1.0 - p]), 1.0
        if label_source == "execution":
            return torch.tensor([0.5, 0.5]), 0.0
    lab = rec.label_for("q_abort") if hasattr(rec, "label_for") else None
    if lab is not None and lab.probs and len(lab.probs) >= 2:
        return torch.tensor([float(lab.probs[0]), float(lab.probs[1])]), 1.0
    return torch.tensor([0.5, 0.5]), 0.0


class _Net(torch.nn.Module):
    """logistic（hidden=0）或单隐层 MLP + 2 路 softmax。"""

    def __init__(self, n_in: int, hidden: int = 0):
        super().__init__()
        self.body = (torch.nn.Sequential(
            torch.nn.Linear(n_in, hidden), torch.nn.ReLU(),
            torch.nn.Linear(hidden, 2)) if hidden > 0
            else torch.nn.Linear(n_in, 2))

    def forward(self, x):  # noqa: D102
        return torch.log_softmax(self.body(x), dim=-1)


class TrainedHead:
    """训好的决策头：可序列化、可作 scorer 直接消费。"""

    def __init__(self, net: _Net, mean: torch.Tensor, std: torch.Tensor,
                 meta: dict):
        self.net = net
        self.net.eval()
        self.mean = mean
        self.std = std
        self.meta = meta

    @property
    def head_id(self) -> str:
        return (f"trained:{self.meta.get('label_source', '?')}"
                f":{self.meta.get('version', '?')}")

    def p_abort(self, state: str) -> float:
        x = (_feature_vector(state) - self.mean) / self.std
        with torch.no_grad():
            logp = self.net(x.unsqueeze(0))[0]
        return float(logp.exp()[0])

    def __call__(self, rec: Any) -> dict[str, tuple[float, ...]]:
        qids = {q.qid for q in rec.questions} if rec.questions else set()
        if qids and "q_abort" not in qids:
            raise ValueError(f"trained head 只答 q_abort，收到 {qids}")
        if rec.state_compressor != STATE_VERSION:
            raise ValueError(
                f"state 版本不匹配: {rec.state_compressor} != {STATE_VERSION}")
        p = self.p_abort(rec.state)
        return {"q_abort": (p, 1.0 - p)}

    def save(self, path: str | Path) -> None:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        torch.save({
            "meta": self.meta, "mean": self.mean, "std": self.std,
            "state_dict": self.net.state_dict(),
            "feature_names": list(FEATURE_NAMES),
        }, Path(path))

    @classmethod
    def load(cls, path: str | Path) -> "TrainedHead":
        d = torch.load(Path(path), map_location="cpu", weights_only=False)
        if tuple(d.get("feature_names", ())) != FEATURE_NAMES:
            raise ValueError("head 特征表不匹配（版本漂移），拒绝加载")
        net = _Net(len(FEATURE_NAMES), hidden=d["meta"].get("hidden", 0))
        net.load_state_dict(d["state_dict"])
        return cls(net, d["mean"], d["std"], d["meta"])


def train_head(records: list[Any], *, label_source: str = "execution",
               hidden: int = 0, lr: float = 0.05, epochs: int = 300,
               seed: str = "head-v1", lambda_teacher: float = 0.5,
               weight_decay: float = 1e-3) -> TrainedHead:
    """从 DecisionRecord 列表训练轻量头。

    纪律：输入应已按 split 过滤（train only）——本函数不做划分判断，
    调用方负责（test 渗透红线在 SP29c 消费侧）。
    mixed = BCE(execution) + λ·KL(teacher)：teacher 软标签作正则。
    """
    if label_source not in ("execution", "teacher", "mixed"):
        raise ValueError(f"未知 label_source: {label_source}")
    import hashlib
    torch.manual_seed(int(hashlib.sha256(seed.encode()).hexdigest()[:8], 16))

    xs, ys, ws, ts = [], [], [], []
    for rec in records:
        try:
            xs.append(_feature_vector(rec.state))
        except ValueError:
            continue                       # state 漂移样本剔除（计数入 meta）
        tgt, w = _target_probs(rec, label_source)
        ys.append(tgt)
        ws.append(w)
        lab = rec.label_for("q_abort") if hasattr(rec, "label_for") else None
        ts.append(torch.tensor([float(lab.probs[0]), float(lab.probs[1])])
                  if lab is not None and lab.probs and len(lab.probs) >= 2
                  else None)
    if not xs or sum(ws) < 10:
        raise ValueError(f"可用样本不足（{int(sum(ws))} < 10）")
    X = torch.stack(xs)
    Y = torch.stack(ys)
    W = torch.tensor(ws)
    mean, std = X.mean(0), X.std(0).clamp_min(1e-6)
    Xn = (X - mean) / std

    net = _Net(X.shape[1], hidden=hidden)
    opt = torch.optim.Adam(net.parameters(), lr=lr,
                           weight_decay=weight_decay)
    for _ in range(epochs):
        opt.zero_grad()
        logp = net(Xn)
        per = (Y * (Y.clamp_min(1e-6).log() - logp)).sum(-1)   # (n,)
        loss = (W * per).sum() / W.sum().clamp_min(1e-6)
        if label_source == "mixed":
            T = torch.stack([t if t is not None
                             else torch.tensor([0.5, 0.5]) for t in ts])
            kl = (T * (T.clamp_min(1e-6).log() - logp)).sum(-1)
            loss = loss + lambda_teacher * (W * kl).sum() \
                / W.sum().clamp_min(1e-6)
        loss.backward()
        opt.step()

    meta = {"version": STATE_VERSION, "label_source": label_source,
            "hidden": hidden, "seed": seed, "epochs": epochs,
            "n_samples": int(W.sum().item()), "n_total": len(records),
            "lambda_teacher": lambda_teacher}
    return TrainedHead(net, mean, std, meta)


# ---------- 评测指标（无 sklearn 依赖，手写） ----------

def auc_score(p_abort: list[float], failed: list[bool]) -> float:
    """Mann-Whitney AUC：p_abort 对 fail(=1) 的排序力。0.5=随机。"""
    pos = sorted(p for p, f in zip(p_abort, failed) if f)
    neg = sorted(p for p, f in zip(p_abort, failed) if not f)
    if not pos or not neg:
        return float("nan")
    import bisect
    wins = sum(bisect.bisect_left(neg, p) for p in pos)
    ties = sum(bisect.bisect_right(neg, p) - bisect.bisect_left(neg, p)
               for p in pos)
    return (wins + 0.5 * ties) / (len(pos) * len(neg))


def ece_score(p: list[float], y: list[float], bins: int = 10) -> float:
    """期望校准误差（对 0/1 硬标签）。"""
    n = len(p)
    if n == 0:
        return float("nan")
    acc = 0.0
    for b in range(bins):
        lo, hi = b / bins, (b + 1) / bins
        idx = [i for i in range(n) if (lo <= p[i] < hi)
               or (b == bins - 1 and p[i] == 1.0)]
        if not idx:
            continue
        conf = sum(p[i] for i in idx) / len(idx)
        frac = sum(y[i] for i in idx) / len(idx)
        acc += len(idx) / n * abs(conf - frac)
    return acc


def feature_importance(head: TrainedHead) -> dict[str, float]:
    """logistic 头的标准化 |w|（对 p_abort logit 的贡献排序）。"""
    if head.meta.get("hidden", 0) != 0:
        return {}                       # MLP 无单一权重解读，返回空
    W = head.net.body.weight.detach()[0]   # 类 0（abort）的权重
    return {n: float(abs(w)) for n, w in zip(FEATURE_NAMES, W)}
