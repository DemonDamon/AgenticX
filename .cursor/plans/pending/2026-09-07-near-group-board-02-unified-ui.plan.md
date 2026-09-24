# 子计划 02：群窗格合成一栏待办（插队 UI + 拉进群）

Planned-with: Cursor Grok 4.6
Suggested-Impl-Model: Composer 2.5
Parent-Plan: `.cursor/plans/pending/2026-09-07-near-group-board-master.plan.md`
Plan-Id: 2026-09-07-near-group-board-02-unified-ui

> **For implementer:** 01 必须已合入（存在 `close` REST、`sort_key`、行内口头完成）。只改本文件列出的 Desktop + create API 插队/拉人参数。禁止实现 `todo_write` 提升、禁止自动发开工消息、禁止改 1:1 `SessionTodoList`、禁止视觉重塑、禁止改 `electron/main.ts`。不要 commit，除非用户明确要求。

**Goal:** 群摘要只剩一栏「待办」：行主文案是 `{负责人名} · {标题}`；创建可选插到某条前面；下拉含未入群分身，选中后创建时把它拉进群。

**Architecture:** 群窗格不再渲染独立 `workitems` Section，把 `GroupWorkItemList` 挂进原来的「待办」Section。`create_item` / POST create 增加 `insert_before_id`、`parallel_with_id`、`ensure_member`。列表按 `sort_key` 排（01 已排序）。

**Tech Stack:** 现有 React / vitest / pytest。

---

## In scope

- 群窗格：待办 Section 渲染事项板；隐藏独立「事项」Section
- 行展示：`{ownerLabel} · {title}`，第二行只留状态 + 可选「前置未结束」+ 按钮
- 创建区：标题、负责人、插入位置（默认「列表末尾」）、创建
- 负责人下拉：用户 / Near / 本群成员 / 未入群分身（后缀「·拉进群」）
- create API：`insert_before_id` / `parallel_with_id` / `ensure_member`

## Out of scope

- `todo_write` → 事项同步（03）
- 前置结束后自动 `sendChat`（03）
- 重绑 `blocked_by` 的完整并行图（03 做；本计划插入只改 `sort_key`，`blocked_by` 先空，03 补）
- 1:1 待办
- 改 `summary-sections.ts` 的 id 联合（保留 `workitems` 键以免 pinned 类型炸，但群窗格不再渲染该 Section）

---

## 现状锚点

| 符号 | 路径 | 约行 |
|---|---|---|
| 待办 Section | `desktop/src/components/work-panel/WorkPanel.tsx` L2191–2207 | 群窗格有 todo 时仍渲染 `SessionTodoList` |
| 事项 Section | 同文件 L2209–2230 | 02 整段用 `null` 替换（仅 `isGroupPane`） |
| `groupAvatarIds` | 同文件 L766–769 | 创建下拉过滤用 |
| `create_item` | `agenticx/runtime/work_items.py` L140 | 加三个可选 kw |
| POST create | `agenticx/studio/server.py` `create_work_item` L6565 | 把 payload 新字段传下去 |
| `update_group` | `agenticx/avatar/group_chat.py` L128 | `ensure_member` 用 |
| 下拉 | `GroupWorkItemList.tsx` L155–167 | 现把**全量** `avatars` 列出，这是上次 400 的根因 |

---

## FR-1：create 插队与拉人（后端）

**Files:**

- Modify: `agenticx/runtime/work_items.py` `create_item`
- Modify: `agenticx/studio/server.py` `create_work_item` 函数体（精确加参数，勿碰 import）
- Test: `tests/test_work_item_store.py`、`tests/test_work_item_api.py`

`create_item` 增加：

```python
        insert_before_id: str = "",
        parallel_with_id: str = "",
        ensure_member: bool = False,
        allowed_owner_ids: set[str] | None = None,
```

（`allowed_owner_ids` 已存在。）

在校验 avatar 成员**之前**：

```python
        if ensure_member and kind == "avatar" and oid:
            from agenticx.avatar.group_chat import GroupChatRegistry
            reg = GroupChatRegistry()
            cfg = reg.get_group(gid)
            if cfg is not None and oid not in cfg.avatar_ids:
                next_ids = list(cfg.avatar_ids) + [oid]
                reg.update_group(gid, {"avatar_ids": next_ids})
            if allowed_owner_ids is not None:
                allowed_owner_ids = set(allowed_owner_ids)
                allowed_owner_ids.add(oid)
```

`sort_key`（01 已 `max+10`）改为：

```python
        before = str(insert_before_id or "").strip()
        parallel = str(parallel_with_id or "").strip()
        if parallel:
            peer = next((i for i in existing if i.id == parallel), None)
            if peer is None:
                raise WorkItemError("parallel_with_id not found", status_code=400)
            item.sort_key = peer.sort_key
        elif before:
            target = next((i for i in existing if i.id == before), None)
            if target is None:
                raise WorkItemError("insert_before_id not found", status_code=400)
            prev_keys = [i.sort_key for i in existing if i.sort_key < target.sort_key]
            lo = max(prev_keys) if prev_keys else target.sort_key - 10
            hi = target.sort_key
            item.sort_key = (lo + hi) // 2
            if item.sort_key == lo or item.sort_key == hi:
                # reindex 10,20,30... then place before target
                ordered = sorted(existing, key=lambda x: (x.sort_key, x.created_at, x.id))
                # rewrite all sort_key in doc, then set item.sort_key = target's new key - 5
```

重排算法必须写完整（不要「按需推断」）：

```python
def _reindex(doc: dict, extra: WorkItem | None, before_id: str) -> None:
    rows = [WorkItem.from_dict(x) for x in doc["items"] if isinstance(x, dict)]
    if extra is not None:
        rows.append(extra)
    rows.sort(key=lambda x: (x.sort_key, x.created_at, x.id))
    if before_id:
        ids = [r.id for r in rows]
        if extra is not None and extra.id in ids and before_id in ids:
            rows.remove(extra)
            idx = next(i for i, r in enumerate(rows) if r.id == before_id)
            rows.insert(idx, extra)
    for i, r in enumerate(rows, start=1):
        r.sort_key = i * 10
    doc["items"] = [r.to_dict() for r in rows]
```

插入时若中点碰撞，调用 `_reindex`。  
本计划 **不修改** 任何已有行的 `blocked_by`（留给 03）。

`create_work_item` handler 增加：

```python
                insert_before_id=str(payload.get("insert_before_id") or ""),
                parallel_with_id=str(payload.get("parallel_with_id") or ""),
                ensure_member=bool(payload.get("ensure_member")),
```

`ensure_member` 为 true 时，即使原先 `allowed = set(cfg.avatar_ids)` 不含该 id，也先走 store（store 会 update_group）。handler 里 **不要**在 store 之前因「不是成员」提前 400。

### AC

- `test_insert_before_sort_key`：A、B 的 key 10/20，insert C before B，C.sort_key < B.sort_key 且 > A.sort_key（或 reindex 后顺序 A,C,B）。
- `test_parallel_with_shares_sort_key`：E2 `parallel_with` E1 → 相同 `sort_key`；list 顺序稳定（再按 created_at）。
- `test_ensure_member_adds_avatar`：用 tmp groups + 真 `GroupChatRegistry` 或 monkeypatch `update_group`；owner 原不在 `avatar_ids`，create 后在。
- API：`insert_before_id` 不存在 → 400。
- `pytest tests/test_work_item_store.py tests/test_work_item_api.py -q`

---

## FR-2：群窗格只留一栏待办

**Files:**

- Modify: `desktop/src/components/work-panel/WorkPanel.tsx`
- Modify: `desktop/src/components/work-panel/GroupWorkItemList.tsx`
- Test: `desktop/src/components/work-panel/summary-sections.test.ts` **不必删** `workitems` 键
- Create: `desktop/src/utils/group-board.ts` + `group-board.test.ts`（展示名格式）

### 展示

`desktop/src/utils/group-board.ts`：

```typescript
export function boardRowTitle(ownerLabel: string, title: string): string {
  const o = ownerLabel.trim();
  const t = title.trim();
  if (!o) return t;
  return `${o} · ${t}`;
}
```

`GroupWorkItemList` 主行改为 `boardRowTitle(name, item.title)`。第二行：状态 · 前置未结束（若有）。**不要**再重复打负责人名。

`ownerLabel`：继续 human→用户、meta→`metaLeaderLabel`、avatar→`avatars.find`；找不到 id 时用 `owner_id`。

### 创建区

- 标题 input 不变
- `select` 负责人：
  - `human:` 用户
  - `meta:__meta__` `{metaLeaderLabel}`
  - `groupAvatarIds` 映射到的成员
  - 其余 `avatars`：`value=avatar:${id}`，文案 `{role?·}{name} ·拉进群`。`role` 有则 `后端·北辰 ·拉进群`，与现网成员展示一致；不要写死「后端」
- 新 `select` 插入位置：
  - `value=""` 「列表末尾」
  - `before:${id}` 「插到「{title}」前」
  - `parallel:${id}` 「与「{title}」并行」
- `onCreate` 扩展：

```typescript
{
  title: string;
  owner_kind: WorkItem["owner_kind"];
  owner_id: string;
  insert_before_id?: string;
  parallel_with_id?: string;
  ensure_member?: boolean;
}
```

`ensure_member`：当选中的 avatar **不在** `groupAvatarIds` 时为 true。

`createWorkItem` body 原样 JSON.stringify 这些字段。

`GroupWorkItemList` 增加 prop `groupAvatarIds: string[]`（WorkPanel 已有，传入）。**禁止**再把全量 avatars 当默认可选负责人而不加「拉进群」标记。

### WorkPanel 布局

在 `isGroupPane` 为 true 时：

1. 「待办」Section 的 `count` = `workItems.length`（不用 `sessionTodo?.total`）。`title` 仍是「待办」。
2. Section 内容：`GroupWorkItemList`（从下面挪上来）。若 `workItems.length===0` 且没有 sessionTodo，空态「暂无待办」。
3. 若仍有 `sessionTodo`，在列表**上方**用现有 `SessionTodoList` 缩进渲染，前面加一行 muted「本轮步骤（尚未入板）」——03 会把它提升走；02 先并排以免规划步骤消失。
4. 删除（或 `null`）原来的独立 `id="workitems"` Section。
5. `contentDrivenOpenSections` / `applyPinnedAutoExpand(..., "workitems", ...)`：群窗格改 pin/open **`todo`** 当 `workItems.length>0`。`workitems` 标志恒 false。不要删类型键。

`runCreateWorkItem` 把新字段传给 `createWorkItem`。

### AC

- `boardRowTitle("北辰", "翻译英文：全职猎人幻影旅团壁纸")` === `北辰 · 翻译英文：全职猎人幻影旅团壁纸`
- `GroupWorkItemList` 单测：下拉 option 含「·拉进群」当传入一个不在 `groupAvatarIds` 的 avatar。
- 群窗格 DOM 不再有第二个 Section 标题「事项」（可用 RTL `queryByText("事项")` 为 null；「待办」存在）。若现有测试没有挂 WorkPanel，新增 `WorkPanel.group-board.test.tsx` **只测**「群窗格不渲染事项标题」需要的最小 mock——若 mock 成本超过 40 行，改为纯测 `group-board.ts` + `GroupWorkItemList`，并在本计划手工验收写明「群窗格只有一个待办标题」。
- `cd desktop && npx vitest run src/utils/group-board.test.ts src/components/work-panel/GroupWorkItemList.test.tsx`

---

## 手工验收

1. 打开群工作区：只有「待办 N」，没有单独「事项」。
2. 进行中行是 `北辰 · 翻译英文：…`，下面一行是「进行中」。
3. 选群外分身 + 标题，创建成功（不再 HTTP 400），该分身出现在成员里。
4. 「插到「B」前」创建后，新行出现在 B 上面。
5. 1:1 窗格待办仍是圆点清单，没有负责人下拉。
