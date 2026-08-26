#!/usr/bin/env python3
"""Phase1 基线实验结果汇总报告生成器。

输出:
  - 按耦合度/办公类型的 CTR、token 开销、TMS 通过率表格
  - 现象是否符合假设（低耦合团队次优 ≤ 0.95, 高耦合团队涌现 ≥ 1.05）
  - CSV + Markdown 报告

用法:
  .venv/bin/python paper/experiments/phase1_report.py --exp paper/experiments/baseline_v0.1_dsv4flash
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List


def load(exp: Path) -> List[Dict[str, Any]]:
    rows = [json.loads(l) for l in (exp / "summary.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    return rows


def group_by(rows, key):
    g = defaultdict(list)
    for r in rows:
        g[r.get(key, "?")].append(r)
    return g


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--exp", required=True, help="实验输出目录")
    args = ap.parse_args()
    exp = Path(args.exp)
    rows = load(exp)

    print(f"# Phase 1 基线实验报告 - {exp.name}")
    print(f"总 run 数: {len(rows)}")

    # 按 (task_id, seed) 配对计算 CTR/token_overhead
    singles = {(r["task_id"], r["seed"]): r for r in rows if r["mode"] == "single"}
    teams = {(r["task_id"], r["seed"]): r for r in rows if r["mode"] == "team"}
    pairs: List[Dict[str, Any]] = []
    for k, t in teams.items():
        s = singles.get(k)
        if not s: continue
        CTR = t["Q"] / s["Q"] if s["Q"] > 0 else 0.0
        pairs.append({
            "task_id": t["task_id"], "office_type": t.get("office_type", "?"),
            "task_type": t.get("task_type", "?"), "seed": t["seed"],
            "Q_s": s["Q"], "Q_t": t["Q"], "CTR": round(CTR, 3),
            "tok_s": s["total_tokens"], "tok_t": t["total_tokens"],
            "tok_ratio": round(t["total_tokens"] / s["total_tokens"], 2) if s["total_tokens"] else 0,
            "TMS_s": s["TMS"], "TMS_t": t["TMS"],
            "time_s": round(s["elapsed"], 1), "time_t": round(t["elapsed"], 1),
        })

    # ── 表格:按耦合度(task_type)汇总 ──
    print("\n## 1. 按任务耦合度汇总")
    by_coupling = defaultdict(list)
    for p in pairs:
        by_coupling[p["task_type"]].append(p)
    for tt in ["low_coupling", "medium_coupling", "high_coupling"]:
        arr = by_coupling.get(tt, [])
        if not arr: continue
        avg_CTR = sum(a["CTR"] for a in arr) / len(arr)
        avg_tokr = sum(a["tok_ratio"] for a in arr) / len(arr)
        tms_s = sum(1 for a in arr if a["TMS_s"]) / len(arr)
        tms_t = sum(1 for a in arr if a["TMS_t"]) / len(arr)
        team_sub = sum(1 for a in arr if a["CTR"] < 0.95)
        team_em = sum(1 for a in arr if a["CTR"] > 1.05)
        print(f"- {tt}: n={len(arr)}  avg_CTR={avg_CTR:.3f}  avg_token_ratio={avg_tokr:.2f}x  "
              f"TMS_s_rate={tms_s:.0%}  TMS_t_rate={tms_t:.0%}   "
              f"团队次优<0.95={team_sub}/{len(arr)}  团队涌现>1.05={team_em}/{len(arr)}")

    # ── 表格:按办公类型(office_type)汇总 ──
    print("\n## 2. 按办公场景汇总")
    by_office = defaultdict(list)
    for p in pairs:
        by_office[p["office_type"]].append(p)
    for ot, arr in sorted(by_office.items()):
        avg_CTR = sum(a["CTR"] for a in arr) / len(arr)
        avg_tokr = sum(a["tok_ratio"] for a in arr) / len(arr)
        print(f"- {ot}: n={len(arr)}  avg_CTR={avg_CTR:.3f}  avg_token_ratio={avg_tokr:.2f}x")

    # ── 假设验证 ──
    print("\n## 3. 团队协作现象假设验证")
    lo = by_coupling.get("low_coupling", [])
    avg_CTR_lo = sum(a["CTR"] for a in lo) / len(lo) if lo else None
    hi = by_coupling.get("high_coupling", [])
    avg_CTR_hi = sum(a["CTR"] for a in hi) / len(hi) if hi else None
    me = by_coupling.get("medium_coupling", [])
    avg_CTR_me = sum(a["CTR"] for a in me) / len(me) if me else None

    # 曲线单调性
    monotonic = (avg_CTR_lo is not None and avg_CTR_me is not None and avg_CTR_hi is not None
                 and avg_CTR_lo <= avg_CTR_me <= avg_CTR_hi)
    # 现象
    low_coupled_team_suboptimal = avg_CTR_lo < 0.95 if avg_CTR_lo is not None else None
    high_coupled_team_emerge = avg_CTR_hi > 1.05 if avg_CTR_hi is not None else None

    print(f"- 耦合度 CTR 单调递增(低→中→高): {'✅ YES' if monotonic else '❌ NO'}  "
          f"(low={avg_CTR_lo:.3f}, medium={avg_CTR_me:.3f}, high={avg_CTR_hi:.3f})")
    print(f"- 低耦合团队次优(CTR<0.95): {'✅ YES' if low_coupled_team_suboptimal else '❌ NO (CTR=' + str(round(avg_CTR_lo or 0,3)) + ')'}")
    print(f"- 高耦合团队涌现(CTR>1.05): {'✅ YES' if high_coupled_team_emerge else '❌ NO (CTR=' + str(round(avg_CTR_hi or 0,3)) + ')'}")

    # ── 异常样本清单:CTR 特别反常的前 5 条 ──
    print("\n## 4. 异常样本(CTR 极端值)")
    pairs_sorted = sorted(pairs, key=lambda x: x["CTR"])
    print("### 最低 CTR 前 5 (团队严重次优)")
    for a in pairs_sorted[:5]:
        print(f"- {a['task_id']} s{a['seed']}: Q_s={a['Q_s']:.2f}→Q_t={a['Q_t']:.2f} CTR={a['CTR']:.2f} tokens {a['tok_s']}→{a['tok_t']}({a['tok_ratio']}x)")
    print("### 最高 CTR 前 5 (团队严重涌现)")
    for a in pairs_sorted[-5:][::-1]:
        print(f"- {a['task_id']} s{a['seed']}: Q_s={a['Q_s']:.2f}→Q_t={a['Q_t']:.2f} CTR={a['CTR']:.2f} tokens {a['tok_s']}→{a['tok_t']}({a['tok_ratio']}x)")

    # 写出全量 pairs.csv（和 runner 保持一致的格式，方便后续作图）
    out_csv = exp / "pairs_report.csv"
    with out_csv.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(pairs[0].keys()) if pairs else [])
        w.writeheader(); w.writerows(pairs)
    print(f"\n📄 已写出全量 pairs 报告: {out_csv}")


if __name__ == "__main__":
    main()
