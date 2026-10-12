# QQ 官方机器人适配器

Planned-with: grok-4.7
Suggested-Impl-Model: composer-2.5

依赖：先完成 [2026-09-25-slack-telegram-adapters.plan.md](2026-09-25-slack-telegram-adapters.plan.md)。本段是渠道序列的最后一段。

## 目标

网关接收 QQ 官方机器人的 Webhook 文本消息并回复。这是开放平台机器人，不是个人 QQ，也不是个人微信 sidecar。

## 现状

- 个人微信在 [agenticx/gateway/adapters/wechat_ilink.py](agenticx/gateway/adapters/wechat_ilink.py)，走本机 sidecar。QQ 机器人不能调用这个类，也不能读 `wechat_sidecar.port`。
- 新渠道的挂载方式已经在钉钉、Slack、Telegram 上固定：`AdaptersConfig` 增加一节、`create_gateway_app` 在 enabled 时构造适配器、`POST /webhook/<name>` 把 `GatewayMessage` 交给 `MessageRouter.route`。

## 改法

1. 新建 `agenticx/gateway/adapters/qqbot.py`，类 `QQBotAdapter`，`platform = "qqbot"`。配置字段：`enabled: bool = False`，`app_id: str = ""`，`app_secret: str = ""`。
2. `POST /webhook/qqbot`。请求头 `X-Signature-Timestamp` 与 `X-Signature-Ed25519`。用 `app_secret` 作为 Ed25519 种子校验签名，消息字节是 `timestamp` 的 UTF-8 加上原始 body。校验失败时不产生 `GatewayMessage`，HTTP 返回 200 `{"ok": true}`。本机没有 `nacl` 或 `PyNaCl` 时，在适配器文件顶部说明依赖，并把它加进项目现有依赖声明；不要在适配器里 `pip install`。
3. 只处理 JSON 里 `op` 为 `0`（Dispatch）且 `t` 为 `MESSAGE_CREATE` 或 `AT_MESSAGE_CREATE` 的事件。正文取 `d.content`，去掉首尾空白。空正文不路由。`sender_id` 取 `d.author.id`，`chat_id` 取 `d.channel_id`，`message_id` 取 `d.id`。其他 `op` 或事件类型直接 200，不路由。
4. `send_reply` 不在本段实现完整的 QQ 发消息 API 鉴权刷新。若入站 `d` 没有可直接 POST 的回复 URL，`send_reply` 返回 `False` 并打一条不含 secret 的 warning。不要假装发送成功。后续若要主动发消息，另开计划接 access token。本段的完成标准是入站解析和签名，而不是群里能看到回复。在设置页说明文字写明：「当前只接收消息；主动回复尚未接通。」
5. 设置页「远程连接」在 Telegram 下面增加 QQ 机器人区块：启用、App ID、App Secret。保存到 `gateway.adapters.qqbot`。

## 验收

- `tests/test_gateway_qqbot.py` 使用一组固定的 Ed25519 密钥夹具。合法签名的 `AT_MESSAGE_CREATE` 解析出 `content`、`sender_id`、`chat_id`。错误签名得到 `None`。`op` 不是 `0` 时得到 `None`。
- 测试不启动 sidecar，不读取 `~/.agenticx/wechat_sidecar.port`。
- `enabled: false` 时 `POST /webhook/qqbot` 返回 404。

## 不做

- 不改 `WeChatILinkAdapter`。
- 不实现 QQ 登录扫码。
- 不在顶栏加 QQ 徽章。
- 不在本段实现 access token 发送。
