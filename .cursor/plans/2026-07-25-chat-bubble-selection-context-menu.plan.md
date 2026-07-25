# 聊天气泡选区右键菜单（复制 / 全选 / 网络搜索 / 引用至当前对话 / 引用至新对话）

Planned-with: Claude Sonnet 5
Suggested-Impl-Model: Composer 2.5（够用且最省：全部落点均有既有代码先例可循——内联菜单加项、一次性 store 字段仿 `historyJumpMessageId`、`focusRequest` 分支复用 `openWebReferenceInBrowser`——不涉及新架构决策，无需上顶配）

> 复杂度：中等（M）。范围锁定 Desktop 聊天气泡（`ImBubble.tsx`）+ `ChatPane.tsx` 少量新增 handler + `WorkPanel.tsx` 一处分支修复 + `store.ts` 一个一次性字段。**不触碰**工作区文件预览的 `SelectionQuotePopover`、`HtmlPreviewChrome` 选元素、`RemoteBrowserPane` 远程网页选区——这些本次明确 Out of scope（用户已在澄清问答中确认仅聊天气泡）。

---

## 1. 背景与参考

用户提供 Cursor 编辑器里选中文字后右键菜单的截图作为交互参照（Copy / Select All / Search with Google / 引用至当前对话 / 引用至新对话），要求 Near 聊天气泡（**用户消息与 AI 回复气泡均需要**，不限于 AI 回复）里选中任意文字后右键出现同等的 5 项能力。

**与用户澄清问答的结论（已确认，作为强制约束）：**

| 问题 | 结论 |
|---|---|
| 「引用至当前/新对话」语义 | **回复引用**（沿用现有气泡「引用」的 `quoteTarget`/`quoted_content` 逻辑），不是工作区那种 `context_files` 片段挂载 |
| 「新对话」具体指什么 | **真正新开一个窗格/pane**（不是原地清空重建同一 pane，不同于全局搜索现有的 `mode:"new"`） |
| 网络搜索引擎 | 硬编码 **Google**（`https://www.google.com/search?q=...`），本次不做可配置项 |
| 「全选」范围 | 仅全选**当前这条消息气泡**的正文内容，不跨气泡、不是全选整个对话 |
| 本次改造范围 | **仅聊天气泡**（用户消息 + AI 回复），不含工作区文件预览 / HTML 选元素 / 远程浏览器选区 |

---

## 2. 需求

### FR（功能性需求）

- **FR-1**：`ImBubble.tsx` 现有的自制右键菜单（`menuOpen`/`menuPos`，L851-914）新增 3 项：**全选**、**用网络搜索**、**引用至新对话**；保留现有「复制/引用/收藏/转发/修改/重试/多选」项及其顺序，不重做菜单组件、不引入 Radix ContextMenu（no-scope-creep：只在既有内联菜单结构里插入新按钮）。
- **FR-2（复制语义变更，用户明确要求）**：菜单「复制」按钮点击时，若气泡内**存在选区**（`getContainedSelectionText(msgContentRef.current)` 非空），复制**选区文本**（`navigator.clipboard.writeText(picked)`）；若**无选区**，保持现状行为——调用 `onCopyMessage?.(message)`（整条消息，含现有 Markdown→纯文本转换逻辑，见 `ChatPane.copyMessage` L4616-4621，不改动该函数本身）。
- **FR-3（全选，新增）**：菜单「全选」按钮：用 `Range.selectNodeContents(msgContentRef.current)` + `window.getSelection()?.removeAllRanges()/addRange()` 选中当前气泡 `msg-content` 容器（L593 或 L713 的 `<div ref={msgContentRef} className="msg-content ...">`）全部内容。纯前端 DOM 操作，不需要新 prop 回调给 `ChatPane`。
- **FR-4（网络搜索，新增）**：菜单「用网络搜索」按钮：
  - 取文本：`getContainedSelectionText(msgContentRef.current)`；若为空则禁用/隐藏该项（网络搜索必须有明确查询词，不回退到整条消息——整条消息通常过长不适合做搜索 query）。
  - 拼 URL：`` `https://www.google.com/search?q=${encodeURIComponent(text)}` ``。
  - 通过新增 prop `onWebSearchMessage?.(message, selectedText)` 冒泡到 `ChatPane`，`ChatPane` 侧：
    1. `openWorkspaceSidebarForPane(pane.id, paneRef.current?.clientWidth ?? paneWidth, openSidePanel)`（若 `!pane.taskspacePanelOpen`，对齐 L4591-4594 既有调用范式）；
    2. `setWorkPanelFocus({ kind: "browser", url: googleUrl, title: \`搜索：${text}\` })`（不传 `srcDoc` 字段）。
  - **必须先修复 `WorkPanel.tsx` 的 `focusRequest.kind === "browser"` 分支缺口**（见第 4 节设计决策 A），否则 URL-only 的 focus 请求不会真正导航，只会 `setActiveKind("browser")`。
- **FR-5（引用至当前对话，语义对齐现有「引用」）**：菜单新增「引用至当前对话」项，行为等同现有 `runQuote()`（L297-300：选区优先，`onQuoteMessage?.(message, picked ?? undefined)`）。**决策：直接把现有「引用」按钮的文案改为「引用至当前对话」**（同一按钮，不重复加一项），避免同一气泡里出现两个语义相同的按钮造成混淆。
- **FR-6（引用至新对话，新增，核心工作量）**：菜单新增「引用至新对话」项：
  1. 取文本：`getContainedSelectionText(msgContentRef.current)` ?? 整条消息（对齐 `resolveQuoteBody` 现有回退逻辑，`ChatPane.tsx` L318-329）。
  2. 新增 prop `onQuoteToNewPane?.(message: Message, selectedText?: string) => void`，冒泡到 `ChatPane`。
  3. `ChatPane` 侧新增 `quoteMessageToNewPane` 回调：
     - `const body = resolveQuoteBody(message, selectedText);`
     - `const newPaneId = addPane(pane.avatarId, pane.avatarName, "");`（同分身、空 sessionId → lazy session，对齐 `addPane` 签名 `store.ts` L599）
     - `markPaneAwaitingFreshSession(newPaneId);`（对齐 `insertGlobalSearchFileReference` 的 `mode:"new"` 分支既有用法，`ChatPane.tsx` L10166）
     - `setPanePendingQuote(newPaneId, { messageId: message.id, body, label: \`${message.avatarName || message.agentId || (message.role === "user" ? "我" : "AI")}\` });`（新 store action，见第 4 节设计决策 B）
     - `setActivePaneId(newPaneId);`
  4. 新 pane 挂载后的 `ChatPane` 实例需在 mount 时机消费 `pane.pendingQuote`：若非空，`setQuoteTarget({ message: {...最小占位 Message，用 body 填 content...}, body })` 并立即调用 `setPanePendingQuote(pane.id, null)` 清空（一次性字段，仿 `historyJumpMessageId` 消费模式）。

### NFR（非功能性需求）

- **NFR-1**：新增行为不得破坏现有「复制/引用/收藏/转发/修改/重试/多选」7 项的既有点击行为与显示条件（`onEditMessage`/`onRetryMessage` 条件渲染保持不变）。
- **NFR-2**：`compactAssistant`（ReAct 紧凑行）继续完全跳过右键菜单（保留 L330-331 `if (compactAssistant) return;`），本次改造不涉及该分支。
- **NFR-3**：新 pane 的「引用至新对话」不得影响源 pane 的任何状态（消息、`quoteTarget`、`sessionId` 均不变）。
- **NFR-4**：`pendingQuote` 字段必须是一次性消费（读取后立刻清空），避免用户之后手动切换回该 pane 或刷新导致引用条重复出现或状态残留。

### AC（验收条件）

- **AC-1**：在任意 AI 回复气泡里拖选一段文字，右键出现 5 项：复制、引用至当前对话、全选、用网络搜索、引用至新对话（保留原有收藏/转发/修改/重试/多选不受影响，可与新增项共存于同一菜单，顺序不作强制要求但需在 plan 落地时保持稳定顺序）。点击「复制」，剪贴板内容为**选区文本**而非整条消息。
- **AC-2**：在用户消息气泡里同样操作，右键菜单行为与 AI 回复一致（用户消息目前已共用同一套 `ImBubble` 右键逻辑）。
- **AC-3**：气泡内无选区时右键，「用网络搜索」项禁用或不显示；「全选」「引用至当前对话」「引用至新对话」「复制」仍可用（复制/引用回退整条消息，全选/引用至新对话回退整条消息文本）。
- **AC-4**：点击「全选」后，`window.getSelection().toString()` 等于该气泡 `msg-content` 的全部可见文本，且不包含相邻气泡内容。
- **AC-5**：选中一段文字点击「用网络搜索」，右侧工作台侧栏自动展开并在浏览器 tab 里打开 `https://www.google.com/search?q=<选中文字 URL 编码>`，标题栏显示「搜索：<选中文字>」。
- **AC-6**：点击「引用至当前对话」（原「引用」按钮改名），输入框上方出现引用条，语义与当前「引用」功能完全一致（回归测试：不能改变现有引用行为）。
- **AC-7**：选中一段文字点击「引用至新对话」：
  - 布局中新增一个窗格（对齐现有 `addPane` append-to-end + 自动成为 active 的行为），源窗格保持不动（消息、`quoteTarget`、`sessionId` 均不变）；
  - 新窗格挂载后，输入框上方立即出现引用条（内容 = 选中文字），且**只出现一次**（切走再切回该 pane 不应重复挂载/不应丢失——挂载后引用条状态转为该新 pane `ChatPane` 组件内的普通 `quoteTarget` local state，后续行为与手动点「引用」完全一致，可被用户手动取消）；
  - 用户在新窗格输入正文并发送，请求体带 `quoted_content`（同现有引用发送逻辑，`ChatPane.tsx` L8395-8398），且发的是**该新 pane 的新 session**（首条消息触发 lazy session 创建）。
- **AC-8**：`npm run typecheck`（或等效 `tsc --noEmit`）与 `npm run build` 绿。
- **AC-9**：主进程未改动，无需重启 Electron；`npm run dev` 热更新即可验证（若改动触及 `electron/`，需额外验证，但本 plan 预期不涉及主进程文件）。

### Out of scope（明确不做，避免范围蔓延）

- 工作区文件预览 `SelectionQuotePopover`、`SpreadsheetPreview` 选区菜单统一化。
- 本地 HTML 预览 `HtmlElementSelectPopover` 选元素菜单统一化。
- 远程网页 `RemoteBrowserPane`（`inspectAvailable={false}`）的选区/选元素加入对话能力。
- 搜索引擎可配置化（设置项、Bing/百度可选等）。
- 消息多选工具栏（`已多选 N 条`）功能改动。
- 代码块工具栏（`markdown-components.tsx` 的「引用」按钮）改动——它已走同一 `onQuoteMessage`，FR-5 改名后自动生效，无需单独改代码块工具栏文案（其按钮文案若也写死"引用"字样需要同步检查，见第 5 节实施清单）。

---

## 3. 现状锚点（实施时按这些行号/符号定位）

### `desktop/src/components/messages/ImBubble.tsx`

- L53-59：props 类型定义区（`onCopyMessage`/`onQuoteMessage`/`onFavoriteMessage`/`onToggleSelectMessage`/`onForwardMessage`/`onRetryMessage`/`onEditMessage`）—— 新增 `onWebSearchMessage?: (message: Message, selectedText?: string) => void;` 与 `onQuoteToNewPane?: (message: Message, selectedText?: string) => void;` 插在此区。
- L198-204：对应的函数参数解构区，同步新增两个新 prop 名。
- L276：`const msgContentRef = useRef<HTMLDivElement | null>(null);`
- L292-305：`runFavorite`/`runQuote`/`runForward` 三个函数，均为 `getContainedSelectionText(msgContentRef.current)` → 回调模式。新增 `runWebSearch`/`runQuoteToNewPane` 按同样模式实现：
  ```ts
  const runWebSearch = () => {
    const picked = getContainedSelectionText(msgContentRef.current);
    if (!picked) return; // 无选区不触发（FR-4 约束）
    onWebSearchMessage?.(message, picked);
  };
  const runQuoteToNewPane = () => {
    const picked = getContainedSelectionText(msgContentRef.current);
    onQuoteToNewPane?.(message, picked ?? undefined);
  };
  const runSelectAll = () => {
    const root = msgContentRef.current;
    if (!root) return;
    const range = document.createRange();
    range.selectNodeContents(root);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };
  ```
- L330-335：`openContextMenu`（`compactAssistant` 早退、`preventDefault`）—— 不改。
- L593：`<div ref={msgContentRef} className="msg-content min-w-0 break-words">`（用户消息正文容器之一）。
- L629：`<div ref={msgContentRef} className="hidden" aria-hidden />`（占位隐藏容器，需确认这条分支下右键菜单是否应该不显示"全选/网络搜索/引用"——若该分支消息本身不可见，右键理论上不会触发，实施时确认即可，不需要特殊处理）。
- L713：`<div ref={msgContentRef} className="msg-content min-w-0 break-words">`（AI 回复正文容器）。
- L851-914：右键菜单 JSX（`menuOpen && !compactAssistant` 包裹的 `fixed z-[80] w-36 ...` 浮层）。现有顺序：复制(860-863) → 引用(864-870) → 收藏(871-877) → 转发(878-884) → [修改 885-897] → [重试 898-906] → 多选(907-913)。
  - **FR-5**：L869 文案 `引用` → 改为 `引用至当前对话`（按钮结构、`onClick`、图标 `<Quote>` 均不变，仅改可见文案）。
  - **FR-1/3/4/6**：在「引用至当前对话」按钮（原「引用」）之后插入「全选」「用网络搜索」「引用至新对话」三个新按钮，各自 `onClick={() => { setMenuOpen(false); runXxx(); }}`，图标可选 `TextSelect`/`Search`/`MessageSquarePlus`（`lucide-react` 已在文件头部导入 `Copy`/`Quote`/`Bookmark`/`Forward`/`Pencil`/`RotateCcw`/`LayoutList`，新增图标需在文件顶部 `import` 语句里追加）。
  - 「用网络搜索」按钮渲染条件：`getContainedSelectionText(msgContentRef.current)` 在菜单**渲染时**判空比较麻烦（选区可能在右键弹出瞬间已固定，但 React state 不会随选区变化重渲染）——**建议做法**：右键触发 `openContextMenu` 时，同一时刻用 `getContainedSelectionText` 求值并存入新增 state `const [menuHasSelection, setMenuHasSelection] = useState(false);`，在 `openContextMenu` 里 `setMenuHasSelection(Boolean(getContainedSelectionText(msgContentRef.current)));`，菜单渲染时用 `menuHasSelection` 控制「用网络搜索」按钮的 `disabled`/隐藏。

### `desktop/src/components/ChatPane.tsx`

- L318-329：`resolveQuoteBody(message, selectedText)` —— FR-6 直接复用，不改。
- L2640：`const [quoteTarget, setQuoteTarget] = useState<{ message: Message; body: string } | null>(null);` —— 每个 `ChatPane` 实例（每个 pane）各自一份，新 pane 挂载后是独立的全新 state。
- L390-416：`openWorkspaceSidebarForPane(paneId, paneOuterWidthPx, openSidePanel)` —— FR-4 直接复用。
- L4591-4594：既有调用范式参照（`if (!pane.taskspacePanelOpen) { openWorkspaceSidebarForPane(...) }`）。
- L6875-6876：现有 `<ImBubble onQuoteMessage={(msg, selectedText) => setQuoteTarget({ message: msg, body: resolveQuoteBody(msg, selectedText) })} .../>` 绑定处 —— 在此处（以及群聊/其它渲染 `ImBubble` 的第二处，约 L11927/12046 一带出现的 workspace 相关 prop 说明还有另一处 `<ImBubble>` 实例，需要 grep 确认共有几处渲染点，全部同步补 `onWebSearchMessage`/`onQuoteToNewPane`）新增：
  ```ts
  onWebSearchMessage={(msg, selectedText) => {
    const q = (selectedText ?? "").trim();
    if (!q) return;
    if (!pane.taskspacePanelOpen) {
      openWorkspaceSidebarForPane(pane.id, paneRef.current?.clientWidth ?? paneWidth, openSidePanel);
    }
    setWorkPanelFocus({
      kind: "browser",
      url: `https://www.google.com/search?q=${encodeURIComponent(q)}`,
      title: `搜索：${q}`,
    });
  }}
  onQuoteToNewPane={(msg, selectedText) => {
    const body = resolveQuoteBody(msg, selectedText);
    const newPaneId = addPane(pane.avatarId, pane.avatarName, "");
    markPaneAwaitingFreshSession(newPaneId);
    setPanePendingQuote(newPaneId, {
      messageId: msg.id,
      body,
      label: msg.avatarName || msg.agentId || (msg.role === "user" ? "我" : "AI"),
    });
    setActivePaneId(newPaneId);
  }}
  ```
- L8395-8398：发送时 `quoted_message_id`/`quoted_content` 写入逻辑 —— 不改，新 pane 走同一发送路径自动生效。
- L11249-11256：输入框上方引用条 UI —— 不改，新 pane 的 `ChatPane` 实例自带这段 JSX，只要该实例的 `quoteTarget` 被设置即会显示。
- L259：`import { markPaneAwaitingFreshSession } from "../utils/pane-fresh-session";`（已导入，供 FR-6 直接使用）。
- 需新增：一个 `useEffect`（建议放在 `quoteTarget` state 声明附近，即 L2640 之后）消费 `pane.pendingQuote`：
  ```ts
  useEffect(() => {
    const pending = pane.pendingQuote;
    if (!pending) return;
    setQuoteTarget({
      message: {
        id: pending.messageId,
        role: "assistant", // 占位；仅用于 resolveQuoteBody 展示，真正展示文案见下方 label 处理
        content: pending.body,
      } as Message,
      body: pending.body,
    });
    setPanePendingQuote(pane.id, null);
  }, [pane.pendingQuote, pane.id]);
  ```
  **注意**：引用条展示文案用的是 `quoteTarget.message.avatarName || quoteTarget.message.agentId || quoteTarget.message.role`（L8397），为了让新窗格引用条正确显示来源（而不是显示 "assistant"/"user" 字面量），`pendingQuote` payload 需要把 `label` 塞进这个占位 `Message` 的 `avatarName` 字段，即 `avatarName: pending.label`（占位 `Message` 对象补上该字段）。实施时对照 `Message` 类型定义（`store.ts` L168-223）确认必填字段，缺的字段用安全默认值填充（如 `timestamp: Date.now()`），避免类型报错。

### `desktop/src/store.ts`

- L141-186：`ChatPane` 类型定义。新增字段（紧邻 `historyJumpMessageId?: string | null;` L171 之后）：
  ```ts
  /** One-shot cross-pane quote payload set by "引用至新对话"; consumed once on mount then cleared. */
  pendingQuote?: { messageId: string; body: string; label: string } | null;
  ```
- L599：`addPane: (avatarId: string | null, avatarName: string, sessionId: string) => string;` —— 接口签名，直接复用，不改。
- L1516-1568：`addPane` 实现，新 pane 对象字面量里补 `pendingQuote: undefined`（或依赖可选字段省略，TS 允许）。
- L2058-2068：`setPaneHistoryJumpMessageId` 实现范式 —— 新增同构 action：
  ```ts
  setPanePendingQuote: (paneId, payload) =>
    set((state) => ({
      panes: state.panes.map((pane) =>
        pane.id === paneId ? { ...pane, pendingQuote: payload } : pane
      ),
    })),
  ```
  并在接口区（对照 L691 附近 `setPaneSessionId` 一带）补类型声明：
  ```ts
  setPanePendingQuote: (paneId: string, payload: ChatPane["pendingQuote"]) => void;
  ```

### `desktop/src/components/work-panel/WorkPanel.tsx`

- **设计决策 A（必须先修）**：L884-912 的 `focusRequest.kind === "browser"` 分支：
  ```ts
  } else if (focusRequest.kind === "browser") {
    const focusUrl = String(focusRequest.url || "").trim();
    const focusSrcDoc = focusRequest.srcDoc;
    if (focusUrl && focusSrcDoc != null) {
      // 现有本地 HTML（srcDoc）分支，原样保留
      ...
    } else if (focusUrl) {
      // 新增：URL-only（远程网页，如网络搜索结果页）分支
      openWebReferenceInBrowser(focusUrl, String(focusRequest.title || "").trim() || focusUrl);
    } else if (focusRequest.tabId) {
      setActiveBrowserId(focusRequest.tabId);
    }
    setActiveKind("browser");
  }
  ```
  - `openWebReferenceInBrowser` 定义于同文件 L1034-1055，已实现"复用同 URL tab 或新建 + 切换 active"逻辑，直接调用即可，**不要**复制粘贴其内部逻辑（避免重复代码 / 后续行为不一致）。
  - 注意此函数在 `focusRequest` 的 `useEffect`（L861-917）触发时若尚未定义（声明顺序问题）需确认 `openWebReferenceInBrowser` 是否已在该 `useEffect` 之前用 `const` 声明（当前 L1034 晚于 L861，JS 函数表达式无提升，需要确认实际渲染时机——若报 "used before defined"，改用 `useCallback` 提前声明或把该 `useEffect` 移到 `openWebReferenceInBrowser` 定义之后）。**实施时务必先跑一次本地验证该顺序问题**，这是本 plan 里唯一有真实"是否报错"不确定性的点。

---

## 4. 设计决策摘要

| 决策点 | 选择 | 理由 |
|---|---|---|
| A. 网络搜索如何真正打开 URL | 修复 `WorkPanel.tsx` `focusRequest` 的 `"browser"` 分支，新增 else-if 调用既有 `openWebReferenceInBrowser` | 复用已验证的"查重 tab / 新建 tab / 激活"逻辑，避免重复实现；这是 FR-4 唯一的架构性改动 |
| B. 新窗格如何携带初始引用条 | `ChatPane` store 新增一次性字段 `pendingQuote`，仿 `historyJumpMessageId` 的"设置→目标 pane 消费→清空"模式 | `quoteTarget` 是纯组件 local state，`addPane` 创建瞬间无法直接注入；跨 pane 传递必须经全局 store。one-shot 字段模式在本仓库已有成熟先例，风险最低 |
| C. 「引用至当前对话」是否新增按钮 | **不新增**，直接把现有「引用」按钮文案改为「引用至当前对话」 | 避免同一菜单里出现两个语义完全相同的按钮；用户澄清问答已确认该语义 = 现有「引用」行为 |
| D. 「复制」是否改变现状行为 | **改**：有选区复制选区，无选区保持复制整条 | 用户参照 Cursor 原生右键菜单的「Copy」语义（选区优先），这是本次需求的明确诉求点，不是无关顺手优化 |
| E. 「用网络搜索」无选区时的行为 | 禁用/隐藏该项，不回退到整条消息 | 整条消息作为搜索 query 通常过长且无意义；比"全选"".引用"更严格 |

---

## 5. 实施清单（建议顺序）

1. `store.ts`：加 `pendingQuote` 字段 + `setPanePendingQuote` action（类型 + 实现两处）。
2. `WorkPanel.tsx`：修复 `focusRequest.kind === "browser"` 分支（设计决策 A），本地验证 Google 搜索 URL 能否通过 `setWorkPanelFocus({kind:"browser", url, title})` 真正打开 tab（可先手写一段临时测试代码或用现有入口模拟）。
3. `ImBubble.tsx`：
   - 补 2 个新 prop 类型 + 解构；
   - 补 `runSelectAll`/`runWebSearch`/`runQuoteToNewPane` 三个函数；
   - 补 `menuHasSelection` state + `openContextMenu` 内求值；
   - 菜单 JSX：改「引用」文案为「引用至当前对话」，插入「全选」「用网络搜索」「引用至新对话」三项，「用网络搜索」按 `menuHasSelection` 控制可用性；
   - 「复制」按钮 `onClick` 改为选区优先（FR-2）。
4. `ChatPane.tsx`：
   - 找到全部 `<ImBubble ... onQuoteMessage={...} .../>` 渲染点（至少 3 处：主消息列表约 L6875、以及 workspace 相关的约 L11927/L12046 一带，**实施时须 grep `<ImBubble` 确认精确处数，逐一补齐新 prop，不能漏**），补 `onWebSearchMessage`/`onQuoteToNewPane` 绑定；
   - 新增 `useEffect` 消费 `pane.pendingQuote` → `setQuoteTarget` → 清空。
5. 全量 grep 一次 `markdown-components.tsx` 里代码块工具栏「引用」按钮文案，确认是否也需要同步改为「引用至当前对话」（如果该按钮独立写死文案而非复用 `ImBubble` 菜单文案，需要同步改，保持全局术语一致；如果它只是触发 `onQuoteText`→`onQuoteMessage` 且没有自己的可见文案菜单项，可跳过）。
6. `npm run typecheck` / `npm run build` 验证（AC-8）。
7. 手动跑 AC-1~AC-7 全部验收点。

---

## 6. 风险与回归点

- **风险 1**：`ImBubble` 是高频组件，右键菜单结构改动若引入渲染错误会影响所有消息展示——实施后务必在真实会话里验证普通消息、流式消息、群聊消息、ReAct 紧凑行（确认仍不弹菜单）均正常。
- **风险 2**：`pendingQuote` 消费 `useEffect` 的依赖数组需精确（`[pane.pendingQuote, pane.id]`），避免在其它 state 变化时误触发或漏触发；同时要确认新 pane 挂载时 `pane` 对象引用已是最新（从 store 里按 `paneId` 取，而非闭包捕获的旧值）。
- **风险 3**：`WorkPanel.tsx` 的 `openWebReferenceInBrowser` 声明顺序问题（见第 3 节 A 决策备注）——若函数在 `useEffect` 中被引用时尚未定义会导致运行时 `ReferenceError`（`const` 是 TDZ，不是 `undefined`），必须实测。
- **风险 4**：新增 `pendingQuote` 字段若被 localStorage 持久化快照捕获（多窗格状态恢复机制），需确认其可选字段在旧数据反序列化时不会导致渲染期访问 `undefined` 报错（按仓库既有约定，新增可选字段配合可选链读取即可，本 plan 里消费处已用 `pane.pendingQuote` 可选访问，无需额外 migration）。
