---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/managed-agents-webhook-notifications
fetched: 2026-10-23
title: 进阶：Webhook 事件通知
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 进阶：Webhook 事件通知

> 把「事件发生」（会话跑完、部署执行结束、资源变更）变成一次主动的 HTTP 推送：接收端工程、验签、投递语义与重试禁用规则的完整实践。

<meta property="og:title" content="进阶：Webhook 事件通知" />

## 概述 <span id="h-wn-intro" />

本篇讲 Managed Agents 的 Webhook 机制：把「事件发生」（会话跑完、部署执行结束、资源变更）变成一次主动的 HTTP 推送，而不是不停轮询。

与系列其他篇的关系：[生产化篇](managed-agents-production.md)的 Deployment 面向「按计划运行」，[多智能体篇](managed-agents-multiagent-proposal.md)的 SSE 面向「人工实时查看」，本篇面向「运行完成后主动通知」——三者组合构成完整的无人值守闭环。事件订阅的基础用法见[Webhook 事件订阅](managed-agents-webhook.md)，本篇深入接收端的工程细节。

## 场景：拾贝电商的对账通知 <span id="h-wn-scenario" />

「拾贝电商」是一家虚构的跨境电商，每晚要对账：一个对账机器人（Deployment 定时触发）核对当天的订单流水。运维同学的诉求很朴素：

> 任务跑完不用盯着，运行完成或运行失败，给服务器发个通知。

在 Webhook 之前只有拉模式：定时轮询 `GET /deployments/{id}/runs`、`GET /sessions/{id}`，反复查询任务是否完成。Webhook 把它倒过来——订阅事件，平台在事件发生时 POST 接收端：

```plaintext
拉模式（轮询）：你 → 平台    "跑完没？"   ×N 次
推模式（Webhook）：平台 → 你   "跑完了"    ×1 次
```

## Webhook 是什么 <span id="h-wn-what" />

- **工作空间级独立资源**：和 Agent、Session、Deployment 平级，id 前缀 `wep_`。每个工作区最多创建 20 个。
- **订阅具名事件**：共 32 个，分 9 类，不支持 `*` 通配：

| 分类               | 事件                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------- |
| Session 管控面      | session.created / updated / archived / deleted                                      |
| Session 运行状态     | session.status\_run\_started / status\_idled / status\_terminated                   |
| Session Thread   | session.thread\_created / thread\_run\_started / thread\_idled / thread\_terminated |
| Agent            | agent.created / updated / archived                                                  |
| Deployment       | deployment.created / updated / archived / paused / unpaused                         |
| Deployment Run   | deployment\_run.started / failed / succeeded                                        |
| Environment      | environment.created / updated / archived / deleted                                  |
| Vault            | vault.created / archived / deleted                                                  |
| Vault Credential | vault\_credential.created / archived / deleted                                      |

- **事件不携带资源内容**：body 里只有资源 id 和事件类型，想知道对账结果，拿着 `data.id` 反查对应接口。

## 创建 Webhook <span id="h-wn-create" />

```bash
curl -s -X POST "$AGENTSTUDIO_URL/webhook_endpoints" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "description": "拾贝电商 对账任务通知",
    "url": "http://118.178.120.71:8080/hook",
    "events": ["session.status_run_started", "session.status_idled", "deployment_run.started", "deployment_run.succeeded", "deployment_run.failed"]
  }'
```

`$AGENTSTUDIO_URL` 与 `$DASHSCOPE_API_KEY` 的约定见[生产化篇](managed-agents-production.md)。响应（关键字段）：

```json
{
  "id": "wep_01M1G63CXHX6C7C1801RD2J19W",
  "url": "http://118.178.120.71:8080/hook",
  "events": ["session.status_run_started", "session.status_idled", "..."],
  "status": "ACTIVE",
  "consecutive_fail": 0,
  "last_success_at": null,
  "signing_secret": "whsec_XgYOlI...",
  "created_at": "..."
}
```

三个必读细节：

1. `signing_secret` **只在创建（和 reset\_secret）响应里出现一次**，之后任何查询接口都不再返回。创建时就要存好——丢了只能重置。
2. `status` 是大写 `ACTIVE`（deployment 为小写 `active`），客户端判断状态时注意区分大小写。
3. HTTP 地址也接受（公网 IP 的 `http://` 投递正常），但生产建议 HTTPS。

### URL 安全校验 <span id="h-wn-urlcheck" />

平台对 `url` 的校验规则：

| 地址                                                            | 结果                                                    |
| ------------------------------------------------------------- | ----------------------------------------------------- |
| `webhook.site`、`*.beeceptor.com`（临时接收站）                       | **拒绝**，报 `invalid webhook url`（11800016）——临时调试站被针对性拉黑 |
| `http://127.0.0.1:8080/hook`（回环/私网）                           | 拒绝——文档明令禁止连接私网、回环、链路本地、保留地址                           |
| `httpbin.org`、`example.com`、`*.vercel.app`、`*.ngrok-free.app` | 通过                                                    |
| `http://<公网IP>:8080/hook`                                     | 通过                                                    |

另一个独立校验：`events` 数组里写不认识的事件名（比如把 `webhook.test` 当事件名塞进去）报 `invalid webhook events`——`webhook.test` 不是可订阅事件，它是 test 端点专用的一次性合成事件（见下文）。

## 接收端：一段 60 行的 Python <span id="h-wn-receiver" />

在拾贝的运维服务器上跑一个接收端，把每次投递的**原始请求**（headers + body）落成 JSONL 日志，并提供读回接口：

```python
#!/usr/bin/env python3
# receiver.py —— Webhook 接收端
import json, os, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LOG = "/root/webhook_hits.jsonl"

class H(BaseHTTPRequestHandler):
    def _send(self, code, body):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n)
        if self.path != "/hook":
            return self._send(404, b'{"error":"not found"}')
        rec = {"ts": time.time(), "path": self.path,
               "headers": dict(self.headers.items()),
               "body": raw.decode("utf-8", "replace")}
        with open(LOG, "a") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        self._send(200, b'{"ok":true}')

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, b'{"status":"up"}')
        if self.path == "/dump":
            data = open(LOG).read() if os.path.exists(LOG) else ""
            return self._send(200, data.encode())
        if self.path == "/clear":
            open(LOG, "w").close()
            return self._send(200, b'{"cleared":true}')
        self._send(404, b'{"error":"not found"}')

    def log_message(self, *a):
        pass

ThreadingHTTPServer(("0.0.0.0", 8080), H).serve_forever()
```

**生产接收端至少还要做两件事**：验签（下一节）和按 `data.id` 反查资源详情（事件不携带内容）。

### 部署注意事项 <span id="h-wn-deploy" />

- **`nohup ... &` 会随 SSH 会话退出被终止**。用 systemd 常驻（`Restart=always`）：

```ini
# /etc/systemd/system/webhook-receiver.service
[Unit]
Description=Bailian webhook receiver
After=network.target

[Service]
ExecStart=/usr/bin/python3 /root/receiver.py
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable --now webhook-receiver
```

- 一个 shell 注意事项：远程终止接收端进程时，`pkill -f receiver.py` 会匹配到 SSH 远程命令行自身（命令行中含 "receiver.py" 字样），导致进程被误终止（exit 255）；按端口终止更安全：`fuser -k 8080/tcp`。

## test 端点：上线前先自检 <span id="h-wn-test" />

```bash
curl -s -X POST "$AGENTSTUDIO_URL/webhook_endpoints/wep_xxx/test" -H "Authorization: Bearer $DASHSCOPE_API_KEY"
```

成功时同步返回一个事件信封（同时真的向接收端投递了一条 `webhook.test` 事件）：

```json
{"type": "event", "id": "whe_01M1G6C24QPR2V9J2QTKFXJCTH",
 "created_at": "2026-09-02T04:34:54.743Z",
 "data": {"id": "wep_01M1G63CXHX6C7C1801RD2J19W", "type": "webhook.test", "workspace_id": "ws_xxx"}}
```

失败时返回 HTTP 502 + 错误码 `11800015`，消息直接回显接收端的响应（典型样本：`Webhook endpoint returned HTTP 302`、`Webhook endpoint returned HTTP 500`、`webhook network request failed`）——排障时这个回显就是第一手证据。

test 的三个特殊语义：

1. **只同步请求一次，不重试**；
2. **不影响 `consecutive_fail`**（接收端回 500 后 test，计数仍为 0）；
3. 它触发的是合成事件 `webhook.test`，不是订阅列表里的真实事件。

## 真实事件长什么样 <span id="h-wn-payload" />

给任一 session 发条消息（或 Deployment 触发 run），接收端日志里就会出现投递。投递样本（截断展示）：

```plaintext
POST /hook HTTP/1.1
User-Agent: Bailian-ManagedAgent-Webhook/1.0
webhook-id: whe_01M1G69TMRHC5ECD4PFE598GYF
webhook-timestamp: 1788323621
webhook-signature: v1,naL38RUIYmTbeQuXfXTJSigDA6J42dNA6Aa4R+1mKK4=
Content-Type: application/json; charset=utf-8

{"type":"event","id":"whe_01M1G69TMRHC5ECD4PFE598GYF","created_at":"2026-09-02T04:33:41.508Z",
 "data":{"id":"sesn_01M1G5RPKRFHPTB72W2HG05KDM","type":"session.status_idled","workspace_id":"llm-czal8nvvwb8d47ks"}}
```

逐字段读：

| 字段                       | 含义                          | 注记                            |
| ------------------------ | --------------------------- | ----------------------------- |
| `webhook-id`             | 本次投递事件的 id                  | **等于 body 里的外层 `id`**——幂等去重用它 |
| `webhook-timestamp`      | 投递时刻（Unix 秒）                | 每次投递（含重试）重新生成                 |
| `webhook-signature`      | `v1,` + Base64(HMAC-SHA256) | 验签见下节                         |
| body `id` / `created_at` | 事件身份 / 发生时刻                 | **重试时不变**；排序用它                |
| body `data.id`           | 资源 id（session/agent/...）    | 拿它反查详情                        |
| body `data.type`         | 事件名                         | 如 `session.status_idled`      |

Thread 类事件在 `data` 里多一个 `session_thread_id`；Vault Credential 类事件多一个 `vault_id`。

## 验签：接收端的第一道门 <span id="h-wn-verify" />

平台用创建时拿到的 `signing_secret` 对每次投递做 HMAC 签名。接收端必须验签，否则任何人拿到 URL 都能伪造通知。

### 算法 <span id="h-wn-algo" />

```plaintext
signed_content = webhook-id + "." + webhook-timestamp + "." + raw_body
key             = Base64Decode( 去掉 whsec_ 前缀后的 secret )   # 注意：不是拿 whsec_ 整串当 key
signature       = Base64( HMAC-SHA256(key, UTF8(signed_content)) )
```

三个最容易做错的地方：

1. **key 的来源**：`whsec_` 是前缀标记，验签前要剥掉它再 Base64 解码得到真正的 key 字节。直接把 `whsec_...` 字符串当 key，必然验签失败。
2. **raw body**：对未经反序列化的**原始请求字节**验签。先 `json.loads` 再拼回去，字段顺序/空格变了就全错。
3. **时间窗**：校验 `webhook-timestamp` 与当前时间相差不超过 5 分钟（防重放），并使用恒定时间比较（`hmac.compare_digest`，防时序侧信道）。

完整的验签脚本（对日志逐条验签）：

```python
import json, base64, hmac, hashlib, sys

secret = sys.argv[1]
secret_bytes = base64.b64decode(secret[len("whsec_"):])   # 剥前缀再解码

for line in open("/root/webhook_hits.jsonl"):
    rec = json.loads(line)
    h = rec["headers"]
    wid, ts, sig = h["webhook-id"], h["webhook-timestamp"], h["webhook-signature"]
    version, signature = sig.split(",", 1)               # "v1,<base64>"
    signed = f"{wid}.{ts}.".encode("utf-8") + rec["body"].encode("utf-8")
    expected = base64.b64encode(
        hmac.new(secret_bytes, signed, hashlib.sha256).digest()).decode()
    print(h["webhook-id"], hmac.compare_digest(signature, expected))
```

<Note>
  生产实现建议：在 web 框架里读 `request.body`（原始字节）+ 三个头，验签通过再解析 JSON——顺序不能反。
</Note>

## 投递语义 <span id="h-wn-semantics" />

以下行为是生产事故的高发区，接入前需完整理解。

### 乱序是真实的 <span id="h-wn-ordering" />

一次 session run 会产生 `run_started` 和 `idled` 两个事件。接收端短暂故障后，到达顺序可能颠倒：**idled 先到，run\_started 要走完重试链之后才到**。

**不能依赖到达顺序推导资源状态**。要排序用 body 的 `created_at`；要最终状态，拿 `data.id` 反查接口。

### at-least-once：重复投递真实存在 <span id="h-wn-dedup" />

同一事件可能被投递不止一轮——重试中的失败会计入计数，例如 `consecutive_fail` 从 0 跳到 2。

**按外层 `id`（= `webhook-id`）做幂等去重不是「最佳实践」，是入门要求**。接收端应记录已处理的 event id，重复到达直接丢弃。

### 重试与禁用（响应码语义表） <span id="h-wn-retry" />

| 接收端响应/错误         | 平台行为                          |
| ---------------- | ----------------------------- |
| 200\~299         | 投递成功，不再重试                     |
| 300\~399         | 不跟随重定向，不重试，**立即禁用**当前 Webhook |
| 408 / 425 / 429  | 当前请求失败，进入重试                   |
| 400\~499 其他      | 当前投递最终失败，不重试                  |
| 500\~599         | 当前请求失败，进入重试                   |
| DNS/连接/读写超时      | 当前请求失败，进入重试                   |
| HTTPS 证书/主机名校验失败 | 不重试，立即禁用                      |
| 解析到私网/保留地址       | 禁止连接，立即禁用                     |

- 重试节奏：首次失败后最多 3 次重试，间隔 **10 秒、30 秒、1 分钟**（共最多 4 次真实网络请求），之后记录最终失败。
- **3xx 立即禁用**：`status: "DISABLED"`，`disabled_reason: "REDIRECT_RESPONSE"`，同时 `consecutive_fail` 计数增加（实测 302 后为 1）——禁用状态与失败计数并不互斥，排查时两个字段都要看。
- 自动禁用：**连续 20 个业务事件最终失败**后自动禁用。
- 接收端应在 **5 秒内**返回状态码（不需要响应体）——重活别在回调里同步做，存下来异步处理。

<Warning>
  **当前行为：`deployment_run.*` 事件暂不投递**。创建接口接受 `deployment_run.started / succeeded / failed` 订阅名，但触发 deployment run 后这些事件本身不会投递；其产生的 session 事件（`session.status_run_started` / `session.status_idled`）正常投递。

  对「任务跑完通知我」这个场景的落地建议：**用 `session.status_idled`（`data.id` 为该 run 创建的 session）作为完成信号，再按需反查 runs 接口拿状态**，是当前可靠的路径；任何事件类型在成为生产依赖前，先用自己的接收端验证一遍。
</Warning>

## 日常运维 <span id="h-wn-ops" />

```bash
# 健康观测三件套：last_success_at / last_failure_at / consecutive_fail
curl -s "$AGENTSTUDIO_URL/webhook_endpoints" -H "Authorization: Bearer $DASHSCOPE_API_KEY" | python3 -m json.tool
```

```json
{"id": "wep_...", "status": "ACTIVE", "disabled_reason": null,
 "last_success_at": "2026-09-01T19:53:00.350Z", "last_failure_at": null,
 "consecutive_fail": 0}
```

<Warning>
  **当前 `last_success_at` / `last_failure_at` 存在约 8 小时偏差**（时区序列化问题）：真实失败发生在 15:39 UTC 时，`last_failure_at` 记为 07:39 UTC，而同一响应的 `updated_at` 是正确的 15:39 UTC。计算健康延迟时以 `updated_at` 为准，不要直接用这两个时间戳；字段修复前先做 8 小时校正再比较。
</Warning>

- `consecutive_fail` **是连续失败计数**，成功一次即归零；逼近 20 就是禁用前兆，值得接告警。
- **轮换密钥**：`POST /webhook_endpoints/{id}/reset_secret` → 响应返回新 secret（旧 secret 立即失效，接收端要能热切换，或选择业务低峰做）。
- **删除**：`DELETE /webhook_endpoints/{id}`（200，真删除；对比：Agent/Deployment 只能 archive 不能删）。
- **改 url / 改订阅事件用** `PUT /webhook_endpoints/{id}`（body 传 `description` / `url` / `events`，缺省字段不变；不会轮换 secret）。另有 `POST /{id}/enable` / `POST /{id}/disable` 启停、`GET /{id}/events` 查最近 7 天投递历史。
- 订阅变更不补发历史事件——新订阅只对之后发生的事件生效。

## 小结 <span id="h-wn-summary" />

| 想要           | 用什么                                                                 |
| ------------ | ------------------------------------------------------------------- |
| 定时/手动把任务跑起来  | Deployment（[生产化篇](managed-agents-production.md)）      |
| 人工实时查看任务执行过程 | SSE 流（[多智能体篇](managed-agents-multiagent-proposal.md)） |
| 跑完了/挂了通知服务器  | **Webhook（本篇）**                                                     |
| 通知里带业务结果     | Webhook 给信号（`data.id`），反查接口拿内容                                      |

接收端工程清单（按优先级）：验签（剥前缀解码 key + 原始字节 + 时间窗 + 恒定时间比较）→ 幂等去重（按 event id）→ 按需反查（`data.id`）→ 5 秒内响应、重活异步 → systemd 常驻（不要依赖 nohup）→ 监控 `consecutive_fail`。

Webhook 是各资源状态变更的统一出口：session、agent、deployment、environment、vault 的管控面动作都有对应事件。把本篇的接收端骨架加上路由分发，就能长成一个轻量的「资源变更总线」。

## 下一步 <span id="h-wn-next" />

- [Webhook 事件订阅](managed-agents-webhook.md)：控制台创建与订阅的基础用法。
- [Webhook API](api/webhook-create.md)：端点管理接口的完整参数。
- [进阶：生产化定时晨报机器人](managed-agents-production.md)：与 Deployment 组合成完整的无人值守闭环。
