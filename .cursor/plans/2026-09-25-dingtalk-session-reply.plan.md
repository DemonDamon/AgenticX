# 钉钉入站回复

Planned-with: grok-4.7
Suggested-Impl-Model: composer-2.5

依赖：无。不要等 Wiki 导航，但不要和 Slack 计划同时改 `gateway/app.py` 与设置页「远程连接」区块。执行顺序上排在 Wiki 导航之后。

## 目标

钉钉机器人收到文本后，回复发到该条消息自带的 `sessionWebhook`。设置页「远程连接」可以开关钉钉并保存 `app_secret`。签名失败的请求不进入路由。

## 现状

- 适配器 [agenticx/gateway/adapters/dingtalk.py](agenticx/gateway/adapters/dingtalk.py)：`parse_message`（第 41 行）验 `timestamp`/`sign` 头，从 `text.content` 取正文，`conversationId` 写入 `GatewayMessage.chat_id`。`send_reply`（第 81 行）只打日志并返回 `True`。
- 注册在 [agenticx/gateway/app.py](agenticx/gateway/app.py) 第 88–90 行与 `POST /webhook/dingtalk`（第 186 行）。适配器未启用时返回 404。
- 配置模型 [agenticx/gateway/config.py](agenticx/gateway/config.py) 的 `DingTalkAdapterConfig` 只有 `enabled` 与 `app_secret`。
- 桌面设置「远程连接」在 [desktop/src/components/SettingsPanel.tsx](desktop/src/components/SettingsPanel.tsx) 约第 9110 行，目前只有飞书与通用 webhook 两个子标签。飞书配置经 `save-feishu-config` 写入本机配置，不走网关 YAML。钉钉开关若只改网关 YAML，桌面用户看不到。本段把钉钉字段放进同一「远程连接」页，保存到 `~/.agenticx/config.yaml` 的 `gateway.adapters.dingtalk`。网关进程启动时已经会 `load_gateway_config`；本段不要求桌面热重启网关，保存后在说明文字里写「重新启动网关后生效」。

## 改法

1. `DingTalkAdapter.parse_message` 在构造成功的 `GatewayMessage` 之前，从 body 读取 `sessionWebhook`。缺这个字段时仍返回消息，但 `raw` 里保留原 body。`send_reply` 从 `reply` 关联的原始消息取 `sessionWebhook`：在 `GatewayReply` 上若已有可放 URL 的字段则使用它；若没有，给 `GatewayReply` 增加可选字段 `session_webhook: str = ""`，由 `MessageRouter.route` 在调用 `send_reply` 前从入站 `GatewayMessage.raw["sessionWebhook"]` 填上。只改这一处赋值，不改路由选设备的逻辑。
2. `send_reply` 用标准库或项目里已有的 HTTP 客户端 `POST` JSON `{"msgtype":"text","text":{"content": reply.text}}` 到该 URL。没有 URL 时记录 warning 并返回 `False`。HTTP 状态码不在 200–299 时返回 `False`。不要在日志里打印 `app_secret` 或完整 webhook URL 的 query。
3. 设置页「远程连接」在飞书区块下面增加钉钉区块：启用开关、`App Secret` 密码框、只读 webhook 路径文字 `/webhook/dingtalk`。保存函数写入 `gateway.adapters.dingtalk.enabled` 与 `app_secret`。读取时缺节当作 `enabled: false`、`app_secret: ""`。沿用该页已有的配置读写 IPC；若现有 IPC 只读写飞书键，就在同一个 handler 里增加钉钉键，不要新建一套配置文件。
4. 中文标签：「钉钉」「启用钉钉机器人」「重新启动网关后生效」。英文对应 DingTalk / Enable DingTalk bot / Restart the gateway to apply。

## 验收

- 测试文件 `tests/test_gateway_dingtalk.py`。构造带合法 HMAC 签名的请求体（算法与 `DingTalkAdapter._verify_sign` 相同），断言解析出的 `content` 与 `chat_id`。错误签名返回 `None`。
- `send_reply` 在测试里用假 HTTP：给定 `session_webhook` 时 POST 的 JSON 含 `msgtype=text` 与回复正文；空 URL 返回 `False` 且不发请求。
- 桌面保存后，`~/.agenticx/config.yaml` 的 `gateway.adapters.dingtalk.app_secret` 等于输入框的值。测试可以用临时配置路径，不要写开发者真实主目录。

## 不做

- 不实现钉钉 Stream 长连接。
- 不在聊天顶栏加钉钉徽章，不写 `dingtalk_binding.json`。
- 不改飞书长连接进程。
