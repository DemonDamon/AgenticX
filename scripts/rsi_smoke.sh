#!/usr/bin/env bash
# RSI 数据飞轮 P0 端到端冒烟（真实 harness-lab 数据）
set -euo pipefail
cd "$(dirname "$0")/.."

STORE=datasets/trajectories
DS=datasets

echo "== ②采集: harbor jobs → 轨迹库 =="
python3 -m agenticx.learning.trajectory collect --source harbor \
    --jobs-dir harness-lab/jobs --out "$STORE"
python3 -m agenticx.learning.trajectory stats --store "$STORE"

echo "== ④蒸馏: 轨迹库 → SFT / DPO =="
python3 -m agenticx.trainer build --store "$STORE" --format sft \
    --out "$DS" --name tb40-sft-v1
python3 -m agenticx.trainer build --store "$STORE" --format dpo \
    --out "$DS" --name tb40-dpo-v1

echo "== ⑥回灌: 注册表生命周期 =="
REG=$(mktemp -d)/models.json
python3 -m agenticx.trainer registry register agent-coding-v1 \
    --model openai/glm-5.3-flash-sft-v1 --backend litellm --registry "$REG"
python3 -m agenticx.trainer registry promote agent-coding-v1 --registry "$REG"
python3 -m agenticx.trainer registry resolve agent-coding-v1 --registry "$REG"

echo "== 完成：datasets/ 下的 jsonl + card 可直接交 LLaMA-Factory =="
