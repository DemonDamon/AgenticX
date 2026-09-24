# 子计划 01：口头完成 / 已做完 / 取消（不强制写文件）

Planned-with: Cursor Grok 4.6
Suggested-Impl-Model: Composer 2.5
Parent-Plan: `.cursor/plans/pending/2026-09-07-near-group-board-master.plan.md`
Plan-Id: 2026-09-07-near-group-board-01-close-kinds

> **For implementer:** 只改本文件列出的符号。禁止合并待办/事项栏、禁止自动开工、禁止改 `todo_write`、禁止改 `electron/main.ts`、禁止动 `server.py` import 区。不要 commit，除非用户明确要求。

**Goal:** 进行中的事项可以口头完成变成待验收；待开始/进行中可以「已做完」或「取消」；后继是否放行看前置是否**结束**，不再要求必须验收。文件交付仍可用，只是不再是唯一路径。

**Architecture:** 在 `WorkItem` 上加 `close_kind` / `sort_key`；store 增加 `close()`；REST 增加 `POST .../close`；`submit()` 允许空产物；`submit_owner_delivery` 成功时写 `close_kind=artifact`。Desktop 行内按钮调用同一 close API。

**Tech Stack:** 现有 pytest / vitest / FastAPI / React。

---

## In scope

- `WorkItem.close_kind`、`sort_key`（create 时 `max+10`，本计划不实现插入中点）
- `blockers_released`；`dispatch_blocked_reason` 在仅因前置未结束时返回 `blocked_by_unreleased`（测试与提示都改用这个；旧字符串 `blocked_by_unaccepted` 删掉，本仓库无对外兼容包）
- `close(kind=verbal|already_done|cancelled)`
- `POST /api/groups/{id}/work-items/{id}/close`
- Desktop：进行中显示「口头完成 / 取消」；待开始/进行中显示「已做完 / 取消」；submitted 仍「验收 / 暂停」
- 文案「前置未结束」

## Out of scope

- 合并「待办」「事项」两个 Section
- `insert_before` / 并行 / 拉进群
- `todo_write` 提升、自动 @ 开工
- 改 1:1 `SessionTodoList`
- 让模型能 accept

---

## 现状锚点

| 符号 | 路径 | 约行 |
|---|---|---|
| 字段 | `agenticx/runtime/work_items.py` `WorkItem` L64–81 | 在 `version` 前插入 `close_kind`、`sort_key` |
| 迁移表 | 同文件 `_TRANSITIONS` L21–28 | 给 `open` / `in_progress` 增加 `accepted`、`cancelled` |
| `submit` | 同文件 L288–301 | 允许空 `artifact_paths` |
| `blockers_accepted` | 同文件 L338–346 | **保留函数**，内部改为调用 `blockers_released`（避免漏改调用方） |
| `dispatch_blocked_reason` | 同文件 L352–365 | `blocked_by_unaccepted` → `blocked_by_unreleased` |
| `submit_owner_delivery` | 同文件 L423–451 | submit 成功后 `patch`/`close_kind` 必须是 `artifact`。最简：`submit` 增加可选 `close_kind` 参数，delivery 传 `artifact` |
| REST | `agenticx/studio/server.py` `accept_work_item` 之后（约 L6634） | 插入 `close_work_item` |
| 前端 action | `desktop/src/utils/work-items.ts` `postWorkItemAction` L103–131 | 增加 `close` + `kind` |
| 按钮 | `desktop/src/components/work-panel/GroupWorkItemList.tsx` `visibleWorkItemActions` L16–23 | 见 FR-3 |
| 提示 | 同文件 + `workItemBlockerHint` | 「前置未结束」 |
| 单测 | `tests/test_work_item_store.py` L81–98 | 改成 submitted 即 released |
| API 测 | `tests/test_work_item_api.py` | 追加 close 用例 |
| 前端测 | `desktop/src/components/work-panel/GroupWorkItemList.test.tsx` | 按钮集合 |
| hint 测 | `desktop/src/utils/work-items.test.ts` L26 | 文案 |

`from_dict` 已忽略未知字段；新字段必须有默认值，旧 `work_items.json` 缺字段仍能读。

---

## FR-1：store 字段与 close

**Files:**

- Modify: `agenticx/runtime/work_items.py`
- Test: `tests/test_work_item_store.py`

### WorkItem 字段（插在 `resume_status` 与 `version` 之间）

```python
    close_kind: str = ""
    sort_key: int = 0
    origin: str = "manual"
```

`from_dict` 之后：

```python
        if item.close_kind not in ("", "artifact", "verbal", "already_done", "cancelled"):
            item.close_kind = ""
        if item.origin not in ("manual", "plan"):
            item.origin = "manual"
        try:
            item.sort_key = int(item.sort_key)
        except (TypeError, ValueError):
            item.sort_key = 0
```

`create_item` 在 lock 内写盘前：

```python
        existing = [WorkItem.from_dict(x) for x in doc["items"] if isinstance(x, dict)]
        max_key = max((i.sort_key for i in existing), default=0)
        item.sort_key = max_key + 10
```

（`item` 先构造再在 lock 里赋 `sort_key`，或构造时先 `0` 再赋。）

`_TRANSITIONS`：

```python
_TRANSITIONS: dict[str, set[str]] = {
    "open": {"in_progress", "paused", "cancelled", "accepted"},
    "in_progress": {"submitted", "paused", "cancelled", "accepted"},
    "submitted": {"accepted", "in_progress", "paused", "cancelled"},
    "paused": {"open", "in_progress", "cancelled"},
    "accepted": set(),
    "cancelled": set(),
}
```

`submit` 增加 `close_kind: str = ""`。空产物合法。若 `close_kind` 非空则写入 `item.close_kind`。`submit_owner_delivery` 调用改为 `close_kind="artifact"`。

新增：

```python
    def blockers_released(self, group_id: str, item: WorkItem) -> bool:
        if not item.blocked_by:
            return True
        by_id = {x.id: x for x in self.list_items(group_id)}
        done = {"submitted", "accepted", "cancelled"}
        for bid in item.blocked_by:
            other = by_id.get(bid)
            if other is None or other.status not in done:
                return False
        return True

    def close(
        self,
        group_id: str,
        item_id: str,
        *,
        expected_version: int,
        kind: str,
    ) -> WorkItem:
        kind_s = str(kind or "").strip()
        if kind_s not in {"verbal", "already_done", "cancelled"}:
            raise WorkItemError("invalid close_kind", status_code=400)

        def mutator(item: WorkItem) -> None:
            item.close_kind = kind_s
            if kind_s == "verbal":
                self._apply_status(item, "submitted")
            elif kind_s == "already_done":
                self._apply_status(item, "accepted")
            else:
                self._apply_status(item, "cancelled")

        return self._mutate(group_id, item_id, expected_version=expected_version, mutator=mutator)
```

`blockers_accepted` 改为 `return self.blockers_released(group_id, item)`（签名不变）。

`dispatch_blocked_reason` 里 `return "blocked_by_unaccepted"` 改为 `return "blocked_by_unreleased"`。

`list_items` 返回值按 `(sort_key, created_at, id)` 排序，避免 UI 乱序。

### AC

`tests/test_work_item_store.py`：

- 改 `test_blocked_by_not_ready_until_accepted`：blocker **submit 之后**（未 accept）`blockers_released` 即为 True；`dispatch_blocked_reason` 为 `""`。函数可改名为 `test_blocked_by_released_after_submit`。
- 新增 `test_close_verbal_submits_without_files`：in_progress → close verbal → `submitted` + `close_kind=verbal` + `artifact_paths==[]`。
- 新增 `test_close_already_done_from_open`：open → already_done → `accepted`。
- 新增 `test_close_cancelled_unblocks`：A cancelled 后，blocked_by=[A] 的子项 `blockers_released` 为 True。
- 新增 `test_create_assigns_sort_key`：同群两条 create，`sort_key` 为 10 与 20。

跑：`pytest tests/test_work_item_store.py tests/test_work_item_runtime.py -q`  
（runtime 若断言旧 reason 字符串，改成 `blocked_by_unreleased`。）

---

## FR-2：REST close

**Files:**

- Modify: `agenticx/studio/server.py` 仅 `resume_work_item` 函数**之后**插入，禁止改文件顶部 import
- Test: `tests/test_work_item_api.py`

```python
    @app.post("/api/groups/{group_id}/work-items/{item_id}/close")
    async def close_work_item(
        group_id: str,
        item_id: str,
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        from agenticx.runtime.work_items import get_work_item_store

        _check_token(x_agx_desktop_token)
        _require_group(group_id)
        expected = _expected_version(payload)
        kind = str((payload or {}).get("kind") or "").strip()
        try:
            item = get_work_item_store().close(
                group_id,
                item_id,
                expected_version=expected,
                kind=kind,
            )
        except Exception as exc:
            _work_item_http(exc)
            raise
        return {"ok": True, "item": item.to_dict()}
```

`create_work_item` 无需本计划改 body。改完后按仓库规则对 `server.py` 做一次冷启动 smoke：`agx serve --host 127.0.0.1 --port 18765`，`GET /api/session` 不崩即可；不要用生产端口。

### AC

`test_close_verbal_200`：create → 用 store `mark_in_progress` 或先 PATCH 不允许改 status。create 默认 open，open→verbal 非法。测试里：create 后 `get_work_item_store().mark_in_progress`，再 `POST .../close` `{"kind":"verbal","expected_version":...}`，断言 200 且 `status==submitted`。

`test_close_bad_kind_400`：`kind=accept` → 400。

跑：`pytest tests/test_work_item_api.py -q`

---

## FR-3：Desktop 按钮

**Files:**

- Modify: `desktop/src/utils/work-items.ts`
- Modify: `desktop/src/components/work-panel/GroupWorkItemList.tsx`
- Modify: `desktop/src/components/work-panel/WorkPanel.tsx` `runWorkItemAction`（约 L869）
- Test: `GroupWorkItemList.test.tsx`、`work-items.test.ts`

`WorkItem` 类型加 `close_kind?: string`、`sort_key?: number`。

`postWorkItemAction` 的 `action` 联合加上 `"close"`。当 `action==="close"` 时 body 为 `{ expected_version, kind }`。增加参数 `kind?: "verbal" | "already_done" | "cancelled"`。URL 仍是 `.../work-items/${id}/${action}`。

`workItemBlockerHint` 返回「前置未结束」。`workItemStatusLabel` 不改。

`visibleWorkItemActions` 改为：

```typescript
export function visibleWorkItemActions(
  status: WorkItemStatus,
): Array<"accept" | "pause" | "resume" | "verbal" | "already_done" | "cancel"> {
  if (status === "submitted") return ["accept", "pause"];
  if (status === "paused") return ["resume"];
  if (status === "open") return ["already_done", "cancel", "pause"];
  if (status === "in_progress") return ["verbal", "already_done", "cancel", "pause"];
  return [];
}
```

`GroupWorkItemList` 增加 props：

```typescript
  onVerbal: (item: WorkItem) => void;
  onAlreadyDone: (item: WorkItem) => void;
  onCancel: (item: WorkItem) => void;
```

按钮文案：口头完成 / 已做完 / 取消。样式：口头完成、已做完用与「验收」相同的 primary；取消用现有「暂停」那种 muted text button。

`WorkPanel.runWorkItemAction` 扩展为可传 close kind，或另写 `runWorkItemClose(item, kind)` 调 `postWorkItemAction(..., "close", version, apiBase)`——**不要**把 kind 塞进 URL。看当前 `postWorkItemAction` 签名，在函数内：

```typescript
      body: JSON.stringify(
        action === "close" ? { expected_version, kind: closeKind } : { expected_version },
      ),
```

`closeKind` 作为新参数，默认 `""`。

错误展示继续 `workItemRequestError`。**改 `createWorkItem` / `fetchWorkItems`：`!resp.ok` 时读 `await resp.json().catch(()=>null)` 的 `detail`，拼进 Error**，避免再只显示 `HTTP 400`。这属于本计划 UX 收口（用户刚踩过），只改 `work-items.ts` 这一处 helper。

### AC

- `visibleWorkItemActions("in_progress")` 含 `verbal`、`already_done`、`cancel`、`pause`，不含 `accept`。
- `workItemBlockerHint` 为「前置未结束」。
- `work-items.test.ts`：mock close 409 仍 `code==="conflict"`。
- `cd desktop && npx vitest run src/utils/work-items.test.ts src/components/work-panel/GroupWorkItemList.test.tsx`

---

## 手工验收

1. 群里已有进行中「翻译英文：…」：点「口头完成」→ 待验收 → 验收 → 已验收。磁盘 `close_kind` 为 `verbal`，`artifact_paths` 仍 `[]`。
2. 新建一条待开始，点「取消」→ 行变为已取消或从活跃列表消失（列表仍显示 cancelled：按现有 `build_work_items_prompt_block` 会列出；UI **继续列出** cancelled，状态文案「已取消」，无按钮）。
3. 不要改 1:1 窗格待办。
