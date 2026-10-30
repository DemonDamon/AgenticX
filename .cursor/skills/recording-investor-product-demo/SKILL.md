---
name: recording-investor-product-demo
description: Use when recording or re-recording an AgenticX Enterprise product ops-manual / investor demo as MP4 with Chinese voiceover, hard subtitles, UI zoom camera, Feishu upload, or when the user says the prior demo VO sounds stiff/AI-like or the frame looks shrunk.
---

# Recording Investor Product Demo

## Overview

Ship an **investor/business-readable** AgenticX Enterprise UI demo: operate the real admin + portal product, narrate why/what/how in plain Mandarin, burn Chinese captions, use local→global camera zooms, then replace the MP4 on the Feishu ops manual. This is a **product story**, not an engineer acceptance tape.

**Canonical recorder (Mac checkout):** `enterprise/scripts/demo-rk-ops-manual-record.ts`  
**Default output:** `docs/agx-rules-knowledge-suite/e2e-shots/rk-ops-manual-demo.mp4` (+ companion `.zh.srt`)

## Non‑negotiable rules

1. **Operate Enterprise UI**, never scroll the Feishu doc as the “demo.”
2. **Record on Damon’s Mac** against local admin (`:3001`) + portal (`:3000`). Box cannot reach Mac localhost without a tunnel.
3. **Neural Mandarin VO only** — Microsoft `edge-tts` `zh-CN-XiaoxiaoNeural` @ about `+8%`. Do **not** use macOS `say` / Tingting / Shelley unless the user explicitly allows a last-resort fallback (`DEMO_TTS_ALLOW_SAY=1`).
4. **Mac cannot reach** `speech.platform.bing.com` WSS from China → generate wavs on the **Grok Bot box**, then copy into Mac cache (default `AgenticX/.runtime/agx-rk-demo-tts/<cueId>.wav`).
5. **Spoken pace = normal conversation**, not slow broadcast. Prefer short 口语 clauses; keep `holdAfterMs` tight (~200–450ms). Long wall time should come from UI waits, not dragged TTS.
6. **Camera:** viewport ≥ `1600×1000`; every major product cue `zoomTo` the focal control → VO → `zoomOut`. Title/agenda cards may stay full-frame.
7. **Desensitize for investors:** say/show 1号泵 / 2号泵 / 阀门 — never unexplained Brand‑A / internal IDs in VO or captions (UI chrome may still show seed IDs; narration must translate).
8. **Feishu ops as 库洛洛**; replace the prior demo file block (delete old + note), insert new preview video + short caption note.
9. Stay on the intended git tip (usually `main`); leave unrelated dirty trees (e.g. FinnewsHunter) untouched. Do not commit large MP4s unless asked.

## When to use / not

**Use when:** “录个产品演示”, “投资人版旁白”, “换飞书视频”, “旁白太 AI / 太生硬”, “镜头放大一点”, ops-manual demo MP4 for Rules & Knowledge (or the same pattern for another Enterprise suite).

**Do not use when:** static HD screenshot refresh only; pure Feishu doc text edits; coding a feature without a demo ask.

## Pipeline

```
1. Confirm Mac branch/tip + admin/portal (and Neo4j if graph pages) healthy
2. Ensure/update recorder cues (口语 VO + zoom beats + page path)
3. Generate neural TTS on box → CopyFromBox → .runtime/agx-rk-demo-tts/<cueId>.wav
4. Run recorder on Mac; mux VO + hard-burn Chinese captions
5. Spot-check: neural audio, zoom beats, graph-explorer included if on tip
6. Upload/replace Feishu demo block as 库洛洛
7. Report paths, duration, voice/rate, Feishu block id — leave MP4 untracked unless asked
```

### Run recorder (Mac, repo root)

```bash
set -a && source enterprise/.env.local && set +a
pnpm -C enterprise exec tsx scripts/demo-rk-ops-manual-record.ts
```

### Generate TTS cache (box)

```bash
# venv once
python3 -m venv /tmp/edge-tts-venv && /tmp/edge-tts-venv/bin/pip install -q edge-tts
# per cue (example)
/tmp/edge-tts-venv/bin/python -m edge_tts \
  --voice zh-CN-XiaoxiaoNeural --rate=+8% \
  --text "……口语旁白……" \
  --write-media /tmp/<cueId>.mp3
ffmpeg -y -i /tmp/<cueId>.mp3 -ar 44100 -ac 1 /tmp/<cueId>.wav
# then CopyFromBox → Mac AgenticX/.runtime/agx-rk-demo-tts/<cueId>.wav
```

Env knobs (recorder): `DEMO_TTS_CACHE_DIR`, `DEMO_TTS_VOICE`, `DEMO_TTS_RATE`, `DEMO_CLAUSE_GAP_MS`, `DEMO_VIEWPORT_W/H`, `DEMO_TTS_ALLOW_SAY` (avoid).

## Narrative shape (every cue)

- **Why** business problem in one plain sentence  
- **What** the screen is answering  
- **How** the user acts (point at the zoomed control)  
- Captions shorter than VO; hard-burned Chinese

## Feishu

- Doc (RK suite ops manual): `https://wv18cbjmgi0.feishu.cn/docx/TpgqdzPzKoeFJix1WRxcPBxBnzf`
- Account: **库洛洛** (`lark-cli` / Feishu `--as user`)
- Delete previous demo file block + stale note; upload new MP4 with preview; caption like「规则与知识套件产品演示（神经网络旁白·口语语速 · 投资人版）」

## Known failure modes (do not repeat)

| Failure | Fix |
|--------|-----|
| Demo is Feishu-doc scroll | Re-record against Enterprise admin/portal only |
| VO = macOS `say` / “10-year TTS” | edge-tts Xiaoxiao on box; block `say` |
| VO too slow / not 口语 | rate ~`+8%`; short clauses; cut holds |
| Frame looks shrunk / half UI | 1600×1000 + zoomTo/zoomOut on key controls |
| Missing graph-explorer | Record on tip that has it; restart stack; include cue |
| Brand‑A jargon in VO | Rewrite to 1号泵/阀门 human labels |
| Wrong git tip / dirty tree | ff to intended main; don’t touch FinnewsHunter |

## Red flags — stop and correct

- About to open Feishu in Playwright “as the product”  
- About to call `say -v Tingting/Shelley` for final audio  
- No zoom beats on rules / knowledge / 消歧 / graph / citations  
- Uploading without deleting the previous demo block  
- Claiming “done” without Feishu new block id + local MP4 path

## Completion report (required)

Lead with: MP4 path, size, duration, voice+rate, Feishu new block id, tip SHA, whether zoom retained. Note any UI seed IDs still visible vs VO desensitization.
