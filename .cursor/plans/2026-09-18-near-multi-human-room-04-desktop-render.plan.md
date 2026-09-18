# 子计划 04：Desktop 回显对方真人名字

Planned-with: Cursor Grok 4.6
Suggested-Impl-Model: Composer 2.5
Parent-Plan: `.cursor/plans/pending/2026-09-18-near-multi-human-room-master.plan.md`
Depends-on: `2026-09-18-near-multi-human-room-02-speaker`
Plan-Id: 2026-09-18-near-multi-human-room-04-desktop-render

> **For implementer:** 使用 executing-plans，TDD。只映射字段并改 `displayName` 判定。不要 commit，除非用户明确要求。

**Goal:** 加载群历史时，非主人的用户行显示对方名字，主人行仍是「我」。

**Architecture:** 纯函数判断 peer human；`mapLoadedSessionMessage` 带上 `speakerUserId`/`speakerName`；`ImBubble` 用该函数算 `displayName`，peer 时复用现有名字行样式（右对齐）。

**Tech Stack:** TypeScript + Vitest。

## 实施前只需打开

- Create: `desktop/src/utils/peer-human-speaker.ts`
- Create: `desktop/src/utils/peer-human-speaker.test.ts`
- `desktop/src/store.ts` `Message` 类型（约 L269–L280）
- `desktop/src/utils/session-message-map.ts`（`LoadedSessionMessage` L269+，`mapLoadedSessionMessage` L327+）
- `desktop/src/utils/session-message-map.test.ts`（文末追加 case）
- `desktop/src/components/messages/ImBubble.tsx` **只改** L256–L258 的 `displayName`，以及 L715–L718 旁增加 peer 名字行
- `desktop/src/components/messages/ImBubble.test.tsx`（已有，追加一条）
- `desktop/src/global.d.ts` `GroupItem`（约 L237–L242）可选加 `human_members?`，**仅类型，不改编辑器 UI**

## 禁止打开 / 禁止改

- `desktop/src/components/ChatPane.tsx` 全文（发送路径本波不改；主人省略 `speaker_user_id`）
- `desktop/electron/`
- `enterprise/`
- `agenticx/runtime/group_router.py`
- 气泡颜色、头像、主题 token、三态主题重构

## In scope

- `Message.speakerUserId` / `Message.speakerName` 可选。
- 历史映射读 `sender_id` / `sender_name`。
- peer human 显示 `speakerName`；`sender_id` 缺省或 `"user"` 仍走「我」。

## Out of scope

- 群编辑器邀请人、已读点、成员列表大改。
- 用户气泡改到左侧（保持右侧，只加名字）。

---

## 根因

- `mapLoadedSessionMessage` 不读 `sender_id`。
- `ImBubble` L258：`isUser ? (userName || t("actions.me"))` —— 所有用户行都是「我」。
- `showSenderIdentity` 只给助手（L271）。

---

## FR-04-1：纯函数

**Files:**

- Create: `desktop/src/utils/peer-human-speaker.ts`
- Test: `desktop/src/utils/peer-human-speaker.test.ts`

```ts
export function isPeerHumanSpeakerId(senderId: string | undefined | null): boolean {
  const id = String(senderId ?? "").trim();
  return id.startsWith("human:");
}

export function resolveUserBubbleName(args: {
  speakerUserId?: string;
  speakerName?: string;
  fallbackMe: string;
}): string {
  if (isPeerHumanSpeakerId(args.speakerUserId)) {
    const name = String(args.speakerName ?? "").trim();
    if (name) return name;
  }
  return args.fallbackMe;
}
```

**AC:**

- `undefined` / `""` / `"user"` → 不是 peer
- `"human:feishu:ou_1"` → peer；有 `speakerName` 用它，空名字回落 `fallbackMe`

---

## FR-04-2：类型 + 历史映射

**Files:**

- Modify: `desktop/src/store.ts` `Message` 在 `agentId?` 旁：

```ts
  /** Group-room human speaker. Absent/"user" = desktop owner. */
  speakerUserId?: string;
  speakerName?: string;
```

- Modify: `LoadedSessionMessage` 增加 `sender_id?: string; sender_name?: string;`
- `mapLoadedSessionMessage` 在构造 `mapped` 时：

```ts
    speakerUserId: item.sender_id != null ? String(item.sender_id).trim() || undefined : undefined,
    speakerName: item.sender_name != null ? String(item.sender_name).trim() || undefined : undefined,
```

用户行的 `agentId` 保持现有默认（今天 user 行可能是 `"user"` 或缺失后变 `"meta"`——**不要**为修 peer 去改 `agentId` 默认，以免 1:1 历史回归）。只加两个新字段。

**AC（`session-message-map.test.ts`）：**

```ts
  it("maps group peer human sender onto Message", () => {
    const mapped = mapLoadedSessionMessage(
      {
        role: "user",
        content: "进度如何",
        sender_id: "human:feishu:ou_1",
        sender_name: "甲",
      },
      "sess-g",
      0,
    );
    expect(mapped.role).toBe("user");
    expect(mapped.speakerUserId).toBe("human:feishu:ou_1");
    expect(mapped.speakerName).toBe("甲");
  });

  it("leaves owner user rows without peer speaker id", () => {
    const mapped = mapLoadedSessionMessage(
      { role: "user", content: "hello", sender_id: "user", sender_name: "我" },
      "sess-1",
      1,
    );
    expect(mapped.speakerUserId).toBe("user");
    expect(isPeerHumanSpeakerId(mapped.speakerUserId)).toBe(false);
  });
```

---

## FR-04-3：ImBubble 名字

**Files:**

- Modify: `ImBubble.tsx` L258 **替换为**：

```tsx
  const fallbackMe = userName || t("actions.me");
  const displayName = isUser
    ? resolveUserBubbleName({
        speakerUserId: message.speakerUserId,
        speakerName: message.speakerName,
        fallbackMe,
      })
    : (assistantName || "AI");
  const isPeerHuman = isUser && isPeerHumanSpeakerId(message.speakerUserId);
```

文件顶部增加 import（与其它 `@/utils` import 放一起）：

```ts
import { isPeerHumanSpeakerId, resolveUserBubbleName } from "@/utils/peer-human-speaker";
```

在 L715–L718 的 `isGroupAssistant` 名字行**旁边**加（不要改助手分支）：

```tsx
        {isPeerHuman ? (
          <div className="mb-0.5 max-w-full truncate text-[12px] font-medium leading-4 text-text-faint">
            {displayName}
          </div>
        ) : null}
```

不要给用户加左侧头像（避免改布局）。不要动 `isGroupAssistant` 条件。

**AC（`ImBubble.test.tsx`）：** 用现有 render helper 渲染一条 `role:"user"` + `speakerUserId:"human:feishu:ou_1"` + `speakerName:"甲"`，断言文档中有「甲」、没有把「甲」当成助手。再渲染无 speaker 的用户行，断言仍是「我」或 `actions.me` 的译文。

`GroupItem` 可加：

```ts
  human_members?: Array<{
    id: string;
    platform: string;
    external_id: string;
    display_name: string;
    joined_at?: string;
  }>;
```

**不要**改 `GroupEditorInline.tsx` / `AvatarSidebar.tsx`。

---

## 验证

```bash
cd desktop && npx vitest run src/utils/peer-human-speaker.test.ts src/utils/session-message-map.test.ts src/components/messages/ImBubble.test.tsx
```

## Composer 2.5 停止条件

- 打开 `ChatPane.tsx` 立刻停手。
- 不要把用户气泡改到左边或换色。
- 不要在 live SSE 路径再写一套映射；群内 IM 发言若走 `/api/session/messages` 重载即可。若发现 live 乐观插入的用户行没有 `speakerUserId`，本计划仍不改 ChatPane——留给后续，并在回复里写明。
