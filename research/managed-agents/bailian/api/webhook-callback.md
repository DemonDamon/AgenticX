---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/webhook-callback
fetched: 2026-10-23
title: Webhook 回调契约
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Webhook 回调契约

> 描述平台向回调地址投递事件时的入站 HTTP 请求契约：请求方法与请求头、验签算法、事件信封字段，以及幂等、重试与投递保证。事件正文仅携带资源标识，需按 data.id 查询资源最新状态。

<meta property="og:title" content="Webhook 回调契约" />

## 概述 <span id="h-callback-overview" />

创建 [Webhook](webhook-create.md) 并订阅具名事件后，平台在事件发生时向配置的回调地址投递通知。本页说明平台发出的入站请求契约：接收端只需按此契约验证签名、解析事件信封，并按 `data.id` 查询资源最新状态。

事件正文不携带资源完整内容，仅含事件类型、资源标识和必要上下文。接收方根据 `data.id` 调用对应资源的 GET 接口查询最新状态。

## 支持的事件 <span id="h-callback-events" />

`events` 支持以下 32 个具名事件，不支持 `*` 或其他通配订阅。

| **分类**           | **事件**                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| Session 管控面      | `session.created`、`session.updated`、`session.archived`、`session.deleted`                                  |
| Session 运行状态     | `session.status_run_started`、`session.status_idled`、`session.status_terminated`                           |
| Session Thread   | `session.thread_created`、`session.thread_run_started`、`session.thread_idled`、`session.thread_terminated`  |
| Agent            | `agent.created`、`agent.updated`、`agent.archived`                                                          |
| Deployment       | `deployment.created`、`deployment.updated`、`deployment.archived`、`deployment.paused`、`deployment.unpaused` |
| Deployment Run   | `deployment_run.started`、`deployment_run.failed`、`deployment_run.succeeded`                               |
| Environment      | `environment.created`、`environment.updated`、`environment.archived`、`environment.deleted`                  |
| Vault            | `vault.created`、`vault.archived`、`vault.deleted`                                                          |
| Vault Credential | `vault_credential.created`、`vault_credential.archived`、`vault_credential.deleted`                         |

## 回调请求 <span id="h-callback-request" />

平台向通过安全校验的 HTTP 或 HTTPS 地址发起 **POST** 请求，不跟随重定向。直接填写的公网 IP 可以投递；私网、回环、链路本地和保留地址禁止连接。

每次投递都会重新生成 `webhook-timestamp`，并使用当前 Signing Secret 计算签名。重试时事件正文、外层 `id` 和 `created_at` 保持不变。

请求头示例：

```http
POST /managedagent/webhooks HTTP/1.1
Host: example.com
Content-Type: application/json
User-Agent: Bailian-ManagedAgent-Webhook/1.0
webhook-id: whe_01JXX8JY9BBM4BK4C2P7K3M3ZR
webhook-timestamp: 1785810621
webhook-signature: v1,BASE64_HMAC_SHA256
```

| **请求头**             | **说明**                                           |
| ------------------- | ------------------------------------------------ |
| `Content-Type`      | 固定为 `application&#47;json`                       |
| `User-Agent`        | 固定为 `Bailian-ManagedAgent-Webhook&#47;1.0`       |
| `webhook-id`        | 外层 `event.id`，格式 whe\_\<ULID>；用于幂等去重，也是验签原文的组成部分 |
| `webhook-timestamp` | 本次投递生成的 Unix 秒级时间戳；每次投递重新生成                      |
| `webhook-signature` | 签名，格式 `v1,` 加 Base64 编码的 HMAC-SHA256 结果          |

## 签名验证 <span id="h-callback-signature" />

签名原文和算法：

```text
signed_content = webhook-id + "." + webhook-timestamp + "." + raw_body
secret_bytes = Base64Decode(RemovePrefix(signing_secret, "whsec_"))
signature = Base64(HMAC-SHA256(secret_bytes, UTF8(signed_content)))
```

- `webhook-id` 的值是外层 `event.id`，不是 Webhook 配置的 `webhook_id`。
- `signing_secret` 为 `whsec_` 加标准 Base64 文本。验签时去掉 `whsec_` 前缀，再用标准 Base64 解码剩余内容，不能将完整 `whsec_...` 字符串直接作为 HMAC 密钥。
- 先读取未经修改的原始请求体完成验签，再进行 JSON 反序列化。
- 校验时间戳与当前时间相差不超过 5 分钟，并使用恒定时间比较验证签名。

<Warning>
  必须对未经解析的原始请求体（raw body）验签，再做 JSON 反序列化。任何在验签前对正文的重编码或解析都会导致签名不匹配。
</Warning>

<Note>
  Signing Secret 仅在 [创建](webhook-create.md) 和重置成功响应中返回，后续查询不再返回。请妥善保存。
</Note>

## 事件信封字段 <span id="h-callback-envelope" />

普通事件正文：

```json
{
  "type": "event",
  "id": "whe_01JXX8JY9BBM4BK4C2P7K3M3ZR",
  "created_at": "2026-08-06T10:30:21.123Z",
  "data": {
    "id": "sesn_xxx",
    "type": "session.status_idled",
    "workspace_id": "ws_xxx"
  }
}
```

Thread 事件额外携带 `session_thread_id`，`data.id` 为 Session 标识，`data.session_thread_id` 为具体 Thread 标识。`session.thread_created`、`session.thread_run_started`、`session.thread_idled` 和 `session.thread_terminated` 都使用该结构：

```json
{
  "type": "event",
  "id": "whe_01JXX8JY9BBM4BK4C2P7K3M3ZR",
  "created_at": "2026-08-06T10:30:21.123Z",
  "data": {
    "id": "sesn_xxx",
    "type": "session.thread_idled",
    "workspace_id": "ws_xxx",
    "session_thread_id": "sthread_xxx"
  }
}
```

| **字段**                   | **类型** | **说明**                                                          |
| ------------------------ | ------ | --------------------------------------------------------------- |
| `type`                   | string | 固定为 `event`                                                     |
| `id`                     | string | 事件 ID，格式 whe\_\<ULID>；同一事件的所有投递尝试使用相同外层 id，与 `webhook-id` 请求头一致 |
| `created_at`             | string | 事件创建时间，ISO 8601                                                 |
| `data`                   | object | 事件载荷                                                            |
| `data.id`                | string | 资源标识；Thread 事件中为 Session 标识                                     |
| `data.type`              | string | 事件类型                                                            |
| `data.workspace_id`      | string | 工作空间 ID                                                         |
| `data.session_thread_id` | string | Thread 事件中为具体 Thread 标识                                         |
| `data.vault_id`          | string | Vault Credential 事件中携带                                          |

## 幂等、重试与投递保证 <span id="h-callback-delivery" />

接收端不需要返回响应体，应在 5 秒内返回状态码。平台按接收端响应或错误决定后续行为：

| **接收端响应或错误**       | **平台行为**                  |
| ------------------ | ------------------------- |
| 200～299            | 投递成功，不再重试                 |
| 300～399            | 不跟随重定向，不重试，立即禁用当前 Webhook |
| 408、425、429        | 当前请求失败，进入重试               |
| 400～499 其他状态       | 当前投递最终失败，不重试              |
| 500～599            | 当前请求失败，进入重试               |
| 域名解析、连接、写入或读取超时    | 当前请求失败，进入重试               |
| HTTPS 证书校验或主机名校验失败 | 不重试，立即禁用当前 Webhook        |
| 域名解析到私网或保留地址       | 禁止建立连接，立即禁用当前 Webhook     |

业务事件首次请求失败后最多再重试 3 次，重试等待时间依次为 10 秒、30 秒、1 分钟，共最多 4 次真实网络请求。第 4 次仍失败时记录最终失败。默认连续 20 个业务事件最终失败后自动禁用 Webhook。`webhook.test` 仅同步请求一次，不重试，不影响连续失败计数。

其他投递语义：

- **可能重复**：同一事件可能多次投递，始终使用相同的 `event.id`；按该标识幂等去重。
- **不保证顺序**：事件可能乱序到达；需要排序时使用 `created_at`，最终状态以资源查询结果为准。
- **查询期限**：投递事件保留 7 天，超过后无法查询。

## 验签示例 <span id="h-callback-example" />

<CodeGroup>
  ```python
  import base64
  import hashlib
  import hmac
  import os
  import time

  secret = os.environ["AGENT_WEBHOOK_SECRET"]
  secret_bytes = base64.b64decode(secret[len("whsec_"):])

  def verify_webhook(raw_body: bytes, webhook_id: str, timestamp: str, signature_header: str) -> bool:
      try:
          if abs(time.time() - int(timestamp)) > 300:
              return False

          version, signature = signature_header.split(",", 1)
          if version != "v1":
              return False

          signed_payload = f"{webhook_id}.{timestamp}.".encode() + raw_body
          expected = base64.b64encode(
              hmac.new(secret_bytes, signed_payload, hashlib.sha256).digest()
          ).decode()
          return hmac.compare_digest(signature, expected)
      except (TypeError, ValueError):
          return False
  ```

  ```javascript
  import crypto from "node:crypto"
  import express from "express"

  const secret = process.env.AGENT_WEBHOOK_SECRET // whsec_...
  const secretBytes = Buffer.from(secret.slice("whsec_".length), "base64")
  const app = express()

  // 必须使用原始请求体，不能先经过 express.json() 解析。
  app.post("/agent/events", express.raw({ type: "*/*" }), (req, res) => {
    const webhookId = req.get("webhook-id") ?? ""
    const timestamp = req.get("webhook-timestamp") ?? ""
    const [version, signature = ""] = (req.get("webhook-signature") ?? "").split(",", 2)
    const timestampSeconds = Number(timestamp)

    if (!timestampSeconds || version !== "v1" || Math.abs(Date.now() / 1000 - timestampSeconds) > 300) {
      return res.status(401).send("invalid webhook signature")
    }

    const expected = crypto
      .createHmac("sha256", secretBytes)
      .update(`${webhookId}.${timestamp}.`)
      .update(req.body)
      .digest()
    const actual = Buffer.from(signature, "base64")

    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
      return res.status(401).send("invalid webhook signature")
    }

    const event = JSON.parse(req.body.toString("utf8"))
    res.status(200).end()
    enqueue(event)
  })
  ```
</CodeGroup>
