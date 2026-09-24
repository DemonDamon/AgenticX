# 子计划 03：规划提升、插队重绑、前置结束自动开工

Planned-with: Cursor Grok 4.6
Suggested-Impl-Model: gpt-5.5-codex
Parent-Plan: `.cursor/plans/pending/2026-09-07-near-group-board-master.plan.md`
Plan-Id: 2026-09-07-near-group-board-03-sequence-kickoff

> **For implementer:** 01+02 必须已合入。本计划把群会话 `todo_write` 提升为 `origin=plan` 事项、插入/并行时重绑 `blocked_by`、前置结束后由 Desktop 发一条带 @ 的群消息开工。禁止改 `server.py` import、禁止新 worker、禁止 1:1 `todo_write` 行为变化、禁止模型 accept。不要 commit，除非用户明确要求。

**Goal:** Near 写出 A、B、C 后它们出现在待办板；人在 B 前插入 E1、再并行 E2（可拉新分身）后，A 一结束（口头/文件/取消/已做完）就自动 @ E1、E2 开工，两者都结束后才轮到 B。

**Architecture:** `_tool_todo_write` 在 `session.avatar_id` 以 `group:` 开头时调用 `sync_plan_todos`。`create_item` 在 02 的 insert/parallel 上补 `rewire_blocked_by`。WorkPanel 在 close/submit 成功或 5s 轮询发现新的就绪项时，回调 `onKickoffWorkItems`，ChatPane 走现有 `sendChat`。

**Tech Stack:** 现有 group 路由 + Desktop `sendChat`。

---

## In scope

- `sync_plan_todos(group_id, todo_items)`
- 群会话 `_tool_todo_write` 成功后调用它
- `rewire_blocked_by`：insert_before / parallel_with
- `list_ready_to_start(group_id)`
- Desktop 开工去重 + 一条 `@a @b` 消息
- 提示块补一句：规划步骤来自待办板，口头完成也算结束

## Out of scope

- 改 `pick_targets` 的 @ 优先语义
- 进程内队列 / 后台 scheduler
- 闲聊自动建事项
- 改 Electron

---

## 现状锚点

| 符号 | 路径 | 约行 |
|---|---|---|
| `todo_write` | `agenticx/cli/agent_tools.py` `_tool_todo_write` L6627–6635 | update 成功后挂钩 |
| 群 session | `StudioSession.avatar_id` 形如 `group:<gid>` | 与 `_session_group_id`（`meta_tools.py` L4024）同一算法 |
| create 插队 | `work_items.py` `create_item`（02 已加 insert/parallel） | 本计划只加 rewire |
| `_run_one_target` mark | `group_router.py` L1874–1881 | 开工后仍靠它改 in_progress；不要再写一套 |
| `sendChat` | `desktop/src/components/ChatPane.tsx` L8994 | 开工只走它 |
| WorkPanel props | `WorkPanel.tsx` L580–605 | 追加 `onKickoffWorkItems?: (text: string) => void` |
| 提示块 | `work_items.py` `build_work_items_prompt_block` L454 | 加一行结案说明 |

解析 group id（两处必须相同，抽到 `work_items.py`）：

```python
def parse_group_id_from_session(session: Any) -> str:
    for attr in ("avatar_id", "bound_avatar_id"):
        aid = str(getattr(session, attr, "") or "").strip()
        if aid.startswith("group:"):
            return aid[len("group:"):].strip()
    return ""
```

不要从 `meta_tools` 反向 import `agent_tools`。

---

## FR-1：todo_write 提升为 plan 事项

**Files:**

- Modify: `agenticx/runtime/work_items.py` 文件末尾追加 `sync_plan_todos`
- Modify: `agenticx/cli/agent_tools.py` `_tool_todo_write` **只在 return 前加 8 行以内**，失败 swallow
- Test: `tests/test_work_item_runtime.py`

```python
def _norm_title(s: str) -> str:
    return " ".join(str(s or "").split()).casefold()


def sync_plan_todos(group_id: str, raw_items: list) -> list[WorkItem]:
    """Upsert origin=plan rows from todo_write. Never delete or overwrite avatar-owned items."""
    gid = str(group_id or "").strip()
    if not gid:
        return []
    store = get_work_item_store()
    wanted: list[tuple[str, str]] = []
    for row in raw_items or []:
        if not isinstance(row, dict):
            continue
        title = str(row.get("content") or "").strip()[:200]
        if not title:
            continue
        st = str(row.get("status") or "pending").strip()
        wanted.append((title, st))
    if not wanted:
        return store.list_items(gid)
    existing = store.list_items(gid)
    by_title = {_norm_title(i.title): i for i in existing if i.origin == "plan"}
    for title, st in wanted:
        key = _norm_title(title)
        cur = by_title.get(key)
        if cur is None:
            # skip if any non-plan item already has this title (user/Near assigned)
            if any(_norm_title(i.title) == key for i in existing):
                continue
            item = store.create_item(
                gid,
                title=title,
                owner_kind="meta",
                owner_id="__meta__",
            )
            # origin=plan: patch via _mutate or add origin= to create_item kwargs
            ...
        else:
            # map status, never accept
            ...
    return store.list_items(gid)
```

实施时 **必须** 给 `create_item` 增加可选 `origin: str = "manual"`，sync 传 `origin="plan"`。禁止 sync 之后再二次打开 json 手改。

状态映射（仅 `origin==plan` 的行）：

| todo status | 事项动作 |
|---|---|
| pending | 保持 open；若当前 in_progress 不要打回去 |
| in_progress | `open` → `mark_in_progress`（吞 409） |
| completed | `open`/`in_progress` → `submit(..., close_kind="verbal")`；已 submitted/accepted/cancelled 不动 |

**禁止** sync 把 `origin=manual` 或 `owner_kind=avatar` 的行改状态、改负责人、删除。

`_tool_todo_write`：

```python
        result = todo_manager.update(items)
        try:
            from agenticx.runtime.work_items import parse_group_id_from_session, sync_plan_todos
            gid = parse_group_id_from_session(session)
            if gid:
                sync_plan_todos(gid, items)
        except Exception:
            pass
        return result
```

1:1 session（无 `group:` 前缀）不得调用 sync。用 `tests/test_agent_tools.py::test_todo_write_updates_session_state` 回归：不断言 work items，但跑过不能报错。

### AC

`tests/test_work_item_runtime.py`：

- `test_sync_plan_creates_meta_items`：空板 + `[{content:A,pending},{content:B,pending}]` → 两条 `origin=plan`、`owner_kind=meta`。
- `test_sync_plan_skips_manual_same_title`：先 manual 创建「翻译英文」，再 sync 同标题 → 仍 1 条，origin 仍 manual。
- `test_sync_plan_complete_submits_verbal`：plan 项 open，sync completed → submitted + verbal。
- `test_todo_write_non_group_does_not_sync`：session.avatar_id 为空，monkeypatch 计数 sync 调用 0 次。

`pytest tests/test_work_item_runtime.py tests/test_agent_tools.py::test_todo_write_updates_session_state -q`

---

## FR-2：insert / parallel 重绑 blocked_by

**Files:**

- Modify: `agenticx/runtime/work_items.py` `create_item`（02 已有 insert/parallel）
- Test: `tests/test_work_item_store.py`

在新 item 写入 doc **之后**、return 前（同一把 lock 内）：

```python
        if before:  # insert_before_id
            # E1.blocked_by = copy of target.blocked_by
            # target.blocked_by = [E1.id] + 其他已与 target 同档并行的 id（已在 target.blocked_by 且 sort_key==E1 的不要循环）
            # 更简且必须实现的规则：
            #   item.blocked_by = list(target.blocked_by)
            #   target.blocked_by = [item.id]
            # 若原来 B.blocked_by=[A]，则 E1.blocked_by=[A]，B.blocked_by=[E1]
        if parallel:
            # item.blocked_by = list(peer.blocked_by)
            # for each other in existing:
            #   if peer.id in other.blocked_by:
            #       other.blocked_by = list(dict.fromkeys([*other.blocked_by, item.id]))
```

两条都传时：`parallel_with_id` 优先，忽略 insert_before 的 rewire（02 已规定 parallel 用同伴 sort_key）。

不要在 lock 外 `get_item` 再写一遍，避免 409。直接改 `doc["items"]` 里对应 dict 的 `blocked_by` 并 `version+=1`。

### AC

- 板 A、B（B.blocked_by=[A]）。insert E1 before B：E1.blocked_by==[A.id]，B.blocked_by==[E1.id]。
- 再 parallel E2 with E1：E2.blocked_by==[A.id]，B.blocked_by 含 E1 与 E2。
- `blockers_released(B)` 在仅 E1 submitted、E2 仍 open 时为 False；两者都 submitted 后为 True。

---

## FR-3：就绪开工（Desktop 一条群消息）

**Files:**

- Modify: `agenticx/runtime/work_items.py` 追加 `list_ready_to_start`
- Modify: `desktop/src/utils/work-items.ts` 可选导出纯函数 `readyWorkItems`（与后端同一规则，避免只信前端）
- Modify: `desktop/src/components/work-panel/WorkPanel.tsx`
- Modify: `desktop/src/components/ChatPane.tsx` 两处 `<WorkPanel`（约 L13843、L13986）传 `onKickoffWorkItems`
- Test: `tests/test_work_item_store.py` + `desktop/src/utils/work-items.test.ts`

```python
def list_ready_to_start(group_id: str) -> list[WorkItem]:
    store = get_work_item_store()
    items = store.list_items(group_id)
    out = []
    for item in items:
        if item.status != "open":
            continue
        if item.owner_kind not in {"avatar", "meta"}:
            continue
        if not store.blockers_released(group_id, item):
            continue
        if store.dispatch_blocked_reason(group_id, item.owner_id) == "owner_paused":
            continue
        out.append(item)
    return out
```

无前置的 `open` 项也算 ready（用户刚创建并指定了分身）。**开工触发条件必须收窄**，否则每 5s 会把所有待开始都 @ 一遍：

Desktop **只**在下列时刻调用 kickoff，且只针对 **本轮新就绪** 的 id：

1. `runWorkItemClose` / `runWorkItemAction(accept)` 成功之后
2. `reloadWorkItems` 得到的列表里，某 id 从「未就绪」变为「就绪」（用 `useRef<Set<string>>` 记上一拍 ready ids）

**不要**在首次 mount 的第一次 GET 就 kickoff（把当前 ready 填进 ref，不发消息）。

`lastKickoffKey` = 排序后的新就绪 id 用逗号拼接；与上次相同则跳过。

开工文案（锁死，禁止发挥）：

```
@{name1} @{name2} 前置已结束，请开始：{title1}；{title2}
```

Near 用 `metaLeaderLabel`。`mentioned_avatar_ids` 必须随 `sendChat` 现有 mention 解析走——正文里写 `@显示名`，与群里 @ 北辰同一套 `expand_mentions`。不要另开 API。

ChatPane：

```typescript
onKickoffWorkItems={(text) => {
  void sendChat(text); // 使用现有 sendChat 签名；若必须 session 已存在，空会话先走与「发送」相同的 ensure
}}
```

若 `sendChat` 需要更多参数，打开 L8994 按**现有调用点**原样转发，禁止重写 sendChat。

`build_work_items_prompt_block` 在现有两条 bullet 后追加：

```
- 口头完成、已做完、取消都算前置结束；下一项会接到系统开工消息，按你名下的 open 事项做。
```

### AC

- `test_list_ready_to_start`：A submitted，E1/E2 open 且 blocked_by=[A] → ready 为 E1、E2；B blocked_by=[E1,E2] 不在其中。
- 前端 `readyWorkItems` 与上面同一组 fixture。
- 手工：A 口头完成 → 群里出现一条 @E1 @E2 开工消息 → 两人变成进行中。刷新/5s 轮询不再重复发。冷启动打开已有 ready 项的群 **不**自动发。

---

## 手工总验收（对照 Master 第 1 节）

1. 群里让 Near 规划 A/B/C（会 `todo_write`）→ 待办板出现三条 plan。
2. 插 E1 到 B 前，负责人北辰 → 顺序 A、E1、B、C。
3. 拉群外分身并行 E2 → 与 E1 并列。
4. 把 A 标已做完或口头完成 → 一条开工消息，E1∥E2 进行中；B 仍待开始且「前置未结束」。
5. E1、E2 口头完成后 B 就绪并再开一轮 @。
6. 1:1 窗格 `todo_write` 不写 `work_items.json`。
