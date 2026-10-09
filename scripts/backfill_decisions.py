#!/usr/bin/env python
"""决策点 teacher 离线补标入口（SP25；SP26 起 scorer 走 decision_scorers 库；
SP28 起 test 划分默认禁补）。

用法:
  # 冒烟（确定性 mock，验证管线）
  python scripts/backfill_decisions.py --in runs/demo/decisions.jsonl --scorer mock

  # openai 兼容端点（受限 softmax 标注机：max_tokens=1 + top_logprobs）
  python scripts/backfill_decisions.py --in runs/demo/decisions.jsonl --scorer openai \
      --base-url http://localhost:18791/v1 --model Qwen3.8-27B

  # StartLux-Decision 本地服务（scripts/serve_decision_model.sh 先起服务）
  python scripts/backfill_decisions.py --in runs/demo/decisions.jsonl --scorer startlux \
      --model StartLux-Decision-4B-Q4_K_M

纪律（plans/rsi/sp25-decision-annotation.md + SP28）：
- raw 不改写：输出写 --out（默认 <in>.labeled.jsonl）
- teacher 标签带 teacher_model，幂等可重跑（同 teacher_model 已补 qid 跳过）
- 补标不覆盖 execution/self 既有标注（真值优先）
- test 划分默认禁补（--exclude-test 默认开，--no-exclude-test 显式解除）；
  补完断言"本次新增 test teacher 标签数 = 0"并打印证明
"""
from __future__ import annotations

import argparse
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agenticx.rl.decision import (  # noqa: E402
    DecisionLog,
    assert_trainable_decisions,
    backfill_teacher,
)
from agenticx.rl.decision_scorers import make_scorer  # noqa: E402


def _teacher_label_count(records, teacher_model: str) -> int:
    return sum(1 for r in records for l in r.labels
               if l.source == "teacher" and l.teacher_model == teacher_model)


def _test_teacher_count(records, teacher_model: str) -> int:
    return sum(1 for r in records if r.split == "test"
               for l in r.labels
               if l.source == "teacher" and l.teacher_model == teacher_model)


def main() -> None:
    ap = argparse.ArgumentParser(description="决策点 teacher 离线补标（SP25/SP26/SP28）")
    ap.add_argument("--in", dest="inp", required=True, help="decisions.jsonl 路径")
    ap.add_argument("--out", default=None, help="输出路径（默认 <in>.labeled.jsonl）")
    ap.add_argument("--scorer", choices=("mock", "openai", "startlux"), default="mock")
    ap.add_argument("--base-url", default="http://localhost:18791/v1",
                    help="openai 兼容端点")
    ap.add_argument("--model", default="", help="teacher 模型名（openai 必填）")
    ap.add_argument("--temperature", type=float, default=0.0)
    ap.add_argument("--limit", type=int, default=0, help="只补前 N 条（0=全部）")
    ap.add_argument("--exclude-test", action=argparse.BooleanOptionalAction,
                    default=True,
                    help="test 划分禁补（默认开；补标范围 split ∈ {train, calib, ''}）")
    ap.add_argument("--split-filter", default="",
                    help="只补该 decision_type（如 tool_selection；空=不限）")
    args = ap.parse_args()

    if args.scorer == "openai" and not args.model:
        raise SystemExit("--scorer openai 需要 --model")

    log = DecisionLog.load(args.inp)
    scorer, teacher_model = make_scorer(
        args.scorer, model=args.model, base_url=args.base_url,
        temperature=args.temperature)
    pre_test_labels = _test_teacher_count(log.records, teacher_model)

    # 补标范围：test 禁补（默认）+ 可选 decision_type 过滤
    eligible = log.records
    if args.exclude_test:
        eligible = [r for r in eligible if r.split != "test"]
    if args.split_filter:
        eligible = [r for r in eligible
                    if r.decision_type == args.split_filter]
    if args.limit:
        eligible = eligible[: args.limit]
    skipped = len(log.records) - len(eligible)

    # SP28 验收：held-out 守卫（考试任务决策点混入即抛 HeldoutViolation）
    assert_trainable_decisions(eligible)
    print(f"载入 {len(log.records)} 条决策点，补标范围 {len(eligible)} 条"
          f"（跳过 {skipped} 条"
          f"{'，含 test 禁补' if args.exclude_test else ''}"
          f"{'，split-filter=' + args.split_filter if args.split_filter else ''}）")

    n = backfill_teacher(eligible, scorer, teacher_model=teacher_model)
    print(f"补标 {n} 个 teacher 软标签（teacher={teacher_model}）")

    # SP28 验收：test 零渗透断言（本次运行不得给 test 增加任何 teacher 标签）
    post_test_labels = _test_teacher_count(log.records, teacher_model)
    new_test = post_test_labels - pre_test_labels
    if args.exclude_test:
        assert new_test == 0, \
            f"test 渗透！本次新增 {new_test} 个 test teacher 标签（红线违规）"
        print(f"assert 通过：test teacher 标签 {post_test_labels} 个"
              f"（本次新增 0，补标前 {pre_test_labels}）")
    elif new_test:
        print(f"警告：--no-exclude-test 模式给 test 新增 {new_test} 个 teacher "
              f"标签（该文件不得再用于基线评测）")

    # 题型分布 + 幂等证明（计数推导，零额外推理）
    types = Counter(r.decision_type for r in eligible)
    print(f"补标范围题型分布: {dict(types)}")
    covered = sum(
        1 for r in eligible
        if {q.qid for q in r.questions} <= {
            l.qid for l in r.labels
            if l.source == "teacher" and l.teacher_model == teacher_model})
    print(f"幂等证明：{covered}/{len(eligible)} 条已全覆盖该 teacher 标签，"
          f"同参数重跑将补 0 条")

    out = Path(args.out) if args.out else Path(str(args.inp).replace(
        ".jsonl", "") + ".labeled.jsonl")
    log.save(out)
    print(f"写出 {out}（raw 未改写）")


if __name__ == "__main__":
    main()
