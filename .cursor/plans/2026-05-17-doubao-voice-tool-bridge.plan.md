# 豆包电话模式工具调用桥接（VoiceFocusMode 侧）

- Plan-Id: 2026-05-17-doubao-voice-tool-bridge
- Owner: Damon Li
- Status: Draft

## 1. 背景

OpenAI Realtime 已经接入 `/api/voice/tool_schemas` + `/api/voice/tool_call`（含 `VoiceConfirmGate`），并通过 DataChannel `session.update` 注入 tools，实现「Realtime 自链式」工具调用，UI 上有 `tool_running` phase、tool_result 落盘、tool_scope 高级开关。

豆包实时语音协议（火山 RTC WebSocket）目前**没有公开 function calling 字段**（`scripts/doubao_voice_tool_spike.py` 也没探测到原生 tool 事件），因此原生路径短期内不可行。

上一次尝试在 `doubao-realtime.ts` provider 内部直接调 `/api/chat` 做桥接，结果出了两个事故：
- 桥接调用失败时抛 `kind: "error"`，触发 `VoiceFocusMode` 的 5 秒错误兜底，导致**电话模式自动退出**。
- 同时把豆包原生 `ChatResponse / TTSResponse / TTSEnded` 全部屏蔽，桥接挂掉后**完全无声**。

已经回滚到「豆包原生语音对话能用，但没有工具」状态。这条 plan 是在不再破坏「能说话」这条底线的前提下，把工具调用补回来。

## 2. 设计原则

1. **桥接放在 `VoiceFocusMode` 组件层，而不是 provider 层**：provider 只负责 ASR/TTS/原生对话；编排（要不要 / 何时调工具）由 UI 层决定，可以独立失败、不污染 realtime 会话。
2. **失败不退出电话**：桥接失败只走 UI inline 提示（capsule 内 toast 或副标题），绝不发 `kind: "error"`、不触发 5 秒兜底。
3. **不抢豆包原生回复**：默认让豆包原生 ASR + LLM + TTS 跑完一轮；工具桥接是「增量补一条」而不是「替换主回复」。先做最低破坏面的形态：用户在话术里显式触发工具意图时才桥接。
4. **复用 OpenAI 链路的所有后端能力**：`/api/voice/tool_schemas` / `/api/voice/tool_call` / `VoiceConfirmGate` / `VOICE_DEFAULT_TOOL_ALLOWLIST` / `tool_scope` 设置；不新增后端面。
5. **工具结果落盘走已有路径**：`POST /api/session/messages/append`，`role: tool` + metadata `source: voice-focus`，复用 ToolCallCard 渲染。

## 3. 触发策略（关键决策）

豆包没有原生 function call 信号，桥接侧需要自己决定「这一句话要不要调工具」。两种选项：

### A. 显式触发（推荐 P0）

- 在 capsule 上加一个「工具」次级按钮（小齿轮/扳手图标），按住或单击进入「工具一问」模式。
- 该模式下用户讲完一句，**不让豆包回答**（本地短暂静音 / 不播 TTSResponse 的音频），而是把转写发到 `/api/chat`（一次性 SSE），把 final text 通过本地 `speechSynthesis` 朗读出来。
- 按钮释放或单击退出后，回到豆包原生对话。
- 优点：状态机干净、用户心智清楚（「我现在在让 Meta 干活」）、不会和豆包语音抢话。
- 缺点：需要一次额外交互。

### B. 关键词触发（P1，可选）

- 监听豆包 `user_final`，如果命中本地正则（如「帮我 / 搜 / 列 / 查询 / 打开 / 执行」等关键词），并行调用 `/api/chat`，**保留豆包原生回复**作为「兜底语音」，工具结果以**文字 + 短朗读补充**追加。
- 优点：无须额外交互。
- 缺点：路由不可靠，容易抢话；先不做。

P0 锁定方案 A，P1 再评估是否补 B。

## 4. 实施步骤

### P0：显式触发的豆包工具桥接

**FR-1（前端 / 桥接）**

- 新建 `desktop/src/voice/realtime/meta-bridge.ts`，导出 `runMetaTurnViaChat(args)`：
  - 入参：`apiBase`, `desktopToken`, `sessionId`, `query`, `signal`。
  - 内部：`POST /api/chat`，按 SSE 解析 `token / tool_call / tool_result / final / error`。
  - 出参：`{ finalText, toolCalls: Array<{name, args, result, callId}> }`。
  - **失败抛 Error**（由调用方决定如何展示），不在这里发 `kind: "error"`。

**FR-2（豆包 provider）**

- 新增 `pauseDoubaoOutput()` / `resumeDoubaoOutput()`：
  - pause：临时 drop `TTSResponse` 的音频帧、忽略 `ChatResponse` 文本累加。
  - resume：恢复正常路径。
- 新增 `requestUserFinalOnce(handler)`：注册一次性 `user_final` 监听，触发后即解绑（避免泄漏）。
- 这两个方法通过 `RealtimeVoiceSession` 暴露（不在 provider 间共享接口，类型加 `kind: "doubao"` guard）。

**FR-3（VoiceFocusMode UI）**

- capsule 右下角新增一个小按钮 `🛠`：
  - 按下：调用 `pauseDoubaoOutput()`，capsule 副标题切到「工具一问，请讲…」，phase = `listening`。
  - 收到一次 `user_final`：调 `runMetaTurnViaChat`；期间 capsule 标题显示 `tool_running` + 工具名。
  - 拿到结果：
    - 用 `speechSynthesis.speak(finalText, { lang: "zh-CN" })` 本地播报；onend 后回到 `listening`。
    - `appendVoiceTurn` 写入 `user` + `assistant` + 每个 `tool` 条目（已有签名足够）。
  - 失败：副标题展示「工具调用失败：xxx（已回到普通对话）」3 秒后清除；自动 `resumeDoubaoOutput()`；**不退出电话**。
- 再次单击 `🛠`：取消进行中请求（AbortController），`resumeDoubaoOutput()`，回到普通对话。
- 仅当 provider 为豆包 + `tool_scope` 已配置时才显示按钮；OpenAI 模式下隐藏（OpenAI 走自链式不需要这个按钮）。

**FR-4（持久化）**

- 工具调用产生的 `user/assistant/tool` 走现成 `appendVoiceTurn`，无需新接口。
- 朗读出的 `assistant` 文本写库；本地 TTS 失败时仍要写库（保证记录完整）。

**NFR-1（健壮性）**

- 桥接路径**不许**调用 `this.emit?.({ kind: "error" })`；只调用 UI inline 状态。
- `VoiceFocusMode` 中的 5 秒错误兜底逻辑保留给真正的 realtime 链路错误（断连、SDP 失败等），不被工具桥接触发。
- AbortController 必须能取消 fetch；用户挂电话时一并 abort。

**AC（验收）**

- AC-1：豆包模式下电话不再因为工具调用失败而自动退出。
- AC-2：豆包模式下点击 `🛠` → 说「帮我列一下桌面文件」→ Meta 实际执行 `bash_exec` 或 `file_*` 工具 → 本地 TTS 念出结果。
- AC-3：会话历史里能看到 `user / tool / assistant` 三条，metadata.source = `voice-focus`。
- AC-4：桥接 fetch 网络断时，capsule 显示「工具调用失败」3 秒，自动恢复豆包原生对话，电话不退出。
- AC-5：进行中再次点击 `🛠` 可取消（abort）。

### P1：关键词自动触发（可选，本 plan 暂不实施）

- 仅当 P0 跑稳一段时间后再评估。
- 可能形态：本地 router 命中关键词 → 触发桥接 → 抑制豆包当次 TTS（需要一个「准备静音 N 秒」窗口）。
- 必须先验证 router 的误触发率，否则会持续抢话。

## 5. 风险与回滚

- **风险 1**：豆包 pause/resume 期间，远端仍在推 PCM 帧，本地 `enqueuePcmOut` 已经入队的可能继续播。
  - 缓解：pause 时立即调用 `flushPlayback()`。
- **风险 2**：`speechSynthesis` 在 macOS 上可能静音（系统语音未配置）。
  - 缓解：UI 上同步显示 finalText 文本；TTS 失败不算桥接失败。
- **回滚**：删除 `meta-bridge.ts`、`🛠` 按钮、`pause/resumeDoubaoOutput()` 三处即可恢复到本 plan 之前的状态。

## 6. 不在本 plan 范围

- 豆包原生 function calling（等官方公开协议字段再说）。
- OpenAI Realtime 工具链路（已完成）。
- 设置面板 UI 调整（tool_scope 复用现有开关即可）。
- 群聊 / 分身在电话模式下的路由（保持 Meta-only）。

## 7. 落盘清单

- [ ] `desktop/src/voice/realtime/meta-bridge.ts`（新）
- [ ] `desktop/src/voice/realtime/doubao-realtime.ts`（pause/resume + once-listener）
- [ ] `desktop/src/voice/realtime/types.ts`（如需扩 emit/连接选项）
- [ ] `desktop/src/components/VoiceFocusMode.tsx`（`🛠` 按钮 + 状态机）
- [ ] `desktop/src/styles/voice-focus.css`（按钮样式）
- [ ] 冒烟：豆包模式手动跑 AC-1~AC-5。
