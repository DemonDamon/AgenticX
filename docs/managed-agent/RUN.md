# 托管智能体 · 产品演示录制 RUN

## 前置

- Mac tip：`main` @ `7f44e9bc`（或更新 tip）。
- 服务已起：Admin `:3001`、Portal `:3000`、Gateway `:8088`、agent-runtime `:8092`。
- 环境建议（开发）：`MA_RUNTIME_ENABLED=1`；按需再开  
  `NEXT_PUBLIC_MA_EVALS_UI_ENABLED=1`、`MA_RUNTIME_EVALS_ENABLED=1`、  
  `MA_RUNTIME_SCHEDULER_ENABLED=1`、`MA_RUNTIME_WEBHOOKS_ENABLED=1`、  
  `MA_RUNTIME_CHANNELS_ENABLED=1`。
- **不要**在缺 TTS 时硬跑全量 MP4。先在 Grok Bot box 用 edge-tts 灌满 `.runtime/agx-ma-demo-tts/<cueId>.wav`。
- 禁止 macOS `say`，除非显式 `DEMO_TTS_ALLOW_SAY=1`。

## 截图复拍（可选）

现有铜管图在 `docs/managed-agent/shots/01–15*.png`（gitignore）。需要刷新时，用 Playwright 对上述路由各拍一帧即可；命名保持附录清单一致。

## Box 上批量 TTS（parent）

```bash
python3 -m venv /tmp/edge-tts-venv && /tmp/edge-tts-venv/bin/pip install -q edge-tts
mkdir -p /tmp/agx-ma-demo-tts
# 读 docs/managed-agent/shots/ma-demo-cues.json
# 对每个 cue：
/tmp/edge-tts-venv/bin/python -m edge_tts \
  --voice zh-CN-XiaoxiaoNeural --rate=+8% \
  --text "<vo>" \
  --write-media /tmp/agx-ma-demo-tts/<id>.mp3
ffmpeg -y -i /tmp/agx-ma-demo-tts/<id>.mp3 -ar 44100 -ac 1 /tmp/agx-ma-demo-tts/<id>.wav
# CopyFromBox → Mac AgenticX/.runtime/agx-ma-demo-tts/<id>.wav
```

## Mac 录屏

```bash
cd ~/myWork/AgenticX
set -a && source enterprise/.env.local && set +a
# 确认 MA_RUNTIME_ENABLED=1 等开关已进进程环境
DEMO_TTS_CACHE_DIR="$(pwd)/.runtime/agx-ma-demo-tts" \
  pnpm -C enterprise exec tsx scripts/demo-ma-ops-manual-record.ts
```

输出：`docs/managed-agent/shots/ma-ops-manual-demo.mp4` + `.zh.srt`（gitignore，勿 commit）。

Cues：`docs/managed-agent/shots/ma-demo-cues.json`（脚本会加载 vo / caption / hold / focus）。

## Feishu（OUT OF SCOPE 本任务；parent as 库洛洛 另发）

- 父节点「产品说明文档」下新建 wiki/docx：`托管智能体 · 产品操作手册`
- 发布后回填 `feishu-ops-manual.url`（仅 wiki / docx URL，勿写 node_token）
