#!/usr/bin/env bash
# StartLux-Decision 本地服务化（SP26 T3，已实测可行）
#
# 两层架构（官方模型卡要求）:
#   1. llama-server (b10454+): 跑 GGUF 权重, OpenAI/ completion API, port 8081
#   2. startlux_decision.gguf_server (Apache-2.0, 随 GGUF repo 发布):
#      prompt 渲染 + 字母位读出 + 每题型温度校准 → /v1/systemone, port 8090
#   模型卡明示: plain chat ≠ decisions，读出与校准在 server 层不在权重里
#
# 用法:
#   ./scripts/serve_decision_model.sh [size]        # 0.8b|2b|4b|9b|27b, 默认 4b
#   QUANT=Q8_0 PORT_LLAMA=8081 PORT_ONE=8090 ./scripts/serve_decision_model.sh
#   HF_ENDPOINT=https://hf-mirror.com ./scripts/serve_decision_model.sh   # 主站不通时走镜像
#
# 已验证: hf-mirror.com 可达; weights 许可 CC BY-NC 4.0（研究可用, 商用需授权）
set -euo pipefail

SIZE="${1:-4b}"
QUANT="${QUANT:-Q4_K_M}"
PORT_LLAMA="${PORT_LLAMA:-8081}"
PORT_ONE="${PORT_ONE:-8090}"
MODELS_DIR="${MODELS_DIR:-$HOME/.cache/startlux-decision}"
export HF_ENDPOINT="${HF_ENDPOINT:-}"

case "$SIZE" in
  0.8b) PARAMS="0.8B" ;;
  2b)   PARAMS="2B" ;;
  4b)   PARAMS="4B" ;;
  9b)   PARAMS="9B" ;;
  27b)  PARAMS="27B" ;;
  *) echo "未知档位: $SIZE" >&2; exit 2 ;;
esac

REPO="startlux-models/StartLux-Decision-${PARAMS}-${QUANT}-GGUF"
DIR="$MODELS_DIR/${REPO##*/}"

if [[ ! -f "$DIR/StartLux-Decision-${PARAMS}-${QUANT}.gguf" ]]; then
  echo ">> 下载 $REPO（含 startlux_decision 包与 tokenizer/config）"
  hf download "$REPO" --local-dir "$DIR"
fi

echo ">> 1/2 llama-server (weights) :$PORT_LLAMA"
llama-server -m "$DIR/StartLux-Decision-${PARAMS}-${QUANT}.gguf" \
  -c 8192 --port "$PORT_LLAMA" --host 127.0.0.1 > /tmp/llama-$PORT_LLAMA.log 2>&1 &
PID1=$!
trap 'kill $PID1 $PID2 2>/dev/null || true' EXIT
for _ in $(seq 1 90); do curl -sf "http://127.0.0.1:$PORT_LLAMA/health" >/dev/null 2>&1 && break; sleep 1; done

echo ">> 2/2 gguf_server (systemone) :$PORT_ONE"
(cd "$DIR" && python3 -m startlux_decision.gguf_server \
  --model-dir . --llama "http://127.0.0.1:$PORT_LLAMA" --port "$PORT_ONE" \
  > /tmp/systemone-$PORT_ONE.log 2>&1) &
PID2=$!
for _ in $(seq 1 30); do curl -sf "http://127.0.0.1:$PORT_ONE/" >/dev/null 2>&1 && break; sleep 1; done

echo ">> systemone 验证（官方示例: 重复扣款工单 → 应分流 billing）"
curl -s "http://127.0.0.1:$PORT_ONE/v1/systemone" -H 'Content-Type: application/json' -d '{
  "state": {"ticket": "I was charged twice for order #4411 and the app still shows it as unpaid."},
  "questions": {"team": {"type": "choice", "instructions": "Which team should handle this ticket?",
    "criteria": {"billing": "Payments, refunds and invoices", "shipping": "Delivery and tracking",
                 "technical": "App, login and account problems"}}}
}' | python3 -c 'import json,sys; a=json.load(sys.stdin)["answers"]["team"]; print("team =", a["choice"], "conf =", round(a["confidence"],3))'

echo ">> 就绪。评测: python scripts/eval_decision_baseline.py --data <decisions.jsonl> --scorer startlux --model StartLux-Decision-${PARAMS}-${QUANT}"
wait $PID1 $PID2
