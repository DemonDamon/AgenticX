---
name: voice-input-ptt-streaming
overview: Near 聊天输入框支持微信式「按住快捷键说话、边说边出字」；松开后写入草稿不自动发送。首版用浏览器流式识别 + 绿色浮条 UI，快捷键可在设置中配置。
todos:
  - id: ptt-core
    content: 新增 PTT 配置、流式识别 session、WeChat 风格浮条与 ChatPane/ChatView 接入。
    status: completed
  - id: ptt-settings
    content: 设置 → 语音 Tab 增加「按住说话」快捷键选项（Ctrl+Space / Space 空输入 / Alt+Space / ⌘+Space）。
    status: completed
  - id: ptt-tests
    content: 补充 ptt-config 单测并验证 desktop 相关测试。
    status: completed
  - id: doubao-stream-asr
    content: （后续）Studio WebSocket 代理火山「流式语音识别大模型」，替换浏览器识别为豆包云端流式。
    status: completed
isProject: false
---

# 按住说话流式语音输入

## 与旧流程的区别

| 模式 | 触发 | 行为 |
|------|------|------|
| 点击 🎙（保留） | 点两次 | 录整段 → 云端/浏览器转写 → 填草稿 |
| **按住说话（新增）** | 按住快捷键 | **边说边出字** → 松开 → 填草稿 |

## 首版实现

- `desktop/src/voice/ptt-config.ts`：快捷键预设与 localStorage
- `desktop/src/voice/stt-ptt.ts`：Web Speech API 流式 interim
- `desktop/src/hooks/useVoicePushToTalk.ts`：keydown/keyup 按住逻辑
- `desktop/src/components/VoicePttOverlay.tsx`：微信绿 pill
- 默认快捷键：**Ctrl + Space**（Fn 在 macOS 不可捕获）

## 后续

- 火山 `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel` + `volc.bigasr.sauc.duration` 后端代理，对接用户已开通的流式大模型
