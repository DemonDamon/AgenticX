---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/managed-agents-webhook
fetched: 2026-10-23
title: Webhook 通知
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Webhook 通知

> Webhook 将会话、智能体、定时任务等资源的状态变更事件实时推送到指定回调地址，替代轮询获取最新状态。

<meta property="og:title" content="Webhook 通知" />

## Webhook 通知

Webhook 是 Workspace 级独立资源，与会话、智能体、环境平级。创建一个 Webhook endpoint 并订阅具名事件后，平台在事件发生时向配置的回调地址投递通知，无需轮询接口。

可订阅的事件覆盖六类资源：Session、Agent、Deployment、Environment、Vault、Credential，共 32 个具名事件。完整列表与投递契约见[Webhook 回调契约](api/webhook-callback.md)。

创建与管理有两种方式：在控制台可视化操作，或调用 API。两者管理的是同一份资源，可混用。

## 在控制台创建

进入控制台「Webhook 通知」页，点击「注册端点」，在弹窗中填写：

- **端点 URL**：接收投递的回调地址。
- **描述**（可选）：便于区分用途。
- **订阅事件类型**：按 Session、Vault、Agent、Deployment、Deployment run、Environment 分组勾选，每组支持「全选」。

创建成功后弹窗展示一次 **Signing Secret**，并附验签步骤与 Node.js/Python 示例代码。

<Warning>
  Signing Secret 仅在创建和重置时展示一次，关闭弹窗后无法再次查看，遗失只能重置。请立即复制保存。
</Warning>

进入端点详情页可查看概览、投递记录（保留 7 天）与设置：

- **发送测试事件**：向回调地址同步发送一次测试投递，返回真实响应，不计入连续失败。
- **设置**：修改端点 URL 或订阅事件。
- **重置密钥**：生成新的 Signing Secret，旧密钥立即失效。
- **禁用 / 删除**：暂停或永久移除端点。

## 接入步骤

1. **创建 endpoint 并保存 Signing Secret**：调用[创建 Webhook](api/webhook-create.md)传入回调 `url` 和订阅的 `events`。响应中的 `signing_secret` 用于验签。Signing Secret 只在创建和重置成功响应中返回一次，后续查询不再返回，请立即安全保存。

2. **接收并验签**：在回调地址接收 POST 请求，先读取未经修改的原始请求体完成验签，再进行 JSON 反序列化。验签使用请求头 `webhook-id`、`webhook-timestamp`、`webhook-signature` 与 Signing Secret，算法与 Python/Node 示例见[回调投递 — 验签](api/webhook-callback.md)。

3. **幂等处理事件**：按事件外层 `id` 去重；同一事件的重复投递使用相同 `id`。事件正文仅含 `data.id` 等标识，根据它调用对应资源的 GET 接口查询最新状态。

4. **返回状态码**：在 5 秒内返回 2xx 表示投递成功。返回 3xx 或 HTTPS 校验失败会立即禁用 Webhook；408、425、429、5xx 和网络错误会触发重试。

## 投递保证

- **至少一次**：同一事件可能多次投递，始终使用相同的 `event.id`，按该标识幂等去重。
- **不保证顺序**：事件可能乱序到达，排序用 `created_at`，最终状态以资源查询结果为准。
- **失败重试**：408、425、429、5xx 和网络错误最多重试 3 次，间隔 10 秒、30 秒、1 分钟。
- **自动禁用**：默认连续 20 个业务事件最终失败后自动禁用；3xx、地址安全校验或 HTTPS 校验失败会立即禁用。
- **保留期限**：投递事件保留 7 天，可通过[查询 Webhook 事件](api/webhook-list-events.md)回溯。

## 下一步

- **Webhook API**：创建、管理 endpoint 与回调投递契约
- [会话事件流](managed-agents-event-stream.md)：会话内交互的 SSE 实时订阅
