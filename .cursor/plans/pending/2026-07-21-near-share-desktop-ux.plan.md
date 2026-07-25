# Near Share SP4：Desktop 快照与分享 UX

Planned-with: GPT-5.6 Sol  
Suggested-Impl-Model: Cursor Grok 4.5 High Fast  
Plan-Id: `2026-07-21-near-share-desktop-ux`  
Parent-Plan: `.cursor/plans/2026-07-21-near-public-conversation-sharing.plan.md`  
Depends-On: `.cursor/plans/2026-07-21-near-share-desktop-transport.plan.md`

## 目标

在 Near Desktop 接入三种分享入口，使用 allowlist 构造 `ConversationShareSnapshotV1`，通过 SP3 IPC 创建公网链接；在账号设置中列出、复制和撤销当前账号的有效分享。

## 前置条件

- SP3 的 `agxShareCreate/List/Revoke` IPC 与类型已进入当前分支。
- SP1 API 可用。
- SP2 可与本计划并行开发，但含本计划入口的 Desktop 不得发布，直到 SP2 已部署且匿名 `/s/<slug>` smoke 通过。

## In scope files

新增：

- `desktop/src/utils/conversation-share.ts`
- `desktop/src/utils/conversation-share.test.ts`
- `desktop/src/components/shares/ConversationShareDialog.tsx`
- `desktop/src/components/shares/ConversationShareDialog.test.tsx`
- `desktop/src/components/shares/AccountSharesSection.tsx`
- `desktop/src/components/shares/AccountSharesSection.test.tsx`

修改：

- `desktop/src/components/ChatPane.tsx`
- `desktop/src/components/messages/ImBubble.tsx`
- `desktop/src/components/messages/ImBubble.test.tsx`
- `desktop/src/utils/im-bubble-actions.ts`
- `desktop/src/components/AccountTab.tsx`
- `desktop/tests/fixtures/conversation_share_v1.json`（SP3 已创建；只在协议同步时修改）
- `desktop/package.json`
- `desktop/package-lock.json`

仅在真实类型缺口存在时精确修改：

- `desktop/src/global.d.ts`（SP3 类型不得重复定义）

## Out of scope

- 不修改 Website API/schema/page。
- 不修改 `store.ts::Message` 持久化结构。
- 不把 share summary 写进 localStorage 或 messages.json。
- 不改 `/api/messages/forward`、ForwardPicker、PDF、收藏和现有多选语义。
- 不实现期限选择、密码、原附件上传、访问统计或 Enterprise provider。
- 不修改 `agenticx/studio/server.py`。

## 当前锚点

- `ChatPane.tsx::selectedMessageIds` 约第 2567 行。
- `ChatPane.tsx::selectedMessages` 约第 4663 行。
- `ChatPane.tsx` 多选操作栏约第 11051 行。
- `ChatPane.tsx` 顶栏按钮约第 10805–10876 行。
- Unified ReAct block 自定义操作区约第 6971 行。
- `ImBubble.tsx::onForwardMessage` / `runForward()` 和按钮区可作为单轮分享的平行模式。
- `AccountTab.tsx` 登录态卡片约第 165 行，适合在其下加入独立“我的分享”区块。

## Task 1：快照 builder TDD

先新增 `conversation-share.test.ts`，再实现。

### Builder API

```ts
export type BuildConversationShareInput = {
  scope: "turn" | "selection" | "session";
  messages: Message[];
  targetAssistantId?: string;
  selectedMessageIds?: ReadonlySet<string>;
  userLabel: string;
  capturedAt: Date;
};

export type BuildConversationShareResult =
  | { ok: true; snapshot: ConversationShareSnapshotV1 }
  | {
      ok: false;
      error:
        | "no_shareable_messages"
        | "turn_not_found"
        | "share_message_limit_exceeded"
        | "share_content_limit_exceeded"
        | "share_attachment_limit_exceeded";
    };

export function buildConversationShareSnapshot(
  input: BuildConversationShareInput,
): BuildConversationShareResult;
```

### Allowlist 映射

每条消息从零构造：

```ts
{
  id: `m${index + 1}`,
  role,
  content: publicContent,
  createdAt,
  senderLabel,
  attachments
}
```

规则：

- role=tool 永远排除。
- `isViewImageInjectMessage(message)` 为 true 时排除。
- `toolCallId` / `toolName` / `toolStatus` / `noticeKind` / `inlineConfirm` / `clarificationPrompt` / `actionConfirmation` / `subAgentCluster` 任一存在的过程行排除，即使其 role 被标为 assistant。
- assistant 内容使用 `parseReasoningContent(message.content).response`；禁止 fallback 到含 `<think>` 的 raw content。
- `message.reasoning` 永远不读。
- 空正文且无附件 metadata 的消息排除。
- user label 使用当前 `userBubbleLabel`；assistant 优先 `avatarName`，否则使用现有 pane/Machi 显示名。
- senderLabel trim 后截断至 80；mimeType trim 后截断至 120；文件名由 sanitizer 截断至 255。
- 任一公开正文超过 65,536 字符或单消息附件超过 20 时返回对应 builder error，不静默截断正文/附件。
- timestamp 是有限 number 时转 ISO；无效时间省略。
- attachment 只映射：

```ts
{
  name: sanitizePublicFilename(attachment.name),
  mimeType: truncateUnicode(attachment.mimeType.trim(), 120),
  sizeBytes: Math.max(0, Math.trunc(attachment.size))
}
```

- 不读取 `dataUrl`, `sourcePath`, `referenceToken`, `snippetContent` 等其他字段。
- `sanitizePublicFilename()` 必须同时按 `/` 与 `\` 取 basename，移除盘符、UNC、`@dir:` 路径载荷和控制字符，空结果回落“附件”；语义与 Website fixture 一致。

### 三种 scope

`turn`：

1. 在原始 messages 中找到 `targetAssistantId` 且 role=assistant。
2. 从目标向前找最近一个 `role=user && !isViewImageInjectMessage`。
3. 取该 user 到目标 assistant 的闭区间。
4. 应用 allowlist；中间 tool/reasoning 被过滤。
5. 找不到真实 user 或目标 assistant时返回 `turn_not_found`。

`selection`：

- 以原始 messages 顺序过滤 selected ids。
- 不按 Set 插入顺序。
- 应用 allowlist。

`session`：

- 对全部 messages 应用 allowlist。

最终公开消息超过 200 时返回 `share_message_limit_exceeded`，禁止静默截断。

### 标题

导出纯函数 `deriveShareTitle(messages)`，遵守 Parent Plan 的首个 user 正文、去 Markdown 控制字符、折叠空白、60 Unicode 字符规则。

### 必须先写的测试

- turn：user → assistant reasoning → tool → assistant final 的边界正确。
- turn：忽略 view-image inject 伪 user。
- selection：Set 顺序与消息顺序不同时仍按消息顺序。
- session：排除 tool、notice、think-only assistant。
- `<think>internal</think>\n最终答案` 只保留最终答案。
- think-only assistant 被排除。
- attachments 只保留 name/mime/size。
- workspace、directory、snippet、重试恢复附件的 name 即使夹带绝对路径，也只能公开 basename。
- `JSON.stringify(snapshot)` 不含 `sourcePath`, `dataUrl`, `reasoning`, `toolArgs`, `ownerSessionId`, 本地 message id。
- 201 条返回显式错误。
- 超长正文、21 个附件、超长 senderLabel/mimeType 的边界行为与 Website contract 一致。
- 无可分享消息返回显式错误。
- title fallback 与 Unicode 截断。
- golden fixture 语义一致。

运行：

```bash
npm --prefix desktop exec vitest run src/utils/conversation-share.test.ts
```

### Task 2：分享弹窗

`ConversationShareDialog.tsx` props：

```ts
type ConversationShareRequestState =
  | { status: "idle" }
  | { status: "pending"; clientRequestId: string }
  | { status: "failed"; clientRequestId: string; error: string; retryAfterSeconds?: number }
  | { status: "succeeded"; clientRequestId: string; share: ConversationShareSummary }
  | { status: "discarded" };

type ConversationShareLoginState =
  | { status: "idle" }
  | { status: "launching" }
  | { status: "waiting" }
  | { status: "error"; error: string };

{
  open: boolean;
  snapshot: ConversationShareSnapshotV1 | null;
  loggedIn: boolean;
  requestState: ConversationShareRequestState;
  loginState: ConversationShareLoginState;
  onClose(): void;
  onGenerate(): void;
  onRetry(): void;
  onDiscard(): void;
  onStartLogin(): Promise<{ ok: true } | { ok: false; error: string }>;
  onCancelLogin(): Promise<void>;
  onCopy(): Promise<void>;
}
```

Dialog 是完全受控视图：不直接调用 share/login IPC，不持有 Promise/clientRequestId；所有 IPC 和生命周期由 ChatPane controller 负责。

交互状态：

1. **未登录/登录回流**：`idle → launching_login → waiting_browser → login_error/confirm`。复用现有 account changed 与 login timeout listener；waiting 时提供“取消等待”并调用 `agxAccountLoginCancel()`。登录成功只进入待确认，不自动发布。
2. **待确认**：明确显示“任何获得链接的人无需登录即可查看”，预览将公开的消息、sender label、时间和附件文件名；说明正文可能含用户主动输入的敏感文本、撤销不能收回他人已保存副本；显示固定七天。“取消”紧靠“生成链接”左侧。
3. **生成中**：按钮显示明确“正在生成分享链接…”，禁止重复提交。
4. **成功**：展示只读且可选择的 URL、“复制链接”、“在浏览器中打开”。自动复制和手动复制统一使用 `copying → copied | copy_failed`；只有 Promise 成功才播报“已复制”，失败显示“链接已生成，请手动复制”。
5. **失败**：弹窗保持打开，在主操作附近显示 SP3 error code 映射后的中文错误；不得只在远端顶栏 toast。

同一 snapshot 使用 `idle → pending → failed|succeeded → discarded` 生命周期：

- 每个新 snapshot 首次 generate 时生成 UUID。
- pending close/reopen 复用同一 Promise 与 id。
- failed retry 使用同一 id 创建新的 Promise；不能复用已 settled Promise。
- pending 隐藏时保留“查看分享结果/重试”入口，不清空 selection。
- 只有 succeeded 或用户明确 `onDiscard()` 才清理 snapshot/selection；新 snapshot 才生成新 id。
- 待确认态“取消”调用 `onDiscard()` 并关闭；pending 的 ✕/Esc 只隐藏；failed 显示“重试/放弃此次分享”，放弃调用 `onDiscard()`；succeeded 的“完成”只清理本地流程，不撤销已生成公网链接。

弹窗要求：

- 使用 `createPortal(..., document.body)`，避免 ChatPane overflow 裁剪。
- 遮罩/容器/输入背景使用 Near theme token，禁止过透明。
- `role="dialog"`、`aria-modal=true`、标题/描述关联；打开时设置初始焦点并圈定焦点，关闭后恢复到触发按钮。
- Esc 与右上角 ✕ 关闭；生成中关闭只隐藏 UI，重开恢复 pending/result。
- loading 使用 `aria-busy`，成功用 `role=status`，失败用 `role=alert`。
- 390px/Near 窄窗保留视口内边距和最大高度；正文滚动，底部操作始终可达。
- 不使用原生 `window.confirm`。
- URL 不允许用户编辑。

### Task 3：单轮 `turn` 入口

`ImBubble.tsx`：

- 新增 `onShareMessage?: (message: Message) => void`。
- assistant 完成态操作按钮中在“转发”邻近加入 `Share2`，tooltip“分享链接”。
- 图标按钮必须有 `aria-label="分享这轮回答"`，支持键盘触发并在弹窗关闭后恢复焦点。
- user、tool、streaming、group typing、空 assistant 不显示。
- context menu 同步加入“分享链接”，避免图标与菜单能力不一致。
- 不改变 `runForward()`。

`ChatPane.tsx`：

- 实现 `openTurnShare(message)`，从 `visibleMessages` 构建 `turn` snapshot。
- unified ReAct block 的自定义图标区也调用同一函数，target 使用 block 中最后一条有公开 response 的 assistant。
- 若 builder 返回错误，使用输入区上方的现有高信号 toast 位置提示。
- `sessionBusy` / streaming 时所有 open/create handler 统一拒绝生成，不能只禁用顶栏而让多选或历史气泡绕过。

### Task 4：多选 `selection` 入口

在多选操作栏：

- “转发”后新增“生成链接”。
- 点击后用 `selectedMessageIds` + `visibleMessages` 构建 selection。
- 弹窗打开后不立刻清空选择；仅 succeeded 的“完成”或显式 `onDiscard()` 后清空。✕、Esc、普通 `onClose()` 只隐藏并保留 snapshot/selection。
- 只选中 tool/think-only 时提示“所选内容没有可公开的消息”。
- Near 窄窗下固定采用多行换行布局，顺序为“计数 → 转发 → 分享 → 复制 → PDF → 删除 → 取消”；禁止操作栏自身横向滚动，390px 下全部动作无需滚动即可看见。

不修改现有复制、PDF、删除按钮行为。

### Task 5：完整 `session` 入口

在 ChatPane 顶栏搜索按钮之后加入 `Share2`：

- tooltip/aria-label：“分享当前会话”
- 仅当前 `visibleMessages` 有公开消息时启用。
- streaming/session busy 时 disabled，避免捕获半条消息。
- 点击构建 session snapshot 并打开同一 dialog。
- 窄窗保持图标按钮，不增加文字挤压。

### Task 6：挂载统一 dialog 与反馈

ChatPane 只挂载一个 `ConversationShareDialog`，状态：

```ts
shareDialogOpen
shareSnapshot
shareClientRequestId
sharePendingPromise
shareSettledResult
shareToast
```

ChatPane controller 实现上述 request/login state；弹窗隐藏但 request 为 pending/failed/succeeded 时，在原分享触发区附近保留可访问的“查看分享结果”状态入口，直到 succeeded 已复制或用户 discard。

成功后：

- clipboard 成功时 toast 才显示“分享链接已复制，有效期 7 天”；clipboard 失败时显示“链接已生成，请手动复制”。
- 不把 URL插入消息历史。
- 不修改 pane/session metadata。

错误映射：

- `auth_required` → “登录已失效，请重新登录”
- `share_message_limit_exceeded` → “会话内容过多，请改用多选分享”
- `share_payload_too_large` → “分享内容过大，请减少选择内容”
- `share_limit_reached` → “有效分享已达上限，请先撤销旧链接”
- `share_rate_limited` + `retryAfterSeconds` → “过去 24 小时生成分享链接次数已达上限，请在 X 后重试”；无合法 header 时回落“请稍后再试”
- `auth_context_changed` → “登录账号已发生变化，请重新确认后分享”
- local `share_content_limit_exceeded` / `share_attachment_limit_exceeded` → 指引减少正文/附件数量
- timeout/503 → “分享服务暂不可用，请稍后重试”

### Task 7：“我的分享”

`AccountSharesSection.tsx`：

- 仅在 `acct.loggedIn` 时挂载。
- mount、账号 changed、成功创建/撤销后调用 `agxShareList()`。
- 在 `conversation-share.ts` 导出事件常量 `AGX_SHARE_CHANGED_EVENT = "agenticx:share-changed"`；ChatPane 创建成功后 dispatch，AccountSharesSection mount 时监听并刷新，unmount 时移除监听。不要为此新增全局 store 字段。
- 展示当前全部 active records（服务端上限 100）：
  - title
  - scope 中文
  - 创建时间
  - 失效时间
  - “复制链接”
  - “撤销”
- 空态：“暂无有效分享链接”。
- loading 使用阶段文字“正在加载分享记录…”。
- list 失败显示就地重试，不影响账号登录卡片。
- 列表使用 `aria-busy`；复制/撤销结果通过行内 `role=status/alert` 播报。
- 390px/Near 窄窗下每条记录纵向堆叠元数据与操作；长标题/URL不得造成面板横向溢出。

撤销：

1. 使用 `window.agenticxDesktop.confirmDialog()` 应用内确认。
2. 文案明确“撤销只阻止后续访问，无法删除他人已经保存的副本。”
3. 每行使用 `idle → confirming → revoking | error` 状态；取消确认回 idle。
4. revoking 时禁用该行复制/撤销并显示“正在撤销…”。
5. 调 `agxShareRevoke(slug)`。
6. 成功乐观移除该行、播报成功，并后台重新 list 校准。
7. 失败保留行并显示中文可执行提示，可附稳定机器码供诊断。

`AccountTab.tsx`：

- 将 section 放在当前登录信息卡片之后。
- 未登录不显示空列表。
- 不增加第二个保存按钮。
- 退出登录后列表立即清空。

## 组件/纯函数测试

使用包管理器增加交互测试依赖，不手写版本号：

```bash
npm --prefix desktop install --save-dev \
  @testing-library/react @testing-library/user-event jsdom
```

两个 TSX 测试文件顶部使用 `// @vitest-environment jsdom`，不要把全部 Desktop Vitest 全局切到 jsdom。

最低必须新增/扩展：

```text
desktop/src/utils/conversation-share.test.ts
desktop/src/components/messages/ImBubble.test.tsx
desktop/src/components/shares/ConversationShareDialog.test.tsx
desktop/src/components/shares/AccountSharesSection.test.tsx
```

`ImBubble.test.tsx` 至少验证动作可见性 helper：

- completed assistant 有分享。
- streaming assistant 无分享。
- user/tool 无分享。

如果直接渲染 ImBubble 成本过高，把显示判断抽到 `desktop/src/utils/im-bubble-actions.ts` 并对纯函数测试；不要靠手工判断替代测试。

Dialog/List 组件测试至少覆盖：

- dialog role/label/focus trap/Esc/focus restore。
- 登录 launching/waiting/timeout/cancel/`{ok:false}`/Promise reject/重试成功回流，登录成功不自动发布。
- pending close/reopen 复用同一 promise/clientRequestId；failed retry 使用同 id 新 promise；discard 才清理。
- clipboard success/failure 文案不误报。
- list loading/empty/error/retry。
- revoke confirming/revoking/success/error 与 live-region。

## 验证

```bash
npm --prefix desktop exec vitest run \
  src/utils/conversation-share.test.ts \
  src/components/messages/ImBubble.test.tsx \
  src/components/shares/ConversationShareDialog.test.tsx \
  src/components/shares/AccountSharesSection.test.tsx \
  tests/agx-share-client.test.ts
npm --prefix desktop run build
```

完全退出并重启 Electron 后手工验收：

```text
未登录 turn 分享 → 登录引导，无上传
turn 分享 → 两端问答正确
selection 分享 → 顺序正确
session 分享 → 完整公开可见消息
含 DOCX/PDF → 只显示 metadata
隐藏 tool/reasoning/sourcePath 字段 → 公开 JSON 与页面均无自动泄露；用户正文按预览原样公开
账号页 list → copy → revoke → 页面失效
streaming 时顶栏分享 disabled
```

## AC

- AC-SP4-1：三种 scope 共用同一 builder/dialog/API，不复制三套上传逻辑。
- AC-SP4-2：turn 范围以真实 user 边界开始，完整过滤中间 tool/reasoning。
- AC-SP4-3：附件公开对象只含 name/mimeType/sizeBytes。
- AC-SP4-4：未登录不上传，登录入口可继续现有 Device Flow。
- AC-SP4-5：固定七天、匿名 bearer-link 权限、公开字段和不可撤回副本风险在生成前明确告知。
- AC-SP4-6：clipboard 成功才宣称已复制；失败保留可选择 URL、弹窗与选择状态。
- AC-SP4-7：AccountTab 展示全部 active links，并能复制、确认撤销和错误重试。
- AC-SP4-8：分享操作不写消息历史、localStorage 或 session metadata。
- AC-SP4-9：定向 Vitest 与 Desktop build 全绿；完全重启后 UI/IPC 实际可用。
- AC-SP4-10：Website、Enterprise、Studio 与现有 forward/PDF 逻辑无无关 diff。
- AC-SP4-11：登录回流、pending close/reopen、复制、撤销均有完整异步状态与无障碍播报。
- AC-SP4-12：SP2 匿名 smoke 未通过时禁止发布本 Desktop 入口。
- AC-SP4-13：同一 snapshot 的 pending/failed retry 始终复用 clientRequestId，但每次 retry 使用新 Promise。
- AC-SP4-14：Desktop builder 镜像正文、sender、MIME、文件名、附件数限制，预览与 Website 存储一致。
- AC-SP4-15：Retry-After 经 IPC 转为可执行等待提示，滚动窗口文案不称“今日”。

## 提交边界

本 subplan 独立提交。只包含 renderer 快照/UX、必要类型对齐和测试，不夹带 SP5 的部署、cron 或跨端 E2E。

