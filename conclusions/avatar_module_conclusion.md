# AgenticX Avatar 模块总结

> 结论更新时间：2026-09-01（覆盖前一基线 `f3ba65001c29` 之后的变更）

## 目录路径

`agenticx/avatar/`

## 模块概述

Avatar 模块提供多分身（Avatar）和群聊（GroupChat）的持久化管理能力，是 AgenticX Desktop 多分身 UX 的数据层支撑。每个 Avatar 拥有独立的 workspace 目录和初始 identity/memory 文件；群聊（GroupChat）管理多分身的会话路由策略。

---

## 目录结构

```
agenticx/avatar/
├── __init__.py       # 包入口
├── registry.py       # AvatarRegistry：Avatar CRUD + workspace 初始化 + 头像生成/回填
├── portrait.py       # 分身插画头像：DiceBear Notionists 线稿 + 本地 SVG 兜底
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
| `avatar_url` | str | 头像图片 URL（可为 data URL） |
| `portrait_style` | str | **(NEW)** 头像来源标记：`notionists-v1`=生成的插画风线稿；`custom`=用户上传；空串=未标记的老数据 |
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
- `list_avatars()`：按 pinned 优先、created_at 降序排列；**(NEW)** 返回前对缺头像/老数据的分身做惰性回填——`needs_portrait_refresh()` 判定后用 `ThreadPoolExecutor`（最多 6 worker）并发调 `_ensure_portrait()` 拉取 Notionists 线稿并落盘
- `get_avatar(avatar_id)`：读取单条配置
- `create_avatar(name, role, ...)`：创建 Avatar，自动初始化 workspace（含 IDENTITY.md / MEMORY.md / memory/）；**(NEW)** 未传 `avatar_url` 时自动调 `generate_avatar_portrait_url()` 生成插画头像并标记 `portrait_style=notionists-v1`，用户自带 URL 则标记 `custom`
- `update_avatar(avatar_id, patch)`：增量更新；`id`、`created_at`、`workspace_dir` 为不可变字段；对 `skills_enabled` / `brains_enabled` 走专门的归一化分支；**(NEW)** patch 含 `avatar_url` 时：清空则重新生成插画头像（`notionists-v1`），换成新 URL 则标记 `custom`
- `delete_avatar(avatar_id)`：删除 avatar 目录及所有文件（`shutil.rmtree`）；删除前先调用 `BrainRegistry.instance().delete_private_brains_for_avatar(avatar_id)` 清理该分身的 private brain

**存储根目录惰性解析（NEW）**：`AVATARS_ROOT` 不再是 import 时被 `Path.home()` 定死的模块级常量，改为 `_avatars_root()` 按调用时的 HOME 解析（`agenticx/utils/agx_home.py` 的 `lazy_home_path`），并保留 PEP 562 `__getattr__` 供外部读取——避免测试重定向 HOME 后数据仍写进开发者真实的 `~/.agenticx`。

**Workspace 初始化**（`_ensure_avatar_workspace`）：
- 创建 `workspace/` 和 `workspace/memory/` 目录
- 写入 `IDENTITY.md`（包含 name/role 的身份模板）
- 写入 `MEMORY.md`（长期记忆模板，记录 created_at）

---

### portrait.py（NEW，分身插画头像）

为分身生成「安静线稿」风格的插画头像，默认走 DiceBear Notionists 合集，网络不可达时回退本地生成的 SVG。

**核心接口**：
- `generate_avatar_portrait_url(name, role, description, tags, avatar_id)`：主入口，返回可直接写入 `AvatarConfig.avatar_url` 的 data URL；合集可达时下载 PNG 转 base64，否则用 `build_avatar_portrait_svg()` 本地生成 128×128 线稿 SVG
- `infer_portrait_traits(...)`：从 name/role/description/tags 推断 Notionists 查询参数——性别（中英文提示词 + 中文名字尾字表 + hash 兜底）、发型（长发/马尾/卷发/短发/光头关键词）、眼镜/墨镜
- `needs_portrait_refresh(avatar_url, portrait_style)`：判定存量头像是否应替换为线稿（空 URL、老的 data SVG、或无 style 标记的老数据返回 True；`custom` / `notionists-v1` 不覆盖）
- `collection_fetch_enabled()`：测试环境（`pytest` 已加载）或 `AGX_SKIP_AVATAR_FETCH=1` 时跳过远程拉取
- 合集请求带 6s 超时、180KB 上限与 PNG magic 校验；seed 由 `name:avatar_id` 派生，保证同一分身脸不变；配色 `_PALETTE_RGB` 与 `desktop/src/utils/avatar-color.ts` 的 `AVATAR_PALETTE` 顺序对齐

---

### GroupChatRegistry（group_chat.py）

**存储路径**：`~/.agenticx/groups/<group_id>/group.yaml`（**(NEW)** `GROUPS_ROOT` 与 `AVATARS_ROOT` 一样改为 `_groups_root()` 惰性解析 + PEP 562 `__getattr__`，按调用时 HOME 求值）

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
