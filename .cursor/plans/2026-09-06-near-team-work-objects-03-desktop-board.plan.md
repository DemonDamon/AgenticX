# 子计划 03：Near 群工作区事项板

Planned-with: Cursor Grok 4.6
Suggested-Impl-Model: Cursor Grok 4.6
Parent-Plan: `.cursor/plans/2026-09-06-near-ai-native-team-work-objects.plan.md`
Plan-Id: 2026-09-06-near-team-work-objects-03-desktop-board

> **For implementer:** 01 的 REST 必须已存在。02 建议已合入（事项才会被模型改状态），但 03 可以只靠 REST 自测闭环。只改本文件列出的 Desktop 路径。禁止视觉重塑、禁止新 Tab、禁止改聊天气泡、禁止改 `electron/main.ts`。不要 commit，除非用户明确要求。

**Goal:** 群窗格工作区摘要里出现「事项」区块：列出状态、负责人、验收/暂停/恢复；点分身负责人打开该分身窗格。会话「待办」保持不动。

**Architecture:** 渲染进程用已有 `__AGX_URL__` + `store.apiToken` 打 `/api/groups/{id}/work-items*`（与 `ChatPane` 里其它 Studio fetch 相同）。UI 复用 `WorkPanel` 的 `Section` / `EmptyBlock` / 主题 token。

**Tech Stack:** React、Zustand、vitest、现有 WorkPanel。

---

## In scope

- `SummarySectionId` 增加 `workitems`
- 群窗格摘要在「待办」和「任务产物」**之间**插入「事项」
- 列表 + 行内创建（标题 + 负责人）+ 验收/暂停/恢复
- 点 avatar 负责人 → `addPane`
- 5s 轮询（仅 `isGroupPane && summaryTabOpen`）
- 409 时重新 GET 再提示，不丢列表

## Out of scope

- 改气泡、`group_progress` 样式、成员列表
- 替换 `SessionTodoList`
- 新 IPC / `preload.ts` / `main.ts`
- 新主题色、新字体、重做 WorkPanel 信息架构
- 跨群交接、多真人评审
- `enterprise/`
- 把暂停同时打到 TaskLock（不要调用 `sendGroupTeamAction`）

---

## 现状锚点

| 落点 | 路径 | 说明 |
|---|---|---|
| Section 类型 | `desktop/src/components/work-panel/summary-sections.ts` L7–16 | 现 6 个 id |
| 单测 | `desktop/src/components/work-panel/summary-sections.test.ts` | 改 flags 时必须带上新键 |
| WorkPanel 初始折叠 | `WorkPanel.tsx` L785–792 | `useState<Record<SummarySectionId, boolean>>` |
| 待办 Section | `WorkPanel.tsx` L2081–2097 | 03 插在它后面、产物 Section 前 |
| 产物 Section | `WorkPanel.tsx` L2099 | 不要改它的 props |
| apiToken | `desktop/src/store.ts` L523 / L1131 | `useAppStore((s) => s.apiToken)` |
| addPane | `desktop/src/store.ts` L692 / L1713 | `(avatarId, avatarName, sessionId) => paneId` |
| Studio fetch 先例 | `desktop/src/components/ChatPane.tsx` L839、L8983 | `__AGX_URL__` + `x-agx-desktop-token` |
| 分身列表 | `WorkPanel` 已有 `avatarList` / `groupAvatarIds` / `metaLeaderLabel` | 创建表单用 |

---

## FR-1：fetch helper（无 UI）

**Files:**

- Create: `desktop/src/utils/work-items.ts`
- Create: `desktop/src/utils/work-items.test.ts`

```typescript
export type WorkItemStatus =
  | "open"
  | "in_progress"
  | "submitted"
  | "accepted"
  | "paused"
  | "cancelled";

export type WorkItem = {
  id: string;
  group_id: string;
  title: string;
  status: WorkItemStatus;
  owner_kind: "human" | "avatar" | "meta";
  owner_id: string;
  definition_of_done: string;
  artifact_paths: string[];
  blocked_by: string[];
  version: number;
};

export function studioBaseUrl(): string {
  return (window as unknown as { __AGX_URL__?: string }).__AGX_URL__ ?? "http://localhost:19080";
}

export function workItemStatusLabel(status: WorkItemStatus): string {
  const map: Record<WorkItemStatus, string> = {
    open: "待开始",
    in_progress: "进行中",
    submitted: "待验收",
    accepted: "已验收",
    paused: "已暂停",
    cancelled: "已取消",
  };
  return map[status];
}

export async function fetchWorkItems(groupId: string, apiToken: string): Promise<WorkItem[]> {
  const resp = await fetch(`${studioBaseUrl()}/api/groups/${encodeURIComponent(groupId)}/work-items`, {
    headers: { "x-agx-desktop-token": apiToken },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = (await resp.json()) as { items?: WorkItem[] };
  return Array.isArray(data.items) ? data.items : [];
}

export async function createWorkItem(
  groupId: string,
  apiToken: string,
  body: { title: string; owner_kind: WorkItem["owner_kind"]; owner_id: string },
): Promise<WorkItem> { /* POST /work-items */ }

export async function postWorkItemAction(
  groupId: string,
  itemId: string,
  apiToken: string,
  action: "accept" | "pause" | "resume",
  expected_version: number,
): Promise<WorkItem> {
  const resp = await fetch(
    `${studioBaseUrl()}/api/groups/${encodeURIComponent(groupId)}/work-items/${encodeURIComponent(itemId)}/${action}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agx-desktop-token": apiToken,
      },
      body: JSON.stringify({ expected_version }),
    },
  );
  if (resp.status === 409) {
    const err = new Error("version conflict");
    (err as Error & { code?: string }).code = "conflict";
    throw err;
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = (await resp.json()) as { item?: WorkItem };
  if (!data.item) throw new Error("missing item");
  return data.item;
}
```

**AC-1：** `work-items.test.ts`  
`workItemStatusLabel("submitted") === "待验收"`。  
可用 `vi.stubGlobal("fetch", ...)` 测 `postWorkItemAction` 在 409 时 `error.code === "conflict"`。

---

## FR-2：summary section 类型

**Files:**

- Modify: `desktop/src/components/work-panel/summary-sections.ts`
- Modify: `desktop/src/components/work-panel/summary-sections.test.ts`
- Modify: `WorkPanel.tsx` 里所有 `Record<SummarySectionId, boolean>` 字面量

### Before

```typescript
export type SummarySectionId = "todo" | "artifacts" | "changes" | "spawns" | "refs" | "members";
```

### After

```typescript
export type SummarySectionId =
  | "todo"
  | "workitems"
  | "artifacts"
  | "changes"
  | "spawns"
  | "refs"
  | "members";
```

`COLLAPSED_SUMMARY_SECTIONS` 与 `contentDrivenOpenSections` 都加 `workitems: false` / `flags.workitems`。

`WorkPanel.tsx` L785–792 初始 state、L963 附近 `contentDrivenOpenSections({...})` 补 `workitems: isGroupPane && workItems.length > 0`。

现有 vitest 里写死 6 个 key 的对象必须加上 `workitems`，否则类型红。

**AC-2：** `summary-sections.test.ts` 全绿；`exclusiveOpenSections("workitems")` 仅该项为 true。

---

## FR-3：`GroupWorkItemList` + 接入 WorkPanel

**Files:**

- Create: `desktop/src/components/work-panel/GroupWorkItemList.tsx`
- Create: `desktop/src/components/work-panel/GroupWorkItemList.test.tsx`
- Modify: `desktop/src/components/work-panel/WorkPanel.tsx`（import + 一块 Section + 少量 state/effect）

### 视觉约束（违反即越界）

- 不要新颜色：状态用 `text-text-muted` / `text-text-strong`；进行中可用已有 `text-[rgb(var(--theme-color-rgb,59,130,246))]`
- 字号：标题 `text-[12px]`，元信息 `text-[11px] text-text-faint`
- 行：`flex items-start gap-2 rounded px-1 py-1`（对齐 `SessionTodoList`）
- **验收**按钮：`className` 必须含主题主按钮变量，例如  
  `bg-[var(--ui-btn-primary-bg)] text-[var(--ui-btn-primary-fg,#fff)] hover:bg-[var(--ui-btn-primary-bg-hover,var(--ui-btn-primary-bg))]`  
  不要写死 cyan
- 暂停/恢复：`text-[11px] text-text-muted hover:text-text-strong` 文字按钮，不要做成大红销毁按钮
- 空态用现成 `EmptyBlock`（`WorkPanel.tsx` 已有，可把 EmptyBlock 留在文件内；列表组件自己用同样结构的简单空文案也可以，但不要引入新插画）

### 组件 props

```typescript
type Props = {
  groupId: string;
  items: WorkItem[];
  avatars: Avatar[];
  metaLeaderLabel: string;
  errorText?: string;
  onAccept: (item: WorkItem) => void;
  onPause: (item: WorkItem) => void;
  onResume: (item: WorkItem) => void;
  onOpenOwner: (item: WorkItem) => void;
  onCreate: (input: { title: string; owner_kind: WorkItem["owner_kind"]; owner_id: string }) => void;
};
```

创建区：一行 `input`（placeholder「事项标题」）+ `select`（选项：`用户` / `Near` / 每个群成员名）+ 「创建」。选项文案用 `metaLeaderLabel`（应为 Near），不要写 Machi。  
`select` 右侧箭头与边框留内边距（原生 select，不要新组件库）。

按钮显隐：

| status | 按钮 |
|---|---|
| submitted | 验收、暂停 |
| open / in_progress | 仅暂停 |
| paused | 仅恢复 |
| accepted / cancelled | 无动作按钮 |

负责人是 `avatar` 或 `meta` 时，名字可点击（`button`），调用 `onOpenOwner`。human 不可点击。

### WorkPanel 接入

在待办 `</Section>` 之后、任务产物 `<Section id="artifacts"` 之前插入：

```tsx
            {isGroupPane && groupId ? (
              <Section
                id="workitems"
                title="事项"
                count={workItems.length}
                open={openSections.workitems}
                onToggle={toggleSection}
              >
                <GroupWorkItemList
                  groupId={groupId}
                  items={workItems}
                  avatars={avatarList}
                  metaLeaderLabel={metaLeaderLabel}
                  errorText={workItemError}
                  onAccept={(item) => void runWorkItemAction(item, "accept")}
                  onPause={(item) => void runWorkItemAction(item, "pause")}
                  onResume={(item) => void runWorkItemAction(item, "resume")}
                  onOpenOwner={openWorkItemOwner}
                  onCreate={(input) => void runCreateWorkItem(input)}
                />
              </Section>
            ) : null}
```

数据逻辑放 `WorkPanel` 内（不要新全局 store 字段，除非 vitest 需要；局部 `useState<WorkItem[]>` 即可）：

```typescript
  const apiToken = useAppStore((s) => s.apiToken);
  const addPane = useAppStore((s) => s.addPane);
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [workItemError, setWorkItemError] = useState("");

  const reloadWorkItems = useCallback(async () => {
    if (!groupId) return;
    try {
      const rows = await fetchWorkItems(groupId, apiToken);
      setWorkItems(rows);
      setWorkItemError("");
    } catch (e) {
      setWorkItemError(e instanceof Error ? e.message : "事项加载失败");
    }
  }, [groupId, apiToken]);

  useEffect(() => {
    if (!isGroupPane || !summaryTabOpen) return;
    void reloadWorkItems();
    const t = window.setInterval(() => void reloadWorkItems(), 5000);
    return () => window.clearInterval(t);
  }, [isGroupPane, summaryTabOpen, reloadWorkItems]);
```

`runWorkItemAction`：先 POST；若 `code==="conflict"`，`await reloadWorkItems()` 后把 `workItemError` 设为「事项已变化，请再试一次」。

`openWorkItemOwner`：

```typescript
  const panes = useAppStore((s) => s.panes);
  // meta: avatarId 为空或 __meta__ 的现有窗格优先，否则 addPane(null, metaLeaderLabel, "")
  // avatar: 现有 pane.avatarId === item.owner_id 优先，否则 addPane(item.owner_id, name, "")
```

`name` 从 `avatarList` 找，找不到用 `owner_id`。

非群窗格 **不得** 请求 work-items API。

**AC-3：** `GroupWorkItemList.test.tsx`（vitest + 现有测试惯例，可用 `@testing-library/react` 若项目已有；没有就测纯函数抽离：`visibleActions(status)`）

必须有：

```typescript
export function visibleWorkItemActions(status: WorkItemStatus): Array<"accept" | "pause" | "resume"> {
  if (status === "submitted") return ["accept", "pause"];
  if (status === "paused") return ["resume"];
  if (status === "open" || status === "in_progress") return ["pause"];
  return [];
}
```

把该函数放在 `GroupWorkItemList.tsx` 并导出，列表按它渲染按钮。单测覆盖四行。

**AC-4：** 手动/浏览器：打开群窗格 → 工作区摘要 → 看到「事项」→ 创建一条标题「方案第一节」负责人为某分身 → 列表出现「待开始」→ 用 curl 把该 item `mark_in_progress`+`submit`（或 02 已合入时让模型 submit）→ UI 轮询后出现「验收」→ 点验收 → 「已验收」。  
若不能开 Desktop，用 vitest + 对 `fetchWorkItems` 的 mock 证明 `WorkPanel` 在 `groupId` 有值时会调用 GET（可在 helper 测，不必硬测整个 WorkPanel）。

浏览器工具可用时：按用户规则走一遍主路径。不可用时在回复里写明未做浏览器验证。

---

## 回归

```bash
cd /Users/damon/myWork/AgenticX/desktop
npx vitest run src/components/work-panel/summary-sections.test.ts src/components/work-panel/GroupWorkItemList.test.tsx src/utils/work-items.test.ts
```

Expected: PASS。

不要跑与本计划无关的 desktop e2e。不要改 `ChatPane.tsx` 除非 TypeScript 因 `SummarySectionId` 被迫改（不应波及）。

---

## AC 汇总

| ID | 断言 |
|---|---|
| AC-1 | helper + 409 code |
| AC-2 | section id `workitems` 纳入折叠逻辑 |
| AC-3 | 按钮显隐纯函数 |
| AC-4 | 群窗格可创建/验收；单聊无事项块 |
| AC-5 | 点分身负责人会 `addPane` 或聚焦已有窗格 |
| AC-6 | 「待办」区块仍在且语义不变 |
| AC-7 | 无 `electron/main.ts` / preload diff |

---

## 实施完成定义

diff 应大致限于：

- `desktop/src/utils/work-items.ts` + test
- `desktop/src/components/work-panel/GroupWorkItemList.tsx` + test
- `desktop/src/components/work-panel/summary-sections.ts` + test
- `desktop/src/components/work-panel/WorkPanel.tsx`（状态、effect、一块 Section）

禁止改群聊路由、禁止改气泡、禁止新增编排设置。
