# AgenticX Avatar 模块总结

> 结论更新时间：2026-09-30（覆盖基线 `30e57496990b0e2acb18978091d9e623210eaba3` 之后的变更）

## 目录路径

`agenticx/avatar/`

## 模块概述

Avatar 模块提供多分身（Avatar）和群聊（GroupChat）的持久化管理能力，是 AgenticX Desktop 多分身 UX 的数据层支撑。每个 Avatar 拥有独立的 workspace 目录和初始 identity/memory 文件；群聊（GroupChat）管理多分身的会话路由策略，并可登记来自 Desktop / IM 的人类成员。

---

## 目录结构

```
agenticx/avatar/
├── __init__.py       # 包入口
├── registry.py       # AvatarRegistry：Avatar CRUD + workspace 初始化 + 头像生成/回填
├── portrait.py       # 分身头像：本地生成 Near 立方体（near-cube-v3）配色款 SVG，无网络
├── near_cube_luma.png # Near 官方立方体标志的灰度光照 + alpha 蒙版素材（portrait.py 内嵌为 data URL）
├── group_members.py  # 群聊人类成员 ID 规范（human:<platform>:<external_id>）
└── group_chat.py     # GroupChatRegistry：群聊 CRUD + 人类成员登记
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
| `portrait_style` | str | 头像来源标记：`near-cube-v3`=生成的 Near 立方体配色款（`PORTRAIT_STYLE`）；`custom`=用户上传；`COLLECTION_STYLE_IDS` 中的其他合集 id（如 `bottts`、`ip-mascot` 等）=前端选定的合集头像；`notionists-v1`（`PORTRAIT_STYLE_LEGACY_GENERATED`）与空串为待迁移的老数据 |
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
- `list_avatars()`：按 pinned 优先、created_at 降序排列；返回前对缺头像/老数据的分身做惰性回填——`needs_portrait_refresh()` 判定后（仍受 `collection_fetch_enabled()` 门控）用 `ThreadPoolExecutor`（最多 6 worker）并发调 `_ensure_portrait()`，现生成本地 Near 立方体头像（传入 `color`）并落盘；随后调 `_dedupe_cube_colorways()`：按 created_at 升序保留最早的配色款，后建且配色款（`data-colorway`）重复的非 custom 立方体头像重新生成并写回
- `_occupied_colorways(exclude_id)`：扫描全部非 custom 分身头像中已占用的 colorway id，供新建/重生成时避免撞色
- `get_avatar(avatar_id)`：读取单条配置
- `create_avatar(name, role, ..., portrait_style="")`：创建 Avatar，自动初始化 workspace（含 IDENTITY.md / MEMORY.md / memory/）；未传 `avatar_url` 时调 `generate_avatar_portrait_url(color=..., taken_colorways=self._occupied_colorways())` 生成唯一配色款立方体并标记 `near-cube-v3`；自带 URL 时，若 `portrait_style` 属于 `COLLECTION_STYLE_IDS`（且非 `near-cube-v3`）则保留该合集标记，否则标记 `custom`
- `update_avatar(avatar_id, patch)`：增量更新；`id`、`created_at`、`workspace_dir` 为不可变字段；对 `skills_enabled` / `brains_enabled` 走专门的归一化分支；`portrait_style` 不直接 setattr，按以下规则解析：patch 含 `avatar_url` 时——清空则按占用配色重新生成立方体（`near-cube-v3`），请求的 `portrait_style` 为合集 id 或 `near-cube-v3` 则采用之，否则 URL 变化标记 `custom`；仅含 `portrait_style` 时接受合集 id 或 `custom`；仅 `color` 变化且当前不是 custom/其他合集头像时，按新颜色重新生成立方体
- `delete_avatar(avatar_id)`：删除 avatar 目录及所有文件（`shutil.rmtree`）；删除前先调用 `BrainRegistry.instance().delete_private_brains_for_avatar(avatar_id)` 清理该分身的 private brain

**存储根目录惰性解析（NEW）**：`AVATARS_ROOT` 不再是 import 时被 `Path.home()` 定死的模块级常量，改为 `_avatars_root()` 按调用时的 HOME 解析（`agenticx/utils/agx_home.py` 的 `lazy_home_path`），并保留 PEP 562 `__getattr__` 供外部读取——避免测试重定向 HOME 后数据仍写进开发者真实的 `~/.agenticx`。

**Workspace 初始化**（`_ensure_avatar_workspace`）：
- 创建 `workspace/` 和 `workspace/memory/` 目录
- 写入 `IDENTITY.md`（包含 name/role 的身份模板）
- 写入 `MEMORY.md`（长期记忆模板，记录 created_at）

---

### portrait.py（分身收藏款立方体头像）

为分身生成「Near 官方立方体标志」同款模具、不同配色款（gacha 式 colorway）的 SVG 头像，**完全本地生成、不再发起网络请求**；用户上传头像（`custom`）永不覆盖。

**核心接口**：
- `generate_avatar_portrait_url(name, role, description, tags, avatar_id, color="", taken_colorways=None)`：主入口，返回 `data:image/svg+xml;base64,...`，可直接写入 `AvatarConfig.avatar_url`；`description` / `tags` 已不参与生成。`fetch_collection_portrait_url(...)` 保留同名签名但同样只返回本地立方体 data URL（无网络）
- `build_avatar_portrait_svg(name, role, avatar_id, color, taken, colorway_id)`：输出 160×160 viewBox 的 SVG，根节点带 `data-portrait="near-cube-v3"` 与 `data-colorway="<id>"`；以 `near_cube_luma.png`（`_luma_data_href()` 懒加载并缓存为 base64）做 alpha 蒙版 + soft-light 光照叠加，再画两只眼睛
- 配色款 `_COLORWAYS`：`dual`（双色盖/身）、`dream`（三段渐变）、`shade`（纯色兜底）三类；`resolve_cube_colorway(avatar_id, name, taken)` 以 `cube:<seed>` hash 为起点，优先未占用的 rich 款（非 shade），再用 shade，全部占用时对 rich 基款做色相偏移派生 `<id>~<n>`；`colorway_by_id()` / `cube_colorway_ids()` 查询
- `NEAR_MARK_COLORWAY_ID="near-mark"` 为品牌橙色保留款，不参与分身分配；`build_near_mark_svg()` 生成官方 Near 应用内标志
- 判定辅助：`is_near_cube_svg()`、`is_collection_portrait_svg()`（`data-portrait="dicebear-` / `ip-mascot` 前缀）、`is_local_fallback_svg()`（退役的 128×128 几何 SVG）、`extract_cube_colorway_id()`
- `needs_portrait_refresh(avatar_url, portrait_style)`：空 URL → True；`custom` 或合集 SVG → False；退役几何兜底 SVG → True；`near-cube-v3` → False；其余（含 `notionists-v1` 与无标记老数据）→ True
- 调色板辅助：`resolve_portrait_palette_key()` / `portrait_ink_hex()`（显式 `color` 优先，否则用与 `desktop/src/utils/avatar-color.ts` `hashToIndex` 对齐的有符号 32 位 hash 选 `_PALETTE_KEYS`）、`tint_line_art_svg()`（将 Notionists 黑色线条替换为调色板色）；`build_collection_portrait_url()` 仍可拼出 DiceBear Notionists SVG URL（`backgroundColor=transparent`），但生成主路径不再调用
- `collection_fetch_enabled()`：测试环境（`pytest` 已加载）或 `AGX_SKIP_AVATAR_FETCH=1` 时返回 False，现仅用于门控 `list_avatars()` 的惰性回填
- `infer_portrait_traits(...)`：仍保留（供 Notionists URL 构造），从 name/role/description/tags 推断性别、发型、眼镜

---

### GroupChatRegistry（group_chat.py）

**存储路径**：`~/.agenticx/groups/<group_id>/group.yaml`（**(NEW)** `GROUPS_ROOT` 与 `AVATARS_ROOT` 一样改为 `_groups_root()` 惰性解析 + PEP 562 `__getattr__`，按调用时 HOME 求值）

**数据模型 — GroupChatConfig**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | str | 12 位 hex UUID |
| `name` | str | 群聊名称 |
| `avatar_ids` | List[str] | 成员 Avatar ID 列表 |
| `human_members` | List[Dict[str, str]] | 人类成员列表，每项 `{id, platform, external_id, display_name, joined_at}`；`to_dict()` 始终保留该键（即使为空） |
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
- `add_human_member(group_id, raw)`：经 `normalize_human_member()` 规范化后按 `id` upsert（同 id 旧记录被替换），缺 `joined_at` 时补当前 UTC 时间并落盘；群不存在返回 `None`，非法输入抛 `ValueError`
- `delete_group(group_id)`：删除群聊目录

### group_members.py（群聊人类成员 ID）

- 人类成员 ID 格式：`human:<platform>:<external_id>`，`platform` ∈ `ALLOWED_PLATFORMS` = `desktop` / `feishu` / `wechat` / `wecom`（类型别名 `HumanPlatform`）
- `make_human_member_id(platform, external_id)`：平台非法、`external_id` 为空或含 `:` / `/` 时抛 `ValueError`
- `parse_human_member_id(member_id)`：反解为 `(platform, external_id)`，格式非法抛 `ValueError`
- `normalize_human_member(raw, avatar_ids)`：优先用 `raw["id"]` 反解，否则由 `platform` + `external_id` 生成；ID 与任一 `avatar_id` 冲突时抛 `ValueError`；`display_name` 缺省回落 `external_id`

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

- **Studio Server**：通过 `/api/avatars/*` 和 `/api/groups/*` API 暴露 AvatarRegistry / GroupChatRegistry CRUD；avatar session 使用分身专属 system prompt 和工具集；`POST /api/groups/{group_id}/human-members` 调 `add_human_member()`（`ValueError` → 400，群不存在 → 404）
- **IM 群聊网关**：`agenticx/gateway/im_group_speaker.py` 用 `make_human_member_id()` 生成 IM 发言人的 `user_id`，与群聊人类成员 ID 体系一致
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
