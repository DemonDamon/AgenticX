# ECP 产品演示录制 RUN

## 前置

- Mac tip：`main` @ `6d2f8df0`（或更新 tip）；Admin `:3001`、Portal `:3000` 已起。
- **不要**在缺 TTS 时硬跑全量 MP4。先在 Grok Bot box 用 edge-tts 灌满 `.runtime/agx-ecp-demo-tts/<cueId>.wav`。
- 禁止 macOS `say`，除非显式 `DEMO_TTS_ALLOW_SAY=1`。

## Box 上批量 TTS（parent）

```bash
python3 -m venv /tmp/edge-tts-venv && /tmp/edge-tts-venv/bin/pip install -q edge-tts
mkdir -p /tmp/agx-ecp-demo-tts
# 读 docs/enterprise-capability-platform/shots/ecp-demo-cues.json
# 对每个 cue：
/tmp/edge-tts-venv/bin/python -m edge_tts   --voice zh-CN-XiaoxiaoNeural --rate=+8%   --text "<vo>"   --write-media /tmp/agx-ecp-demo-tts/<id>.mp3
ffmpeg -y -i /tmp/agx-ecp-demo-tts/<id>.mp3 -ar 44100 -ac 1 /tmp/agx-ecp-demo-tts/<id>.wav
# CopyFromBox → Mac AgenticX/.runtime/agx-ecp-demo-tts/<id>.wav
```

## Mac 录屏

```bash
cd ~/myWork/AgenticX
set -a && source enterprise/.env.local && set +a
DEMO_TTS_CACHE_DIR="$(pwd)/.runtime/agx-ecp-demo-tts"   pnpm -C enterprise exec tsx scripts/demo-ecp-ops-manual-record.ts
```

输出：`docs/enterprise-capability-platform/shots/ecp-ops-manual-demo.mp4` + `.zh.srt`（gitignore，勿 commit）。

## Feishu（parent as 库洛洛）

- wiki space `7459622435080814593`
- parent node `S49bw4rkJiSJ32kJFr5ctwsgnDb`（产品说明文档）
- title：`企业能力平台 · 产品操作手册`
- 用 lark-cli 发布；填回 `feishu-ops-manual.url`
