# agenticx/agents/decision_router.py
"""DecisionRouter：loop 级 gating 的守门员组件（SP27）。

定位（master plan V3，validator 不做司机）：LLM 仍生成工具与参数，
router 只对"LLM 已做的选择"独立打分做一致性校验——
- observe 模式：只记录 agreement/confidence，不干预（零风险，产出决策数据）
- nudge 模式：错配且高置信才注入一条 system 提示影响下一轮（对齐
  loop_detector.nudge 先例，绝不 block 本轮执行）

fail-open 红线：任何异常 → pass + degraded 标记，不得影响任务执行。
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from agenticx.rl.decision import DecisionQuestion, DecisionRecord
from agenticx.rl.decision_scorers import Scorer

PASS = "pass"
NUDGE = "nudge"


@dataclass
class RouterVerdict:
    action: str                 # pass | nudge
    decision_id: str
    expected: str               # 被验证的选择（LLM 的工具名）
    argmax: str                 # 决策头的 argmax
    confidence: float           # 决策头 top-1 概率
    probs: tuple[float, ...] = ()
    degraded: bool = False      # True=异常降级（fail-open）
    reason: str = ""
    latency_ms: float = 0.0


def _record(state: str, symbols: tuple[str, ...], decision_type: str,
            state_compressor: str) -> DecisionRecord:
    import uuid
    q = DecisionQuestion(qid="q_gate", type="choice",
                         question="下一步调用哪个工具最合理", options=symbols)
    return DecisionRecord(
        decision_id=f"gate-{uuid.uuid4().hex[:12]}", rollout_id="live",
        turn=0, task_id="live", decision_type=decision_type, state=state,
        state_compressor=state_compressor, questions=(q,), created_at="")


class DecisionRouter:
    """对一次选择做一致性校验：check(state, expected, symbols) -> verdict。

    tau_high 语义：argmax≠expected 且 confidence≥tau_high 才 nudge；
    候选 <2 个直接 pass（退化场景，SP26 已证真实 TB bash-only）。
    """

    def __init__(self, scorer: Scorer, *, tau_high: float = 0.8,
                 decision_type: str = "tool_selection",
                 state_compressor: str = "msg-tail-1200-v1"):
        self.scorer = scorer
        self.tau_high = tau_high
        self.decision_type = decision_type
        self.state_compressor = state_compressor
        self.telemetry: list[dict[str, Any]] = []
        self.n_degraded = 0

    def check(self, state: str, expected: str,
              symbols: tuple[str, ...]) -> RouterVerdict:
        t0 = time.perf_counter()
        rec = _record(state, tuple(symbols), self.decision_type,
                      self.state_compressor)
        verdict = self._check_inner(rec, expected, tuple(symbols))
        verdict.latency_ms = (time.perf_counter() - t0) * 1000
        row: dict[str, Any] = {
            "decision_id": verdict.decision_id,
            "decision_type": self.decision_type,
            "expected": verdict.expected, "argmax": verdict.argmax,
            "confidence": round(verdict.confidence, 4),
            "action": verdict.action, "degraded": verdict.degraded,
            "latency_ms": round(verdict.latency_ms, 2),
            "reason": verdict.reason,
            "n_options": len(symbols),
        }
        self.telemetry.append(row)
        return verdict

    def _check_inner(self, rec: DecisionRecord, expected: str,
                     symbols: tuple[str, ...]) -> RouterVerdict:
        if len(symbols) < 2:
            return RouterVerdict(PASS, rec.decision_id, expected, expected,
                                 1.0, reason="degenerate:<2 options")
        try:
            probs = self.scorer(rec)["q_gate"]
        except Exception as e:  # fail-open 红线
            self.n_degraded += 1
            return RouterVerdict(PASS, rec.decision_id, expected, expected,
                                 0.0, degraded=True, reason=f"scorer-error:{e}")
        q = rec.questions[0]
        idx = max(range(len(probs)), key=lambda i: probs[i])
        argmax, conf = q.symbols[idx], probs[idx]
        mismatch = argmax != expected
        action = NUDGE if (mismatch and conf >= self.tau_high) else PASS
        reason = ("mismatch" if mismatch else "agree") + (
            f":conf={conf:.2f}<tau" if mismatch and action == PASS else "")
        return RouterVerdict(action, rec.decision_id, expected, argmax, conf,
                             tuple(probs), reason=reason)

    def nudge_message(self, v: RouterVerdict) -> str:
        return (f"[decision-gate] 上一步选择了 '{v.expected}'，但独立评估更倾向 "
                f"'{v.argmax}'（置信 {v.confidence:.2f}）。请复核工具选择是否"
                f"符合当前任务状态。")

    def dump(self, path: str | Path) -> int:
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        with p.open("w", encoding="utf-8") as f:
            for row in self.telemetry:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
        return len(self.telemetry)
