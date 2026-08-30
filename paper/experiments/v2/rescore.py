#!/usr/bin/env python3
"""离线重打分：用修复后的 scoring_v2（L1 内容感知）重算一个实验目录的全部 run。

用途：打分器修正后无需重跑 LLM（L1/L2 均为确定性规则），直接对已落盘的
output 重算 Q/TMS/detail，并重建 summary.jsonl / summary.csv / pairs.csv。

用法：
  .venv/bin/python paper/experiments/v2/rescore.py --exp-dir paper/experiments/v2/pilot_flash \
      --tasks-dir paper/tasks/data/v0.1
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, Tuple

ROOT = Path(__file__).resolve().parent.parent.parent.parent   # AgenticX 仓库根
sys.path.insert(0, str(ROOT))

from paper.metrics.scoring_v2 import score_artifact


def rescore(exp_dir: Path, tasks_dir: Path) -> None:
    tasks: Dict[str, Dict] = {}
    for f in sorted(tasks_dir.glob("t-*.json")):
        t = json.loads(f.read_text(encoding="utf-8"))
        tasks[t["task_id"]] = t

    n_rescored = 0
    rows = []
    for f in sorted(exp_dir.glob("*/*.json")):
        if f.parent == exp_dir:
            continue                      # 跳过 summary/pairs 等汇总文件
        d = json.loads(f.read_text(encoding="utf-8"))
        if "task_id" not in d or "output" not in d:
            continue
        t = tasks.get(d["task_id"])
        if t is None:
            print(f"  [WARN] 找不到任务 {d['task_id']}，跳过")
            continue
        sd = score_artifact(d["output"], t, mode=d.get("mode", "team"), llm_judge=None)
        d["Q_prev"] = d.get("Q")          # 保留旧分供审计
        d["Q"] = round(sd.Q, 4)
        d["TMS"] = sd.TMS
        det = {"L1": sd.L1, "L2": sd.L2, "L3": sd.L3}
        det.update(sd.L1_items)
        det.update(sd.L2_items)
        det["notes"] = sd.notes
        d["detail"] = det
        f.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
        rows.append(d)
        n_rescored += 1
    print(f"重打分完成：{n_rescored} 个 run")

    # 重建 summary.jsonl / summary.csv
    with open(exp_dir / "summary.jsonl", "w", encoding="utf-8") as fj, \
         open(exp_dir / "summary.csv", "w", encoding="utf-8") as fc:
        fc.write("task_id,office_type,task_type,mode,model,seed,Q,TMS,prompt_tokens,"
                 "completion_tokens,total_tokens,cached_tokens,elapsed,llm_calls,error\n")
        for d in sorted(rows, key=lambda x: (x["task_id"], x["mode"], x["seed"])):
            fj.write(json.dumps(d, ensure_ascii=False) + "\n")
            fc.write(f"{d['task_id']},{d['office_type']},{d['task_type']},{d['mode']},"
                     f"{d['model']},{d['seed']},{d['Q']},{d['TMS']},"
                     f"{d.get('prompt_tokens',0)},{d.get('completion_tokens',0)},"
                     f"{d.get('total_tokens',0)},{d.get('cached_tokens',0)},"
                     f"{d.get('elapsed',0)},{d.get('llm_calls',0)},"
                     f"\"{str(d.get('error','')).replace(chr(34),chr(39))}\"\n")

    # 重建 pairs.csv（口径与 runner 一致）
    idx = {(d["task_id"], d["mode"], d["seed"]): d for d in rows}
    team_modes = sorted({d["mode"] for d in rows if d["mode"].startswith("team_")})
    single_mode = next((m for m in ("single_refine_k", "single_bon_k")
                        if any(k[1] == m for k in idx)), None)

    def _ratio(num, den):
        return round(num / den, 4) if (den and den > 0) else None

    n_pairs = 0
    with open(exp_dir / "pairs.csv", "w", encoding="utf-8") as fp:
        fp.write("task_id,office_type,task_type,model,seed,assembly,Q_single,"
                 "Q_single_matched,Q_team,CTR_naive,CTR_matched,TR,call_ratio,team_token_overhead\n")
        for (tid, mode, seed), d in sorted(idx.items()):
            if not mode.startswith("team_"):
                continue
            s = idx.get((tid, "single", seed))
            if s is None:
                continue
            m = idx.get((tid, single_mode, seed)) if single_mode else None
            qm = m["Q"] if m else None
            asm = mode.replace("team_", "", 1)
            fp.write(f"{tid},{d['office_type']},{d['task_type']},{d['model']},{seed},{asm},"
                     f"{s['Q']},{qm if qm is not None else ''},{d['Q']},"
                     f"{_ratio(d['Q'], s['Q']) or ''},"
                     f"{_ratio(d['Q'], qm) if qm else ''},"
                     f"{_ratio(d['total_tokens'], s['total_tokens']) or ''},"
                     f"{_ratio(d['llm_calls'], s['llm_calls']) or ''},"
                     f"{d['total_tokens'] - s['total_tokens']}\n")
            n_pairs += 1
    print(f"summary.jsonl/csv 与 pairs.csv 已重建（{n_pairs} 对）")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--exp-dir", required=True)
    ap.add_argument("--tasks-dir", default="paper/tasks/data/v0.1")
    args = ap.parse_args()
    rescore(Path(args.exp_dir), Path(args.tasks_dir))
