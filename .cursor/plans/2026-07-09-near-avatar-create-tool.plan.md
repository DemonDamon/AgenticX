# Near 自然语言创建数字分身：create_avatar 工具 + agent-builder skill 重写

Planned-with: claude-opus-4.8

## 背景与根因（证据链，不依赖对话记忆）

用户让 Near（Meta-Agent）"创建一个金融市场数字分身"，Near 完成了需求澄清（市场/风格/风险偏好）并产出了完整的 name/role/system_prompt/输出模板，但**最终只把内容写成了桌面 Markdown 文件，没有真正把分身加入桌面端「分身」列表**（截图1 那种可点击的 Avatar 条目）。Near 自称"当前工具里没有新增 Avatar 的直接接口"。

排查结论：**能力齐全，唯独缺一个 Agent 侧执行器工具。**

1. 后端 `AvatarRegistry.create_avatar()` 完整可用：`agenticx/avatar/registry.py:131-180`，落库到 `~/.agenticx/avatars/<id>/avatar.yaml` 并初始化 workspace（IDENTITY.md / MEMORY.md）。
2. Studio 已暴露 HTTP 接口：`POST /api/avatars`（`agenticx/studio/server.py:4834-4866`）与 `POST /api/avatars/generate`（同文件 `5267-5306`，传一句自然语言描述由 LLM 生成 name/role/system_prompt 并落库）。
3. **缺失点**：`agenticx/runtime/meta_tools.py` 的 `_META_ONLY_TOOLS` / `META_AGENT_TOOLS`（约 `216-600`）里只有 `spawn_subagent`（临时子智能体）与 `delegate_to_avatar`（委派**已存在**分身），**没有 `create_avatar`**。因此 Meta-Agent 无论澄清得多好都无法落地，只能退化为写文件。
4. **误导来源**：`agenticx/skills/agenticx-agent-builder/SKILL.md` 讲的是 Python SDK 的 `Agent()`/`AgentExecutor`/`agx agent create` CLI（代码层 agent，不是桌面 Avatar），完全没提 `AvatarRegistry`。Near 激活该 skill 后被误导判断"没有接口"。

## 设计原则（回答"tool 还是 skill"）

两者互补，各司其职，缺一不可：
- **Skill = 方法论**：多轮澄清 → 把散乱需求提炼成 `name / role / system_prompt / default_model / skills_enabled` 结构（当前的澄清体验要保留，但内容要改对）。
- **Tool = 执行器**：`create_avatar` 直接进程内调 `AvatarRegistry.create_avatar(...)`，真正落库并返回 `avatar_id`。

只有 skill 没有 tool = 当前 bug；只有 tool 没有 skill = 生硬问答、易漏配置。

## In scope

- 后端：新增 Meta-Agent 工具 `create_avatar`（可选一并加 `update_avatar`），及其在 `dispatch_meta_tool_async` 的 handler。
- 后端：把新工具接进 `_META_ONLY_TOOLS` / `META_AGENT_TOOLS`，并在 spawn 拦截逻辑不受影响的前提下让新工具可被调用。
- Skill：重写 `agenticx-agent-builder/SKILL.md`，改为面向 Near 桌面 Avatar 的访谈式创建 playbook（澄清 → 提炼 → 调 `create_avatar` → 确认）。
- 前端：`create_avatar` 工具结果到达后，自动刷新侧栏分身列表并自动打开新分身窗格；ChatPane 工具卡片展示友好文案。

## Out of scope（no-scope-creep 边界）

- 不做自动头像生成（`avatar_url` 图像模型）——留到后续「core_icon」档，本次 `avatar_url` 传空。
- 不改 `spawn_subagent` / `delegate_to_avatar` 既有逻辑，不重构 `AvatarRegistry`。
- 不新增群聊创建工具、不动 automation/定时任务。
- 不改 `/api/avatars` HTTP 接口签名（工具走进程内 registry，不自调 HTTP）。
- 不改 `agenticx/studio/server.py` 顶部 import 区（该文件极敏感，本次无需触碰；若最终无需改 server.py 则完全不动它）。

---

## 变更点 1（FR-1）：后端新增 `create_avatar` Meta 工具定义

**文件**：`agenticx/runtime/meta_tools.py`
**落点**：`_META_ONLY_TOOLS` 列表内，紧邻 `delegate_to_avatar` 定义之后（当前 `delegate_to_avatar` 在约 `527-547`，`read_avatar_workspace` 在 `548-567`）。在这两者之间插入新工具定义。

**新增工具 schema（意图）**：
```python
{
    "type": "function",
    "function": {
        "name": "create_avatar",
        "description": (
            "Create a new persistent digital avatar (数字分身) in the desktop "
            "avatar list. Use this after clarifying the user's needs and "
            "distilling a name, role, and system_prompt. The avatar is written "
            "to the registry and immediately appears in the sidebar. "
            "Do NOT just write a markdown file — this tool actually creates it."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Avatar display name, e.g. 飞廉."},
                "role": {"type": "string", "description": "Short role, e.g. 进取型全市场交易分析师."},
                "system_prompt": {"type": "string", "description": "Full system prompt distilled from the conversation."},
                "default_provider": {"type": "string", "description": "Optional default provider id."},
                "default_model": {"type": "string", "description": "Optional default model id."},
            },
            "required": ["name", "role", "system_prompt"],
            "additionalProperties": False,
        },
    },
},
```

**AC-1**：`META_AGENT_TOOLS` 中存在 `name == "create_avatar"` 的条目；`delegate_to_avatar` / `read_avatar_workspace` / `chat_with_avatar` 仍在。断言测试见 AC-4。

---

## 变更点 2（FR-2）：`create_avatar` 的 dispatch handler

**文件**：`agenticx/runtime/meta_tools.py`
**落点**：`dispatch_meta_tool_async`（`2446` 起）。在 `spawn_subagent` 分支之后、其它 `if name == ...` 分支中间，新增：

```python
if name == "create_avatar":
    from agenticx.avatar.registry import AvatarRegistry  # 与 spawn 分支同风格的局部 import
    av_name = str(arguments.get("name", "")).strip()
    av_role = str(arguments.get("role", "")).strip()
    av_prompt = str(arguments.get("system_prompt", "")).strip()
    if not av_name:
        return json.dumps({"ok": False, "error": "missing_name",
                           "message": "name is required to create an avatar."},
                          ensure_ascii=False)
    registry = AvatarRegistry()
    # 去重：同名已存在则不重复创建，引导改用 delegate_to_avatar
    for _av in registry.list_avatars():
        if av_name.lower() == (_av.name or "").lower():
            return json.dumps({"ok": False, "error": "avatar_exists",
                               "avatar_id": _av.id,
                               "message": f"分身「{av_name}」已存在（id={_av.id}），"
                                          f"如需交给它做事请用 delegate_to_avatar。"},
                              ensure_ascii=False)
    cfg = registry.create_avatar(
        name=av_name,
        role=av_role,
        system_prompt=av_prompt,
        created_by="meta",
        default_provider=str(arguments.get("default_provider", "")).strip(),
        default_model=str(arguments.get("default_model", "")).strip(),
    )
    return json.dumps({"ok": True, "avatar_id": cfg.id, "name": cfg.name,
                       "role": cfg.role,
                       "message": f"数字分身「{cfg.name}」已创建并加入分身列表（id={cfg.id}）。"},
                      ensure_ascii=False)
```

**说明**：
- 走**进程内** `AvatarRegistry()`，不自调 HTTP、不处理 `X-AGX-Desktop-Token`（与 `spawn_subagent` 分支 `2474-2476` 一致）。
- `created_by="meta"` 便于区分来源（对齐 `/api/avatars/generate` 用 `"ai"`）。
- 返回 JSON 含 `avatar_id`/`name`，供前端侦测（FR-4）与 Meta 后续 `delegate_to_avatar`。

**AC-2**：单测调用 `dispatch_meta_tool_async("create_avatar", {...}, team_manager=..., session=None)`，用临时 `AvatarRegistry(root=tmp_path)`（通过 monkeypatch `AvatarRegistry` 或注入 root）后，`~/.agenticx/avatars/<id>/avatar.yaml` 被写出且 `list_avatars()` 能读到；同名二次调用返回 `error == "avatar_exists"`。

---

## 变更点 3（FR-3）：重写 agent-builder skill 为「Near Avatar 访谈式创建」

**文件**：`agenticx/skills/agenticx-agent-builder/SKILL.md`（整篇改写正文，保留 frontmatter 的 name，`version` bump 到 `0.5.0`，`description` 改为面向桌面分身创建）。

**新正文要点（结构约束）**：
1. 明确目标：帮用户在桌面端创建**持久数字分身（Avatar）**，最终**必须调用 `create_avatar` 工具**落地，禁止只写 Markdown 文件。
2. 访谈流程（分 2-3 轮澄清，不要一次问十个问题）：定位/职责 → 关注领域与风格 → 风险/边界或输出偏好。可用 `show_widget` 或 clarification 让用户点选。
3. 提炼产物：`name`（简短角色化）、`role`（一句话定位）、`system_prompt`（含定位/优先级/边界/输出结构/免责声明）。
4. 落地：调用 `create_avatar(name=..., role=..., system_prompt=..., default_model=可选)`；成功后向用户确认"已加入分身列表，可直接点开或 @ 它"，并可建议是否再建定时任务。
5. 反面清单：不要说"没有创建接口"、不要只落盘文件、不要让用户手填一堆表单。
6. **删除**所有 Python SDK（`Agent()`/`AgentExecutor`/`@tool`/`agx agent create`）内容——那是代码层 agent，与桌面 Avatar 无关，是本次误导根源。

**AC-3**：`SKILL.md` 正文出现 `create_avatar`，不再出现 `AgentExecutor`/`agx agent create`；frontmatter `name: agenticx-agent-builder` 保留、`version` 已 bump。

---

## 变更点 4（FR-4）：前端——建完自动刷新侧栏 + 自动开窗格 + 工具卡片文案

### 4a. 工具结果卡片文案
**文件**：`desktop/src/components/ChatPane.tsx`
**落点**：`formatToolResultMessage`（`1375`），在 `delegate_to_avatar` 分支（`1384`）附近新增 `create_avatar` 分支：解析 `ok`/`name`/`avatar_id`，`ok` 时返回 `✅ 数字分身「<name>」已创建并加入分身列表`；`avatar_exists` 时返回相应提示。

### 4b. 侦测创建成功 → 派发全局事件 + 自动开窗格
**文件**：`desktop/src/components/ChatPane.tsx`
**落点**：`payload.type === "tool_result"` 处理块（`8191-8207` 附近，`formatToolResultMessage` 调用点之后）。当 `toolName === "create_avatar"` 且结果 `ok === true` 时：
```ts
try {
  const r = typeof payload.data?.result === "string"
    ? JSON.parse(payload.data.result) : payload.data?.result;
  if (r && r.ok && r.avatar_id) {
    window.dispatchEvent(new CustomEvent("agenticx:avatars:changed",
      { detail: { avatarId: r.avatar_id, name: r.name } }));
  }
} catch { /* ignore parse errors */ }
```
（自动开窗格可复用 `addPane(avatarId, name, "")` 路径，见 `App.tsx:1931-1940` 的 `resolveForwardTargetForFavorite` avatar 分支模式；本次最小实现只需刷新侧栏，"自动开窗格"作为增强可在同一事件里由订阅方处理。）

### 4c. 侧栏订阅事件刷新
**文件**：`desktop/src/components/AvatarSidebar.tsx`
**落点**：新增一个 `useEffect`（紧邻现有 `284-288` 的 automation 轮询 effect），监听 `window` 的 `"agenticx:avatars:changed"` 事件 → `void refreshAvatars()`（`refreshAvatars` 已定义于 `171`）；cleanup 时 `removeEventListener`。

**AC-4**：`agx serve` 冷启动后，在 Near（Meta）会话说"帮我创建一个金融市场分身"，经澄清后 Near 调用 `create_avatar`；**无需重启/手动刷新**，左侧「分身」列表新增该条目（对齐截图1），且工具卡片显示成功文案。

---

## 验收与回归

- **后端单测**（新增 `tests/test_smoke_create_avatar_tool.py`）：
  - 覆盖 AC-1（工具在 `META_AGENT_TOOLS` 中）、AC-2（dispatch 落库 + 同名去重）。
  - 用 `monkeypatch` 让 `AvatarRegistry` 指向 `tmp_path`，避免污染真实 `~/.agenticx`。
- **server.py 门槛**：本次预期**不改** `server.py`；若确有改动，必须按 AGENTS.md 规则冷启动 `agx serve --host 127.0.0.1 --port <临时端口>` 验证 `/api/session`、`/api/avatars`、`/api/sessions` 返回 200。
- **前端**：`desktop` 目录 `npm run build`（或 typecheck）绿；手动走一遍 AC-4。
- **Skill**：不影响运行时注册，人工校对 AC-3。

## 建议实施模型（Suggested-Impl-Model）

| 子任务 | 推荐模型 | 理由 |
|---|---|---|
| FR-1/FR-2 后端工具与 dispatch（含单测） | gpt-5.3-codex | 后端接线、序列/去重逻辑，代码专精中档够用且稳 |
| FR-3 skill 重写 | kimi-k2.7-code 或 composer-2.5-fast | 文档改写，低风险，便宜档即可 |
| FR-4 前端事件/卡片/侧栏订阅 | composer-2.5-fast | 前端小改，非重塑，性价比优先 |

Suggested-Impl-Model: gpt-5.3-codex
