#!/usr/bin/env python3
"""Phase1 修复 runner:重跑 max_tokens 截断失败的 runs,与原实验合并。

修复项:把 max_tokens 从 8192 提到 16384。
重跑范围:
  - PROJ-H-03 (4/4 runs 全失败,必重跑)
  - DOC-H-03  (1/4 失败,但高耦合长上下文整体影响大,整体重跑 4 runs 保证公平)
  - CROSS-H-03(1/4 失败,同上整体重跑 4)
  - DATA-H-03 (0/4 失败,但高耦合任务为公平也重跑 4)
  - CONTENT-H-03(0/4失败,但团队Q很低,团队协作写长文案也可能受影响,重跑 4)
  - CROSS-M-02 (1/4 失败,中耦合但输出长,重跑 4)
合计: 6 任务 × 4runs = 24 runs

用法:
  export DEEPSEEK_API_KEY=...
  .venv/bin/python paper/experiments/phase1_fix_reruns.py
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))

EXP = ROOT / "paper" / "experiments" / "baseline_v0.1_dsv4flash"
RERUN_OUT = ROOT / "paper" / "experiments" / "baseline_v0.1_dsv4flash_rerun"
FINAL_OUT = ROOT / "paper" / "experiments" / "baseline_v0.1_final"

# 不受影响保留的任务(9任务×4=36 runs)
KEEP_TASK_IDS = [
    "t-CONTENT-L-01", "t-CONTENT-M-02",
    "t-CROSS-L-01",
    "t-DATA-L-01", "t-DATA-M-02",
    "t-DOC-L-01", "t-DOC-M-02",
    "t-PROJ-L-01", "t-PROJ-M-02",
]

# 重跑任务(6任务×4=24 runs)
RERUN_TASK_IDS = [
    "t-DOC-H-03", "t-CROSS-H-03", "t-DATA-H-03", "t-CONTENT-H-03", "t-PROJ-H-03",
    "t-CROSS-M-02",
]


def main():
    api_key = os.getenv("DEEPSEEK_API_KEY")
    if not api_key:
        print("ERROR: 请设置 DEEPSEEK_API_KEY"); sys.exit(1)

    # Step 1: 备份原数据
    backup = EXP.with_name(EXP.name + "_v1_backup")
    if not backup.exists():
        shutil.copytree(EXP, backup)
        print(f"✅ 原数据备份到 {backup}")

    # Step 2: 重跑 6 任务
    RERUN_OUT.mkdir(parents=True, exist_ok=True)
    task_paths = " ".join(str(ROOT/"paper"/"tasks"/"data"/"v0.1"/f"{t}.json") for t in RERUN_TASK_IDS)
    print(f"\n>>> Step 2: 重跑 {len(RERUN_TASK_IDS)} 任务 × 2seeds × 2modes = 24 runs")
    print(f"    输出到: {RERUN_OUT}")

    # 写 runner 命令:逐个任务 --task 跑,合并进 RERUN_OUT
    runner = str(ROOT / "paper" / "infra" / "teambench_runner.py")
    for tid in RERUN_TASK_IDS:
        task_file = ROOT / "paper" / "tasks" / "data" / "v0.1" / f"{tid}.json"
        if not task_file.exists():
            print(f"❌ {task_file} 不存在,跳过"); continue
        print(f"   跑 {tid} ...")
        cmd = [
            sys.executable, runner,
            "--task", str(task_file),
            "--seeds", "0", "1",
            "--model", "deepseek-v4-flash",
            "--disable-llm-judge",
            "--out", str(RERUN_OUT),
        ]
        p = subprocess.run(cmd, capture_output=True, text=True,
                           env={**os.environ, "DEEPSEEK_API_KEY": api_key,
                                "PATH": os.environ.get("PATH", "")})
        print(f"    stdout tail: {p.stdout.strip().splitlines()[-5:] if p.stdout.strip() else '(empty)'}")
        if p.returncode != 0:
            print(f"    ⚠️ 退出码={p.returncode}  stderr: {p.stderr[-500:]}")

    # Step 3: 合并 36 keep runs + 24 rerun runs = 60 runs
    print("\n>>> Step 3: 合并结果")
    FINAL_OUT.mkdir(parents=True, exist_ok=True)

    def load_rows(d: Path):
        f = d / "summary.jsonl"
        if not f.exists(): return []
        return [json.loads(l) for l in f.read_text(encoding="utf-8").splitlines() if l.strip()]

    keep_rows = [r for r in load_rows(backup) if r["task_id"] in KEEP_TASK_IDS]
    rerun_rows = [r for r in load_rows(RERUN_OUT) if r["task_id"] in RERUN_TASK_IDS]
    print(f"   keep  runs (9 tasks): {len(keep_rows)} (expected 9×4=36)")
    print(f"   rerun runs (6 tasks): {len(rerun_rows)} (expected 6×4=24)")

    # 需要保持每个 (task_id, mode, seed) 唯一:如果 keep 里有 rerun 任务的旧记录,drop
    keep_rows = [r for r in keep_rows if r["task_id"] not in RERUN_TASK_IDS]
    merged = keep_rows + rerun_rows
    merged.sort(key=lambda r: (r["task_id"], r["mode"], r["seed"]))

    (FINAL_OUT / "summary.jsonl").write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in merged) + "\n", encoding="utf-8"
    )

    # 复制产物目录(保留 task_id 文件夹用于 review)
    for tid in KEEP_TASK_IDS:
        src = backup / tid
        if src.exists() and not (FINAL_OUT / tid).exists():
            shutil.copytree(src, FINAL_OUT / tid)
    for tid in RERUN_TASK_IDS:
        src = RERUN_OUT / tid
        if src.exists():
            dst = FINAL_OUT / tid
            if dst.exists(): shutil.rmtree(dst)
            shutil.copytree(src, dst)

    print(f"   ✅ 合并完成: {len(merged)} runs  →  {FINAL_OUT / 'summary.jsonl'}")

    # Step 4: 验证截断错误数
    errs = [r for r in merged if r.get("error")]
    print(f"   合并后含 error 的 runs: {len(errs)}")
    for e in errs:
        print(f"     {e['task_id']} {e['mode']} s{e['seed']}: {e['error'][:120]}")

    print(f"\n下一步: 执行报告生成")
    print(f"  .venv/bin/python paper/experiments/phase1_report.py --exp {FINAL_OUT} | tee {FINAL_OUT}/phase1_final_report.txt")


if __name__ == "__main__":
    main()
