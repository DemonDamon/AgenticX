# AGENTS.md

## Learned User Preferences
- 默认使用中文回复；技术术语可按需保留英文。
- 进行 git commit 时，提交信息必须包含 `Made-with: Damon Li`，并偏好按功能点分组、附结构化需求块（如 FR/NFR/AC）。
- Plan 文档必须落盘到 `.cursor/plans/` 并随代码一起提交，不能遗漏。
- Desktop 端视觉重塑：App 命名为「Machi」，应用图标偏好《全职猎人》玛奇神韵的极客化解构——纯黑白高对比度矢量线稿（类 NousResearch 风格），仅保留至颈部的大头贴（无肩/无头巾），以高马尾和冷酷洞悉的眼神凸显“绝对理性”的高级开发者工具气质，拒绝低端二次元感或渐变色。
- 配置面板遵循关注分离：MCP 独立 tab 不混入 Provider；用户可改配置项必须提供 Desktop 设置面板 GUI；模型切换需持久化；权限确认文案需对齐 Cursor，且用户选择 `Run Everything` 后必须严格生效，禁止重复弹窗询问。主要操作按钮（如保存）应使用主题层 `--ui-btn-primary-*` 变量并按 dark/dim/light 区分，避免长期硬编码 cyan。
- 多分身/群聊 UX 深度对齐微信体验：支持 @提及指定分身直接回复、未 @ 时由 Meta-Agent（产品名 Machi、显示名以 Meta 窗格为准）充当项目经理统筹/兜底；未 @ 但文本明显指向某成员职责时，路由应优先由该成员实际执行与回复，而非仅靠 Meta 口头代答。用户点名某分身时，该分身应以人类用户为主答对象，避免把主对话改成 @ 组长客套；成员在回复里 @ 其他分身时，路由应尽力让被 @ 方接续发言。用户需要能感知分身在执行（工具调用、阻塞确认、进度类信号），避免长时间只有「正在输入」却看不到在做什么。新建群聊必须默认隐式包含 Meta-Agent；消息多选需左侧打勾，多选复制须结构化（角色+时间+内容），合并转发卡片点开需见原始历史。Session 创建参考 Cherry Studio；默认布局需视觉均衡，窄屏头像自适应。设置里「群内显示名称」参与群聊上下文标注（`user_display_name`）。
- UI 交互必须即时响应（乐观 UI）：打开窗格、删除分身/群聊、切换会话都要先响应再异步回填；删除群聊后应回退到元 Agent 界面而非停留在已删除群聊；转发卡片等消息体必须自适应大小避免内容遮挡；工作区面板布局自上而下：成员区 → 工作目录 → Spawn Agent 列表（成员不单独 tab）；消息操作按钮（复制/引用/收藏/转发/重试/多选）应常驻显示而非仅 hover 出现，且用户消息行固定提供重试（非仅失败时才出现）；收藏结果反馈（如「已收藏过」）须贴近该条消息下方操作按钮行展示，避免仅在侧栏或会话列表远端角落弱提示；引用必须优先使用用户选区文本（不要整段带上 `<think>`）；多选操作必须包含删除且能持久化生效；流式回答禁止出现整段重复拼接；流式输出期间不得强制锁定滚动到底部，用户需能随时向上滚动查看已输出内容；附件上传后须在输入框**上方**展示预览（对齐豆包/Cherry Studio），图片显示可点击放大的缩略图；重试或复制消息时必须保留图片附件，不得退化成纯文本；删除所有会话后须自动新建默认 session 而非卡在「正在初始化」。
- 子智能体须全链路透明（运行状态/摘要/产出/`awaiting_confirm` 与倒计时）；完成或失败后 Meta-Agent 要主动汇报；代码生成须有类似 Cursor 的流式呈现，等待期间不得只显示 ⏳⏳ 静态符号，应使用类豆包的动态三点动画。委派须为「真委派」：任务在分身真实 session 执行、历史与产出可追溯，禁止影子 spawn 顶替身份，启动后自动打开目标分身窗格；子智能体详情面板须有一键复制按钮。
- Desktop 端应支持「断点续开」：合盖/重开后优先恢复上次会话与多窗格状态，避免用户重新找上下文。
- LLM `<think>` 推理内容必须解析为独立 ReasoningBlock：streaming 阶段 spinner + "Thinking" 标签 + 流式推理文本在同一容器内；完成后折叠为 "Thought"；禁用独立边框/白色背景/青蓝色底色——融入消息气泡（参照 Cursor 思考链 UI）。
- 用户对重复噪音提示敏感：须收敛为单次高信号、降低焦虑感；已知非视觉聊天模型下用户尝试附图时，用 Cherry 式文案「模型不支持该文件类型」等明确提示，展示在**消息列表与输入区之间的主视区**内水平居中（紧邻状态 chips、贴近输入区上方），采用黄色感叹号警示样式，避免缩在窗口右下角或边角弱提示；内部系统消息（如工具调用频率限制日志）对用户不可见。
- 出现线上异常时优先做根因排查和证据链，不接受拍脑袋修复；实现新需求时严禁乱改已有逻辑正确的代码（用户将此称为「严重倒退现象」）；已有 workspace rule `no-scope-creep.mdc` 强制约束，每次改动必须能追溯到具体需求。

## Learned Workspace Facts
- AgenticX 全局配置目录为 `~/.agenticx`（主配置 `~/.agenticx/config.yaml`），身份与记忆目录为 `~/.agenticx/workspace`；`AGX_MAX_TOOL_ROUNDS` 等运行参数可在该文件配置。用户要求「记住」的长期信息应写入该 workspace（如 `MEMORY.md`、`memory/*.md`）并落在 `WorkspaceMemoryStore` 索引范围内；仅写到用户 home 根目录等路径的孤立 `.md` 不会进入 hybrid 召回。
- 元智能体系统提示由 `agenticx/runtime/prompts/meta_agent.py` 构建，每轮对话动态注入活跃子智能体快照（`_build_active_subagents_context`）和记忆自动召回（`_build_memory_recall_context`）。
- 子智能体调度由 `agenticx/runtime/team_manager.py`（`AgentTeamManager`）管理，支持并发上限、归档快照 `_archived_agents`、`owner_session_id` 会话隔离、`avatar_id` 字段绑定，以及跨 session 的全局 registry 查找（`lookup_global_status`/`collect_global_statuses`）。
- `agenticx/runtime/agent_runtime.py` 在上下文清洗阶段强制 tool 调用序列合法化，防止 `assistant(tool_calls)` 与 `tool` 响应断链触发 provider 400；streaming 路径对 tool name 为 `None`/`"None"` 的情况做归一化过滤；`[系统通知]` 前缀消息不写入 `chat_history`。
- `agenticx/studio/server.py` 的子智能体状态、取消、重试接口已支持同会话 fallback 查找；`SessionManager` 实例通过 `_session_manager` 属性附加到 `StudioSession` 用于跨会话 avatar 状态查询。`chat_history` 落盘为 `messages.json`，经 `_normalize_messages` 暴露给 `GET /api/session/messages`；带图用户消息可含 `attachments`（`data:image/...` data URL），Desktop 新开会话再切回历史时必须仍能从持久化消息恢复气泡内附图预览，避免仅当次内存态有效；普通会话与群聊都应传递 `quoted_content` 供模型对齐引用改写；批量消息删除需写回 `chat_history`/`agent_messages` 并持久化。
- `agenticx/runtime/meta_tools.py` 的 `spawn_subagent` 对已注册 avatar 名称/ID 硬拦截并引导 `delegate_to_avatar`；`delegate_to_avatar` 通过 `_find_or_create_avatar_session` 与 `_run_delegation_in_avatar_session` 在后台跑分身会话，使用 `STUDIO_TOOLS` 与 avatar 提示，provider/model 按 avatar → session → Meta-Agent 回退。
- `/api/subagents/status` 会扫描 `SessionManager._sessions` 的 `_delegation_info`；`_run_delegation_in_avatar_session` 约每 5 秒中间 persist 以支持前端轮询。
- Desktop 前端为 React + Zustand + Electron + Vite，Pro/Lite（`ChatPane` / `ChatView`）；`store.ts` 含 `awaiting_confirm`；Pro 输入框从剪贴板粘贴图片时应对 `clipboardData.files` 与 `items` 合并去重，避免同一次粘贴出现重复附件；`desktop/src/components/messages/reasoning-parser.ts` 与 `ReasoningBlock.tsx` 及 `ImBubble`/`CleanBlock`/`TerminalLine` 需一致支持推理块；Electron `titleBarStyle: "hiddenInset"`，`AGX_CHROMIUM_QUIET` 控制 Chromium 日志。
- 分身由 `agenticx/avatar/registry.py` 与 `group_chat.py` 管理；群聊创建默认注入 Meta-Agent；`group_router.py` 处理 `user-directed`（@）与 `meta-routed`，并可将直呼组长显示名、`meta_leader_display_name` 并入 mention，智能模式下可发 `group_typing`；成员消息正文中的 `@名字`（匹配注册名或短 slug id、全角＠与尾部标点会归一）可触发被点名分身的跟进回合。持久化含 `agent_messages.json`、`context_files_refs.json`、`inherit_from_session_id`，`MemoryHook` 压缩 daily memory。
- `/codedeepresearch` 命令 SOP：除 `*_deepwiki.md`、`*_source_notes.md` 等外，须产出 `*_agenticx_gap_analysis.md` 与 `*_proposal.md`；源码浅克隆至 `upstream/`，可参考 `openclaw/`；调研目录迁移至 `research/codedeepresearch/` 下对应子目录。
- `agenticx/llms/minimax_provider.py` 用 `@model_validator(mode="after")` 为模型名加 `openai/` 前缀；缺 `/models` 时 Electron `main.ts` 用 `POST /chat/completions` 健康检查与硬编码 fallback。MiniMax Chat 官方文档对上述 M2 / M2.1 / M2.5 / M2.7 及 `*-highspeed` 等型号统一声明**不支持图像与音频输入**；产品对 `minimax-m2*` 按非视觉处理（前端拦截与提示、Studio 剥离 `image_inputs`）。另外，群聊或非 meta 子 Agent 的 `/api/chat` 分支若未把附图并入多模态 `user_message_content`，模型侧只会看到纯文本；前端不得继续展示“已附图但静默丢图”，应禁用附图或明确提示。
- 文档站采用 MkDocs Material + Vercel 部署至 `docs.agxbuilder.com`（子域名），域名 DNS 在阿里云（hichina.com），主站 `www.agxbuilder.com` 已通过 CNAME 托管在 Vercel；`AGX_MAX_TOOL_ROUNDS` 已在 `~/.agenticx/config.yaml` 手动设置为 100；用户明确选择不区分版本，基于最新代码持续更新文档即可。
- 扩展生态模块位于 `agenticx/extensions/`：`bundle.py` 定义 AGX Bundle 格式（`agx-bundle.yaml` manifest，包含 skills/mcp_servers/avatars/memory_templates 四类组件）；`installer.py` 实现本地目录安装/卸载，安装路径 `~/.agenticx/skills/bundles/<name>/`；`registry_hub.py` 实现多源聚合搜索，支持 `agx` 与 `clawhub` 两种注册表类型；`agenticx/cli/config_manager.py` 的 `AgxConfig.extensions` 字段（`ExtensionsConfig`）管理注册表配置（`extensions.registries` + `scan_dirs`）；Studio 已暴露 `/api/skills/*`、`/api/bundles/*`、`/api/registry/*` REST API；Desktop 设置面板新增「技能」Tab（包含技能列表、市场搜索、已安装扩展包三个区域）。
- Sandbox 已实现三层模式（Local / Docker / Docker+K8s），对应 `SandboxSettings.mode`，支持文件系统隔离、命令执行隔离、审计追踪与可重复执行；配置入口在 `~/.agenticx/config.yaml` 的 `sandbox` 字段。
