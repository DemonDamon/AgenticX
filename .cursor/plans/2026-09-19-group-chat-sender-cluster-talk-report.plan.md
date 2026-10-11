# 群聊同人连发 + 长报告拆卡

Planned-with: Cursor Grok 4.6
Suggested-Impl-Model: Cursor Grok 4.6

> **For implementer:** 只改本 plan 列出的路径。不要装 `@base-ui` / `cva`，不要替换 `ImBubble` 为外部 Conversation 组件，不要改 `agenticx/studio/server.py`，不要改 Meta 单聊 ReAct 通栏，不要改 `group_router.py` 提示词。不要 commit，除非用户明确要求。

**Goal:** 群聊数字分身按「是谁」连发（同人才收角/藏头像名），长报告从气泡拆到独立说明卡。

**Architecture:** 纯函数算出 sender key 与是否续麦，ChatPane 写到行属性并传给 `ImBubble`。长文在渲染期剥出短口语，余下进折叠卡；不改落盘 `message.content`。

**Tech Stack:** React、Vitest、现有 IM token / `CitationMarkdownBody`。

---

## 规划模型建议

| 子任务 | 推荐模型 | 理由 |
|---|---|---|
| FR-1 连发 key / 行标记 | Composer 2.5 | 纯函数 + 属性接线 |
| FR-2 长报告剥出口语 | Cursor Grok 4.6 | 阈值与中文断句要稳 |
| FR-3 ImBubble / CSS | Composer 2.5 | 照现有胶囊改 |

Suggested-Impl-Model: Cursor Grok 4.6

---

## In scope

- 群聊（`pane.avatarId` 以 `group:` 开头）助手/用户气泡按发送者连发
- 同人续麦：藏头像与名字、留 `h-7 w-7` 占位、收近角、收紧间距
- 换人或中间插入 tool/系统行：打断连发
- 群聊已完成长回复：气泡只留短口语，余下进「完整说明」卡
- 流式中不剥文；复制/引用仍用完整 `message.content`

## Out of scope / no-scope-creep

- 不搬外部 Conversation variant / Reactions / 点开时间
- 不分身气泡改成 tinted theme-color（保持中性灰）
- 不改 Meta 单聊、`ChatView` Lite、`group_router.py` 提示词
- 不把长文写成工作区文件（已有附件仍走 `TurnArtifactCard`）
- 不改 `server.py`

---

## 根因与证据链

1. 连发现在只看左右。`desktop/src/index.css` 约 1076 行：

```css
[data-im-align="start"] + [data-im-align="start"] .agx-im-group-bubble {
  border-top-left-radius: 8px;
}
```

`ChatPane.tsx` 约 8462 行只写 `data-im-align`。法务后财务两条都是 `start`，会被收成一串。`ImBubble.tsx` 759–783 行每条都画头像和名字。

2. 长报告：`group_router.py` 已写「默认短聊」，模型仍常吐 `##` / 大表。气泡 `width: fit-content` 会被长 Markdown 撑满。需要渲染期拆卡，不改历史 JSON。

---

## FR-1：按发送者连发

**落点**

1. Create: `desktop/src/utils/group-sender-cluster.ts`
2. Create: `desktop/src/utils/group-sender-cluster.test.ts`
3. Modify: `desktop/src/components/ChatPane.tsx`（`groupedVisibleMessages` 后、`renderGroupedRow` 包装 div、群流式 `ImBubble`、`MessageThread` className）
4. Modify: `desktop/src/components/messages/MessageRenderer.tsx`（透传 `clusterContinue`）
5. Modify: `desktop/src/components/messages/ImBubble.tsx`（`clusterContinue` 藏身份）
6. Modify: `desktop/src/index.css`（用 `data-im-cluster="continue"` 替代 start+start）
7. Modify: `desktop/src/components/messages/ImBubble.test.tsx`
8. Modify: `desktop/src/components/messages/im-bubble-tokens.test.ts`（断言选择器）

**key 规则（写全，禁止推断）**

- `systemNotice` → `null`（打断）
- `role === "user"` → `user:${speakerUserId}`，否则 `user:self`
- `role === "assistant"` → `assistant:${senderAvatarId || agentId}`，否则 `assistant:name:${avatarName}`（`分身` 不算）
- 其它 role / `tool_group` 行 → 不写 key，并清空 prev
- `clusterContinue` = 当前 key 非空且等于**上一条可见行**的 key

**ChatPane before/after**

```tsx
// before
data-im-align={message.role === "user" ? "end" : message.role === "assistant" ? "start" : undefined}

// after
data-im-align={...同上...}
data-im-sender={cluster?.senderKey || undefined}
data-im-cluster={cluster?.clusterContinue ? "continue" : undefined}
```

`MessageThread` 群聊 className 加 `agx-group-thread`。

群流式气泡（约 8949–7979 行）：若最后一条历史行的 key 与当前 `agentId` 相同，且当前没有可见 `GroupExpertActivityCard`（无 stream body 的那些），则 `clusterContinue`。用 div 包一层写同样的 data 属性。

**ImBubble before/after**

- `clusterContinue` 时：不渲染 `ChatImAvatar` / 专家名 / 对方人名；左侧留 `h-7 w-7` 占位（无 `mt-[18px]`）
- 首条不变

**CSS**

删除（或不再作为群聊生效）：

```css
[data-im-align="start"] + [data-im-align="start"] .agx-im-group-bubble
```

新增：

```css
.agx-group-thread [data-im-align="end"] + [data-im-align="end"] .agx-im-user-bubble {
  border-top-right-radius: 18px;
}
.agx-group-thread [data-im-cluster="continue"] .agx-im-group-bubble {
  border-top-left-radius: 8px;
}
.agx-group-thread [data-im-cluster="continue"] .agx-im-user-bubble {
  border-top-right-radius: 8px;
}
.agx-group-thread [data-im-cluster="continue"] {
  margin-top: -0.25rem;
}
```

1:1 的 `[data-im-align="end"] + [data-im-align="end"] .agx-im-user-bubble` **保留**。

**AC**

- `clusterFlagsForGroupRows`：A→A continue；A→B 不 continue；A→tool→A 不 continue
- 用户 `user:self` 连发 continue；`human:x` 与 `user:self` 不 continue
- `ImBubble` `clusterContinue`：无「架构师」文字、无 `agx-im-avatar`、有占位
- 短消息仍有头像和名字（现有 identity 测试不回退）

---

## FR-2：长报告拆到说明卡

**落点**

1. Create: `desktop/src/utils/group-talk-report.ts`
2. Create: `desktop/src/utils/group-talk-report.test.ts`
3. Create: `desktop/src/components/messages/GroupTalkReportCard.tsx`
4. Create: `desktop/src/components/messages/GroupTalkReportCard.test.tsx`
5. Modify: `desktop/src/components/messages/ImBubble.tsx`（群助手、非流式、无图片块时剥文）
6. Modify: `desktop/locales/zh/chat.json`、`desktop/locales/en/chat.json`

**阈值（写全）**

`looksLikeGroupReport(text)` 为 true 当且仅当 trim 后：

- 长度 ≥ 480，且
- 满足任一：`/^#{1,3}\s+/m` 且长度 ≥ 560；或 `|...|` 表格行 ≥ 4；或长度 ≥ 900

否则整段留在气泡。

`extractTalkLead(text, 480)`：

- 若第一个 `#{1,3}` 标题前有 ≥ 20 字，取标题前文本再按 480 截
- 否则截到 480，优先在 `。！？\n` 或 `". "` 处断开（断点 ≥ 80）

剥出后若余下 < 160 字，或 lead 几乎等于全文（差 < 40），不拆。

流式（`__stream__` / `__group_stream__:` / `typing-`）不拆。`hasImageBlock` 时不拆。

卡片默认折叠，`data-slot="group-talk-report"`，展开后用 `CitationMarkdownBody` 渲染**余下正文**（不含已在气泡的 lead）。放在气泡外、`afterBody` 前。

文案：

- zh: `groupReport.title` = 完整说明；`expand` = 展开；`collapse` = 收起
- en: Full write-up / Expand / Collapse

**AC**

- 短句「结论：用方案 A。」→ `report === null`
- 带 `##` 的 600+ 字 → talk 为标题前短句，report 含 `##`
- 流式群气泡不出现 `group-talk-report`
- 现有 `not.toContain("展开")` 短消息测试仍过（短消息不渲染卡）

---

## 验证

```bash
cd desktop && npx vitest run \
  src/utils/group-sender-cluster.test.ts \
  src/utils/group-talk-report.test.ts \
  src/components/messages/GroupTalkReportCard.test.tsx \
  src/components/messages/ImBubble.test.tsx \
  src/components/messages/Conversation.test.tsx \
  src/components/messages/im-bubble-tokens.test.ts
```
