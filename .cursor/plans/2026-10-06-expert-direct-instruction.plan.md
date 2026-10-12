# 专家指令直达主聊天（Expert Direct Instruction）

日期：2026-10-06
状态：实施中

## 背景

测试用例「请让数字专家「阮和鸣」帮我完成任务。」当前链路：
市场「使用」→ `newMetaTask` 草稿进 Meta（Near）会话 → 用户发送 → Meta 模型调用 `delegate_to_avatar` → 产生委派 run + 子智能体卡片 + 自动弹窗。

用户预期：**专门的数字专家在自己的会话里、主聊天界面直接接收指令并执行**——无子智能体、无弹窗、无委派。

## 方案（纯前端确定性路由，不动委派后端）

1. **纯匹配器** `utils/expert-direct-route.ts`：`matchExpertDirectSend(text, avatars)`
   - 锚定句首：`^(请)?让(数字)?专家` + 可选引号（「」『』""''）+ 专家名（与已知 avatar name 精确匹配）+ 可选闭合引号
   - 命中返回 `{ avatarId, avatarName, instruction }`，instruction = 原文全文（追加的任务内容一并带给专家）
   - 排除 `group:` 前缀头像；未知专家名 → null；非句首 → null
2. **直达派发** `usePaneNavigation.deliverExpertInstruction(avatarId, name, instruction, { autoSend })`
   - 打开/聚焦专家 pane（懒会话）→ 派发 `agenticx:pane:new-topic`（detail 增加 `autoSend`）
   - autoSend 时 ack-retry 派发（新 pane 未挂载监听器的时序兜底），最多 20 次 ×150ms；草稿先持久化，极端情况降级为预填
3. **ChatPane.sendChat 拦截**（仅 Meta pane：`avatarId === null`、非 continuation、非静默转发）：
   命中匹配器 → 清空 Meta composer → 改道 deliverExpertInstruction(autoSend: true) → return
4. **ChatPane `pane:new-topic` 事件扩展**：`detail.autoSend` → ack + 延迟调 `sendChatRef.current(draftText)`（专家 pane 内直达执行）
5. **市场「使用」（agent 类目）**：不再走 `newMetaTask`；直接 `deliverExpertInstruction(item.avatarId, item.name, 直达草稿, { autoSend: false })`；`buildAgentItems` 补 `avatarId` 字段
6. **i18n**：`useDraftAgentDirect` zh「你好 {{name}}，请帮我完成以下任务：」/ en

## 验收标准（AC）

- AC-1：在 Meta 会话发送「请让数字专家「阮和鸣」帮我完成任务。」→ 切到阮和鸣专属对话，指令直接送达并自动执行；不出现子智能体卡片、不弹委派工作区
- AC-2：市场专家卡「使用」→ 直接打开阮和鸣对话并预填直达草稿（不经过 Near）
- AC-3：追加任务文本（原文后接具体任务）一并送达专家
- AC-4：普通消息、群聊、未知专家名不受影响
- TDD：matcher 与派发工具 vitest 全绿；tsc 对基线零新增错误

## 不做（本轮）

- ChatView lite 路径同款拦截（后续按需）
- 委派机制本身保留（用户显式让 Near"委派"时仍可用）
- 中断级联等后端 bug（另行处理）

## 实施验证记录（2026-10-06）

- TDD：`expert-direct-route.test.ts` 先红（3 失败：引号分支未跳开引号）后绿，8/8 通过
- 相关套件（expert-direct-route + composer-draft-store + marketplace 全目录）：9 文件 93 用例全绿
- 全量 vitest：8 failed / 2063 passed——8 个失败全部为存量（ImBubble / InlineImageBlock / handoff-inline-code），失败数与基线一致，通过数较基线 +8（新增用例）
- tsc：220 行错误与基线完全一致，零新增（ChatPane 存量报错行号均在本次改动区域之外）
- 真机验收：需重启 Near dev 实例（9:43 启动的实例仍是旧前端），AC-1 在 Meta 会话发送测试用例原句、AC-2 在市场专家卡点「使用」
