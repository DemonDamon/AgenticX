# Desktop 设置页长期 Loading 修复

Planned-with: composer-2.5-fast

## 背景

重启 Near 后，设置页多个 Tab（技能、内置工具、知识脑、钩子、语音等）长时间停留在「加载中…」，甚至永久阻塞。首轮 CORS（5713）修复后，仍有个别路径在 `agx serve` 未就绪或 `apiBase` 为空时发起无超时 fetch，导致 UI 挂死。

## 根因

1. **设置类 IPC**（`load-skills` / `get-tools-registry` / `get-guard-settings` 等）直接 `fetch(getStudioUrl())`，未 `await waitForStudio()`，也无 Abort 超时；后端冷启动时 TCP 长时间挂起。
2. **渲染进程 fetch**（Hooks、Voice、Brains/KB API、PendingProposals）依赖 store `apiBase`，为空时走 Vite `/api` proxy → 8000，约 3s 失败且 `useEffect([])` 不重试。
3. **`get-api-base` IPC** 未等待 serve 就绪，可能返回默认 `8000` 或错误端口。

## 方案

- 主进程：`fetchStudioBackend()` = `waitForStudio(60s)` + `AbortSignal.timeout(20s)` + token；设置相关 IPC 统一使用。
- 新增 IPC `wait-for-studio` + preload 暴露。
- 渲染进程：`desktop/src/utils/studio-fetch.ts`（`resolveStudioApiBase` / `waitStudioReady` / `studioFetch`）。
- 改造：HooksTab、VoiceSettingsPanel、PendingProposalsList、knowledge/api、brains/api。
- `get-api-base` 在本地模式先 `waitForStudio`。

## 验收

- [ ] 完全退出 Near → `pip install -e .` → `cd desktop && npm run dev`
- [ ] 冷启动后立即打开设置：技能 / 工具 / 知识脑 / 钩子 / 语音应在 **≤20s** 内结束 loading（正常 serve 就绪后 **≤3s**）
- [ ] 后端未启动时不应无限 spinner；超时后应显示可读错误
- [ ] CORS：`Origin: http://localhost:5713` 预检仍返回 allow-origin

## Requirements

- FR-1: 设置页所有 studio API 请求在本地模式须等待 serve ready barrier
- FR-2: 所有设置页 fetch（IPC 与渲染进程）须带 20s 超时
- FR-3: `apiBase` 为空时须 fallback 至 IPC `get-api-base`（已含 wait）
- AC-1: 上述五个 Tab 冷启动不再永久 loading
- AC-2: 超时后 UI 展示错误而非 silent hang
