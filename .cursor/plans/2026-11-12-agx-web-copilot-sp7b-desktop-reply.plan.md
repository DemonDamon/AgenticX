# SP7b · 桌面端真实回复（copilot_reply 从 mock 变真）

归属：feat/agx-browser-extension · Master Plan `.cursor/plans/2026-11-12-agx-web-copilot.plan.md` 第 3 节
依赖：SP7a（协议与 SW 路由已落地）；与 SP7c 可并行
闭环定义：面板输入 → NM → desktop bridge → Studio 会话真实 agent 回复 → 面板显示回答全文

## 0. 防扩散边界

- **不做流式**（整段回复一次性 `copilot_reply`；`chat_delta` 留 v2 backlog）
- 不动面板 UI（SP7a 已定）；不动扩展侧任何文件
- 不新建注入通道：会话解析、POST /api/chat、SSE 处理**全部复用 SP5 已验证的
  `dispatchInjectContext` 既有设施**
- 多轮上下文 = Studio 会话天然具备（同一 session 的既有历史），不在桥接层做任何记忆逻辑

## 1. 关键事实（已验证，直接利用）

- SP5 的 `desktop/electron/browser-bridge.ts` `dispatchInjectContext` 已实现：
  会话解析（`GET /api/sessions` 按 updated_at 取最近活跃）→ `POST /api/chat`
  （SSE，首个 chunk 后 cancel）→ 错误映射全套
- **SSE 通道本身就携带 agent 回复流**——SP5 只是刻意提前 cancel。本计划的工作核心 =
  不 cancel、drain 到底、聚合成 `copilot_reply.text`

## 2. 任务

### 2.1 `dispatchCopilotChat`（browser-bridge.ts，唯一新入口）
- 消息形态：`{type:"copilot_chat", request_id, session_id?, text, source_url?, source_title?}`
- 会话解析与错误映射：与 dispatchInjectContext 完全同源（复用同一内部函数）
- POST /api/chat 请求体：**真实用户轮**（不是 context_files 占位）；
  text 带来源时拼 `[来自页面 <source_title>](<source_url>)\n<text>` 前缀（复用 plan 格式）
- SSE drain：读 chunk 聚合 assistant 回复文本（聚合格式以 Studio SSE 实际 chunk 结构为准，
  先读既有 SSE 消费代码——desktop/cli 中必有先例；vitest mock 按 same 格式定契约）
- 30s 超时 → `reply_timeout`，已注入的轮次不回滚（如实告知用户"已进会话，回答超时"）
- 完成后：`sendAct` 形态回推 `{type:"copilot_reply", request_id, session_id, ok:true, text}`
  （transport type 剥离，fire-and-forget 同 inject_context_result 形态）

### 2.2 main.ts 接线
- 仅按既有模式传 getter（对照 SP5 执行结果里 injectContextStudio 的两行接线）

### 2.3 vitest（desktop/tests/browser-bridge-copilot.test.ts，新）
- 镜像 browser-bridge-inject-context.test.ts 的 mock 模式，用例：
  - 会话解析三态（payload.session_id / 最近活跃 / 无会话）
  - 请求体格式（真实轮 + 来源前缀）
  - SSE 聚合正确性（多 chunk 拼接）
  - 超时映射、studio 5xx/unreachable 映射、回推 wiring
- **诚实降级条款**：若读码后发现 SSE 聚合无法可靠拿到全文（格式不透明/无先例），
  则实现降级版：`{ok:true, text:"已发送到桌面端会话，请到 Studio 查看回答"}`，
  并在执行结果里明确标注"降级 + 原因"，**不许假装是真回复**

## 3. 验收判据

1. 新 vitest 全 PASS；既有 browser-bridge-inject-context.test.ts 零回归
2. `node scripts/e2e/verify-copilot-panel.mjs` 复跑：mock bridge 替换为「透传模式」
   （若 verify 脚本有 desktop 真桥接模式；纯 mock 模式则此条改为人工真机）
3. 真机（用户桌面端 dev 起服务 + Chrome 扩展）：面板输入 → 面板出现真实 agent 回复，
   Studio 会话里同步出现该轮（用户确认）

## 4. Sub agent 执行提示

- 先读：`desktop/electron/browser-bridge.ts`（dispatchInjectContext 全文）、
  `desktop/tests/browser-bridge-inject-context.test.ts`（mock 模式）、
  desktop/cli 侧任何既有 SSE 消费先例（grep `text/event-stream`）
- 会话解析/错误映射必须复用同一函数，复制粘贴两份算实现错误
- 禁止顺手做流式、禁止动扩展侧文件

## 5. 执行结果

已完成（sub agent，2026-11-12），**无降级**。交付：browser-bridge.ts 新增 dispatchCopilotChat（真实用户轮 + [来自页面 …](url) 前缀 + SSE drain 聚合 + 30s reply_timeout）+ 提取共享 postStudioChatTurn（dispatchInjectContext 重构复用同一函数）；nm-socket-server.ts 增加 copilot_chat 路由；main.ts 两行接线；tests/browser-bridge-copilot.test.ts 14 用例。
SSE 聚合：镜像 ChatPane.tsx liveText 先例（data: {"type":"token"} 帧、跨 chunk 半帧缓冲、只聚合 meta agent 的 token、剥 ⏳ 占位、error 帧透传如 session_busy_elsewhere、done 帧结束）——契约按 Studio server.py 实际格式，非虚构。
验证：新 14/14 + inject 11/11 + 其余 bridge 32/32 + tsc 零错误；主 agent 独立复跑 25/25。
遗留：真机联调（需桌面端重启加载新 bridge 代码后与扩展实测）；chat_delta 流式留 v2。
