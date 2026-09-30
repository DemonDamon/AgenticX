# AgenticX Gateway 模块总结

> 结论生成时间：2026-05-29（首次创建，覆盖当前代码）

> 说明：本文档描述的是 **IM 远程指令网关**（飞书/企业微信/钉钉/Slack/Telegram/QQ/微信 → 云端 Gateway → 本机 Agent），与 `conclusions/server_gateway_conclusion.md`（API 服务网关）是不同模块，不要混淆。

## 模块概述

AgenticX Gateway 模块实现「IM 远程指令网关」：让用户从手机端 IM（飞书、企业微信、钉钉、Slack、Telegram、QQ 官方机器人、个人微信 iLink，以及 Siri/HTTP 快捷指令）下达指令，经由云端 Gateway 中转，通过 WebSocket 下发到本机运行的 Agent（`agx serve`）执行，再把回复回传到原 IM 会话。其核心价值是把「桌面端 Agent」延伸为「随身可远程驱动」的能力，支持设备绑定、离线消息队列、跨 IM 的待确认（confirm）流转与回复摘要。

## 目录结构

```
agenticx/gateway/
├── __init__.py            # 导出 create_gateway_app / GatewayMessage / GatewayReply
├── app.py                 # FastAPI 网关服务（webhook + WebSocket 设备中继 + 绑定 API）
├── router.py              # 归一化消息路由：绑定/状态/取消命令 + 设备下发与回复
├── models.py              # GatewayMessage / GatewayReply / PendingMessage 统一模型
├── config.py              # 网关 YAML 配置加载与设备/绑定码表
├── device_manager.py      # WebSocket 设备注册表 + 离线消息队列 + 回复 future
├── connect_session.py     # 二维码绑定的临时 connect session（TTL）
├── connect_page.py        # 扫码落地页 HTML 渲染
├── user_device_map.py     # (platform, sender_id) → device_id 绑定持久化
├── crypto_utils.py        # 飞书/企业微信加密回调 AES 解密
├── client.py              # 本机侧 WebSocket 客户端：连云端网关并本地执行对话
├── im_confirm.py          # IM 侧待确认指令解析与 pending 存储
├── im_group_speaker.py    # IM 发言人进群聊：/api/chat 群字段、群回复/澄清卡片转 IM 文本
├── im_wechat_inbound.py   # 微信入站媒体：图片嗅探/编码、文本与附件合并批次、SSE 分块解析
├── im_wechat_files.py     # 微信出站文件：发送意图识别、可发送文件筛选与 sidecar 载荷
├── feishu_longconn.py     # 飞书长连接本机直跑（agx feishu）
└── adapters/              # 各 IM 平台适配器
    ├── base.py            # IMAdapter Protocol（verify/parse/send_reply）
    ├── feishu.py          # 飞书 webhook 解析 + tenant token 回复
    ├── wecom.py           # 企业微信回调验证与解析
    ├── dingtalk.py        # 钉钉消息解析 + sessionWebhook 回复
    ├── slack.py           # Slack Events API（签名校验 + chat.postMessage 回复）
    ├── telegram.py        # Telegram Bot webhook（secret token + sendMessage 回复）
    ├── qqbot.py           # QQ 官方机器人 webhook（Ed25519 验签，仅入站）
    └── wechat_ilink.py    # 个人微信 iLink sidecar 适配（SSE 中继）
```

## 核心组件分析

### 网关服务 (app.py)

**文件功能**：基于 FastAPI 的云端网关入口

**关键端点**：
- `POST /webhook/feishu`、`/webhook/wecom`（GET 校验 + POST）、`POST /webhook/dingtalk`、`POST /webhook/slack`、`POST /webhook/telegram`、`POST /webhook/qqbot`：各 IM 平台 webhook 入口；解析为 `GatewayMessage` 后以后台 task 交给 `MessageRouter.route`。Slack/Telegram/QQ 入口在对应适配器未启用时返回 404；解析失败（验签不过、非消息事件、空文本）时仍回 `{"ok": true}` 不路由；Slack 先经 `SlackAdapter.early_response` 处理 `url_verification` 挑战
- `POST /api/command`：Siri/HTTP 快捷指令入口，支持共享密钥（`command_api_secret`）或设备 token 鉴权，同步等待设备回复
- `POST /api/connect/session` + `GET /api/connect/session/{id}` + `GET /connect/{id}`：二维码绑定会话创建、状态轮询与扫码落地页
- `GET/DELETE /api/device/{device_id}/bindings`：查询/解除某设备的 IM 绑定
- `WebSocket /ws/device/{device_id}`：本机设备长连接，注册后下发离线积压消息，并接收 `auth`/`im_reply`/`im_progress`
- `GET /health`：健康检查

**生命周期**：`startup`/`shutdown` 钩子负责启停 `WeChatILinkAdapter`；各适配器按配置 `enabled` 条件实例化并挂到 `app.state`。

### 消息路由 (router.py)

**文件功能**：桥接 IM 适配器、设备 WebSocket 与绑定流程

**核心组件 `MessageRouter.route(message, adapter)`**，按序处理：
1. **绑定命令**（`绑定 <绑定码>`）：解析绑定码 → 写入 `UserDeviceMap` → 完成 connect session → 回复绑定结果
2. **状态命令**（`/状态`）：返回设备在线状态与离线队列条数
3. **取消命令**（`/取消`）：提示当前版本需在桌面端操作
4. **常规消息**：解析目标 `device_id`（消息携带或绑定查得）→ 设备离线则入队并提示 → 在线则下发并 `wait_for_reply`
5. **回复处理**：超过 `_SUMMARY_MAX`(2000) 字时截断并附「请在 Near 查看完整回复」提示

所有出站回复统一经 `_send` → `_decorate` 投递：若回复未填，则从入站 `message.raw["sessionWebhook"]` 补 `session_webhook`（钉钉回复用），并以 `message.chat_id` 补 `channel_id`/`chat_id`（Slack/Telegram 回复用）。

### 统一消息模型 (models.py)

- `GatewayMessage`：归一化入站消息（`source`/`sender_id`/`content`/`content_type`/`attachments`/`device_id`/`chat_id` 等）
- `GatewayReply`：出站回复，由源适配器投递；含 `session_webhook`（钉钉会话回调地址）与 `channel_id`（Slack channel / Telegram chat）两个投递路由字段，默认空串
- `GatewayAttachment` / `PendingMessage`：附件元数据与离线排队消息

### 配置 (config.py)

**文件功能**：加载网关 YAML 配置（对应 `~/.agenticx/config.yaml` 的 `gateway` 节及云端示例）

**核心组件**：
- `GatewayServerConfig`：含 `server`（host/port）、`adapters`（feishu/wecom/dingtalk/slack/telegram/qqbot/wechat_ilink 各自 enabled（默认 false）+ 凭据；新增 `SlackAdapterConfig`（`bot_token`/`signing_secret`）、`TelegramAdapterConfig`（`bot_token`/`webhook_secret`）、`QQBotAdapterConfig`（`app_id`/`app_secret`））、`devices.auth_tokens`、`command_api_secret`、`reply_timeout_seconds`
- `device_token_table` / `binding_code_table` / `binding_code_for_device`：从配置派生 device→token、绑定码→device 等查表

### 设备管理 (device_manager.py)

**文件功能**：跟踪在线设备与离线消息队列

**核心组件 `DeviceManager`**：
- `register`/`unregister`/`is_online`/`send_to_device`：WebSocket 连接注册与下发（新连接会踢掉旧连接）
- `enqueue_pending`/`drain_pending`/`pending_count`：离线队列，上限 `MAX_PENDING=100`、TTL `86400s`
- `wait_for_reply`/`resolve_reply`：以 `asyncio.Future` + `correlation_id` 实现请求-回复关联与超时

### 绑定会话与落地页 (connect_session.py / connect_page.py)

- `ConnectSessionManager`：二维码绑定的临时 session（TTL 300s，线程安全），状态 `pending→scanned→bound→expired`；`try_complete_bind` 在收到绑定码消息后完成绑定
- `connect_page.py`：渲染扫码后的落地页 HTML

### 绑定持久化 (user_device_map.py)

**核心组件 `UserDeviceMap`**：把 `(platform, sender_id) → device_id` 绑定关系持久化到 `~/.agenticx/gateway/device_bindings.json`（可被 `AGX_GATEWAY_BINDINGS_PATH` 覆盖），原子写入；并提供 `绑定`/`/新对话`/`/状态`/`/取消` 等命令的正则识别。

### 加密工具 (crypto_utils.py)

`decrypt_feishu_event` / `decrypt_wecom_message`：对飞书/企业微信加密回调做 AES-CBC + PKCS7 解密（依赖 `cryptography`，缺失时给出明确安装提示）。

### 本机客户端 (client.py)

**文件功能**：运行在本机 `agx serve` 侧，连接云端网关 WebSocket 并在本地执行对话

**核心组件 `GatewayClient`**：
- `load_gateway_client_settings()`：从 `gateway` 配置节/环境变量解析 ws URL、device_id、token、Studio base、desktop token
- `run_forever` / `_consume_loop`：带指数退避重连，收到 `im_message` 后并发执行
- `_execute_turn`：为每个 IM 发送者派生稳定 `session_id`（`im-<source>-<hash>`），调用本机 `/api/session` 与流式 `/api/chat`，聚合 `token`/`final`/`tool_call`/`tool_result`/`tool_progress`/`confirm_required` 事件并回传；从 `/api/session` 响应读取 `avatar_id`，若为群聊会话（`group:<id>`）则经 `im_group_speaker` 补群字段、尽力注册人类成员，并把 `group_reply`/`group_clarification` 事件按发言人合并进最终回复
- `_handle_confirm_command`：处理 `/approve`、`/deny`、`/pending` 等待确认指令，调用 `/api/confirm`

### IM 待确认流转 (im_confirm.py)

- `PendingConfirmStore`：按外部发送者身份维护待确认任务（TTL 默认 300s，按 sender 限量）
- `parse_confirm_command`：解析 `/approve|ok|allow|yes`、`/deny|reject|no [reason]`、`/pending|confirm`，兼容引用前缀与全角斜杠
- `format_pending_hint`：生成 IM 友好的待确认提示

### IM 群聊发言人 (im_group_speaker.py)

被 `client.py`、`feishu_longconn.py` 与 `wechat_ilink.py` 共用，让 IM 发送者以「人类成员」身份参与绑定的群聊会话：
- `merge_im_group_chat_fields`：浅拷贝 `/api/chat` body，总是设置 `user_display_name`；仅当会话 `avatar_id` 形如 `group:<id>` 时追加 `group_id` 与 `speaker_user_id`（由 `agenticx.avatar.group_members.make_human_member_id(platform, external_id)` 生成）
- `register_human_member_best_effort`：群会话下 `POST /api/groups/{gid}/human-members`（`platform`/`external_id`/`display_name`），失败只记 warning 不中断
- `format_im_group_reply`：把群 SSE 行转为 `名字：内容` 段落，跳过 `skipped` 与带 `tool_phase` 的进度行；`format_im_clarification` 把澄清卡片（prompt + 编号选项）拍平为纯文本
- `im_outbound_bubbles` / `merge_im_sse_reply_text`：每个群发言人一条气泡（`final` 不重复时置首，无群内容时回落 `final` 或 token 文本），进度块前缀到首条；`split_im_joined_bubbles` 反向拆分已拼接文本
- `latest_unanswered_clarification` / `latest_assistant_reply_after_user`：从持久化会话消息中找最近未回答的澄清卡片、或最新匹配用户消息之后的助手回复（SSE 空结束时兜底）
- 飞书长连接侧新增 `build_feishu_chat_body`，同样经 `merge_im_group_chat_fields` 组装 body（保留 `keep_runtime_after_disconnect: True`）

### 微信入站媒体与出站文件 (im_wechat_inbound.py / im_wechat_files.py)

- **入站**：`sniff_image_mime` 按魔数识别 jpeg/png/gif/webp；`split_inbound_media` 把下载路径拆为 `image_inputs`（data URL，单张上限 `MAX_IMAGE_DATA_URL_CHARS`=8,000,000 字符，每轮最多 `MAX_INBOUND_IMAGES`=4 张）与剩余附件路径；`InboundMergeBatch` + `inbound_merge_delay_sec` 把同一发送者被拆开的文本/图片事件合并为一轮（图文同到 0.35s、仅媒体 2.2s、像图注的文本 4.0s、普通文本 1.2s），`InboundCompanionHold`（TTL 30s）暂存孤立的图注或附件以便重新合并；`compose_wechat_user_input` 生成最终 user_input（附件以 `[附件] <路径>` 追加，纯图时用占位提示，下载失败/模型看不了图时附说明）；`should_short_circuit_unseen_images` 在「仅图片且绑定模型明确不支持视觉」时直接短路回复 `UNSEEN_IMAGE_IM_REPLY`；`parse_sse_data_blocks` 兼容 LF/CRLF 的 SSE 分块
- **出站**：`select_outbound_files` 始终纳入 `file_write` 产出的文件；仅当用户消息命中发送意图（`发我`/`发文件`/`send me` 等）时，才额外纳入 `file_read`/`file_edit` 引用路径、文本中的绝对路径与《…》/反引号文件名（在 `~/.agenticx/workspace`、`taskspaces`、各分身 workspace、当前 session 目录中有限深度检索）；`is_sendable_file` 限制白名单扩展名、单文件 ≤20MB，并拒绝 `.ssh`/`.aws` 等目录、`/etc/` 等系统根及 `.env`/`id_rsa`/`.pem` 等敏感名；每轮最多 5 个；`build_sidecar_file_payload` 以 base64 `file` + `filename`（可选 `caption`）构造 sidecar `/send` 载荷

### 适配器 (adapters/)

- `base.IMAdapter`：定义 `platform` 与 `verify_webhook`/`parse_message`/`send_reply` 协议
- `feishu.FeishuAdapter`：处理 `url_verification` 挑战、加密事件解密、`im.message.receive_v1` 解析；回复经 tenant_access_token 调 OpenAPI（含 token 缓存与长文本截断）
- `wecom.WeComAdapter`：企业微信回调验证/解析
- `dingtalk.DingTalkAdapter`：钉钉消息解析；`send_reply` 以 `reply.session_webhook` POST `{"msgtype":"text"}`，无 webhook 或请求失败返回 False，2xx 视为成功
- `slack.SlackAdapter`：`X-Slack-Signature` v0 HMAC-SHA256 验签（时间戳偏差 >300s 拒绝），仅处理无 `subtype` 的 `message` 事件；回复调 `chat.postMessage`（`channel_id` 优先、回落 `chat_id`），需 HTTP 2xx 且响应 `ok: true`
- `telegram.TelegramAdapter`：配置 `webhook_secret` 时校验 `X-Telegram-Bot-Api-Secret-Token`，只处理带文本的 `message`；回复调 Bot API `sendMessage`，成功判定同上
- `qqbot.QQBotAdapter`：用 `cryptography` 的 Ed25519（由 `app_secret` 派生 32 字节种子）校验 `X-Signature-Ed25519`/`X-Signature-Timestamp`，只处理 `op == 0` 的 `MESSAGE_CREATE`/`AT_MESSAGE_CREATE`；**`send_reply` 尚未接通，始终记 warning 并返回 False**
- `wechat_ilink.WeChatILinkAdapter`：连接本机 `agx-wechat-sidecar` 的 SSE `/events`，把微信消息中继到 `agx serve /api/chat`，将 Markdown 转为微信可读纯文本，支持媒体下载、待确认指令、桌面绑定 session 优先与失效 session 自动迁移重试、模型不兼容时回退备用模型。此外：
  - 入站事件经 `_pump_events` 脱离 SSE 读循环处理，按发送者进入 `InboundMergeBatch` 合并后延迟 flush（`_schedule_flush`/`_flush_sender`/`_dispatch_inbound_turn`），图片以 `image_inputs` 随 `/api/chat` 发送；视觉能力由 `agenticx.llms.vision.is_vision_capable` 判定
  - `build_wechat_chat_body` 固定 `keep_runtime_after_disconnect: True`，并对群聊会话合并群发言人字段；`group_clarification`/`clarification_required` 事件被拍平为文本回复，并经 `/api/clarify` 自动释放本回合（`IM_CLARIFY_RELEASE_ANSWER`），出错时回读 `/api/session/messages` 中未答澄清卡片
  - SSE 无文本时回读 `/api/session/messages` 取已持久化助手回复；多发言人按气泡逐条发送，`format_wechat_outbound_text` 去除冗余的 Meta 发言人前缀
  - 出站文件经 `select_outbound_files` 选定后由 `_send_file` 逐个走 sidecar `/send`，文本末尾追加「已通过微信附件发送：…」，仅重复文件名的文本气泡被跳过；`_post_sidecar_send` 按 `group_id → session_id → sender` 顺序尝试收件人
  - 每个入站事件的脱敏摘要写入 `~/.agenticx/wechat_last_inbound_sse.json`（保留最近 8 条），用于排查入站图片

## 设计模式

### 1. 适配器模式
- 各 IM 平台统一实现 `IMAdapter` 协议，路由层与平台细节解耦

### 2. 中继 / 代理模式
- 云端 Gateway 不执行业务逻辑，仅做归一化 + 路由 + 中继；真正的对话执行在本机 `agx serve`（`client.py`）或经 sidecar

### 3. 请求-回复关联（Future 模式）
- `correlation_id` + `asyncio.Future` 把异步 WebSocket 回复关联回同步 webhook/HTTP 请求，并带超时

### 4. 离线队列 + TTL
- 设备离线时消息入队，上线自动补发；连接会话与待确认任务均带 TTL 自动回收

## 技术亮点

1. **多平台统一归一化**：飞书/企业微信/钉钉/Slack/Telegram/QQ/微信/Siri 全部归一化为 `GatewayMessage`，路由与回复逻辑单点维护
2. **远程闭环执行**：手机指令 → 云端中继 → 本机 Agent 执行 → 回传，桌面端能力随身可用
3. **跨端待确认流转**：高风险动作的 `confirm_required` 可在 IM 侧通过 `/approve`、`/deny` 远程批准/拒绝
4. **二维码绑定体验**：通过临时 connect session + 扫码落地页 + 绑定码消息完成 IM 身份与设备的安全绑定
5. **健壮的连接治理**：本机客户端指数退避重连、新连接踢旧连接、回复超时与离线补发、绑定关系原子持久化
6. **加密回调支持**：内置飞书/企业微信加密事件 AES 解密

## 应用场景

1. **移动远程办公**：出门在外用飞书/企业微信给本机 Agent 下达任务并接收结果
2. **Siri/快捷指令触发**：通过 `POST /api/command` 让语音/快捷指令驱动本机 Agent
3. **个人微信助手**：经 iLink sidecar 把微信消息接入 Agent 运行时
4. **远程审批**：在 IM 侧远程批准 Agent 的高风险操作确认

## 总结

AgenticX Gateway 模块构建了「手机 IM → 云端网关 → 本机 Agent」的远程指令链路，以统一消息模型、适配器协议、设备 WebSocket 中继与请求-回复关联为骨架，叠加二维码绑定、离线队列、跨端待确认与回复摘要等能力，把桌面端 Agent 扩展为可随身远程驱动的入口。它是 AgenticX「IM 远程指令」能力的服务端与本机客户端实现，与 API 服务网关相互独立、各司其职。
