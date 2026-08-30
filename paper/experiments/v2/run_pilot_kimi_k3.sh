#!/bin/zsh
# Pilot v2 Kimi K3 复刻：装配效应跨模型泛化验证
# 15 任务 × 3 seeds × 7 臂 = 315 runs，judge 关闭，断点续跑 + Moonshot 余额守卫（阈值 ¥10）
# 注意：kimi-k3 输出 ¥100/M 且恒开推理，预计总成本 ¥270–400；余额不足会优雅停止，充值后重跑本脚本续跑。
set -o errexit
cd /Users/damonli/myWork/AgenticX
export PATH=/usr/bin:/bin:/usr/sbin:/sbin:$PATH
: "${KIMI_API_KEY:?请先 export KIMI_API_KEY}"

OUT=paper/experiments/v2/pilot_kimi_k3
RUN=(.venv/bin/python paper/infra/teambench_runner.py
     --tasks-dir paper/tasks/data/v0.1
     --seeds 0 1 2
     --model kimi-k3
     --base-url https://api.moonshot.cn/v1
     --api-key-env KIMI_API_KEY
     --disable-llm-judge
     --min-balance 10
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

echo "=== pilot_kimi_k3 完成，原始数据在 $OUT/summary.jsonl ==="
echo "=== 重打分（L1 v2.2 + L2 v2 断言）：.venv/bin/python paper/experiments/v2/rescore.py --exp-dir $OUT ==="
