# 对话式改名与角色落盘（对齐 Grok bot 体验）

Planned-with: claude-opus-5-thinking
Suggested-Impl-Model: gpt-5.6-sol-medium（跨 Python 后端 + Electron/React 前端，序列与状态同步敏感）

## 背景与根因

用户在分身窗格里说「你现在定义你是一个 ai 项目售前专家」，模型只是口头答应，界面仍显示占位名「oo」。
对照 Grok bot：用户说「你以后叫 kimi」→ 气泡确认 →「已重命名为 kimi」系统提示 → 顶栏立即变 kimi。

根因（已核验）：

1. `agenticx/runtime/meta_tools.py` 只有 `create_avatar`，**没有**修改自身身份的工具（`update_avatar` 仅存在于 REST 层 `agenticx/studio/server.py:5753`）。
2. `agenticx/runtime/prompts/meta_agent.py:860-870` 的分身身份块只告诉模型「你是谁」，没有任何「用户要改名/改角色时该调什么工具」的规则。
3. Desktop 侧 `desktop/src/components/PaneManager.tsx:94-111` 与窗格标题读的是快照字段 `pane.avatarName`，注册表改了也不会热更新。
   （`ChatPane.tsx:2902-2916` 的 `paneAvatarMeta` 已优先读 `avatars` store，刷新列表即可生效——不要改这段逻辑。）
4. 前端没有「系统提示条」这种居中弱提示消息类型来承载「已重命名为 X」。

## 目标行为（验收口径）

- 场景 A（占位名，直接改）：分身名仍是创建时的占位名（`oo`、`新建分身`、`未命名` 等）时，用户一句「你现在是 AI 项目售前专家」→ 模型**直接**调工具落盘 `role` + 由角色推导的新 `name`，无需二次确认。
- 场景 B（用户起过名，先问）：名字不是占位名时，模型必须先用一句话问「要顺便把名字改成「售前顾问」吗？」，用户点头后再落盘。
- 场景 C（显式改名）：用户说「你以后叫 kimi」→ 任何情况都直接落盘 `name=kimi`。
- 三种场景落盘后：顶栏名、侧栏分身列表、窗格标题、输入框占位「给 X 发消息」全部立即变；对话流里出现一条居中灰色系统提示「已重命名为 X」。

## In scope / Out of scope

In scope：新增 `update_self_identity` 工具、Meta 提示词规则、Desktop 工具结果处理与 UI 同步、系统提示条消息类型、冒烟测试。

Out of scope（no-scope-creep 边界）：
- 不动 `create_avatar` 的确认流程与参数。
- 不动 `ChatPane.tsx:2902-2916` 的 `paneAvatarMeta` 解析逻辑。
- 不动群聊（`group:` 前缀）与 Automation（`automation:` 前缀）窗格的命名。
- 不做头像重绘（`avatar_url` 保持原值，除非用户显式要求换头像——本次不做）。
- 不动 Meta（Near 本体）窗格的命名，元智能体名字仍由设置面板管理。

---

## FR-1：后端新增 `update_self_identity` 工具

**文件：** `agenticx/runtime/meta_tools.py`

**落点 1 — 工具声明**：在 `create_avatar` 的声明之后（约 L678 `create_avatar` 声明块结束处）追加一个同构的 `{"type": "function", "function": {...}}` 条目：

```python
{
    "type": "function",
    "function": {
        "name": "update_self_identity",
        "description": (
            "Rename the CURRENT avatar and/or update its role and persona, then "
            "persist to the avatar registry so the desktop sidebar, pane title and "
            "header update immediately. Use this whenever the user redefines who "
            "you are (e.g. 'you are now an AI pre-sales expert') or renames you "
            "(e.g. 'call yourself kimi'). Only valid inside a dedicated avatar "
            "pane; it fails in the meta/group/automation panes. Do NOT call "
            "create_avatar for this — that would create a duplicate."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "New display name. Omit to keep current."},
                "role": {"type": "string", "description": "New short role line. Omit to keep current."},
                "system_prompt": {"type": "string", "description": "New persona/system prompt. Omit to keep current."},
                "description": {"type": "string", "description": "New gallery blurb. Omit to keep current."},
            },
            "additionalProperties": False,
        },
    },
},
```

**落点 2 — 分发实现**：在 `dispatch` 的 `if name == "create_avatar":`（L3142）之前插入新分支。实现要点：

```python
if name == "update_self_identity":
    from agenticx.avatar.registry import AvatarRegistry

    avatar_id = str(getattr(session, "bound_avatar_id", "") or "").strip()
    if not avatar_id or avatar_id.startswith(("group:", "automation:")):
        return json.dumps(
            {
                "ok": False,
                "error": "not_an_avatar_pane",
                "message": "当前会话不是分身会话，无法修改身份。",
            },
            ensure_ascii=False,
        )
    registry = AvatarRegistry()
    current = registry.get_avatar(avatar_id)
    if current is None:
        return json.dumps({"ok": False, "error": "avatar_not_found"}, ensure_ascii=False)

    patch: dict[str, Any] = {}
    new_name = str(arguments.get("name", "")).strip()
    if new_name and new_name != current.name:
        # Reject collisions with other avatars (case-insensitive), same rule as create_avatar.
        for other in registry.list_avatars():
            if other.id != avatar_id and new_name.lower() == (other.name or "").lower():
                return json.dumps(
                    {
                        "ok": False,
                        "error": "name_taken",
                        "message": f"已有分身叫「{new_name}」，请换一个名字。",
                    },
                    ensure_ascii=False,
                )
        patch["name"] = new_name
    for key in ("role", "system_prompt", "description"):
        val = str(arguments.get(key, "")).strip()
        if val:
            patch[key] = val
    if not patch:
        return json.dumps({"ok": False, "error": "empty_patch"}, ensure_ascii=False)

    updated = registry.update_avatar(avatar_id, patch)
    ...
    return json.dumps(
        {
            "ok": True,
            "avatar_id": updated.id,
            "renamed": "name" in patch,
            "previous_name": current.name,
            "name": updated.name,
            "role": updated.role,
            "message": ...,
        },
        ensure_ascii=False,
    )
```

**注意：**
- `registry.update_avatar`（`agenticx/avatar/registry.py:307`）在 patch 含 `avatar_url` 时会重算头像；本工具**不传** `avatar_url`，因此头像保持不变。
- `bound_avatar_id` 是 session 上已有字段（见 `agenticx/runtime/prompts/meta_agent.py:824`），沿用它取当前分身，不要新造参数让模型自己填 id。

**注册到可用工具集**：`agenticx/runtime/tool_search.py:86` 附近的工具名清单里 `create_avatar` 同级加入 `update_self_identity`。

**AC-1：** 新增 `tests/test_smoke_avatar_self_rename.py`：
- 建一个临时 registry + 一个 `name="oo"` 的分身，构造 `bound_avatar_id` 指向它的假 session。
- 断言 `dispatch("update_self_identity", {"name": "售前专家", "role": "AI 项目售前专家"})` 返回 `ok=True, renamed=True, previous_name="oo"`，且 `registry.get_avatar(id).name == "售前专家"`。
- 断言重名时返回 `error="name_taken"` 且注册表未变。
- 断言 `bound_avatar_id` 为空 / `group:x` 时返回 `error="not_an_avatar_pane"`。

---

## FR-2：Meta 提示词加入改名规则

**文件：** `agenticx/runtime/prompts/meta_agent.py`，函数内 `avatar_block` 构造处（L860-870）。

在现有 `lines.append("当用户问“你是谁”时，...")` 之后追加规则文本（保持中文、与周边风格一致）：

```
- 当用户重新定义你的角色/人设（如「你现在是 X」），或要求改名（如「你以后叫 X」）时，**必须**调用 `update_self_identity` 真正落盘，不能只在回复里口头答应。
- 若当前名字仍是占位名（如 oo、新建分身、未命名、Avatar、AI），直接根据新角色拟一个简短名字（2-6 字）连同 role 一起落盘，不必再问用户。
- 若当前名字是用户起过的正式名字，先用一句话询问「要顺便把名字改成「X」吗？」，得到肯定答复后再调用。
- 只改角色不改名时，`update_self_identity` 只传 role/system_prompt，不要传 name。
```

**注意：** 这段只在 `has_avatar_context` 为真时拼接，Meta 窗格不受影响。**只新增 `lines.append(...)` 行，不要重写整个 `avatar_block` 块**。

**AC-2：** `tests/test_smoke_avatar_self_rename.py` 内追加断言：`build_*_prompt(avatar_context={"name": "oo", ...})` 的输出包含 `update_self_identity`，而 `avatar_context=None`（Meta）时不包含。

---

## FR-3：Desktop 工具结果 → 系统提示条 + 状态同步

**文件 1：** `desktop/src/store.ts`

- `Message` 类型（约 L250 附近 `avatarName?` 所在的类型）新增可选字段 `systemNotice?: boolean`，用于渲染居中灰字。
- 新增 action `renameAvatarInPanes(avatarId: string, name: string)`：同时更新 `avatars` 数组里该条目的 `name`，以及所有 `panes` 中 `avatarId === avatarId` 的 `avatarName`。放在 `setAvatars`（L1459）附近。

**文件 2：** `desktop/src/components/ChatPane.tsx`

- `formatToolResultMessage`（L2355 起）在 `create_avatar` 分支（L2380-2404）**之后**加 `update_self_identity` 分支：`ok && renamed` → 返回 `{ content: "已重命名为 " + name, silent: false }`；`ok && !renamed` → `{ content: "", silent: true }`（只改角色不打扰用户）；失败 → `⚠️ ...message`。
  **只新增分支，不要改动相邻 `create_avatar` / `spawn_subagent` 分支的任何一行。**
- 在处理工具结果的地方（与 `create_avatar` 后刷新分身列表同源的位置）解析该工具返回的 JSON，`ok` 为真时调用 `renameAvatarInPanes(avatar_id, name)`，并 `window.agenticxDesktop.listAvatars()` 回填一次 store（复用 `AvatarSidebar.tsx:65-104` 的 `refreshAvatars` 同款映射）。
- 「已重命名为 X」这条消息以 `systemNotice: true` 写入，渲染为居中、`text-text-muted`、`text-[12px]`，不带头像与气泡背景（参照 Grok 的系统行）。

**文件 3：** `desktop/src/components/PaneManager.tsx:94-111`
把 `pane.avatarName` 改为「优先查 `avatars` store，查不到再回落 `pane.avatarName`」，与 `ChatPane` 的 `paneAvatarMeta` 语义一致。群聊（`group:` 前缀）与 Meta（`avatarId === null`）保持现有回落路径不变。

**AC-3（手工回归，需逐条截图/确认）：**
1. 新建一个占位名分身 → 在窗格里说「你现在是 AI 项目售前专家」→ 顶栏、侧栏、窗格标题、输入框占位四处同时变新名，对话里出现居中「已重命名为 …」。
2. 对已有正式名字的分身说同样的话 → 模型先问一句，确认后才改。
3. 说「你以后叫 kimi」→ 直接改名。
4. 只说「以后回答简短点」→ 不触发改名、不出现系统提示条。
5. Meta（Near）窗格与群聊窗格里说「你现在是 X」→ 名字不变、不报错。

---

## 实施顺序

1. FR-1 后端工具 + 冒烟测试（可独立验证）。
2. FR-2 提示词规则 + 断言。
3. FR-3 前端三文件改动 + 手工回归。

每段完成后 `pytest tests/test_smoke_avatar_self_rename.py -v`；前端改完跑 `npm run build`（desktop）确认 TS 通过。

## 风险

- `update_avatar` 改名后，历史消息里已持久化的 `avatarName` 仍是旧名——这是符合预期的（历史记录如实反映当时身份），不要为此去批量重写 `messages.json`。
- 模型可能误在 Meta 窗格调用该工具：已由 FR-1 的 `not_an_avatar_pane` 兜底，前端展示为普通失败提示即可。
