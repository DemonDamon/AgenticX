#!/usr/bin/env python
"""决策点 teacher 离线补标入口（SP25；SP26 起 scorer 走 decision_scorers 库）。

用法:
  # 冒烟（确定性 mock，验证管线）
  python scripts/backfill_decisions.py --in runs/demo/decisions.jsonl --scorer mock

  # openai 兼容端点（受限 softmax 标注机：max_tokens=1 + top_logprobs）
  python scripts/backfill_decisions.py --in runs/demo/decisions.jsonl --scorer openai \
      --base-url http://localhost:18791/v1 --model Qwen3.8-27B

  # StartLux-Decision 本地服务（scripts/serve_decision_model.sh 先起服务）
  python scripts/backfill_decisions.py --in runs/demo/decisions.jsonl --scorer startlux \
      --model StartLux-Decision-4B-Q4_K_M

纪律（plans/rsi/sp25-decision-annotation.md）：
- raw 不改写：输出写 --out（默认 <in>.labeled.jsonl）
- teacher 标签带 teacher_model，幂等可重跑
- 补标不覆盖 execution/self 既有标注（真值优先）
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agenticx.rl.decision import (  # noqa: E402
    DecisionLog,
    backfill_teacher,
)
from agenticx.rl.decision_scorers import make_scorer  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description="决策点 teacher 离线补标（SP25/SP26）")
    ap.add_argument("--in", dest="inp", required=True, help="decisions.jsonl 路径")
    ap.add_argument("--out", default=None, help="输出路径（默认 <in>.labeled.jsonl）")
    ap.add_argument("--scorer", choices=("mock", "openai", "startlux"), default="mock")
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

    scorer, teacher_model = make_scorer(
        args.scorer, model=args.model, base_url=args.base_url,
        temperature=args.temperature)

    n = backfill_teacher(records, scorer, teacher_model=teacher_model)
    print(f"补标 {n} 个 teacher 软标签（teacher={teacher_model}）")

    out = Path(args.out) if args.out else Path(str(args.inp).replace(
        ".jsonl", "") + ".labeled.jsonl")
    log.save(out)
    print(f"写出 {out}（raw 未改写）")


if __name__ == "__main__":
    main()
