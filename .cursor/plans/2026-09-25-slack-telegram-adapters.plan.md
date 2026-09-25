# Slack 与 Telegram 适配器

Planned-with: grok-4.7
Suggested-Impl-Model: composer-2.5

依赖：先完成 [2026-09-25-dingtalk-session-reply.plan.md](2026-09-25-dingtalk-session-reply.plan.md)。本段继续改 `gateway/app.py` 和设置页「远程连接」。

## 目标

网关在适配器启用时接收 Slack Events 与 Telegram webhook，把文本消息交给现有 `MessageRouter.route`，并用各自的 Bot API 把回复发回去。设置页可以分别保存开关和令牌。

## 现状

- 适配器目录只有 [agenticx/gateway/adapters/](agenticx/gateway/adapters/) 下的 `base.py`、`feishu.py`、`wecom.py`、`dingtalk.py`、`wechat_ilink.py`。没有 Slack 或 Telegram。
- 挂载方式以钉钉为模板：[agenticx/gateway/app.py](agenticx/gateway/app.py) 第 88–90 行创建适配器，第 186–202 行 `POST /webhook/dingtalk`，解析失败或空文本时直接返回成功，避免平台重试风暴；解析成功则 `router.route(msg, adapter)`。
- 配置集中在 [agenticx/gateway/config.py](agenticx/gateway/config.py) 的 `AdaptersConfig`（第 59 行）。

## Slack

新建 `agenticx/gateway/adapters/slack.py`，类 `SlackAdapter`，`platform = "slack"`。

- 配置字段：`enabled: bool = False`，`bot_token: str = ""`，`signing_secret: str = ""`。
- `POST /webhook/slack`。body 里 `type == "url_verification"` 时原样返回 `{"challenge": body["challenge"]}`，不验路由。
- 其他请求校验头 `X-Slack-Signature` 与 `X-Slack-Request-Timestamp`。签名是 `v0=` 加 HMAC-SHA256(signing_secret, `v0:{timestamp}:{raw_body}`)。时间戳与当前时间相差超过 300 秒，或签名不一致，则不产生 `GatewayMessage`，HTTP 仍返回 200 和 `{"ok": true}`，避免 Slack 重试把错误签名打成失败风暴。缺少 signing secret 时拒绝解析。
- 只处理 `event.type == "message"` 且没有 `subtype`、有 `text` 的事件。`sender_id` 用 `event.user`，`chat_id` 用 `event.channel`，`message_id` 用 `event.client_msg_id` 或 `event.ts`。
- `send_reply`：`POST https://slack.com/api/chat.postMessage`，头 `Authorization: Bearer {bot_token}`，JSON `channel` 为 `reply` 上的频道 id，`text` 为回复正文。路由器在调用前把入站 `chat_id` 填到 `GatewayReply` 的新可选字段 `channel_id`（钉钉计划若已增加 `session_webhook`，本字段并列，不要互相覆盖）。Slack 响应 JSON 的 `ok` 为 false 时 `send_reply` 返回 `False`。

## Telegram

新建 `agenticx/gateway/adapters/telegram.py`，类 `TelegramAdapter`，`platform = "telegram"`。

- 配置字段：`enabled: bool = False`，`bot_token: str = ""`，`webhook_secret: str = ""`。
- `POST /webhook/telegram`。若配置了 `webhook_secret`，请求头 `X-Telegram-Bot-Api-Secret-Token` 必须一致，否则不解析，HTTP 200 `{"ok": true}`。
- 从 `message.text` 取正文。没有 `message.text`（例如只有图片）时返回空，不路由。`sender_id` 为 `message.from.id` 的字符串，`chat_id` 为 `message.chat.id` 的字符串，`message_id` 为 `update_id` 的字符串。
- `send_reply`：`POST https://api.telegram.org/bot{bot_token}/sendMessage`，JSON `chat_id` 与 `text`。不要把 token 打进日志。HTTP 非 2xx 或响应 `ok != true` 时返回 `False`。

## 设置页

在钉钉区块下面增加 Slack、Telegram 两块，字段与上面的配置键一一对应。密码框用于 token 和 secret。保存进 `gateway.adapters.slack` 与 `gateway.adapters.telegram`。说明文字仍是「重新启动网关后生效」。中文标签用「Slack」「Telegram」「Bot Token」「签名密钥」「Webhook 密钥」。

## 验收

- `tests/test_gateway_slack.py`：url_verification 返回 challenge；合法签名的 message 事件得到非空 `GatewayMessage`；错误签名得到 `None`。`send_reply` 用假 HTTP 断言 URL 与 `channel`。
- `tests/test_gateway_telegram.py`：带文本的 update 解析出 `chat_id`；只有图片的 update 得到 `None`；secret 不匹配得到 `None`。`send_reply` 断言 URL 以 `/sendMessage` 结尾且 body 含 `chat_id`。
- 两个适配器 `enabled: false` 时，对应 webhook 返回 404，与钉钉相同。

## 不做

- 不处理 Slack 的 slash command、交互按钮和文件。
- 不调用 Telegram `setWebhook` 代用户注册。
- 不在顶栏加渠道徽章。
