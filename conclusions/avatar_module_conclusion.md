# AgenticX Avatar 模块总结

> 结论更新时间：2026-05-29（覆盖 2026-04-29 之后的变更）

## 目录路径

`agenticx/avatar/`

## 模块概述

Avatar 模块提供多分身（Avatar）和群聊（GroupChat）的持久化管理能力，是 AgenticX Desktop 多分身 UX 的数据层支撑。每个 Avatar 拥有独立的 workspace 目录和初始 identity/memory 文件；群聊（GroupChat）管理多分身的会话路由策略。

---

## 目录结构

```
agenticx/avatar/
├── __init__.py       # 包入口
├── registry.py       # AvatarRegistry：Avatar CRUD + workspace 初始化
└── group_chat.py     # GroupChatRegistry：群聊 CRUD
```

---

## 核心组件

### AvatarRegistry（registry.py）

**存储路径**：`~/.agenticx/avatars/<avatar_id>/avatar.yaml`

**数据模型 — AvatarConfig**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | str | 12 位 hex UUID |
| `name` | str | 显示名称 |
| `role` | str | 角色描述 |
| `avatar_url` | str | 头像图片 URL |
| `system_prompt` | str | 自定义系统提示 |
| `workspace_dir` | str | 独立工作区路径（`~/.agenticx/avatars/<id>/workspace`） |
| `created_by` | str | 创建方式（manual / api） |
| `default_provider` | str | 默认 LLM provider |
| `default_model` | str | 默认模型名称 |
| `pinned` | bool | 是否置顶 |
| `tools_enabled` | Dict[str, bool] | 分身级工具启停覆盖 |
| `skills_enabled` | Optional[Dict[str, bool]] | 分身级技能启停覆盖（仅写显式关闭项） |
| `brains_enabled` | Optional[Any] | **(NEW)** 挂载知识脑策略：`None`=仅挂载 global brains；`"*"`=所有可见 brain；`list`=显式 brain id 列表 |
| `created_at` / `updated_at` | str | ISO 8601 UTC 时间戳 |

> **(NEW，2026-05-20 多脑知识库架构 MVP，commit `d695c202`)**：`AvatarConfig` 新增 `brains_enabled` 字段，将知识库从进程级单例升级为 Brain（知识脑）一等实体的分身级挂载。`to_dict()` 对 `brains_enabled` / `skills_enabled` 做显式非空保留（区分 `None` 与空集合）；`update_avatar()` 对 `brains_enabled` 做归一化（空串/None → `None`、`"*"` 保留、list 去空白）。

**核心方法**：
- `list_avatars()`：按 pinned 优先、created_at 降序排列
- `get_avatar(avatar_id)`：读取单条配置
- `create_avatar(name, role, ...)`：创建 Avatar，自动初始化 workspace（含 IDENTITY.md / MEMORY.md / memory/）
- `update_avatar(avatar_id, patch)`：增量更新；`id`、`created_at`、`workspace_dir` 为不可变字段；对 `skills_enabled` / `brains_enabled` 走专门的归一化分支
- `delete_avatar(avatar_id)`：删除 avatar 目录及所有文件（`shutil.rmtree`）；**(NEW)** 删除前先调用 `BrainRegistry.instance().delete_private_brains_for_avatar(avatar_id)` 清理该分身的 private brain

**Workspace 初始化**（`_ensure_avatar_workspace`）：
- 创建 `workspace/` 和 `workspace/memory/` 目录
- 写入 `IDENTITY.md`（包含 name/role 的身份模板）
- 写入 `MEMORY.md`（长期记忆模板，记录 created_at）

---

### GroupChatRegistry（group_chat.py）

**存储路径**：`~/.agenticx/groups/<group_id>/group.yaml`

**数据模型 — GroupChatConfig**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | str | 12 位 hex UUID |
| `name` | str | 群聊名称 |
| `avatar_ids` | List[str] | 成员 Avatar ID 列表 |
| `routing` | str | 路由策略：`intelligent` / `user-directed` / `meta-routed` / `round-robin` / `team` |
| `created_at` / `updated_at` | str | ISO 8601 UTC 时间戳 |

**路由策略说明**：
- `intelligent`：（默认）Machi 持续监控全局上下文，自动选人、追踪线程；**（2026-04-29 新增）** 当用户未 @ 任何成员且消息命中复杂多步任务启发式（`_is_complex_multistep_task`）时，自动 dispatch 到 `_run_team_turn` 启用 Workforce 任务编排；用户无需感知或显式切换
- `user-directed`：用户直接 @ 指定 Avatar 响应（**不**触发 Workforce auto-dispatch）
- `meta-routed`：Meta-Agent 根据上下文自动选择 Avatar（**不**触发 Workforce auto-dispatch）
- `round-robin`：群成员轮流响应（**不**触发 Workforce auto-dispatch）
- `team`：（API 兼容保留，UI 不暴露）每条消息都强制走 Workforce；仅供 API 调试或已设置过此模式的老用户。新用户不应选择此模式，应使用默认 `intelligent`（自动判断更智能）；参见 ADR `docs/adr/0002-group-chat-workforce-bridge.md`

**核心方法**：
- `list_groups()`：列出所有群聊
- `create_group(name, avatar_ids, routing)`：创建群聊配置
- `update_group(group_id, patch)`：增量更新；`id`、`created_at` 不可变
- `delete_group(group_id)`：删除群聊目录

---

## Workspace 全局模板

**Avatar IDENTITY.md 模板**：
```markdown
# IDENTITY.md - {name}

- Name: {name}
- Role: {role}
- Vibe: Pragmatic, structured, concise, execution-first
- Language: Chinese by default
```

**Avatar MEMORY.md 模板**：
```markdown
# MEMORY.md - Long-Term Anchors

## Agent Notes
- Avatar created: {created_at}
- Keep this file short and curated.
```

---

## 与其他模块的关系

- **Studio Server**：通过 `/api/avatars/*` 和 `/api/groups/*` API 暴露 AvatarRegistry / GroupChatRegistry CRUD；avatar session 使用分身专属 system prompt 和工具集
- **SessionManager**：`ManagedSession` 携带 `avatar_id` / `avatar_name` 字段，会话列表支持 `avatar_id` 过滤
- **Meta-Agent 真委派**：`meta_tools.py` 中 `delegate_to_avatar` 工具通过 `_find_or_create_avatar_session()` 查找或创建 Avatar 的真实 session，在其中独立执行 `AgentRuntime` 循环（使用 Avatar 配置的 default_provider / default_model，回退到 Meta-Agent 的 provider/model）
- **Meta-Agent 系统提示**：`prompts/meta_agent.py` 调用 `AvatarRegistry().list_avatars()` 动态注入 Avatars 上下文
- **Desktop Store**：通过 IPC `agx:avatar:*` / `agx:group:*` 通道同步状态到前端；委派触发后前端自动打开对应 Avatar 窗格
- **Brain 知识脑（NEW）**：`agenticx/brain` 模块据 `AvatarConfig.brains_enabled` 决定分身可挂载的知识脑；`knowledge_search` / `code_search` 工具按挂载 brain 路由（可选 `brain_id`）；删除分身时联动清理其 private brain

---

## 设计特点

1. **YAML 持久化**：每个 Avatar / Group 存储为独立目录下的 YAML 文件，无需数据库
2. **Workspace 隔离**：每个 Avatar 拥有独立 workspace，identity 和 memory 文件相互不污染
3. **不可变字段保护**：`id`、`created_at`、`workspace_dir` 在 update 时被显式过滤，防止误修改
4. **轻量 CRUD**：无依赖 ORM，直接 YAML 读写；`uuid.uuid4().hex[:12]` 生成 12 位唯一 ID
