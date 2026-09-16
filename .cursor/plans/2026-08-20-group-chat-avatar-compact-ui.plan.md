# 群聊数字专家头像与紧凑气泡 UI

Planned-with: GPT-5.6 Sol
Suggested-Impl-Model: Cursor Grok 4.6（共享 ImBubble / MessageRenderer 视觉分支，需防止污染 Meta 单聊）
Status: implemented
Plan-Id: 2026-08-20-group-chat-avatar-compact-ui
Parent-Plan: 2026-08-20-group-chat-control-room-experience

> **For implementer:** 所有新视觉必须由 `showSenderIdentity`（群聊）控制。不要改 Meta 单聊、Lite ChatView、侧栏、顶栏、输入区。不要移除常驻消息操作按钮。P3 已负责运行中的活动卡，本 plan 负责最终消息和持久化交互卡的专家身份。不要 commit，除非用户明确要求。

**Goal:** 群聊中每个数字专家都以真实头像 + 灰字名 + 中性灰短气泡出现；去掉“Near 展开/折叠”专家胶囊和通栏文档感；确认、澄清、失败等持久化卡片也能认出是谁发起的。

**Architecture:** 复用 `ChatPane.resolveGroupChatSender` 已解析好的 name / avatarUrl / avatarId。`ImBubble` 恢复头像参数，群聊分支使用独立紧凑外壳。`MessageRenderer` 给 group tool / intervention card 增加同一身份 rail。现有 Meta frameless assistant 分支完全保留。

**Tech Stack:** React、Tailwind、theme tokens、vitest。

---

## 视觉规格

- 专家头像：28×28，圆形
- 图片优先：`message.avatarUrl` → 成员配置 `avatarUrl` → Meta 全局头像 → 稳定颜色 + 首字
- 专家名：气泡上方，12px，`text-text-faint`，不带底色和描边
- 最终气泡：`--surface-card-strong`，无边框，`rounded-2xl`
- 气泡宽度：内容自适应；最大 `min(100%, 760px)`，不要固定 560px 导致长答案过度换行
- 头像列与内容列间距：8px
- 用户气泡：保持靠右、无专家头像
- 操作行：常驻；紧贴气泡下方；不改按钮集合
- 群聊不显示每条消息的模型 badge；当前模型已在窗格顶部可见

---

## In scope

- `ChatImAvatar` 增加 28px `sm` 尺寸和稳定 class
- 群助手最终消息头像轨
- 灰字名
- 删除专家折叠胶囊
- 中性灰实心自适应气泡
- 群消息隐藏 inline model badge
- 操作行收紧
- group confirm / clarification / tool failure 持久化卡片身份 rail
- light / dim / dark
- vitest

## Out of scope

- 不改回复内容、路由、工作区
- 不改运行活动卡状态机（P3）
- 不改群顶栏和群成员列表
- 不改操作按钮为 hover-only
- 不做新的头像上传入口
- 不删 `expertLabelChipStyle` 工具函数；停止在 ImBubble 使用即可

---

## FR-1：`ChatImAvatar` 支持紧凑尺寸

**Files:**

- Modify: `desktop/src/components/messages/ImBubble.tsx:ChatImAvatar`
- Test: `desktop/src/components/messages/ImBubble.test.tsx`

签名增加：

```ts
size?: "sm" | "md";
```

映射：

```ts
const dim =
  size === "sm"
    ? "h-7 w-7 text-[11px]"
    : "h-8 w-8 text-xs";
```

`img` 与 fallback `div` 根节点都必须包含 `agx-im-avatar`，便于一致 CSS 和测试。

图片：

```tsx
<img
  src={imageUrl}
  alt={label}
  className={`agx-im-avatar ${dim} shrink-0 object-cover ${rounded}`}
/>
```

群聊专家传 `variant="circle"`；不要复用群入口头像的 rounded-square。

**AC:**

- image URL 渲染 img
- 无 image URL 渲染首字和 avatarId 稳定色
- sm = 28px
- 默认 md 保持 32px

---

## FR-2：最终助手消息恢复专家头像

**Files:** Modify `desktop/src/components/messages/ImBubble.tsx`

现状：

```ts
void assistantAvatarUrl;
const showExpertLabel = showSenderIdentity && !isUser && !compactAssistant;
```

改为：

```ts
const isGroupAssistant =
  showSenderIdentity && !isUser && !compactAssistant;
```

不再 `void assistantAvatarUrl`。

群聊助手结构：

```tsx
<div className="flex min-w-0 w-full items-start gap-2 px-3">
  <div className="mt-[18px] shrink-0">
    <ChatImAvatar
      label={displayName}
      imageUrl={assistantAvatarUrl}
      avatarId={senderAvatarId}
      variant="circle"
      size="sm"
    />
  </div>
  <div className="flex min-w-0 flex-1 flex-col items-start">
    <div className="mb-0.5 max-w-full truncate text-[12px] font-medium leading-4 text-text-faint">
      {displayName}
    </div>
    {/* group bubble + actions */}
  </div>
</div>
```

`mt-[18px]` 使头像对齐气泡首行，而不是对齐名字。

Meta 单聊仍走现有根结构，不出现头像。

---

## FR-3：删除专家胶囊和折叠

**Files:** Modify `desktop/src/components/messages/ImBubble.tsx`

删除群聊分支使用的：

- `expertLabelChipStyle` import
- `expertChip`
- `expertCollapsed` state
- `canFoldExpertReply`
- chevron + 名字 + “展开/折叠”胶囊 JSX
- folded body hidden 分支

保留 Markdown 内部自己的 ReasoningBlock 折叠；本 FR 只删除“整条专家回复”的折叠。

**AC:**

- 群消息 HTML 不含“展开”“折叠”
- 正文默认可见
- ReasoningBlock 自身行为不变

---

## FR-4：实心自适应群气泡

**Files:**

- Modify: `desktop/src/components/messages/ImBubble.tsx`
- Modify: `desktop/src/index.css`

增加 token：

```css
:root {
  --chat-im-group-bg: var(--surface-card-strong);
}

.agx-im-group-bubble {
  border: none;
  box-shadow: none;
  box-sizing: border-box;
}
```

群正文容器：

```tsx
className={`agx-im-group-bubble relative min-w-0 rounded-2xl px-3.5 py-2 text-[var(--agx-chat-im-body-font-size)] ${assistantBodyLeadingClass}`}
style={{
  background: "var(--chat-im-group-bg)",
  color: "var(--chat-im-assistant-text)",
  width: "fit-content",
  maxWidth: "min(100%, 760px)",
}}
```

不要 `w-full`；不要 theme color tint；不要边框。

引用、ReasoningBlock、ReferencesCard、Markdown、附件均继续在气泡内部渲染。

---

## FR-5：操作行与消息节奏

**Files:** Modify `desktop/src/components/messages/ImBubble.tsx`

群聊：

```ts
const assistantActionStyle = isGroupAssistant
  ? { marginLeft: 0 }
  : getAssistantActionStyle({ inReActRow: compactAssistant });

const actionOnlyClass = isGroupAssistant
  ? "mb-3 mt-1.5 min-w-0 self-stretch"
  : ASSISTANT_ACTION_ICON_ONLY_CLASS;
```

按钮集合保持：

- 复制
- 引用
- 收藏
- 转发
- 重试（适用时）
- 多选
- 时间

不要修改共享 `ASSISTANT_ACTION_ICON_ONLY_CLASS`，否则会影响 Meta。

---

## FR-6：群聊不显示逐条模型 badge

**Files:** Modify `desktop/src/components/ChatPane.tsx`，`showInlineAssistantModelBadge`

现有 group pane 会保留 inline badge。改为：

```ts
const showInlineAssistantModelBadge =
  !isMachiMetaPane &&
  !isDedicatedAvatarPane &&
  !isAutomationTaskPane &&
  !isGroupPane;
```

原因：群里视觉主身份是数字专家，不是 provider/model；模型仍可从窗格顶部查看。

**AC:** group message 不含 ModelBadge；其它既有路径行为按当前条件回归。

---

## FR-7：持久化交互卡也显示专家身份

**Files:**

- Create: `desktop/src/components/messages/GroupSenderRail.tsx`
- Create: `desktop/src/components/messages/GroupSenderRail.test.tsx`
- Modify: `desktop/src/components/messages/MessageRenderer.tsx`
- Modify: `desktop/src/components/messages/im-layout.ts`

组件：

```tsx
type Props = {
  name: string;
  avatarUrl?: string;
  avatarId?: string;
  children: ReactNode;
};
```

结构与最终消息相同：

- 左侧 28px `ChatImAvatar`
- 右侧灰字名
- children 下方

仅当 `showSenderIdentity && message.role === "tool"` 且消息属于明确专家时使用：

- `InlineConfirmCard`
- `ClarificationCard`
- `ToolCallCard` 的 error / blocked 最终态

普通 `group_progress` 不包；P3 活动卡负责。

`GROUP_INLINE_CARD_SHELL_CLASS` 在 rail 内改为 `my-1 min-w-0 w-full max-w-[520px]`，不要再用全局 `ml-[44px]` 双重缩进。Meta 的 `ASSISTANT_INLINE_CARD_SHELL_CLASS` 不动。

若历史 tool row 缺 `avatarUrl`，`MessageRenderer` 使用传入的 `assistantAvatarUrl` / `senderAvatarId` fallback。

**AC:**

- 刷新后确认卡仍有专家头像和名字
- Meta confirm card 不套群身份 rail
- group progress 不重复出现两份头像

---

## FR-8：测试

**Files:**

- Modify: `desktop/src/components/messages/ImBubble.test.tsx`
- Create: `desktop/src/components/messages/GroupSenderRail.test.tsx`

核心用例：

```tsx
it("shows digital expert avatar and compact solid bubble in group chat", () => {
  const html = renderToStaticMarkup(
    <ImBubble
      message={{
        id: "g1",
        role: "assistant",
        content: "结论：建议采用方案 A。",
        avatarName: "架构师",
        avatarUrl: "https://example.test/avatar.png",
      }}
      showSenderIdentity
      senderAvatarId="architect"
      assistantName="架构师"
      assistantAvatarUrl="https://example.test/avatar.png"
    />,
  );
  expect(html).toContain("agx-im-avatar");
  expect(html).toContain("https://example.test/avatar.png");
  expect(html).toContain("agx-im-group-bubble");
  expect(html).not.toContain("展开");
  expect(html).not.toContain("折叠");
});
```

Meta 回归：

```tsx
expect(metaHtml).not.toContain("agx-im-avatar");
expect(metaHtml).not.toContain("agx-im-group-bubble");
```

---

## 验证

```bash
cd desktop && npx vitest run \
  src/components/messages/ImBubble.test.tsx \
  src/components/messages/GroupSenderRail.test.tsx \
  src/components/messages/GroupExpertActivityCard.test.tsx
```

人工：

1. 最终消息、活动卡、确认卡分别检查专家头像一致。
2. 有自定义图片用图片；无图片用稳定 fallback。
3. 三位专家连续短答时，布局紧凑且可快速分辨身份。
4. 长回复气泡不超过 760px，但不会因 560px 过窄而异常拉长。
5. 无“Near 展开/折叠”胶囊。
6. 群消息无模型 badge。
7. Meta 单聊视觉与实施前一致。
8. light / dim / dark 都可读。

