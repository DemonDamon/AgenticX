# 子计划 03：外部 IM 写入同一条群 session

Planned-with: Cursor Grok 4.6
Suggested-Impl-Model: Composer 2.5（优先）；同时改飞书+微信两条 HTTP 体时可用代码专精中档
Parent-Plan: `.cursor/plans/pending/2026-09-18-near-multi-human-room-master.plan.md`
Depends-on: `2026-09-18-near-multi-human-room-01-roster`, `2026-09-18-near-multi-human-room-02-speaker`
Plan-Id: 2026-09-18-near-multi-human-room-03-im-ingress

> **For implementer:** 使用 executing-plans，TDD。先写纯函数再改两处 POST body。不要 commit，除非用户明确要求。

**Goal:** 已绑定到 `group:<gid>` session 的外部 IM 用户，发消息时带上 `speaker_user_id` 与 `group_id`，并登记进花名册。

**Architecture:** 新增 `im_group_speaker.py` 构造 `/api/chat` JSON；飞书 `_chat_turn` 与 gateway `client.py` 只调用它。禁止在 1000+ 行长连接文件里现场拼 id。

**Tech Stack:** Python + httpx 调用方 + pytest（无网络）。

## 实施前只需打开

- Create: `agenticx/gateway/im_group_speaker.py`
- `agenticx/avatar/group_members.py`（只 import `make_human_member_id`）
- `agenticx/gateway/feishu_longconn.py` 的 `_chat_turn`（约 L796–L821）
- `agenticx/gateway/client.py` 构造 `body = {` 处（约 L248–L252）
- 可选：`agenticx/gateway/adapters/wechat_ilink.py` 里同样构造 `user_display_name` 的 POST（约 L572–L588）——**同一 helper，三处各加 2 行**

## 禁止打开 / 禁止改

- `group_router.py`
- `desktop/`、`enterprise/`
- 飞书绑定状态机、二维码、session 哈希算法（`_session_id`）
- 不要「自动」把所有 `im-feishu-lc-*` 会话改成群；只有目标 session 已是 `group:` 才附加字段

## In scope

- 纯函数：`speaker_user_id`、`merge_im_group_chat_fields`
- 群 session 上 POST 带 `speaker_user_id` / `group_id` / `user_display_name`
- 绑定到群 session 成功后（或每次发言前）best-effort `POST /api/groups/{gid}/human-members`（失败只打日志，不阻断发言）

## Out of scope

- 改 `/bind` UX 文案以外的协议。
- 已读、群 IM 频道扇出、Centrifugo。
- 让 IM 用户可被 @ 执行。

---

## 根因

1. `feishu_longconn._chat_turn`（L815–L821）只发 `session_id` + `user_input` + `user_display_name`。
2. `gateway/client.py` L248–L252 同样。
3. 默认 session 常是 `im-feishu-lc-<hash(sender)>`，每人一条私聊。多人进群的**产品约定**是：同事必须 `/bind` 到已有 `group:<gid>` session（已有能力）。本计划只补「绑上之后发言能区分人」。

---

## FR-03-1：纯函数（先写测试）

**Files:**

- Create: `agenticx/gateway/im_group_speaker.py`
- Test: `tests/test_im_group_speaker.py`

```python
#!/usr/bin/env python3
"""Build /api/chat fields for an IM speaker in a group room.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any

from agenticx.avatar.group_members import make_human_member_id


def speaker_user_id(platform: str, external_id: str) -> str:
    return make_human_member_id(platform, external_id)


def group_id_from_session_avatar_id(avatar_id: str | None) -> str:
    raw = str(avatar_id or "").strip()
    if raw.startswith("group:"):
        return raw.split(":", 1)[1].strip()
    return ""


def merge_im_group_chat_fields(
    body: dict[str, Any],
    *,
    platform: str,
    external_id: str,
    display_name: str,
    session_avatar_id: str | None,
) -> dict[str, Any]:
    """Return a shallow copy. Only group sessions get speaker/group fields."""
    out = dict(body)
    name = str(display_name or "").strip() or str(external_id or "").strip()
    if name:
        out["user_display_name"] = name
    gid = group_id_from_session_avatar_id(session_avatar_id)
    if not gid:
        return out
    out["group_id"] = gid
    out["speaker_user_id"] = speaker_user_id(platform, external_id)
    return out


def human_member_payload(platform: str, external_id: str, display_name: str) -> dict[str, str]:
    return {
        "platform": platform,
        "external_id": str(external_id or "").strip(),
        "display_name": str(display_name or "").strip() or str(external_id or "").strip(),
    }
```

**AC:**

- `session_avatar_id=""` 或 `"abc"` → 输出**没有** `group_id` / `speaker_user_id`
- `session_avatar_id="group:deadbeef"` + feishu/`ou_1` → `group_id=="deadbeef"`，`speaker_user_id=="human:feishu:ou_1"`
- 原 body 的 `session_id` / `user_input` / `keep_runtime_after_disconnect` 原样保留
- 非法 platform 抛 `ValueError`（来自 01 的 `make_human_member_id`）

---

## FR-03-2：接线（薄）

对每个现有 `body = { "session_id", "user_input", "user_display_name" }`：

1. 若调用方已经知道 session 的 `avatar_id`，传入 `merge_im_group_chat_fields`。
2. 若不知道：在 POST 前对 `/api/session?session_id=` 的 JSON 读 `avatar_id`（飞书 `_chat_turn` **已经** GET `/api/session`，见 `client.py` L240–L246；飞书 `_chat_turn` 在 L815 前若没有 GET，就用已有 `_ensure_session` 返回值，**不要新造一轮握手**）。

`feishu_longconn._chat_turn` After 意图：

```python
        body = {
            "session_id": target_sid,
            "user_input": text,
            "user_display_name": sender_name,
            "keep_runtime_after_disconnect": True,
        }
        body = merge_im_group_chat_fields(
            body,
            platform="feishu",
            external_id=sender_key.rsplit(":", 1)[-1] if sender_key else "",
            display_name=sender_name,
            session_avatar_id=avatar_id,  # 该函数已有 avatar_id 参数 L803
        )
```

注意：`sender_key` 在飞书侧格式需你打开 `_chat_turn` 的调用点确认。若 `sender_key` 不是 `feishu:ou_xxx`，改用调用方已经传入的 `open_id`。**禁止猜测新的 hash。** 若 `avatar_id` 参数在非群绑定时是分身 id，helper 会正确不加 group 字段。

`client.py`：`platform` 用 `msg.source` / adapter 平台名映射到 `feishu|wechat|wecom`；`external_id=msg.sender_id`。先读 `GatewayMessage`（`models.py` L23–L29）已有 `sender_id`。平台字符串若不在四者内，**不要 merge 群字段**（catch `ValueError` 后保持旧 body）。

微信 `wechat_ilink.py` 的 `_chat_turn` 同类三行。platform=`wechat`。

**AC：** 为三处各加一个测试会太重。本 FR 用 `tests/test_im_group_speaker.py` 覆盖 helper；另写 `test_feishu_chat_body_uses_helper`：**不要启动飞书**。把构造 body 的 8 行抽成 `feishu_longconn.build_feishu_chat_body(...)`（同文件小函数）再测它。若抽函数风险大，允许只测 helper，并在 PR 说明三处已手改。**优先抽 `build_feishu_chat_body`。**

---

## FR-03-3：best-effort 花名册

新增 `agenticx/gateway/im_group_speaker.py`：

```python
def should_register_human(session_avatar_id: str | None) -> bool:
    return bool(group_id_from_session_avatar_id(session_avatar_id))
```

接线处：若 `should_register_human`，对 Studio：

`POST {studio}/api/groups/{gid}/human-members` + 同一 `x-agx-desktop-token`，body=`human_member_payload(...)`。

4xx/5xx/`httpx` 异常：`logger.warning`，**不 raise**。发言路径必须继续。

不要在 01 的 registry 外再写一份 YAML。

**AC:** `tests/test_im_group_speaker.py` 测 `should_register_human` True/False。HTTP 失败不阻断：对 register 函数（若抽出）mock `httpx` 抛错，`build`/`merge` 仍返回完整 chat body。

---

## 验证

```bash
pytest tests/test_im_group_speaker.py tests/test_group_human_members.py tests/test_group_speaker_persist.py -q
```

手动（写在 AC，实施者本地若无飞书可跳过并在回复里声明）：群 session `/bind` 后发一句，`~/.agenticx/sessions/<sid>/messages.json` 最新 user 行 `sender_id` 为 `human:feishu:…`。

## Composer 2.5 停止条件

- 不要改 `_session_id()` 生成规则（会把旧绑定全部打飞）。
- 不要把未 bind 的 IM 用户强行并进「最近一个群」。
- 不要改 Desktop。
