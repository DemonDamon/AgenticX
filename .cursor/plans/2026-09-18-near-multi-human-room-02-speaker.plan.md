# 子计划 02：群用户行写入真实 sender_id

Planned-with: Cursor Grok 4.6
Suggested-Impl-Model: Composer 2.5
Parent-Plan: `.cursor/plans/pending/2026-09-18-near-multi-human-room-master.plan.md`
Depends-on: `2026-09-18-near-multi-human-room-01-roster`
Plan-Id: 2026-09-18-near-multi-human-room-02-speaker

> **For implementer:** 使用 executing-plans，TDD。只把发言者 id 传入 `append_user`。不要 commit，除非用户明确要求。

**Goal:** 群聊用户历史行可以带 `human:…`（或保持默认 `"user"`），旧会话读起来不变。

**Architecture:** `GroupChatContext.append_user` 增加可选 `sender_id`；`ChatRequest` 增加可选 `speaker_user_id`；`run_group_turn` / `_iter_group_turn` **只加同名参数并传给 append_user**。

**Tech Stack:** Python + pytest。

## 实施前只需打开

- `agenticx/runtime/group_context.py`（`append_user` L50–L71，`recent` L95–L116）
- `agenticx/studio/protocols.py`（`ChatRequest` L21–L70）
- `agenticx/runtime/group_router.py` **只用编辑器跳到** `run_group_turn`（约 L3188）和 `_iter_group_turn` 里 `context.append_user`（约 L3258）。**禁止从头读该文件。**
- `agenticx/studio/server.py` **只用搜索** `async for reply in router.run_group_turn(`（约 L3309–L3323）加一个 kwarg。禁止改 import 区。

## 禁止打开 / 禁止改

- `_analyze_intent`、`_run_intelligent_turn`、`_run_team_turn`、Workforce/Graph
- `desktop/`、`enterprise/`、`agenticx/gateway/`
- 回填或改写已有 `messages.json`

## In scope

- `append_user(..., sender_id=)` 默认 `"user"`。
- 非空 `speaker_user_id` 写入 `sender_id` 与 `agent_id`（用户行继续 `role=user`）。
- `/api/chat` 把 `payload.speaker_user_id` 传进 router。

## Out of scope

- 花名册 API（01 已做）。
- IM 客户端（03）。
- 气泡 UI（04）。
- `@` 解析人。

---

## 根因

`append_user`（`group_context.py` L60–L65）写死 `"sender_id": "user"`、`"agent_id": "user"`。两个真人在同一 `chat_history` 里无法区分。`user_display_name` 只影响 `sender_name`，且 Desktop 主人也常叫「我」。

---

## FR-02-1：append_user 可覆写 sender_id

**Files:**

- Modify: `agenticx/runtime/group_context.py::GroupChatContext.append_user`
- Test: `tests/test_group_speaker_persist.py`

**Before：**

```python
    def append_user(
        self,
        text: str,
        *,
        sender_name: str = "我",
        quoted_message_id: str = "",
        quoted_content: str = "",
        attachments: Sequence[Mapping[str, Any]] | None = None,
    ) -> None:
        label = str(sender_name or "").strip() or "我"
        row: dict[str, Any] = {
            "role": "user",
            "content": str(text or ""),
            "sender_id": "user",
            "sender_name": label,
            "agent_id": "user",
```

**After：**

```python
    def append_user(
        self,
        text: str,
        *,
        sender_name: str = "我",
        sender_id: str = "user",
        quoted_message_id: str = "",
        quoted_content: str = "",
        attachments: Sequence[Mapping[str, Any]] | None = None,
    ) -> None:
        label = str(sender_name or "").strip() or "我"
        sid = str(sender_id or "").strip() or "user"
        row: dict[str, Any] = {
            "role": "user",
            "content": str(text or ""),
            "sender_id": sid,
            "sender_name": label,
            "agent_id": sid,
```

`recent()` 已读 `sender_id`；空时对 user role 回落 `"user"`（L106–L107）。不要改 `append_agent`。

**AC（用假 session 对象，`chat_history=[]`）：**

- 不传 `sender_id` → 行内 `"user"`
- `sender_id="human:feishu:ou_1"` → `sender_id` 与 `agent_id` 均为该值，`role=="user"`
- `recent()` 能读出该 `sender_id`

---

## FR-02-2：ChatRequest.speaker_user_id

**Files:**

- Modify: `agenticx/studio/protocols.py::ChatRequest`（加在 `user_display_name` 旁，约 L39）

```python
    # Group-room speaker. Empty/omitted => sender_id "user" (desktop owner).
    speaker_user_id: Optional[str] = None
```

不要改其它字段默认值。

---

## FR-02-3：router / server 只传球，不改路由

**Files:**

- Modify: `group_router.py` `run_group_turn` 签名，在 `user_display_name` 后增加 `speaker_user_id: str | None = None`
- 把它原样传入 `_iter_group_turn`
- `_iter_group_turn` 签名同样增加该参数；`append_user` 改为：

```python
        speaker = str(speaker_user_id or "").strip() or "user"
        context.append_user(
            user_input,
            sender_name=udn,
            sender_id=speaker,
            quoted_message_id=quoted_message_id,
            quoted_content=quoted_content,
            attachments=turn_history or None,
        )
```

- Modify: `server.py` 对 `router.run_group_turn(...)` 增加一行：

```python
                        speaker_user_id=str(getattr(payload, "speaker_user_id", None) or "").strip() or None,
```

放在现有 `user_display_name=u_display,` 旁边。

**禁止**改 `run_group_turn` 里其它分支。若漏传 `_iter_group_turn` 会导致 TypeError——两处签名必须一起加默认值。

**AC:**

- `tests/test_group_speaker_persist.py` 用 `GroupChatRouter` **不必**跑 LLM：直接实例化 `GroupChatContext` 测 FR-02-1 即可。
- 另写 `test_run_group_turn_passes_speaker_id`：可用 `unittest.mock.patch.object` patch `_iter_group_turn` 为 async generator，断言 `run_group_turn(..., speaker_user_id="human:feishu:ou_1")` 把该 kwarg 传下去。不要 mock LLM。

若不想碰 router 测试双份，最低要求：FR-02-1 单测 + 人工确认 server 那一行存在。**推荐**做 patch 断言，避免漏传。

---

## 验证

```bash
pytest tests/test_group_speaker_persist.py tests/test_group_human_members.py -q
```

若改了 `server.py`：冷启动 `agx serve`，`/api/session` `/api/avatars` `/api/sessions` 200。

## Composer 2.5 停止条件

- 打开 `group_router.py` 后若开始改 intent / mention / workforce，停手并还原。
- 不要把 `speaker_user_id` 校验成必须在 `human_members` 里（03 才注册；缺席仍允许落盘，避免 IM 先发后注册失败丢消息）。
- Desktop 发送路径本计划不改；主人继续省略该字段。
