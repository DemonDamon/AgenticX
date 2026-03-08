# AgenticX Desktop MVP

## 快速启动

1. 在仓库根目录启动服务端：
   - `agx serve --host 127.0.0.1 --port 8000`
2. 在 `desktop/` 目录安装依赖并启动：
   - `npm install`
   - `npm run dev`

## E2E 验证流程（Phase 4）

1. 启动 `agx serve` 后，打开 Electron 窗口。
2. 在侧边栏输入自然语言需求。
3. 验证对话区域出现工具调用事件（tool_call）与最终回答（final）。
4. 当服务端触发确认（confirm_required）时，在上层 UI 调用 `/api/confirm` 回复。
5. 打开代码预览区域，确认产物内容可见。

## 语音增强（Phase 5）

- `src/voice/stt.ts`：浏览器 STT。
- `src/voice/tts.ts`：TTS 播报。
- `src/voice/wakeword.ts`：唤醒词检测。
- `src/voice/interrupt.ts`：语音打断 TTS。
