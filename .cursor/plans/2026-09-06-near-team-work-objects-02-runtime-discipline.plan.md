# 子计划 02：运行时纪律（注入、硬拦、自动派活守门）

Planned-with: Cursor Grok 4.6
Suggested-Impl-Model: Cursor Grok 4.6
Parent-Plan: `.cursor/plans/2026-09-06-near-ai-native-team-work-objects.plan.md`
Plan-Id: 2026-09-06-near-team-work-objects-02-runtime-discipline

> **For implementer:** 01 必须已经落地（存在 `agenticx/runtime/work_items.py` 与 work-items REST）。只改本文件列出的符号。禁止把 Near（`__meta__`）从群路由里拿掉，禁止改 `pick_targets` 的 @ 优先语义，禁止改 Desktop。展示名一律用 Near，不要写 Machi。不要 commit，除非用户明确要求。

**Goal:** 群成员和 Near 能看见事项板；Near 可用工具创建/提交事项但不能验收；自动派活遵守 pause 与 blocked_by；群成员工具表代码层去掉调度工具。

**Architecture:** 在现有 `GroupChatRouter` 上做**加法**：提示块、dispatch 守门、`_group_chat_tools` 扩 denylist、Meta 增加一个工具。微信式群聊与 `__meta__` 在场保持不变。

**Tech Stack:** 现有 GroupChatRouter / meta_tools / pytest。

---

## In scope

- `build_work_items_prompt_block(group_id)` 注入成员 system prompt 与 Near 群块
- Meta 工具 `work_item_upsert`（create / update / submit / attach / cancel）
- `_group_chat_tools` 扩大屏蔽列表
- 智能路由自动选中的成员若 `dispatch_blocked_reason` 非空：本轮 **skip** 并发一条 `group_progress`，**显式 @ 仍执行**
- 可选：成员开始执行时把其 `open` 事项 `mark_in_progress`（失败不得打断 turn）

## Out of scope

- 改 `pick_targets` 的 mention / intelligent 返回值结构（只在**调用方**过滤自动目标）
- 把 Meta 从 `pick_targets` 结果里删除
- Desktop、OKR、房间、MessageHub
- REST `/submit`（submit 只走 store + Meta 工具）
- 改 `server.py` import 区
- 替换 TaskLock / 强杀 in-flight

---

## 现状锚点

| 符号 | 路径 | 约行 |
|---|---|---|
| `_group_chat_tools` | `agenticx/runtime/group_router.py` | 607–614，现仅 `blocked = {"delegate_to_avatar"}` |
| 成员 system prompt | 同文件 `_run_one_target` 内 `system_prompt = (` | 1718–1754，随后 `_append_context_files_block` 1755 |
| `pick_targets` | 同文件 | 1304–1331 |
| 调用 `pick_targets` 之后跑成员 | 同文件，搜 `pick_targets(` | 实施时用 ripgrep 定位**所有**调用点，通常在 `run_turn` / `_run_intelligent` / team 路径 |
| Near 群块 | `agenticx/runtime/prompts/meta_agent.py` | `group_block` 约 846–855 |
| Meta 工具表 | `agenticx/runtime/meta_tools.py` | `visible_meta_agent_tools` 约 827；`dispatch` 里已有 `spawn_subagent` / `delegate_to_avatar` 分支 |
| 成员工具调用 | `group_router.py` | `tools=_group_chat_tools()` 约 1825 |
| 进度 skip | `GroupChatRouter._progress_reply` | 约 866–885 |
| store API | `agenticx/runtime/work_items.py` | `dispatch_blocked_reason` / `submit` / `cancel` |

**根因：** 01 只把事项落盘；runtime 仍看不见，成员仍可能 `spawn_subagent`，paused 负责人仍会被智能路由拉去干活。

---

## FR-1：提示块

**Files:**

- Modify: `agenticx/runtime/work_items.py` 文件**末尾追加**函数（不要重写 Store）
- Modify: `agenticx/runtime/group_router.py` · `_run_one_target` 在 `_append_context_files_block` **之后**拼一块
- Modify: `agenticx/runtime/prompts/meta_agent.py` · `group_block` 末尾追加同一块
- Test: `tests/test_work_item_runtime.py`

追加函数（放 `work_items.py`）：

```python
def build_work_items_prompt_block(group_id: str) -> str:
    gid = str(group_id or "").strip()
    if not gid:
        return ""
    items = get_work_item_store().list_items(gid)
    active = [i for i in items if i.status not in {"cancelled"}]
    if not active:
        return ""
    lines = ["## 本群事项（组织后台，不是聊天记录）"]
    lines.append("- 长产物写群共享工作区；群里只回结论。")
    lines.append("- 你不能把事项标为 accepted；验收是用户的按钮。")
    for item in active:
        owner = item.owner_id or "用户"
        ready = get_work_item_store().blockers_accepted(gid, item)
        block = "" if ready else "；前置未验收"
        lines.append(
            f"- [{item.status}] {item.id} {item.title} · 负责人={owner}{block}"
        )
    return "\n".join(lines) + "\n"
```

`_run_one_target` after `_append_context_files_block`：

```python
        wi_block = build_work_items_prompt_block(group_id)
        if wi_block:
            system_prompt = f"{system_prompt}\n{wi_block}"
```

`meta_agent.py` 的 `group_block` 在现有三句话之后追加：

```python
        wi_block = ""
        try:
            from agenticx.runtime.work_items import build_work_items_prompt_block
            # group_id 从现有函数参数取；若 build 函数签名里没有 group_id，
            # 打开 meta_agent.py 里构建 group_block 的函数，把已有 group_id / group_allowed 参数用上。
            wi_block = build_work_items_prompt_block(str(group_id or "").strip())
        except Exception:
            wi_block = ""
        if wi_block:
            group_block = group_block + wi_block + "\n"
```

**禁止**为了注入把 `build_meta_agent_system_prompt` 整段重写。先读该函数签名，确认已有 `group_id` 或可从 `session.avatar_id` 解析 `group:` 前缀（`agenticx/memory/graph/group_id.py` 的 `parse_group_id_from_avatar`）。优先用已有参数；没有再从 `getattr(session, "avatar_id", "")` 解析。

**AC-1：** `tests/test_work_item_runtime.py::test_prompt_block_lists_open_item`  
在 tmp groups 下 create 一条 open 事项，断言 block 含 `wi_` 与 title，且含「不能把事项标为 accepted」。

**AC-2：** 空群返回 `""`。

---

## FR-2：群成员工具硬拦

**Files:**

- Modify: `agenticx/runtime/group_router.py` · `_group_chat_tools`（L607–614）
- Test: `tests/test_work_item_runtime.py`

### Before

```python
def _group_chat_tools() -> Sequence[Dict[str, Any]]:
    blocked = {"delegate_to_avatar"}
    tools = [
        tool
        for tool in STUDIO_TOOLS
        if tool.get("function", {}).get("name") not in blocked
    ]
    return _strip_disabled_web_search_tools(tools)
```

### After

```python
GROUP_MEMBER_BLOCKED_TOOLS = frozenset({
    "delegate_to_avatar",
    "spawn_subagent",
    "create_avatar",
    "schedule_task",
    "cancel_scheduled_task",
    "list_scheduled_tasks",
    "work_item_upsert",
})


def _group_chat_tools() -> Sequence[Dict[str, Any]]:
    tools = [
        tool
        for tool in STUDIO_TOOLS
        if tool.get("function", {}).get("name") not in GROUP_MEMBER_BLOCKED_TOOLS
    ]
    return _strip_disabled_web_search_tools(tools)
```

`work_item_upsert` 即使稍后只注册在 META 表，denylist 也写上，防止以后误并进 STUDIO_TOOLS。

**AC-3：** `test_group_member_tools_hide_scheduler_tools`  
`{t["function"]["name"] for t in _group_chat_tools()}` 与 `GROUP_MEMBER_BLOCKED_TOOLS` 交集为空。  
`delegate_to_avatar` 仍不在成员表（回归）。  
`file_read` 或现有 STUDIO 里某个普通工具仍在（证明不是清空工具表）。

**不要**改 `_filter_tools_by_policy`，不要改分身单聊工具表。

---

## FR-3：自动派活守门，显式 @ 放行

**Files:**

- Modify: `agenticx/runtime/group_router.py` 所有在 `pick_targets(...)` 之后、开始 `_run_one_target` 之前的循环
- Test: `tests/test_work_item_runtime.py`

先 `rg "pick_targets\(" agenticx/runtime/group_router.py`。对**每一个**调用点套同一规则。

新增模块级辅助（放在 `pick_targets` 附近）：

```python
def _auto_dispatch_owner_blocked(group_id: str, owner_id: str) -> str:
    try:
        from agenticx.runtime.work_items import get_work_item_store
        return get_work_item_store().dispatch_blocked_reason(group_id, owner_id)
    except Exception:
        return ""
```

规则（写进循环，不要改 `pick_targets` 内部）：

```python
mentioned = set(explicit_mentioned_ids)  # 本轮用户 @ 或无 @ 点名已解析出的成员
for target in targets:
    if target == META_LEADER_AGENT_ID:
        # Near（__meta__）始终可说话，不因事项 pause 静音
        ...
        continue
    reason = _auto_dispatch_owner_blocked(group_id, target)
    if reason and target not in mentioned:
        yield self._progress_reply(
            agent_id=target,
            avatar_name=...,  # 用 registry 取名，取不到就用 target
            avatar_url="",
            text="事项已暂停或前置未验收，本轮不自动开跑。需要的话直接 @ 我。",
        )
        continue
    # 原 _run_one_target
```

`mentioned` 必须来自**已经算好的** `mentioned_avatar_ids` / 无 @ 点名集合，不要自己再解析一套正则。打开现有 `run_turn` 看变量名（常见 `mentioned_avatar_ids`），直接用。

若某条路径没有 mention 集合（纯 team/workforce），则：`reason` 非空就 skip（workforce 不应在前置未验收时自动开跑）。

**AC-4：** `test_auto_dispatch_skips_paused_owner_unless_mentioned`  
构造 router（抄 `tests/test_smoke_group_meta_direct_honesty.py` 的 `_make_router`）。store 里给 `wen` 一条 `paused` 事项。  
调用你抽出来的过滤函数（建议同时把过滤写成 `GroupChatRouter._filter_dispatch_targets(...)` 以便单测，避免 mock 整个 run_turn）：

```python
def _filter_dispatch_targets(
    self,
    *,
    group_id: str,
    targets: Sequence[str],
    mentioned_avatar_ids: Sequence[str],
) -> tuple[list[str], list[GroupReply]]:
    """Return (run_ids, progress_skips). Never drops __meta__."""
```

断言：`mentioned=[]` 时 `wen` 不在 `run_ids`，且有一条 `group_progress`。  
断言：`mentioned=["wen"]` 时 `wen` 在 `run_ids`。  
断言：`__meta__` 始终保留。

把 `run_turn` 里的循环改成先 `_filter_dispatch_targets` 再执行，这样测试不必跑 LLM。

---

## FR-4：Meta 工具 `work_item_upsert`

**Files:**

- Modify: `agenticx/runtime/meta_tools.py`
  1. 在 `META_AGENT_TOOLS` / `visible_meta_agent_tools()` **所使用的列表**里追加一个 tool schema（先读 `visible_meta_agent_tools`：它若是过滤 `META_AGENT_TOOLS` 的函数，把 schema 加到 `META_AGENT_TOOLS` 即可）
  2. 在 `dispatch` / `dispatch_meta_tool` 同类函数里加 `if name == "work_item_upsert":`
- Test: `tests/test_work_item_runtime.py`

Schema（字段写全，禁止「按需推断」）：

```python
{
    "type": "function",
    "function": {
        "name": "work_item_upsert",
        "description": (
            "创建或更新当前群的事项（组织后台）。"
            "action=create|update|submit|attach|cancel。"
            "不能验收、不能暂停、不能恢复；那是用户按钮。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["create", "update", "submit", "attach", "cancel"]},
                "item_id": {"type": "string"},
                "title": {"type": "string"},
                "owner_id": {"type": "string", "description": "群成员 avatar_id；空表示用户负责"},
                "owner_kind": {"type": "string", "enum": ["human", "avatar", "meta"]},
                "definition_of_done": {"type": "string"},
                "artifact_paths": {"type": "array", "items": {"type": "string"}},
                "blocked_by": {"type": "array", "items": {"type": "string"}},
                "expected_version": {"type": "integer"},
            },
            "required": ["action"],
        },
    },
}
```

Dispatch 规则：

1. 从 session 解析 `group_id`：`avatar_id` 以 `group:` 开头则去前缀；否则返回错误 `"work_item_upsert 只能在群聊会话使用"`。
2. `action=accept|pause|resume` 或任何其它值 → 错误 `"unsupported action"`（即使模型胡写）。
3. `create`：调 `WorkItemStore.create_item`，`allowed_owner_ids` 用 `GroupChatRegistry.get_group(gid).avatar_ids`。
4. `update`：`patch_item(..., allow_status=False)`，必须 `item_id` + `expected_version`。
5. `submit`：`store.submit`。
6. `attach`：只改 `artifact_paths`（与现有 paths 合并去重），状态不变。
7. `cancel`：`store.cancel`。
8. 捕获 `WorkItemError`，把 `status_code` 与消息返回给模型（不要 raise 出 dispatch）。

群外单聊调用必须失败。automation session 不要注册此工具——若 `visible_meta_agent_tools` 对 automation 已有过滤，把 `work_item_upsert` 加进 automation 屏蔽集合（`server.py` 约 L3613 `_blocked` 那组）。**只追加这一名字**，不要改那一组其它项。

**AC-5：** `test_meta_tool_create_and_cannot_accept`  
create 成功；dispatch `action=accept` 返回错误且 store 里 status 仍不是 `accepted`。

**AC-6：** `test_meta_tool_rejected_outside_group`  
非 `group:` session 失败。

---

## FR-5：可选 in_progress 标记（允许做，失败必须吞掉）

在 `_run_one_target` 真正调用 LLM **之前**：

```python
        try:
            store = get_work_item_store()
            for item in store.list_items(group_id):
                if item.owner_id == avatar_id and item.status == "open" and store.blockers_accepted(group_id, item):
                    store.mark_in_progress(group_id, item.id, expected_version=item.version)
                    break  # 每轮最多推一条，避免把所有 open 一次推进去
        except Exception:
            pass
```

无测试也可，但若写测试：paused 项不能被这逻辑改成 in_progress（`mark_in_progress` 对 paused 是非法迁移，会被 except 吃掉——更好的是先 `if item.status != "open": continue`，上面已写）。

---

## 回归保护（必须跑）

```bash
python -m pytest tests/test_work_item_store.py tests/test_work_item_api.py tests/test_work_item_runtime.py tests/test_smoke_group_meta_direct_honesty.py tests/test_smoke_group_legacy_routing.py -q
```

Expected: PASS。`pick_targets` 单测若存在，行为与改前一致（你没有改该函数体）。

---

## AC 汇总

| ID | 断言 |
|---|---|
| AC-1 | 提示块列出事项且写明不能 accepted |
| AC-2 | 无事项 → 空字符串 |
| AC-3 | 成员工具表不含调度/spawn |
| AC-4 | pause/blocked 自动 skip；@ 仍跑；Meta 不静音 |
| AC-5 | Near 可 create，不能 accept |
| AC-6 | 非群会话拒工具 |
| AC-7 | 未改 Desktop；未把 Near（`__meta__`）移出群 |

---

## 实施完成定义

diff 应大致限于：

- `agenticx/runtime/work_items.py`（只追加 prompt helper，不改 schema）
- `agenticx/runtime/group_router.py`（`_group_chat_tools`、`_filter_dispatch_targets`、prompt 拼接、调用点）
- `agenticx/runtime/prompts/meta_agent.py`（group_block 追加）
- `agenticx/runtime/meta_tools.py`（一个工具 + 一个 dispatch 分支）
- 如需要：`agenticx/studio/server.py` **仅** automation `_blocked` 集合多一个字符串
- `tests/test_work_item_runtime.py`

禁止改 `desktop/`、禁止改 CRD/房间、禁止新增编排模式。
