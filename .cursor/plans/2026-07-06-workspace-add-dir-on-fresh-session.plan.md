# 新建对话可直接添加工作区目录

Planned-with: claude-opus-4.8
Suggested-Impl-Model: gpt-5.5-codex（会话生命周期敏感、跨 ChatPane/WorkspacePanel 收口，宜用代码专精中档；纯文案/小改动可降档）

## 背景 / 问题

新建对话（点「全新对话」，`createNewTopic`）后，工作区面板点「确认添加 / 选择目录」会弹出
「请先发送一条消息，再添加工作区目录」，无法直接加目录。

用户预期：新对话应能**直接添加任意工作区目录**，不必先发一条消息。

## 根因

- `createNewTopic`（`desktop/src/components/ChatPane.tsx` ~8840）出于「惰性创建会话」的设计：
  - `markPaneAwaitingFreshSession(pane.id)`、`setPaneSessionId(pane.id, "")`
  - 记录 `setPanePendingSessionMode` / `setPaneLazyInheritParent`
  - **不立即创建后端会话**，等首条消息发送时才在 sendChat 懒创建分支
    （`ChatPane.tsx` 6959-7006）用正确的 `session_mode` / `inherit_from_session_id` /
    `provider` / `model` 物化会话。目的：避免空会话在历史侧栏留「纯数字 id」标题、避免丢失懒创建参数。
- `WorkspacePanel.addTaskspace()`（`desktop/src/components/WorkspacePanel.tsx` 553-602）：
  - 工作区目录（taskspace）是**按 session 存储**的，必须先有 `session_id` 才能挂。
  - 对「等待全新会话」态直接拦截并提示（564-568 行）。
  - 对「无 session 但非等待全新会话」态则会主动 `createSession` 再挂（569-586 行，但用的是**精简 payload**，不带 mode/inherit/provider/model）。
- 因此该提示仅出现在「全新对话」这一态。

## 目标

1. 新对话可直接添加工作区目录，无需先发消息。
2. 就地创建会话时，参数与「发消息懒创建」**完全一致**（`session_mode` / `inherit_from_session_id` / `provider` / `model`），不丢失继承/模式/模型。
3. 目录挂载后清除「等待全新会话」态；后续首条消息**复用同一 session**，不再重复新建。
4. 不改动其它态（分身冷启动、群聊/自动化窗格「正在初始化」提示保持不变）。

## 设计

复用「懒创建会话」逻辑到「加目录」路径。会话创建参数都在 `ChatPane`，`WorkspacePanel` 拿不到，
通过回调把创建动作交回 `ChatPane`，并抽出共享函数避免两套逻辑漂移。

### FR-1：抽出共享的会话物化函数（ChatPane）
- 在 `ChatPane.tsx` 抽出 `materializeLazySession(): Promise<string | null>`：
  - 收敛 sendChat 懒创建分支（6959-7006）里的创建逻辑：读取 `peekPaneLazyInheritParent`、
    `peekPanePendingSessionMode`、`chatProvider`/`chatModel`，调用 `createSession`，成功后
    `setPaneSessionId` + `setPaneSessionMode` + `clearPaneLazyInheritParent` +
    `clearPanePendingSessionMode` + `clearPaneAwaitingFreshSession` + `bumpSessionCatalogRevision`，
    返回新 `session_id`；失败返回 `null`。
  - sendChat 懒创建分支改为调用该函数（行为保持不变），避免复制逻辑。
  - 注意：不复制 sendChat 内部与「发消息」强耦合的副作用（如 `setPaneMessages([])`、
    `pollSessionSidRef` 重置）到加目录路径——加目录不清空消息（此时本就是空会话）。
    抽取时把「发送特有副作用」留在 sendChat 分支，共享函数只负责创建+落 session 状态。

### FR-2：WorkspacePanel 新增会话保障回调
- 新增可选 prop：`onEnsureSessionForWorkspace?: () => Promise<string | null>`。
- `addTaskspace`（553-602）改造：
  - 当 `!effectiveSessionId` 且 `isPaneAwaitingFreshSession(paneId)` 时，
    不再直接拦截报错；改为调用 `onEnsureSessionForWorkspace?.()`：
    - 返回有效 id → 用它作为 `effectiveSessionId` 继续挂目录。
    - 返回 `null` 或未提供回调 → 保留原提示 / 报「创建会话失败」。
  - 群聊/自动化窗格「会话正在初始化，请稍候再试」分支**保持不变**（scope 之外）。
  - 「无 session 且非等待全新会话」的既有 `createSession` 分支保持不变。

### FR-3：ChatPane 接线回调
- 渲染 `<WorkspacePanel>` 两处（`ChatPane.tsx` 10434、10543）都传入
  `onEnsureSessionForWorkspace={() => materializeLazySession()}`。

## 验收标准（AC）

- AC-1：新建对话 → 打开工作区 → 选择/输入目录 → 确认添加，目录成功挂载，无「请先发送一条消息」提示。
- AC-2：加目录后查看会话，`session_mode` / 继承关系 / provider·model 与「先发消息再加目录」结果一致。
- AC-3：加目录后再发第一条消息，复用同一 session（历史里不出现两个会话），消息与目录都在同一会话。
- AC-4：加目录创建会话失败时，有可读错误提示（复用 `formatTaskspaceAddError` / 明确文案），不静默。
- AC-5：分身冷启动、群聊/自动化窗格的加目录行为与提示与改动前一致（回归）。
- AC-6：`npm run -s typecheck`（desktop）通过。

## 影响文件

- `desktop/src/components/ChatPane.tsx`（抽 `materializeLazySession`、接线两处 WorkspacePanel）
- `desktop/src/components/WorkspacePanel.tsx`（新增 prop、改造 `addTaskspace`）
- 可能：`desktop/src/utils/pane-fresh-session.ts` 无需改（只读现有 API）

## 风险 / 注意

- 会话生命周期敏感：抽取共享函数时**只搬创建逻辑**，不要把发送特有副作用误带进加目录路径，
  否则可能清空正在恢复的消息或错乱轮询 sid。
- 历史侧栏：加目录即物化会话——此时会话虽无消息但已有工作区，属「有意义」的会话；
  若担心标题仍为纯数字 id，可在后续单独优化标题（本次不扩范围）。
- 严格遵守 no-scope-creep：仅改「全新对话加目录」这一路径，不动其它态与无关逻辑。

## 备选方案（未采用）

- 备选 A：新对话时就 eager 创建会话（回到非惰性）。否决：会重新引入空会话污染历史、
  破坏「继承上下文/模式在首条消息才定」的既有设计，回归面大。
- 备选 B：WorkspacePanel 自己 `createSession`（像现有非等待态那样精简 payload）。否决：
  会丢 mode/inherit/provider/model，参数逻辑二次漂移，与首条消息懒创建不一致。
