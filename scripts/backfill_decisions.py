#!/usr/bin/env python
"""决策点 teacher 离线补标入口（SP25）。

用法:
  # 冒烟（确定性 mock，验证管线）
  python scripts/backfill_decisions.py --in runs/demo/decisions.jsonl --scorer mock

  # openai 兼容端点（受限 softmax 标注机：max_tokens=1 + top_logprobs）
  python scripts/backfill_decisions.py --in runs/demo/decisions.jsonl --scorer openai \
      --base-url http://localhost:18791/v1 --model Qwen3.8-27B

纪律（plans/rsi/sp25-decision-annotation.md）：
- raw 不改写：输出写 --out（默认 <in>.labeled.jsonl）
- teacher 标签带 teacher_model，幂等可重跑
- 补标不覆盖 execution/self 既有标注（真值优先）
"""
from __future__ import annotations

import argparse
import hashlib
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agenticx.rl.decision import (  # noqa: E402
    DecisionLog,
    DecisionRecord,
    DecisionQuestion,
    backfill_teacher,
)

_LETTERS = "ABCDEFGH"


def _mock_scorer(rec: DecisionRecord) -> dict[str, tuple[float, ...]]:
    """确定性 mock：sha256(decision_id|qid|symbol) 加权 softmax，冒烟管线用。"""
    out: dict[str, tuple[float, ...]] = {}
    for q in rec.questions:
        syms = q.symbols
        ws = [
            int(hashlib.sha256(
                f"{rec.decision_id}|{q.qid}|{s}".encode()).hexdigest()[:4], 16)
            for s in syms
        ]
        m = max(ws)
        exps = [math.exp((w - m) / 4096.0) for w in ws]  # 近均匀，冒烟无偏向要求
        z = sum(exps)
        out[q.qid] = tuple(e / z for e in exps)
    return out


def _make_openai_scorer(base_url: str, model: str, temperature: float):
    """受限 softmax 标注机：单 token 输出 + top_logprobs，
    只在候选符号上 softmax（未出现的候选给 -30 近零概率）。"""
    try:
        from openai import OpenAI
    except ImportError as e:  # pragma: no cover
        raise SystemExit(f"缺 openai 依赖: {e}") from e
    client = OpenAI(base_url=base_url, api_key="local")

    def _score_one(state: str, q: DecisionQuestion) -> tuple[float, ...]:
        if q.type == "score":
            lines = "\n".join(f"{s}" for s in q.symbols)
            prompt = (f"给定状态与问题，给出 0-5 分评分。只输出一个数字，不要解释。\n\n"
                      f"状态:\n{state}\n\n问题: {q.question}\n候选:\n{lines}\n答案:")
        else:
            lines = "\n".join(f"{_LETTERS[i]}. {s}"
                              for i, s in enumerate(q.symbols))
            prompt = (f"给定状态与问题，从候选中选择最可能正确的选项。"
                      f"只输出选项字母，不要解释。\n\n"
                      f"状态:\n{state}\n\n问题: {q.question}\n候选:\n{lines}\n答案:")
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=1, temperature=temperature,
            logprobs=True, top_logprobs=20,
        )
        top = resp.choices[0].logprobs.content[0].top_logprobs or []
        lp = {t.token.strip(): t.logprob for t in top}
        # 候选符号（choice/yes_no 用字母位，score 用数字）映射回 symbols 顺序
        if q.type == "score":
            keys = q.symbols
        else:
            keys = [_LETTERS[i] for i in range(len(q.symbols))]
        vals = [lp.get(k, -30.0) for k in keys]
        m = max(vals)
        exps = [math.exp(v - m) for v in vals]
        z = sum(exps)
        return tuple(e / z for e in exps)

    def scorer(rec: DecisionRecord) -> dict[str, tuple[float, ...]]:
        return {q.qid: _score_one(rec.state, q) for q in rec.questions}

    return scorer


def main() -> None:
    ap = argparse.ArgumentParser(description="决策点 teacher 离线补标（SP25）")
    ap.add_argument("--in", dest="inp", required=True, help="decisions.jsonl 路径")
    ap.add_argument("--out", default=None, help="输出路径（默认 <in>.labeled.jsonl）")
    ap.add_argument("--scorer", choices=("mock", "openai"), default="mock")
    ap.add_argument("--base-url", default="http://localhost:18791/v1",
                    help="openai 兼容端点")
    ap.add_argument("--model", default="", help="teacher 模型名（openai 必填）")
    ap.add_argument("--temperature", type=float, default=0.0)
    ap.add_argument("--limit", type=int, default=0, help="只补前 N 条（0=全部）")
    args = ap.parse_args()

    if args.scorer == "openai" and not args.model:
        raise SystemExit("--scorer openai 需要 --model")

    log = DecisionLog.load(args.inp)
    records = log.records[: args.limit] if args.limit else log.records
    print(f"载入 {len(log.records)} 条决策点（补标 {len(records)} 条）")

    if args.scorer == "mock":
        scorer, teacher_model = _mock_scorer, "mock-v1"
    else:
        scorer, teacher_model = _make_openai_scorer(
            args.base_url, args.model, args.temperature), args.model

    n = backfill_teacher(records, scorer, teacher_model=teacher_model)
    print(f"补标 {n} 个 teacher 软标签（teacher={teacher_model}）")

    out = Path(args.out) if args.out else Path(str(args.inp).replace(
        ".jsonl", "") + ".labeled.jsonl")
    log.save(out)
    print(f"写出 {out}（raw 未改写）")


if __name__ == "__main__":
    main()
