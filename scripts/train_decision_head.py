#!/usr/bin/env python3
"""SP29b：轻量决策头三路标签对照训练。

同一批 continue_stop 决策点（SP29a dataset.jsonl：execution 真值 +
teacher 软标签 + rollout 粒度三分），三种监督信号各训一个头：
  A teacher（蒸馏）  B execution（真值）  C mixed（真值+λ·teacher 正则）

统一外部裁判 = execution 真值（p_abort 对 attempt 终局 fail 的判别力），
指标 acc / AUC / ECE；test 划分不读（SP29c 一次性消费）。

用法:
  python scripts/train_decision_head.py \
      --data results/decision-layer/gating/continue_stop.dataset.jsonl \
      --out results/decision-layer/gating
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agenticx.rl.decision import DecisionLog  # noqa: E402
from agenticx.rl.decision_head import (  # noqa: E402
    STATE_VERSION, TrainedHead, auc_score, ece_score, feature_importance,
    parse_step_state, train_head)


def _eval_head(head: TrainedHead, records: list) -> dict:
    """execution 真值裁判：acc(argmax) / AUC(p_abort) / ECE(p_abort)。"""
    ps, ys, ok = [], [], []
    for r in records:
        if r.outcome is None or r.outcome.ok is None:
            continue
        try:
            p = head.p_abort(r.state)
        except ValueError:
            continue
        ps.append(p)
        ys.append(0.0 if r.outcome.ok else 1.0)   # y=1 ↔ 应止损
        ok.append(not r.outcome.ok)
    if not ps:
        return {"n": 0}
    pred_abort = [p >= 0.5 for p in ps]
    acc = sum(1 for p, y in zip(pred_abort, ys) if float(p) == y) / len(ps)
    return {"n": len(ps), "acc": round(acc, 4),
            "auc": round(auc_score(ps, ok), 4),
            "ece": round(ece_score(ps, ys), 4),
            "abort_rate@0.5": round(sum(pred_abort) / len(ps), 4)}


def _rollout_cluster(head: TrainedHead, records: list) -> list[str]:
    """按 rollout 聚类呈现（统计诚实条款）：每 attempt 的均值 p_abort。"""
    by: dict[str, list] = {}
    for r in records:
        if r.outcome is None or r.outcome.ok is None:
            continue
        try:
            by.setdefault(r.rollout_id, []).append(
                (head.p_abort(r.state), 0.0 if r.outcome.ok else 1.0))
        except ValueError:
            continue
    rows = []
    for rid, vals in sorted(by.items()):
        p = sum(v[0] for v in vals) / len(vals)
        rows.append(f"| {rid} | {len(vals)} | {vals[0][1]:.0f} | {p:.3f} |")
    return rows


def _teacher_signal_diag(records: list) -> list[str]:
    """teacher 信号诊断：pass/fail rollouts 的 teacher p_abort 分层对照。

    SP29b 冒烟发现（12 rollouts）：teacher 在 fail 终局上反而更乐观
    （mean p_abort 0.265 vs pass 0.364，方向反转）——公开头零样本不仅
    惰性，doom 感知方向也是反的。该诊断段固化进报告，随数据更新。
    """
    p_pass, p_fail = [], []
    for r in records:
        if r.outcome is None or r.outcome.ok is None:
            continue
        lab = r.label_for("q_abort")
        if not lab or not lab.probs:
            continue
        (p_fail if not r.outcome.ok else p_pass).append(lab.probs[0])
    if not p_pass or not p_fail:
        return ["- （teacher 信号诊断：pass/fail 分层不完整，跳过）"]
    mp, mf = sum(p_pass) / len(p_pass), sum(p_fail) / len(p_fail)
    verdict = ("**反向**：teacher 在 fail 终局上更乐观——doom 感知方向反了"
               if mf < mp else "正向但待 AUC 定量")
    return [
        f"- pass rollouts 步级 teacher mean p_abort = {mp:.3f}"
        f"（n={len(p_pass)}）",
        f"- fail rollouts 步级 teacher mean p_abort = {mf:.3f}"
        f"（n={len(p_fail)}）",
        f"- 判读：{verdict}",
    ]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", default="results/decision-layer/gating")
    ap.add_argument("--sources", nargs="+",
                    default=["teacher", "execution", "mixed"])
    ap.add_argument("--hidden", type=int, default=0,
                    help="0=logistic（默认，可解释）；>0=单隐层 MLP")
    ap.add_argument("--epochs", type=int, default=300)
    args = ap.parse_args()

    log = DecisionLog.load(args.data)
    recs = [r for r in log.records
            if r.decision_type == "continue_stop"
            and r.state_compressor == STATE_VERSION]
    train = [r for r in recs if r.split == "train"]
    calib = [r for r in recs if r.split == "calib"]
    # 去重校验：train/calib 若无回填 outcome 的记录会拖低样本量，如实报
    n_out = sum(1 for r in recs if r.outcome is not None
                and r.outcome.ok is not None)
    print(f"dataset: {len(recs)} continue_stop（train {len(train)} / "
          f"calib {len(calib)} / test {sum(1 for r in recs if r.split == 'test')}"
          f" / 未分桶 {sum(1 for r in recs if not r.split)}），"
          f"execution 真值 {n_out}")
    if not train:
        raise SystemExit("train 划分为空——检查 dataset split")

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    results = {}
    heads = {}
    for src in args.sources:
        head = train_head(train, label_source=src, hidden=args.hidden,
                          epochs=args.epochs)
        p = out / f"head_{src}.pt"
        head.save(p)
        heads[src] = head
        results[src] = {"train": _eval_head(head, train),
                        "calib": _eval_head(head, calib),
                        "meta": head.meta,
                        "importance": feature_importance(head)}
        print(f"[{src}] train {results[src]['train']} "
              f"calib {results[src]['calib']}")

    # 报告（master plan 纪律：test 只字不提；rollout 聚类 + 样本量限制声明）
    lines = [
        "# SP29b 三路标签对照报告（teacher 蒸馏 / execution 真值 / mixed）",
        "",
        f"- 数据: `{args.data}`（continue_stop, state={STATE_VERSION}）",
        f"- train {len(train)} / calib {len(calib)} 条（rollout 粒度隔离）；"
        "test 划分未读（SP29c 一次性消费）",
        "- 外部裁判 = execution 真值（attempt 终局）；"
        "abort_rate@0.5 是 argmax 决策下的止损频率",
        "",
        "## calib 区指标（选择依据）",
        "",
        "| source | n | acc | AUC | ECE | abort_rate@0.5 |",
        "|---|---|---|---|---|---|",
    ]
    for src, r in results.items():
        c = r["calib"]
        lines.append(f"| {src} | {c.get('n', 0)} | {c.get('acc', '-')} | "
                     f"{c.get('auc', '-')} | {c.get('ece', '-')} | "
                     f"{c.get('abort_rate@0.5', '-')} |")
    lines += ["", "## train 区指标（收敛参照）", "",
              "| source | n | acc | AUC | ECE | abort_rate@0.5 |",
              "|---|---|---|---|---|---|"]
    for src, r in results.items():
        t = r["train"]
        lines.append(f"| {src} | {t.get('n', 0)} | {t.get('acc', '-')} | "
                     f"{t.get('auc', '-')} | {t.get('ece', '-')} | "
                     f"{t.get('abort_rate@0.5', '-')} |")
    for src, r in results.items():
        imp = r["importance"]
        if imp:
            top = sorted(imp.items(), key=lambda kv: -kv[1])[:5]
            lines += ["", f"## feature importance（{src}, logistic |w|）", "",
                      "| feature | |w| |", "|---|---|"]
            lines += [f"| {k} | {v:.3f} |" for k, v in top]
    lines += ["", "## rollout 聚类（calib，统计诚实条款）", ""]
    best = max(results, key=lambda s: results[s]["calib"].get("auc", 0)
               if results[s]["calib"].get("n") else -1)
    lines += [f"最优头（calib AUC）: **{best}**；其 calib 每-rollout 均值：", "",
              "| rollout | steps | fail(1/0) | mean p_abort |",
              "|---|---|---|---|"]
    lines += _rollout_cluster(heads[best], calib)
    lines += ["", "## teacher 信号诊断（train 区，老师观点 vs 执行真值）", ""]
    lines += _teacher_signal_diag(train)
    n_rollouts = len({r.rollout_id for r in train})
    lines += [
        "",
        "## 统计限制声明",
        "",
        f"- rollout 级独立样本：train {n_rollouts} 条 attempt——步级样本",
        "  同 attempt 内强相关，上述指标的有效样本量以 rollout 数为准；",
        "  结论跨任务泛化能力受此限制，SP29c 终审以 gating A/B 为最终裁判。",
    ]
    (out / "head_compare.md").write_text("\n".join(lines) + "\n",
                                         encoding="utf-8")
    (out / "head_compare.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"报告: {out/'head_compare.md'}；heads: "
          + ", ".join(f"head_{s}.pt" for s in args.sources))


if __name__ == "__main__":
    main()
