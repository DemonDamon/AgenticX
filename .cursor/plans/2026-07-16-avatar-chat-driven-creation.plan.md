# 分身创建流程：对话驱动 + human-in-the-loop 确认 + 卡片 UI 对标

Planned-with: Claude Sonnet 5 (Thinking)
Suggested-Impl-Model: Composer 2.5（前端接线为主，无高风险架构改动）

> 参考对象：某竞品桌面应用创建「专家」的流程截图（用户已提供，不在本文引用竞品名）。仅借鉴交互模式，不照抄视觉与文案。

## 1. 背景与既有能力（复用，不重建）

- `create_avatar` Meta 工具已存在（`agenticx/runtime/meta_tools.py` L548-587 定义，L2964+ dispatch），Meta-Agent 在对话中可直接调用并落库，无需新的后端创建管线。
- `request_action_confirmation` 通用 HITL 原语已存在（`agenticx/cli/agent_tools.py` L377-421 定义，L2485-2606 `_request_action_confirmation` 实现），前端 `InlineConfirmCard.tsx` + `message.actionConfirmation` 已完整接线（`MessageRenderer.tsx` L430-441，`ChatPane.tsx` L9717 `resolveActionConfirmation`）。**不需要新建任何确认 UI/传输机制**，只需让 Meta 在创建分身前调用它。
- `usePaneNavigation.newMetaTask()`（`desktop/src/hooks/usePaneNavigation.ts` L222-240）已支持「新建任务」跳转元智能体新会话，通过 `agenticx:pane:new-topic` 事件通知 `ChatPane.tsx`（L9329-9337 监听）。
- `shellOpenPath` IPC 已存在（`desktop/electron/preload.ts` L648，`main.ts` L9712-9722），可直接用于「打开文件夹」。
- `AvatarConfig.workspace_dir` 后端已持久化并会出现在 `/api/avatars` 返回的 `to_dict()` 中（`agenticx/avatar/registry.py` L64-70：非空值总会被序列化），只是前端尚未把这个字段映射进 `Avatar` 类型。

## 2. In scope（本轮要做的）

### FR-1 网格末尾虚线「+ 创建分身」占位卡片
- 位置：`desktop/src/components/gallery/AvatarGalleryView.tsx`，`sortedAvatars.map(...)` 渲染的 `<div className="grid ...">` 内，紧跟最后一张真实卡片之后追加一张虚线卡片。
- 视觉：`border border-dashed border-border`，居中 `Plus` 图标 + 文案「创建分身」，高度与普通卡片一致（`min-h` 对齐，不需要精确复刻参考图的方形比例）。
- 行为：`onClick={() => setCreateOpen(true)}`，与顶部按钮打开同一个 `AvatarCreateDialog`。
- AC-1：分身数量 ≥1 时，网格最后一格显示虚线「创建分身」卡片；点击后打开创建弹窗。

### FR-2 空态视觉微调（参考图1，不照搬文案）
- 位置：同文件，`sortedAvatars.length === 0` 分支（当前 `desktop/src/components/gallery/AvatarGalleryView.tsx` 约 L160-170）。
- 改动：加一个居中图标（`lucide-react` 的 `Sparkles` 或 `Bot`，与 Near 品味一致，不用 WorkBuddy 的毕业帽），标题加粗为 `text-[15px] font-semibold text-text-strong`，副标题保留 `text-text-muted` 但补一句「创建属于你的数字分身，处理专精任务」，按钮样式不变。
- AC-2：空分身列表时展示「图标 + 加粗标题 + 副标题 + 新建按钮」四段式布局，与现状比仅是视觉层级增强，不改变交互。

### FR-3 「AI 生成」改为「AI 创建」，走对话驱动
- 位置：`desktop/src/components/AvatarCreateDialog.tsx`。
- Tab 文案：L145 `[["manual", "手动创建"], ["ai", "AI 生成"]]` → 第二项文案改为 `"AI 创建"`（`key` 仍用 `"ai"`，不改内部状态命名，降低改动面）。
- `Props` 新增：`onCreateViaChat: (description: string) => void`（新增，不删旧的 `onCreate`，手动创建 tab 逻辑不变）。
- `ai` 模式的提交按钮（当前 L326-332 `handleAiGenerate` + `generateAvatar` IPC）改为：
  ```tsx
  onClick={() => {
    const desc = description.trim();
    if (!desc) return;
    onCreateViaChat(desc);
    setDescription("");
    resetAndClose(); // 复用现有 resetAndClose，只是不再调用 handleAiGenerate
  }}
  ```
  按钮文案由「AI 生成」/「生成中...」改为「开始创建」（不再有 loading 态，因为不再发起 API 调用，是纯跳转）。
- 删除本 tab 对 `window.agenticxDesktop.generateAvatar` 的调用与 `busy`/`aiError` 在此路径的使用（`handleAiGenerate` 函数体、`aiError` 状态、错误展示块可保留但仅手动创建路径可能已不再用到——**保留 `generateAvatar` IPC 本身与后端 `/api/avatars/generate` 端点不删除**，仅本 UI 入口切换用法，避免影响其他潜在调用方；若 grep 确认无其他调用方，可在评审后二次清理，本轮不做删除以免 scope creep）。
- AC-3：在「AI 创建」tab 输入描述后点击「开始创建」，弹窗关闭，主区跳转到元智能体新会话，且聊天输入框已预填一段包含该描述的可编辑草稿（未自动发送）。

### FR-4 对话驱动创建：跳转 + 预填草稿
- 位置 1：`desktop/src/hooks/usePaneNavigation.ts`，`newMetaTask` 签名改为 `newMetaTask(draftText?: string)`（L222），`window.dispatchEvent` 的 `detail` 增加 `draftText`（L236-238）：
  ```ts
  const newMetaTask = useCallback((draftText?: string) => {
    ...
    window.dispatchEvent(
      new CustomEvent("agenticx:pane:new-topic", { detail: { paneId: targetPaneId, draftText } })
    );
  }, [...]);
  ```
- 位置 2：`desktop/src/components/ChatPane.tsx`，`onNewTopic` 监听器（L9330-9334）：
  ```ts
  const onNewTopic = (e: Event) => {
    const detail = (e as CustomEvent).detail as { paneId?: string; draftText?: string } | undefined;
    if (detail?.paneId && detail.paneId !== pane.id) return;
    createNewTopicRef.current(false, pane.sessionMode ?? "daily_office");
    if (detail?.draftText) {
      window.setTimeout(() => setInput(detail.draftText as string), 0);
    }
  };
  ```
  （沿用 L9317-9321 `resumeInNewSessionRef` 里 `createNewTopic` 后紧跟 `setInput(draft)` 的既有模式；`setTimeout` 是为了避开 `createNewTopic` 触发的清空逻辑可能在同一 tick 覆盖 input，若实测不需要可去掉，实施时以实际效果为准）。
- 位置 3：`desktop/src/components/gallery/AvatarGalleryView.tsx` 新增：
  ```ts
  const { openMetaOrAvatarPane, newMetaTask } = usePaneNavigation();
  const handleCreateViaChat = (description: string) => {
    const draft = `帮我创建一个数字分身。\n需求描述：${description}\n\n请先跟我确认名称、角色定位和系统提示（可参考我的描述做补充/追问），确认后再创建。`;
    newMetaTask(draft);
  };
  ```
  传入 `<AvatarCreateDialog ... onCreateViaChat={handleCreateViaChat} />`。
- AC-4：`newMetaTask` 未传参时行为与现状完全一致（回归安全）；传入 `draftText` 时新会话聊天框出现该文本且可编辑。

### FR-5 human-in-the-loop：创建前先确认（prompt 级软约束）
- 位置：`agenticx/runtime/meta_tools.py`，`create_avatar` 工具的 `"description"` 字段（L552-557）。
- 改动：追加一段强制性指引文本，要求 Meta 在调用 `create_avatar` **之前**先调用 `request_action_confirmation`，把即将创建的 `name`/`role`/`system_prompt` 摘要放进 `summary` 让用户确认；只有在收到 `[ACTION_CONFIRMED]` 后才允许调用 `create_avatar`。示例追加文案（英文，遵循本文件既有工具描述语言）：
  ```python
  "description": (
      "Create a new persistent digital avatar (数字分身) in the desktop "
      "avatar list. Use this after clarifying the user's needs and "
      "distilling a name, role, and system_prompt. The avatar is written "
      "to the registry and immediately appears in the sidebar. "
      "Do NOT just write a markdown file — this tool actually creates it. "
      "IMPORTANT: before calling this tool, you MUST first call "
      "request_action_confirmation with a summary showing the proposed "
      "name/role/system_prompt, and only proceed after receiving "
      "[ACTION_CONFIRMED] in the tool result. If the user rejects or the "
      "confirmation expires, do not call create_avatar; ask what to adjust "
      "instead."
  ),
  ```
- **说明（务必让用户知悉的限制）**：这是 prompt 级软约束（系统提示引导），不是代码层硬拦截——`_handle_tool_call` 中 `create_avatar` 分支不会去校验「本轮之前是否真的收到过 ACTION_CONFIRMED」。之所以选择这个方式而非硬编码状态机拦截，是因为：(a) 现有框架里 `request_action_confirmation` 本身就是给模型自律调用的声明式工具，没有其他工具走过硬编码的「前置工具校验」模式；(b) 引入跨工具调用的强制状态机会显著增加 `meta_tools.py` 的复杂度和回归面，超出本次「让创建过程可控」的诉求。如果后续发现模型不遵守（跳过确认直接创建），需要再单独立项做硬编码 gate。
- AC-5：手动触发「帮我创建一个 XXX 分身」对话后，Meta 在调用 `create_avatar` 前会先展示一张确认卡片（`InlineConfirmCard`），点击确认后才在分身列表出现新分身；点击取消后不出现。（此 AC 依赖模型对新增指引的遵从度，非 100% 保证，测试时以「大概率遵循」为验收标准，而非强制保证。）

### FR-6 分身卡片 UI 对标（复用已有 IPC，非新增能力）
- 位置：`desktop/src/components/gallery/AvatarGalleryView.tsx`。
- 6a. 按钮文案：卡片内「唤起」（约 L246）→「立即对话」。
- 6b. hover `...` 菜单（约 L261-286）在「设置 / 关注（取消关注） / 删除」之间插入「打开文件夹」：
  ```tsx
  <button
    type="button"
    className="w-full px-3 py-1.5 text-left text-[13px] text-text-muted transition hover:bg-surface-hover"
    onClick={() => {
      const id = cardMenu.avatarId;
      setCardMenu(null);
      const av = avatars.find((a) => a.id === id);
      if (av?.workspaceDir) void window.agenticxDesktop.shellOpenPath(av.workspaceDir);
    }}
  >
    打开文件夹
  </button>
  ```
  若 `workspaceDir` 为空则不渲染该菜单项（防御性判断，理论上不会发生因为后端总会写入）。
- 6c. 需要把 `workspace_dir` 从后端一路映射到前端 `Avatar.workspaceDir`（当前完全没有透传，需要在以下 4 处补齐，做法与本仓库既有 `color` 字段透传完全一致）：
  1. `desktop/src/store.ts`：`Avatar` 类型加 `workspaceDir?: string;`
  2. `desktop/src/global.d.ts`：`AvatarItem` 类型加 `workspace_dir?: string;`
  3. `desktop/src/utils/splash-preload-core.ts`：`mapAvatarsFromApi` 增加 `workspaceDir: a.workspace_dir ?? ""`
  4. `desktop/src/components/AvatarSidebar.tsx`：`refreshAvatars` 里 `result.avatars.map(...)` 增加 `workspaceDir: a.workspace_dir ?? ""`
- AC-6：卡片按钮显示「立即对话」；hover 菜单可见「打开文件夹」并能在 Finder/Explorer 中打开该分身工作区目录；关注/设置/删除行为不变。

## 3. Out of scope（本轮不做，避免 scope creep）

- 不引入任务列表（Task List）组件展示分身创建的分步进度——现有 `ToolCallCard` / `ReasoningBlock` 已能展示 Meta 的工具调用与思考过程，足以覆盖「过程可见」的诉求，不需要另造 UI。
- 不新增「分享」「查看专家」菜单项——Near 没有对应的专家市场/预览概念，避免造出无实际后端支撑的按钮。
- 不删除现有 `generateAvatar` / `/api/avatars/generate` 一次性生成端点与 `AvatarCreateDialog` 手动创建 tab；仅切换「AI 创建」入口的行为，其它入口保持不变。
- 不做 `create_avatar` 硬编码确认拦截（见 FR-5 说明）。
- 不改动 `AvatarSettingsPanel.tsx` / `AvatarCreateDialog.tsx` 手动创建 tab 的任何字段与校验逻辑。

## 4. 验收清单（汇总）

| # | AC | 验证方式 |
|---|----|----------|
| AC-1 | 网格末尾虚线创建卡片 | 目测 + 点击打开弹窗 |
| AC-2 | 空态四段式视觉 | 删光分身后目测 |
| AC-3 | AI 创建 tab 跳转聊天并预填草稿 | 手动操作 |
| AC-4 | `newMetaTask()` 无参回归、有参预填 | 手动操作对比「新建任务」nav 按钮 |
| AC-5 | 创建前弹出确认卡片（best-effort） | 对话内触发创建，观察是否出现 InlineConfirmCard |
| AC-6 | 卡片「立即对话」+「打开文件夹」 | 目测 + 点击验证 Finder/Explorer 打开 |

## 6. 追加：卡片进一步对标参考图（简介 + 标签 + 分隔线 + 底部双按钮）

用户复核后指出 FR-6 只做了按钮改名，视觉细节仍未对标参考截图。补充以下改动（已在同一轮实施，非独立立项）：

- `AvatarConfig` 新增 `description: str = ""`（卡片简介，区别于 `system_prompt` 的行为指令）与 `tags: List[str] = field(default_factory=list)`（技能标签，创建/更新时经 `normalize_avatar_tags` 清洗：去空/去重/单条 ≤24 字/最多 8 条）。
- `agenticx/studio/server.py` `create_avatar` 端点透传 `description`/`tags`；`update_avatar` 端点走既有通用 patch 循环，无需改动（`AvatarRegistry.update_avatar` 已加 `tags` 分支）。
- 桌面端 `description`/`tags` 沿用 `color`/`workspace_dir` 的既有透传路径：`store.ts`（Avatar 类型）→ `global.d.ts`（AvatarItem + createAvatar/updateAvatar payload）→ `preload.ts`（IPC payload 类型）→ `main.ts`（ipcMain handler payload 类型）→ `splash-preload-core.ts` / `AvatarSidebar.tsx`（响应映射）。
- `AvatarCreateDialog.tsx` 手动创建 tab 新增「简介」textarea + 「标签」逗号分隔 input；`AvatarSettingsPanel.tsx` 基本信息 tab 同步新增这两项可编辑。
- `AvatarGalleryView.tsx` 卡片重排为：更大的圆角方形头像（`rounded-2xl`，14×14）+ 名称/角色 → 简介段落（`line-clamp-2`）→ 标签 chips 行 → 分隔线 → 底部宽「立即对话」按钮 + 独立方形「...」菜单按钮（原贴在标题右上角的小点点移到这里）。

AC-7：分身设置了简介/标签后，卡片按「头像+标题 / 简介 / 标签 / 分隔线 / 宽按钮+菜单方块」的顺序展示；未设置简介/标签时对应区块不渲染，卡片退化为与旧版结构一致（仅头像形状与底部布局变化）。

## 7. 涉及文件清单

- `desktop/src/components/gallery/AvatarGalleryView.tsx`
- `desktop/src/components/AvatarCreateDialog.tsx`
- `desktop/src/hooks/usePaneNavigation.ts`
- `desktop/src/components/ChatPane.tsx`
- `agenticx/runtime/meta_tools.py`
- `desktop/src/store.ts`
- `desktop/src/global.d.ts`
- `desktop/src/utils/splash-preload-core.ts`
- `desktop/src/components/AvatarSidebar.tsx`
- `desktop/electron/preload.ts`
- `desktop/electron/main.ts`
- `agenticx/studio/server.py`（`create_avatar` 端点）
