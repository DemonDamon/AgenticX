#!/usr/bin/env python3
"""SP29d-D2：multi-tool distractor 候选集探针（信号判定，不重实施）。

问题：TB 域 tool_selection 100% 单候选（bash-only）是因为数据集只有
terminal；若把候选集扩成 bash + 常见 agent 工具（distractor），公开
决策头能否仅凭 state 的任务语义区分"该用 bash"？——显著高于随机基线
→ multi-tool 采集走便宜的 distractor 路线；不显著 → state 需含工具
描述（compressor 升级）或接新任务族（贵）。

用法（StartLux 服务先行，scripts/serve_decision_model.sh 或手动起）:
  python scripts/probe_multitool.py --base-url http://127.0.0.1:8092
  python scripts/probe_multitool.py --scorer mock   # 冒烟
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agenticx.learning.trajectory.harbor_collector import collect_jobs  # noqa: E402
from agenticx.learning.trajectory.decision_mining import (  # noqa: E402
    mine_tool_decisions)
from agenticx.rl.decision import DecisionLog  # noqa: E402
from agenticx.rl.decision_scorers import make_scorer  # noqa: E402

# 常见 agent 工具名（确定性集合；真实工具注册表接入是后续工程）
DISTRACTORS: tuple[str, ...] = (
    "read_file", "write_file", "edit_file", "search_code",
    "web_search", "browser_navigate", "run_tests", "query_database")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs-dir", default="harness-lab/jobs")
    ap.add_argument("--job-pattern", default="agenticx-*")
    ap.add_argument("--limit-tasks", type=int, default=12,
                    help="等距抽 N 个 task（默认 12，与 SP26/27 口径一致）")
    ap.add_argument("--scorer", default="mock")
    ap.add_argument("--model", default="")
    ap.add_argument("--base-url", default="http://127.0.0.1:8092")
    ap.add_argument("--out",
                    default="results/decision-layer/decisions")
    args = ap.parse_args()

    trajs = list(collect_jobs(Path(args.jobs_dir),
                              job_pattern=args.job_pattern))
    if not trajs:
        raise SystemExit(f"未收集到轨迹: {args.jobs_dir}/{args.job_pattern}")
    # 等距抽 task（与 eval_gating_ab._stride_tasks 同法，保持口径）
    ids = sorted({t.task_id for t in trajs})
    if args.limit_tasks and args.limit_tasks < len(ids):
        step = len(ids) / args.limit_tasks
        keep = {ids[int(i * step)] for i in range(args.limit_tasks)}
        trajs = [t for t in trajs if t.task_id in keep]

    # 多候选挖掘：bash（trace）∪ distractors
    log = DecisionLog()
    for t in trajs:
        mine_tool_decisions(log, t.messages, rollout_id=t.session_id,
                            task_id=t.task_id, extra_options=DISTRACTORS,
                            distractor_source="common-tools-v1")
    recs = log.records
    n_cand = Counter(len(r.questions[0].options) for r in recs)
    print(f"挖掘: {len(recs)} 个 tool_selection 决策点，候选数分布 "
          f"{dict(n_cand)}")

    scorer, sid = make_scorer(args.scorer, model=args.model,
                              base_url=args.base_url)
    n_hit = n_err = 0
    miss_examples = []
    for r in recs:
        q = r.questions[0]
        truth = r.label_for(q.qid).hard
        try:
            probs = scorer(r)[q.qid]
        except Exception as e:                       # noqa: BLE001
            n_err += 1
            if n_err <= 3:
                print(f"  scorer 异常（fail-open 跳过）: {e}")
            continue
        top = q.options[max(range(len(probs)), key=lambda i: probs[i])]
        if top == truth:
            n_hit += 1
        elif len(miss_examples) < 5:
            miss_examples.append((truth, top, round(max(probs), 3)))
    n = n_hit + n_err
    acc = n_hit / max(n, 1)
    chance = 1.0 / max(n_cand and max(n_cand) or 1, 1)
    # 二项检验的粗显著性界（n 大时）：acc - chance 与 2σ
    sigma = (chance * (1 - chance) / max(n, 1)) ** 0.5
    sig = "显著" if acc - chance > 2 * sigma else "不显著"

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    lines = [
        "# SP29d multi-tool distractor 探针报告", "",
        f"- scorer: `{sid}`；task 数 {len(ids) if not args.limit_tasks else args.limit_tasks}"
        f"（等距抽样，与 SP26/27 口径一致）",
        f"- 决策点 {len(recs)}，候选 = bash(trace) ∪ {len(DISTRACTORS)} 干扰项"
        f"（common-tools-v1）",
        f"- 随机基线 chance = {chance:.3f}（1/候选数）", "",
        "## 结果", "",
        f"- top1 acc = **{acc:.3f}**（{n_hit}/{n}；scorer 异常 {n_err}）",
        f"- acc − chance = {acc - chance:+.3f}，2σ = {2 * sigma:.3f}"
        f" → **{sig}**",
        "", "## 判定", "",
        ("- **显著**：state 任务语义足以区分工具——multi-tool 采集可走"
         " distractor 候选集路线（便宜，无需新任务族）" if sig == "显著"
         else "- **不显著**：state 缺工具语义——需升级 state compressor"
         "（含工具描述）或接入多工具任务族（贵），二者成本差异见"
         " MASTER-PLAN-SP29 不做清单第 3 条"),
        "", "## miss 样例（truth, pred, p_top）", "",
    ] + [f"- {m}" for m in miss_examples]
    (out / "multitool_probe.md").write_text("\n".join(lines) + "\n",
                                            encoding="utf-8")
    log.save(out / "multitool_probe_decisions.jsonl")
    print(f"acc {acc:.3f} vs chance {chance:.3f}（{sig}）→ "
          f"{out/'multitool_probe.md'}")


if __name__ == "__main__":
    main()
