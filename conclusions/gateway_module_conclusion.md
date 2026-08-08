# AgenticX Gateway 模块总结

> 结论生成时间：2026-05-29（首次创建，覆盖当前代码）

> 说明：本文档描述的是 **IM 远程指令网关**（飞书/企业微信/钉钉/微信 → 云端 Gateway → 本机 Agent），与 `conclusions/server_gateway_conclusion.md`（API 服务网关）是不同模块，不要混淆。

## 模块概述

AgenticX Gateway 模块实现「IM 远程指令网关」：让用户从手机端 IM（飞书、企业微信、钉钉、个人微信 iLink，以及 Siri/HTTP 快捷指令）下达指令，经由云端 Gateway 中转，通过 WebSocket 下发到本机运行的 Agent（`agx serve`）执行，再把回复回传到原 IM 会话。其核心价值是把「桌面端 Agent」延伸为「随身可远程驱动」的能力，支持设备绑定、离线消息队列、跨 IM 的待确认（confirm）流转与回复摘要。

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
├── feishu_longconn.py     # 飞书长连接本机直跑（agx feishu）
└── adapters/              # 各 IM 平台适配器
    ├── base.py            # IMAdapter Protocol（verify/parse/send_reply）
    ├── feishu.py          # 飞书 webhook 解析 + tenant token 回复
    ├── wecom.py           # 企业微信回调验证与解析
    ├── dingtalk.py        # 钉钉消息解析
    └── wechat_ilink.py    # 个人微信 iLink sidecar 适配（SSE 中继）
```

## 核心组件分析

### 网关服务 (app.py)

**文件功能**：基于 FastAPI 的云端网关入口

**关键端点**：
- `POST /webhook/feishu`、`/webhook/wecom`（GET 校验 + POST）、`POST /webhook/dingtalk`：各 IM 平台 webhook 入口；解析为 `GatewayMessage` 后以后台 task 交给 `MessageRouter.route`
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

### 统一消息模型 (models.py)

- `GatewayMessage`：归一化入站消息（`source`/`sender_id`/`content`/`content_type`/`attachments`/`device_id`/`chat_id` 等）
- `GatewayReply`：出站回复，由源适配器投递
- `GatewayAttachment` / `PendingMessage`：附件元数据与离线排队消息

### 配置 (config.py)

**文件功能**：加载网关 YAML 配置（对应 `~/.agenticx/config.yaml` 的 `gateway` 节及云端示例）

**核心组件**：
- `GatewayServerConfig`：含 `server`（host/port）、`adapters`（feishu/wecom/dingtalk/wechat_ilink 各自 enabled + 凭据）、`devices.auth_tokens`、`command_api_secret`、`reply_timeout_seconds`
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
- `_execute_turn`：为每个 IM 发送者派生稳定 `session_id`（`im-<source>-<hash>`），调用本机 `/api/session` 与流式 `/api/chat`，聚合 `token`/`final`/`tool_call`/`tool_result`/`tool_progress`/`confirm_required` 事件并回传
- `_handle_confirm_command`：处理 `/approve`、`/deny`、`/pending` 等待确认指令，调用 `/api/confirm`

### IM 待确认流转 (im_confirm.py)

- `PendingConfirmStore`：按外部发送者身份维护待确认任务（TTL 默认 300s，按 sender 限量）
- `parse_confirm_command`：解析 `/approve|ok|allow|yes`、`/deny|reject|no [reason]`、`/pending|confirm`，兼容引用前缀与全角斜杠
- `format_pending_hint`：生成 IM 友好的待确认提示

### 适配器 (adapters/)

- `base.IMAdapter`：定义 `platform` 与 `verify_webhook`/`parse_message`/`send_reply` 协议
- `feishu.FeishuAdapter`：处理 `url_verification` 挑战、加密事件解密、`im.message.receive_v1` 解析；回复经 tenant_access_token 调 OpenAPI（含 token 缓存与长文本截断）
- `wecom.WeComAdapter` / `dingtalk.DingTalkAdapter`：企业微信回调验证/解析、钉钉消息解析
- `wechat_ilink.WeChatILinkAdapter`：连接本机 `agx-wechat-sidecar` 的 SSE `/events`，把微信消息中继到 `agx serve /api/chat`，将 Markdown 转为微信可读纯文本，支持媒体下载、待确认指令、桌面绑定 session 优先与失效 session 自动迁移重试、模型不兼容时回退备用模型

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

1. **多平台统一归一化**：飞书/企业微信/钉钉/微信/Siri 全部归一化为 `GatewayMessage`，路由与回复逻辑单点维护
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
