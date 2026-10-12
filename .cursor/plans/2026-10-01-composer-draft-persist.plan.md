# Composer 未发送草稿按会话持久化

Planned-with: Composer
Suggested-Impl-Model: Composer 2.5

## Goal

用户在 Near 输入框写了待发送内容后，切到导航栏「定时任务」等其它主视图、或关窗再开同一会话，输入框应恢复未发送草稿，避免长文稿丢失。

## Root cause

`App.tsx` 在 `mainView === "automation" | "avatars" | ...` 时条件渲染，**卸载** `PaneManager` / `ChatPane`。Composer 文本只存在 `contenteditable` DOM + React 状态，无 localStorage 持久化。

## Architecture

新增 `desktop/src/utils/composer-draft-store.ts`（对齐 `pending-message-queue.ts` 的 scoped localStorage 模式）：

- Key：`agx-composer-drafts-v1::<backendScope>`（payload version=2，兼容读 v1）
- Draft map key：`session:<sessionId>`（有会话）或 `pane:<paneId>`（空白/懒创建会话）
- 持久化纯文本 + `attachments[]`（含图片 `dataUrl` / `sourcePath` 等 chip 字段）
- 图片二进制进 IndexedDB（`composer-draft-blob-store`）；localStorage 只存元数据 + `hasBlob`
- 上限：单条文本 100_000 字符；最多 8 个附件；最多 80 条草稿（按 `updatedAt` 淘汰）

`ChatPane` 接线：输入落盘、附件变更落盘、layout unmount flush、session 切换存旧载新、发送成功清空、`migrateActiveComposerDraftToSession` 带附件迁移。

`App.tsx`：非 chat 主视图用 CSS `hidden` keep-alive，避免卸载丢状态。

## In scope

- 文本草稿存/取/迁移/清空
- 输入框附件（图片等 contextFiles）与文本一并持久/恢复
- Pro `ChatPane` 主路径
- 单元测试 `composer-draft-store.test.ts`
- 导航 keep-alive（`App.tsx`）

## Out of scope

- quoteTargets 持久化
- Lite `ChatView`（可后续复用同一 store）

## Suggested impl models

| 子任务 | 推荐模型 | 理由 |
|--------|----------|------|
| store + 测试 + ChatPane 接线 | Composer 2.5 | 局部 CRUD + 既有模式拷贝，无跨栈高风险 |

Suggested-Impl-Model: Composer 2.5

---

### FR-1 草稿存储 API

**落点：** 新建 `desktop/src/utils/composer-draft-store.ts`

导出：

- `COMPOSER_DRAFT_STORAGE_KEY = "agx-composer-drafts-v1"`
- `resolveComposerDraftKey(paneId, sessionId?)` → `session:…` 或 `pane:…`
- `parseComposerDrafts` / `serializeComposerDrafts` / `loadComposerDrafts` / `saveComposerDrafts`
- `getComposerDraftText(key)` / `upsertComposerDraft(key, text)` / `clearComposerDraft(key)`
- `migrateActiveComposerDraftToSession(paneId, sessionId)`：把 `pane:<id>` 挪到 `session:<sid>` 后删 pane key；空文本则只删 pane key

空/空白文本 upsert = clear（不占槽）。

**AC-1：** `desktop/src/utils/composer-draft-store.test.ts` 覆盖 parse 坏数据、upsert、clear、migrate、上限裁剪。

### FR-2 ChatPane 存取

**落点：** `desktop/src/components/ChatPane.tsx`

1. import store helpers。
2. `draftKeyRef` + `draftSaveTimerRef` + `restoringDraftRef`。
3. `flushComposerDraft(key?, text?)`：立刻 upsert；`scheduleComposerDraftSave`：300ms debounce。
4. `onInput` / `onCompositionEnd`：在 `syncComposerFromValue` 之后 `scheduleComposerDraftSave(extractComposerText())`（IME 组字中不写）。
5. `onBlur`：`flushComposerDraft()`。
6. `useEffect` 依赖 `[pane.id, pane.sessionId]`：
   - 离开前 flush 旧 key（读 DOM）
   - 载入新 key：`setComposerText(getComposerDraftText(newKey))`（可 `setTimeout(0)` 等 contenteditable mount）
   - `restoringDraftRef` 防止 restore 触发的空写覆盖
7. unmount cleanup：clear timer + flush。
8. 所有发送成功路径的 `setComposerText("")` 旁调用 `clearComposerDraft(resolveComposerDraftKey(...))`（至少 `sendChat` 主清空处 L10110；确认短语清空 L9712；命令清空等）。
9. `initSession` 成功处把悬空调用改为：

```ts
migrateActiveComposerDraftToSession(pane.id, result.session_id);
```

**AC-2：** 手动：Meta 窗格输入长文 → 侧栏点「定时任务」→ 再回聊天 → 文本仍在。  
**AC-3：** 发送后草稿清空，重开不再回填已发送文。  
**AC-4：** 会话 A 草稿与会话 B 不串台（历史面板切换）。

### FR-3 no-scope-creep

禁止：改附件数据模型、改 Lite、顺手重构 composer。（导航 keep-alive 与附件随草稿持久化属于 In scope，见上文；此前本行与 In scope 自相矛盾，已更正。）
