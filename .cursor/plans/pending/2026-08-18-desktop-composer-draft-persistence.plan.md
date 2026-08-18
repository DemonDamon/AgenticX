# Desktop 会话级输入草稿持久化

Planned-with: gpt5.6sol
Suggested-Impl-Model: gpt5.6sol
Status: pending-review
Plan-Id: 2026-08-18-desktop-composer-draft-persistence

## 目标

为 Desktop 聊天输入区补齐可靠的未发送草稿保存与恢复：

1. 用户输入但尚未发送的内容，在切换会话、关闭窗格、重启应用后仍可恢复。
2. 草稿严格按后端 scope 和会话隔离；一个窗格/会话的内容不得出现在另一个会话。
3. 首条消息前尚无 `sessionId` 的 lazy session 也必须可保存草稿，并在会话真正创建时迁移到正式 session key。
4. 输入区已有的 `@文件`、`@skill`、引用 chip 和可安全恢复的附件元数据必须与文本一起恢复，不能退化成错位纯文本。
5. 用户消息被本地发送链接受后清理草稿；会话创建失败、发送前校验失败等尚未接受消息的失败路径必须保留草稿。

本计划只补输入区草稿，不调整聊天协议、服务端 session/messages 数据格式，也不把未发送内容上传到后端。

## 当前实现与根因证据

基线：`origin/main@363a95fe`。

| 位置 | 当前行为 | 缺口 |
| --- | --- | --- |
| `desktop/src/components/ChatPane.tsx:2865` | 仅保存 `composerHasText: boolean` | React/Zustand 中没有真实草稿正文 |
| `desktop/src/components/ChatPane.tsx:4392-4399` 的 `syncComposerFromValue` | 只更新空/非空和 @mention 状态 | 输入时没有任何持久化写入 |
| `desktop/src/components/ChatPane.tsx:4897-4992` 的 `setComposerText` | 直接重建 contenteditable DOM/chip | 可以作为恢复入口，但当前没有持久化来源 |
| `desktop/src/components/ChatPane.tsx:2991-3067` | 引用、附件、ref path/meta 分散在 state/ref | 只存纯文本会丢 quote/file chip 的语义 |
| `desktop/src/components/ChatPane.tsx:8605-8648` 的 `materializeLazySession` | 首次发送/工作区操作后才创建 session | 首条消息前没有 session key，需要 provisional key 和迁移 |
| `desktop/src/components/ChatPane.tsx:8747,8795,9182` | 消息确认/入队/本地 user echo 后清空输入区 | 可作为“发送已被接受”的清理边界 |
| `desktop/src/components/ChatPane.tsx:11386-11438` | 新建话题清 session，但部分入口没有明确清 DOM | 新话题可能继承旧未发送 DOM，也没有保存旧正式会话草稿 |
| `desktop/src/App.tsx:49-75,1065-1101` | workspace snapshot 保存 pane/session/model/panel | 没有 draft 字段；不宜把高频输入塞入整个 workspace snapshot |
| `desktop/src/utils/backend-scope.ts:25-58` | 已提供 backend-scoped localStorage | 可复用，避免本地与远端后端之间串草稿 |

根因不是“缺一个 localStorage.setItem”这么简单，而是 contenteditable 是当前真实输入源，文本、引用和附件由多个 state/ref 共同组成；同时 pane 会在 lazy key、正式 session key、历史会话切换之间变化。若没有显式的 identity transition，旧 DOM 会覆盖新会话草稿或把 provisional 草稿重新写回错误 key。

## In scope

- Desktop 渲染层的会话级草稿存储、恢复、迁移、清理与容量治理。
- 普通文本、多行文本、`@文件`、`@skill`、引用 chip、工作区引用和可安全恢复附件。
- Meta、分身、群聊、Automation pane 共用同一身份规则；正式 session 一律按 session ID 隔离。
- 首条消息前 lazy pane 的 provisional draft，以及创建 session 后原子迁移。
- 切换 session、切换空 pane avatar、关闭窗格、刷新/重启、显式新建话题、发送成功/失败边界。
- 单元测试和 Desktop build。

## Out of scope

- 不新增后端 API、数据库表、session metadata 字段或云端草稿同步。
- 不把草稿写入 `messages.json`，未发送内容不能伪装成历史消息。
- 不恢复光标/选区像素位置；恢复后仅保证内容和 chip 顺序正确。
- 不保证超大、无本地路径的二进制附件永久保存；超过本计划预算时保留文本并提示用户重新添加附件。
- 不修改发送队列、SSE、模型路由、历史标题、工作区绑定语义。
- 不改全局 workspace snapshot 的 schema，避免每次击键触发 `App.tsx` 的 panes 持久化。
- 不做草稿加密或跨设备同步；数据仅保存在当前 Electron profile 的 backend-scoped localStorage。

## No-scope-creep 约束

1. 禁止持久化 contenteditable 的原始 `innerHTML`；只保存 `extractComposerText()` 的规范化文本和白名单结构化元数据，避免样式/脚本注入与 DOM 版本耦合。
2. 禁止在每次击键时更新 Zustand `pane`，否则会放大 `App.tsx` workspace snapshot 写入和整棵 UI 重渲染。
3. 禁止用全局 active session 作为草稿 key；只能使用当前 `pane.id/avatarId/sessionId` 推导的稳定 identity。
4. session 从空变为正式 ID 时必须 migrate + delete provisional key，不能 copy 后留下两个可继续写入的源。
5. session 切换必须先同步 flush 旧 DOM，再恢复新 key；异步 effect 返回顺序不能决定最终草稿。
6. 新建话题是显式清空当前未发送输入的边界；返回旧正式 session 时仍应恢复此前为该 session 保存的草稿。
7. 发送链在创建 session 或前置校验失败时不能删草稿；仅在现有代码已经添加 user echo、成功入队或成功处理确认动作的路径清理。
8. 不在 console、埋点或错误 toast 中输出草稿正文。
9. 路径型附件只保存必要元数据/受限文本；可从本地路径重新加载的图片不重复长期保存大 data URL。
10. 任一存储解析/配额失败必须降级为“不阻塞输入和发送”，不能让草稿功能影响聊天主链。

## 推荐实施模型

| 子任务 | Suggested-Impl-Model | 理由 |
| --- | --- | --- |
| 纯存储 DTO、容量裁剪、identity/migration 与单测 | Composer 2.5 | 纯函数边界清晰，计划已给出完整契约 |
| `ChatPane` contenteditable/session 生命周期接线 | gpt5.6sol | 涉及 DOM source-of-truth、lazy session 和多个异步状态，需较强跨状态推理 |
| 发送/新话题边界回归收口 | gpt5.6sol | 需要避免旧会话草稿覆盖新会话及失败路径误清理 |

## 数据契约

### 存储 key

- scoped base key：`agx-composer-drafts-v1`，通过现有 `readScopedLocalStorage/writeScopedLocalStorage` 自动追加 backend scope。
- 正式会话：`session:<sessionId>`。
- 尚无 session：`pane:<paneId>:avatar:<avatarId|meta>`。
- 不能只用 `paneId`：同一个空 pane 若被重新绑定到另一分身，旧草稿不得串过去。

### Draft DTO

在新文件 `desktop/src/utils/composer-draft-storage.ts` 中定义 JSON-safe DTO，至少包含：

~~~ts
type ComposerDraft = {
  text: string;
  attachments: Array<{
    key: string;
    name: string;
    size: number;
    mimeType: string;
    status: "ready";
    content: string;
    dataUrl?: string;
    sourcePath?: string;
    referenceToken?: boolean;
    composerRefLabel?: string;
    lineRange?: { start: number; end: number };
    spreadsheetRef?: { sheet: string; a1: string };
    snippetRef?: string;
    snippetContent?: string;
    htmlElementRef?: { tagName: string; selectorHint: string; comment?: string };
  }>;
  quotes: Array<{
    id: string;
    body: string;
    message: {
      id: string;
      role: "user" | "assistant" | "tool";
      content: string;
      avatarName?: string;
      avatarUrl?: string;
      agentId?: string;
    };
  }>;
  refPaths: Record<string, string>;
  refMetaOverrides: Record<string, {
    sourcePath?: string;
    composerRefLabel?: string;
    htmlElementRef?: { tagName: string; selectorHint: string; comment?: string };
  }>;
  omittedAttachmentNames?: string[];
  updatedAt: number;
};

type ComposerDraftCollection = {
  version: 1;
  drafts: Record<string, ComposerDraft>;
};
~~~

### 容量与保留策略

- 防抖：`COMPOSER_DRAFT_SAVE_DEBOUNCE_MS = 250`。
- 最多 50 个 draft，保留 30 天；每次读写时清理过期/非法项。
- 正文最大 200,000 字符；引用正文/消息正文各最大 32,000 字符。
- 每个 draft 最多 24 个附件、64 个 ref path/meta。
- 有 `sourcePath` 的图片删除持久化 DTO 中的 `dataUrl`，恢复时调用已有 `window.agenticxDesktop.loadLocalImageDataUrl(path)`。
- 无路径 data URL 只在单 draft 预算内保存；超预算附件从 DTO 中排除并写入 `omittedAttachmentNames`，恢复时用现有附件 toast 告知“草稿已恢复，部分附件需重新添加”。
- collection JSON 设总字符预算（建议 4,000,000）；超过后按 `updatedAt` 从旧到新淘汰，但当前写入 draft 的文本必须优先保留。
- 空 draft（正文为空、附件为空、引用为空）等价于 delete，不保留空壳。

## FR-1：新增独立、可测试的草稿存储层

Suggested-Impl-Model: Composer 2.5

### 修改落点

1. 新建 `desktop/src/utils/composer-draft-storage.ts`。
   - 导出上述 DTO、常量和 `composerDraftIdentity({ paneId, avatarId, sessionId })`。
   - 导出纯函数：`parseComposerDraftCollection`、`readComposerDraftFromRaw`、`writeComposerDraftToRaw`、`removeComposerDraftFromRaw`、`migrateComposerDraftInRaw`。
   - 再提供 scoped wrappers：`loadComposerDraft`、`saveComposerDraft`、`deleteComposerDraft`、`migrateComposerDraft`。
   - 所有 parser 必须白名单复制字段、限制长度和数量；禁止直接信任 `JSON.parse` 后的对象。
   - wrapper 捕获 localStorage/JSON 错误并返回安全结果；不得抛到输入事件。

2. 新建 `desktop/src/utils/composer-draft-storage.test.ts`。
   - 测试使用纯 raw-string 函数，不依赖浏览器 localStorage。

### Before / After 意图

~~~ts
// Before：未发送文本只存在 composerRef.current DOM。
const live = composerRef.current?.innerText ?? "";
syncComposerFromValue(live);

// After：DOM 仍是输入 source-of-truth；存储层只接收防抖快照。
scheduleDraftSave({
  identity: composerDraftIdentity({ paneId, avatarId, sessionId }),
  draft: collectComposerDraftFromDomAndRefs(),
});
~~~

### AC

- malformed JSON、未知 version、非法字段均返回空 collection，不抛异常。
- `session:A`、`session:B`、两个 provisional avatar key 互不覆盖。
- migrate 后目标内容完整、源 key 消失；目标已有更新草稿时按 `updatedAt` 保留较新者。
- 空 draft 写入会删除已有项。
- 超期/超数量按规则裁剪。
- 大 path-based image 会去掉 data URL 但保留 sourcePath；超预算 pathless binary 会进入 omitted 名单且不挤掉正文。

## FR-2：在 ChatPane 建立可靠的 draft identity 生命周期

Suggested-Impl-Model: gpt5.6sol

### 修改落点

1. `desktop/src/components/ChatPane.tsx:196-235`（utility import 区）
   - 引入草稿 identity/load/save/delete/migrate、DTO 和 debounce 常量。

2. `desktop/src/components/ChatPane.tsx:2991-3067`（quote/context/composer refs）
   - 增加 `contextFilesRef`，始终镜像最新 `contextFiles`。
   - 增加 `activeDraftIdentityRef`、`draftSaveTimerRef`、`draftHydratingRef`、`scheduleDraftSaveRef`。
   - 不把正文加入 React state 或 Zustand。

3. `desktop/src/components/ChatPane.tsx:4392-4490`（composer serializer）
   - 复用 `extractComposerText()` 作为正文序列化，禁止 `innerHTML`。
   - 新增 `collectComposerDraft()`：从 DOM、`contextFilesRef`、`quoteTargetsRef`、`composerRefPathsRef`、`composerRefMetaOverrideRef` 采集 JSON-safe 快照。
   - 新增 `flushComposerDraftNow(identity?)` 和 `scheduleComposerDraftSave()`。

4. `desktop/src/components/ChatPane.tsx:4897-4992`（`setComposerText`）
   - options 增加 `focus?: boolean`，默认保持现有 focus 行为；恢复草稿时传 `false`，避免启动/切换会话抢焦点。
   - DOM 重建结束后通过 ref 调度一次保存，覆盖程序化插入文本、Skill 和全局搜索引用。

5. 在 `setComposerText` 定义后增加 `useLayoutEffect`，依赖 `pane.id/pane.avatarId/pane.sessionId`：
   - 若 identity 改变：取消 debounce，先把旧 DOM 同步 flush 到旧 key。
   - 更新 active identity。
   - load 新 draft；同步设置 quote ref/state、contextFiles、path/meta refs，然后调用 `setComposerText(restored.text, { tokenNames, refSourcePaths, focus: false })`。
   - 无 draft 时必须明确清空 DOM、quote、contextFiles 和 ref maps，不能保留旧会话画面。
   - 使用 hydration guard，恢复过程中不把“半恢复 state”写回 storage。

6. 增加 mount/unmount 与窗口边界：
   - `beforeunload`、`visibilitychange(hidden)` 和组件 cleanup 时同步 flush。
   - cleanup 必须清 debounce timer。
   - localStorage 同步写不等待 Promise，避免关闭窗口最后 250ms 的输入丢失。

### identity transition 伪代码

~~~ts
useLayoutEffect(() => {
  const next = composerDraftIdentity({
    paneId: pane.id,
    avatarId: pane.avatarId,
    sessionId: pane.sessionId,
  });
  const prev = activeDraftIdentityRef.current;
  if (prev && prev !== next) flushComposerDraftNow(prev);
  activeDraftIdentityRef.current = next;
  restoreDraftIntoComposer(next); // 无值也必须 clear
}, [pane.id, pane.avatarId, pane.sessionId]);
~~~

### AC

- 在 session A 输入后切到 B：B 不显示 A；切回 A 恢复文本和 chip。
- 关闭 pane 再打开同一 session，草稿恢复。
- 重启应用后，workspace 恢复到同一 session 时草稿恢复且不自动抢走其他控件焦点。
- 空 session 的 Meta 与两个分身 provisional key 相互隔离。
- 快速输入后 250ms 内直接关闭窗口，最后内容仍由 unload flush 保存。

## FR-3：迁移 lazy session 并恢复富输入元数据

Suggested-Impl-Model: gpt5.6sol

### 修改落点

1. `desktop/src/components/ChatPane.tsx:8605-8648` 的 `materializeLazySession`。
   - createSession 成功、调用 `setPaneSessionId` 之前：
     - 同步 flush 当前 provisional draft；
     - `migrateComposerDraft(provisionalIdentity, sessionIdentity)`；
     - 把 `activeDraftIdentityRef.current` 更新为正式 key，防止随后的 session effect 又把当前 DOM 写回 provisional key。
   - createSession 失败不 migrate、不 delete，草稿继续留在 provisional key。

2. `desktop/src/components/ChatPane.tsx:11352-11384` 的 `initSession`。
   - 群聊/Automation 新话题 eager create 成功时执行相同迁移，避免只修 Meta lazy path。

3. `desktop/src/components/ChatPane.tsx:4897-4992` 恢复顺序：
   - quoteTargetsRef/state 先就位，确保 quote placeholder 能重建成 chip。
   - contextFiles 与 ref metadata 先写 ref，再通过 `tokenNames/refSourcePaths` 重建 `@文件`。
   - `@skill://slug` 继续复用现有 parser。
   - path-based image 没有 data URL 时异步调用 `loadLocalImageDataUrl`；返回前 attachment 保持 parsing，成功置 ready，失败置 error 并给可读提示。

4. `desktop/src/components/ChatPane.tsx:8391-8452` 的 `parseLocalFile` 图片分支。
   - 与文本/文档一致调用 `getPathForFile(file)`；存在绝对路径时写入 `sourcePath`，便于重启后重新读取，而不是重复保存大 data URL。

### AC

- 首条消息前输入文本/加入工作区导致 session materialize 后，草稿仍在且 storage 只剩正式 session key。
- createSession 失败后，输入和 provisional storage 均保持。
- 引用 chip 的位置、body、sender label 恢复，发送时 `quotedContent` 与恢复前一致。
- `@文件`、目录别名、Skill 恢复为 chip，不退化为无法路由的显示文本。
- 有路径图片重启后重新加载；无路径小图片在预算内恢复；超预算附件给一次提示但正文不丢。

## FR-4：明确发送、新话题和失败路径的清理边界

Suggested-Impl-Model: gpt5.6sol

### 修改落点

1. `desktop/src/components/ChatPane.tsx:8740-8800`。
   - 保留现有确认动作命中和 queue enqueue 后的 `setComposerText("")`。
   - 空 draft 调度必须调用 storage delete；清理 quotes/contextFiles 后再保存最终空快照。

2. `desktop/src/components/ChatPane.tsx:8860-8890`。
   - `materializeLazySession()` 返回 null 的路径不得调用 delete/clear；保留 DOM 和 provisional draft。

3. `desktop/src/components/ChatPane.tsx:9150-9190`。
   - 本地 user echo / sub-agent event 已写入后，现有清空行为继续作为“消息已被接受”的边界。
   - 后续 SSE/model error 不恢复旧 draft，因为用户消息已经进入当前会话并可重试。

4. `desktop/src/components/ChatPane.tsx:11386-11438` 的 `createNewTopic`、budget resume 和 `agenticx:pane:new-topic`。
   - `createNewTopic` 开始时 flush 旧正式 session draft。
   - 删除即将使用的 provisional key，并同步清正文、quote、contextFiles、ref maps，保证 Ctrl/Cmd+N 与按钮入口一致。
   - `resumeInNewSessionRef` 必须通过 `setComposerText(draft)` 写入真实 DOM，不能只设置 `composerHasText`。
   - event 的 `draftText` 无论是否为空都通过统一 fresh-topic helper；非空 draft 随后保存到新 provisional key。

### Before / After 意图

~~~ts
// Before：只改 sessionId，旧 DOM 可能继续显示。
setPaneSessionId(pane.id, "");

// After：先保存旧会话，再显式初始化一个空 provisional 草稿。
flushComposerDraftNow(currentIdentity);
deleteComposerDraft(provisionalIdentity);
activateFreshIdentity(provisionalIdentity);
setComposerText("");
clearQuoteTargets();
setContextFiles({});
setPaneSessionId(pane.id, "");
~~~

### AC

- 新建话题立即显示空输入区；返回旧 session 能恢复旧 session 的未发送草稿。
- budget resume 的预填文本真实显示且重启后可恢复。
- session 创建失败、`apiBase` 缺失、空输入校验失败均不清草稿。
- 消息成功入队或添加 user echo 后草稿删除；重新打开该 session 不再出现已发送文本。

## 测试与验证

### 自动化测试

1. `desktop/src/utils/composer-draft-storage.test.ts`
   - parser/normalizer、identity 隔离、provisional→session migration。
   - 空 draft delete、TTL、最大条数、总预算裁剪。
   - quote/ref/attachment round-trip。
   - path image data URL 去重与 pathless binary 超预算降级。

2. 若 ChatPane integration 难以直接挂载，新增最小纯 helper 到同 utility 并测试 transition 决策；禁止为测试复制一套与生产不一致的逻辑。

3. 运行：

~~~bash
cd desktop
npx vitest run src/utils/composer-draft-storage.test.ts src/utils/composer-input-sync.test.ts
npm run build
~~~

### 手工验收矩阵

| 场景 | 操作 | 预期 |
| --- | --- | --- |
| 重启恢复 | A 输入多行文字，等待 300ms，重启 | A 原样恢复 |
| 快速关闭 | 输入后立即关闭窗口 | 最后输入通过 unload flush 恢复 |
| 会话隔离 | A 输入，切 B 输入，再往返 | 各自只显示自己的草稿 |
| lazy 迁移 | 新对话输入，添加工作区或首次发送前触发 session 创建 | 内容不闪丢，provisional key 被移除 |
| 创建失败 | 断开后端后在 lazy 对话发送 | 输入仍在 |
| 富文本 | 混合普通文字、@文件、Skill、引用 | 重启后 chip 顺序与语义保持 |
| 新话题 | 正式 session 有草稿时新建话题 | 新话题为空；返回旧 session 恢复旧草稿 |
| 发送 | 正常发送后重开 session | 已发送内容不作为草稿恢复 |
| 大附件 | 添加超预算无路径图片并重启 | 文本恢复，提示该附件需重加，其他草稿不受影响 |
| backend scope | 本地与远程连接各写草稿 | 两个 scope 不串数据 |

### 质量门槛

- `git diff --check` 通过。
- 新增 focused tests 全绿。
- `npm run build` 通过。
- 现有 `composer-input-sync.test.ts` 继续全绿，确保高频输入优化不倒退。
- 代码 review 确认没有把 raw draft、路径内容或 data URL 输出到日志。

## 实施顺序

1. 先实现纯存储 utility 与测试，使 identity/migration/capacity 契约稳定。
2. 在 ChatPane 接入采集、防抖、restore 和 session-switch flush。
3. 接入 lazy/eager session migration。
4. 收口新话题、budget resume、发送成功/失败清理边界。
5. 补附件路径恢复与降级提示。
6. 跑 focused tests、build、手工最小矩阵。

## 回滚策略

- 实现只新增独立 scoped storage key；回滚代码后旧 key 不会影响现有输入/发送。
- 若需主动禁用，可移除 ChatPane 接线但保留 utility；不需要迁移 workspace/session 数据。
- 任何恢复异常都必须优先回退为空输入区并保留原 storage，不得阻止会话打开或发送。
