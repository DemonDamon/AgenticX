# Meta 对话侧建群：新增 list_avatars / create_group_chat 工具

Planned-with: kimi-k3
Suggested-Impl-Model: gpt-5.6-terra-medium（后端单文件工具接线 + 桌面一行事件镜像 + 冒烟测试，中档代码模型够用）
Status: implementing
Plan-Id: 2026-08-11-meta-group-chat-tools

## 背景与根因（证据链）

用户在 Machi 对话中说「把刚刚创建的数字分身拉到一个群聊 / 新建项目群」，Machi 回答「无法直接创建群聊，请点 GUI 按钮」。排查确认这是**能力断层**而非模型推脱：

1. 后端能力早已存在：`agenticx/avatar/group_chat.py:92` `GroupChatRegistry.create_group(name, avatar_ids, routing)` 真写 `~/.agenticx/groups/<id>/group.yaml` 并 `ensure_group_workspace`；REST 出口 `agenticx/studio/server.py:5963` `POST /api/groups`。
2. Desktop GUI 已通：`desktop/src/components/groups/ProjectsView.tsx:122`「新建群聊」→ IPC `createGroup`。
3. **对话侧无出口**：`agenticx/runtime/meta_tools.py` 的 `_META_ONLY_TOOLS`（约 125-652 行）含 `create_avatar` / `delegate_to_avatar` / `chat_with_avatar` / `read_avatar_workspace` 等，但没有任何 group 工具，也没有 `list_avatars`。
4. 连带影响：系统提示每轮注入的 Avatars 列表（`agenticx/runtime/prompts/meta_agent.py:124-130`）是轮次开始时构建的，同一轮内新建的分身不会出现在列表里，模型只能靠猜 id。
5. Desktop 侧已有响应式机制：侧栏监听 `agenticx:groups:changed` 刷新群列表（`desktop/src/components/AvatarSidebar.tsx:181-188`）；`ChatPane.tsx:9125-9147` 已在 `create_avatar` 工具结果成功时派发 `agenticx:avatars:changed`——群创建需要同模式镜像，否则聊天建的群要等面板重挂载才可见。

## 目标

- FR-1：新增 meta 工具 `list_avatars`——实时列出已注册分身（id/name/role/description/tags），返回 `{"ok": true, "count", "avatars": [...]}`。
- FR-2：新增 meta 工具 `create_group_chat`——按名称或 id 解析成员、创建持久化项目群，返回 `{"ok": true, "group": {...}}`；成员全部无法解析时返回 `ok: false` + 可用分身候选清单。
- FR-3：系统提示补一条建群引导；Desktop 在 `create_group_chat` 成功工具结果时派发 `agenticx:groups:changed`，侧栏即时可见。
- FR-4：冒烟测试覆盖两个工具的成功/失败/幂等路径。

## 非目标（Out of scope）

- 不做「创建群聊后自动打开群聊窗格 / 自动建群会话」（群会话由 Desktop 侧用户点击进入后创建，与 delegation 的 owner session 链路不同，另行规划）。
- 不改 `GroupChatRegistry` 存储结构与 `POST /api/groups`。
- 不要求 `request_action_confirmation` 前置（与 GUI「新建群聊」直接保存的行为对齐；群可删可改，低风险）。
- 不动 `agenticx/studio/server.py`（高敏文件，本计划无需触碰）。
- 不做群成员编辑 / 删除群 / 改路由的对话侧工具（GUI 已有，后续按需）。

## 实施步骤

### FR-1/FR-2 落点 1：工具 schema（`agenticx/runtime/meta_tools.py`）

在 `_META_ONLY_TOOLS` 列表末尾（当前 `chat_with_avatar` spec 之后、约 651 行 `]` 之前）追加两个 spec：

```python
    {
        "type": "function",
        "function": {
            "name": "list_avatars",
            "description": (
                "List all registered digital avatars (数字分身) with fresh data "
                "from the registry. Use this to resolve avatar names/ids before "
                "delegation or group creation, especially after creating avatars "
                "earlier in the same turn (the prompt's Avatars list is built at "
                "turn start and may be stale)."
            ),
            "parameters": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_group_chat",
            "description": (
                "Create a persistent project group chat (项目群) from registered "
                "avatars. Members may be avatar ids or display names "
                "(case-insensitive). The group appears in the desktop project "
                "group list immediately. Duplicate group names are allowed; if a "
                "same-name group with identical members already exists, return it "
                "instead of creating a duplicate. Meta-Agent is always implicitly "
                "present in group chats and must NOT be listed as a member."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Group display name, e.g. 游戏开发工作室.",
                    },
                    "members": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Avatar ids or display names to include.",
                    },
                    "routing": {
                        "type": "string",
                        "enum": ["intelligent", "user-directed", "meta-routed", "round-robin"],
                        "description": "Optional routing strategy; default intelligent.",
                    },
                },
                "required": ["name", "members"],
                "additionalProperties": False,
            },
        },
    },
```

### FR-1/FR-2 落点 2：dispatch 分支（`dispatch_meta_tool_async`）

在 `create_avatar` 分支（当前约 2988-3042 行）之后、`delegate_to_avatar` 分支之前插入：

```python
    if name == "list_avatars":
        from agenticx.avatar.registry import AvatarRegistry

        registry = AvatarRegistry()
        avatars = [
            {
                "avatar_id": av.id,
                "name": av.name,
                "role": av.role,
                "description": av.description,
                "tags": list(av.tags or []),
            }
            for av in registry.list_avatars()
        ]
        return json.dumps(
            {"ok": True, "count": len(avatars), "avatars": avatars},
            ensure_ascii=False,
        )

    if name == "create_group_chat":
        from agenticx.avatar.group_chat import GroupChatRegistry
        from agenticx.avatar.registry import AvatarRegistry

        group_name = str(arguments.get("name", "")).strip()
        raw_members = arguments.get("members")
        routing = str(arguments.get("routing", "intelligent")).strip() or "intelligent"
        if routing not in {"intelligent", "user-directed", "meta-routed", "round-robin"}:
            return json.dumps(
                {"ok": False, "error": "invalid_routing", "message": f"非法 routing: {routing}"},
                ensure_ascii=False,
            )
        if not group_name:
            return json.dumps(
                {"ok": False, "error": "missing_name", "message": "name is required to create a group chat."},
                ensure_ascii=False,
            )
        if not isinstance(raw_members, list) or not raw_members:
            return json.dumps(
                {"ok": False, "error": "missing_members", "message": "members must be a non-empty list of avatar names or ids."},
                ensure_ascii=False,
            )
        avatar_registry = AvatarRegistry()
        all_avatars = avatar_registry.list_avatars()
        resolved_ids: list[str] = []
        resolved_names: list[str] = []
        unresolved: list[str] = []
        for item in raw_members:
            query = str(item).strip()
            if not query:
                continue
            match = None
            for av in all_avatars:
                if query.lower() in ((av.id or "").lower(), (av.name or "").lower()):
                    match = av
                    break
            if match is None:
                unresolved.append(query)
                continue
            if match.id not in resolved_ids:
                resolved_ids.append(match.id)
                resolved_names.append(match.name)
        if not resolved_ids:
            return json.dumps(
                {
                    "ok": False,
                    "error": "members_unresolved",
                    "unresolved": unresolved,
                    "message": "未能解析任何成员，请用 list_avatars 获取有效分身名称/id 后重试。",
                    "available_avatars": [
                        {"avatar_id": av.id, "name": av.name} for av in all_avatars
                    ],
                },
                ensure_ascii=False,
            )
        group_registry = GroupChatRegistry()
        wanted = set(resolved_ids)
        for existing in group_registry.list_groups():
            if existing.name == group_name and set(existing.avatar_ids or []) == wanted:
                return json.dumps(
                    {
                        "ok": True,
                        "existing": True,
                        "group": existing.to_dict(),
                        "message": f"同名同成员群聊「{group_name}」已存在（id={existing.id}），直接复用。",
                    },
                    ensure_ascii=False,
                )
        config = group_registry.create_group(name=group_name, avatar_ids=resolved_ids, routing=routing)
        return json.dumps(
            {
                "ok": True,
                "group": config.to_dict(),
                "resolved_members": resolved_names,
                "unresolved": unresolved,
                "message": (
                    f"项目群「{config.name}」已创建（id={config.id}，成员 {len(resolved_ids)} 人："
                    f"{'、'.join(resolved_names)}），已出现在项目群列表，点击即可开始群聊。"
                ),
            },
            ensure_ascii=False,
        )
```

注意点（实施者必读）：

- 成员解析**同时支持 id 与 name**，比较统一 `lower()`；去重保持入参顺序。
- 部分成员解析失败**不阻断**建群，但结果必须带 `unresolved` 让模型向用户说明。
- 幂等键 = `name + 成员 id 集合`；命中已有群返回 `ok: true, existing: true`，不重复创建。
- 两个工具的返回都是单行 JSON 字符串（与既有分支一致），异常不得上抛——registry 读取失败时用 try/except 包成 `{"ok": False, "error": ...}`（参照 `create_avatar` 分支现有风格，若其无 try 则保持一致不额外加）。
- routing 默认值与 `GroupChatConfig.routing` 默认一致（`intelligent`）；`team` 值仅 server 路由接受，本工具不放行（GUI 编辑器亦不含）。

### FR-3 落点 1：系统提示引导（`agenticx/runtime/prompts/meta_agent.py`）

在「## 分身协作」段落工具引导列表中（当前约 1001-1007 行，`chat_with_avatar` / `delegate_to_avatar` 引导附近）追加一条：

```
- 需要列出/核对当前已注册分身（尤其本轮刚创建过分身、提示词中的 Avatars 列表可能滞后）时，使用 `list_avatars` 获取实时名单。
- 用户要求把分身拉群、新建项目群/团队群时，使用 `create_group_chat(name, members, routing?)`；members 可传分身名或 id。创建成功后向用户汇报群名与成员，并提示可在「项目群」列表进入群聊。
```

### FR-3 落点 2：Desktop 即时刷新（`desktop/src/components/ChatPane.tsx`）

在 `create_avatar` 工具结果处理块（当前约 9125-9147 行）之后镜像追加：

```typescript
              if (toolName === "create_group_chat") {
                try {
                  const rawResult = payload.data?.result;
                  const parsed =
                    typeof rawResult === "string"
                      ? (JSON.parse(rawResult) as Record<string, unknown>)
                      : (rawResult as Record<string, unknown> | null | undefined);
                  if (parsed && parsed.ok) {
                    window.dispatchEvent(
                      new CustomEvent("agenticx:groups:changed", {
                        detail: { groupId: String((parsed.group as Record<string, unknown> | undefined)?.id ?? "").trim() },
                      })
                    );
                  }
                } catch {
                  // Ignore parse errors; tool card still renders via formatter.
                }
              }
```

侧栏 `AvatarSidebar.tsx:181-188` 已监听该事件并 `refreshGroups()`，无需改动。

### FR-4：测试（`tests/test_meta_group_tools.py`，新建）

调用方式参照 `tests/test_meta_tools.py`：`asyncio.run` + `dispatch_meta_tool_async(..., team_manager=AgentTeamManager(llm_factory=lambda: _QuickTextLLM(), base_session=StudioSession()))`（本工具不触碰 team_manager，仅满足签名）。

**隔离要求**：`AvatarRegistry()` / `GroupChatRegistry()` 默认写 `~/.agenticx`，测试必须用 `monkeypatch` 把 `agenticx.avatar.registry.AVATARS_ROOT` 与 `agenticx.avatar.group_chat.GROUPS_ROOT`（两模块顶层常量，registry `__init__` 的默认 root 来源于它们）替换到 `tmp_path`，禁止污染真实数据。实施前先读两个模块 `__init__` 确认常量名，若实际字段名不同以代码为准。

用例：

1. `test_list_avatars_empty_and_fresh`：空注册表返回 `ok, count=0`；`create_avatar` 建 1 个后 `list_avatars` 立即可见（验证实时读注册表）。
2. `test_create_group_chat_by_names_and_ids`：建 3 个分身，members 混传 name/id，断言 `ok`、`group.avatar_ids` 去重且顺序正确、`resolved_members` 为名字；`group.yaml` 落盘可读回。
3. `test_create_group_chat_unresolved_members`：全部成员不存在 → `ok: false, error: members_unresolved` 且带 `available_avatars`；部分存在 → 建群成功且 `unresolved` 含失败名。
4. `test_create_group_chat_idempotent_same_membership`：同名同成员调用两次，第二次 `existing: true` 且 group id 相同；同名不同成员 → 新建不同 id。
5. `test_create_group_chat_validation`：缺 name / 空 members / 非法 routing 分别返回对应 `ok: false` error code。
6. `test_meta_tool_specs_registered`：`META_AGENT_TOOLS` 中含 `list_avatars` 与 `create_group_chat` 且 schema `required` 正确。

回归：`python -m pytest tests/test_meta_tools.py tests/test_meta_agent_taskspaces_context.py tests/test_loop_halt_progress.py -q` 全绿；Desktop 侧 `pnpm --dir desktop typecheck`（或 `npx tsc --noEmit`，以 desktop/package.json 现有脚本为准）通过。

## Requirements

- FR-1: `list_avatars` 实时返回注册表分身列表（ok/count/avatars）。
- FR-2: `create_group_chat` 支持 name/id 混合解析、去重保序、部分失败上报、同名同成员幂等复用、非法输入明确 error code；成功返回 group + resolved_members + 中文 message。
- FR-3: meta 系统提示新增两条工具引导；Desktop `create_group_chat` ok 结果派发 `agenticx:groups:changed`。
- FR-4: 6 条新测试全绿；相关回归全绿；desktop typecheck 通过。
- NFR-1: 不新增依赖；所有工具返回单行 JSON 字符串；异常不外抛。
- NFR-2: 不触碰 `studio/server.py`；不改注册表存储格式。
- AC-1: 测试 1-6 全部通过且使用 tmp_path 隔离。
- AC-2: 手工验证路径（描述即可，不阻塞）：对话中「把刚建的分身拉成群」→ Machi 调 `create_group_chat` → 侧栏项目群即时出现。
