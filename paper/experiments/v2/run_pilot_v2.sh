#!/bin/zsh
# Pilot v2：任务迁移后重跑（L2 断言生效），15 任务 × 3 seeds × 7 臂 = 315 runs
# DS v4 Flash，judge 关闭（省钱）。带断点续跑 + 余额守卫。
set -o errexit
cd /Users/damonli/myWork/AgenticX
export PATH=/usr/bin:/bin:/usr/sbin:/sbin:$PATH
: "${DEEPSEEK_API_KEY:?请先 export DEEPSEEK_API_KEY}"

OUT=paper/experiments/v2/pilot_flash_v2
RUN=(.venv/bin/python paper/infra/teambench_runner.py
     --tasks-dir paper/tasks/data/v0.1
     --seeds 0 1 2
     --model deepseek-v4-flash
     --disable-llm-judge
     --min-balance 5
     --out $OUT)

echo "=== [1/5] single + refine_k + team_integrator ==="
"${RUN[@]}" --assembly integrator --single-baseline single_refine_k

echo "=== [2/5] team_last ==="
"${RUN[@]}" --assembly last --single-baseline none

echo "=== [3/5] team_concat ==="
"${RUN[@]}" --assembly concat --single-baseline none

echo "=== [4/5] team_blackboard ==="
"${RUN[@]}" --assembly blackboard --single-baseline none

echo "=== [5/5] single_bon_k（其余臂已存在自动跳过）==="
"${RUN[@]}" --assembly integrator --single-baseline single_bon_k

echo "=== pilot_v2 完成，原始数据在 $OUT/summary.jsonl ==="
echo "=== 重打分（L1 v2.2 + L2 v2 断言）：.venv/bin/python paper/experiments/v2/rescore.py --exp-dir $OUT ==="
