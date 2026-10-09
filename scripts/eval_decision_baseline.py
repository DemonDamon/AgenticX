#!/usr/bin/env python
"""决策头基线评测入口（SP26）。

用法:
  # mock 冒烟（无网全链路）
  python scripts/eval_decision_baseline.py --data runs/demo/decisions.jsonl --scorer mock

  # 已补标文件的 teacher probs（不现场打分）
  python scripts/eval_decision_baseline.py --data runs/demo/decisions.jsonl.labeled.jsonl \
      --teacher-model Qwen3.8-27B

  # StartLux-Decision 本地服务（scripts/serve_decision_model.sh 先起服务）
  python scripts/eval_decision_baseline.py --data runs/demo/decisions.jsonl \
      --scorer startlux --model StartLux-Decision-4B-Q4_K_M

纪律（plans/decision-layer/MASTER-PLAN.md）：
- 只评 test 切分；calib 拟合温度（温度不改 argmax）；train 不出结论性数字
- 数据无 split 时必须 --assign-split 显式确认（仅内存切分，不回写）
- --data 传目录则递归合并 *.jsonl（排除 *.labeled.jsonl），decision_id 去重
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agenticx.rl.decision import (  # noqa: E402
    DecisionLog,
    DecisionRecord,
    assign_split,
)
from agenticx.rl.decision_eval import (  # noqa: E402
    eval_split,
    fit_temperature,
    scorer_probs_getter,
    teacher_probs_getter,
)
from agenticx.rl.decision_scorers import make_scorer  # noqa: E402


def _load_records(data: str | Path) -> list[DecisionRecord]:
    p = Path(data)
    files = ([q for q in sorted(p.rglob("*.jsonl"))
              if "labeled" not in q.name] if p.is_dir() else [p])
    by_id: dict[str, DecisionRecord] = {}
    for f in files:
        for rec in DecisionLog.load(f).records:
            by_id.setdefault(rec.decision_id, rec)
    if not by_id:
        raise SystemExit(f"未载入任何决策点: {data}")
    return list(by_id.values())


def main() -> None:
    ap = argparse.ArgumentParser(description="决策头基线评测（SP26）")
    ap.add_argument("--data", required=True, help="decisions.jsonl 或目录")
    ap.add_argument("--scorer", choices=("mock", "openai", "startlux"),
                    help="现场打分（缺省则读已补标 teacher probs）")
    ap.add_argument("--base-url", default="",
                    help="端点覆盖（缺省用 scorer 各自默认：openai=18791, startlux=8090）")
    ap.add_argument("--model", default="", help="scorer 模型名")
    ap.add_argument("--temperature", type=float, default=0.0)
    ap.add_argument("--teacher-model", default="",
                    help="读已补标文件时按 teacher 标识过滤（缺省取任意 teacher）")
    ap.add_argument("--assign-split", action="store_true",
                    help="数据无 split 时显式确认内存切分（不回写）")
    ap.add_argument("--limit", type=int, default=0, help="只评前 N 条记录（0=全部）")
    ap.add_argument("--out", default="results/decision-layer/baseline",
                    help="报告输出目录")
    args = ap.parse_args()

    records = _load_records(args.data)
    if args.limit:
        records = records[: args.limit]
    if any(not r.split for r in records):
        if not args.assign_split:
            raise SystemExit("数据存在未切分记录：确认后加 --assign-split（内存切分，不回写）")
        assign_split(records)
        print(f"内存切分完成（seed=dec-v1）: "
              f"{sum(r.split == 'train' for r in records)}/"
              f"{sum(r.split == 'calib' for r in records)}/"
              f"{sum(r.split == 'test' for r in records)}")

    calib = [r for r in records if r.split == "calib"]
    test = [r for r in records if r.split == "test"]
    if not test:
        raise SystemExit("test 切分为空，无法评测（数据量过小？）")

    if args.scorer:
        scorer, scorer_id = make_scorer(
            args.scorer, model=args.model, base_url=args.base_url,
            temperature=args.temperature)
        getter = scorer_probs_getter(scorer)
    else:
        scorer_id = args.teacher_model or "teacher-any"
        getter = teacher_probs_getter(args.teacher_model)

    # calib 拟温度（无 calib 则 T=1；温度不改 argmax）
    from agenticx.rl.decision_eval import _collect  # noqa: E402
    calib_samples, _, _ = _collect(calib, getter)
    temperature = fit_temperature(calib_samples) if calib_samples else 1.0

    report = eval_split(test, getter, temperature=temperature)
    report["meta"] = {
        "data": str(args.data), "scorer": args.scorer or "labeled-teacher",
        "scorer_id": scorer_id, "split": "test",
        "n_calib_for_temp": len(calib_samples),
        "degraded": args.scorer == "mock",
    }
    # calib 数字仅作 sanity 对照，非结论（纪律）
    report["sanity_calib"] = eval_split(calib, getter, temperature=temperature)["overall"]

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "baseline.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# 决策头基线报告（test 切分）",
        "",
        f"- scorer: `{report['meta']['scorer_id']}`"
        f"{' （mock，数字无结论意义）' if report['meta']['degraded'] else ''}",
        f"- records: {report['n_records']}  questions: {report['n_questions']}"
        f"  evaluated: {report['n_evaluated']}  temperature: {report['temperature']}",
        "",
        "| decision_type | n | top1 | ECE | ECE(T) |",
        "|---|---|---|---|---|",
    ]
    for dt, st in report["by_type"].items():
        lines.append(f"| {dt} | {st['n']} | {st['top1']} | {st['ece']} | {st['ece_temp']} |")
    ov = report["overall"]
    lines += ["", f"**overall**: top1={ov['top1']} ECE={ov['ece']} ECE(T)={ov['ece_temp']}",
              "", f"skipped: {report['skipped']}"]
    (out / "baseline.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"test={report['n_evaluated']} 题  top1={ov['top1']}  "
          f"ECE={ov['ece']}  T={report['temperature']}")
    print(f"报告: {out}/baseline.md")


if __name__ == "__main__":
    main()
