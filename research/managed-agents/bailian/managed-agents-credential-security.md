---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/managed-agents-credential-security
fetched: 2026-10-23
title: 进阶：密钥库安全注入与出网网关
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 进阶：密钥库安全注入与出网网关

> Vault 密钥库的占位符注入模型、allowed_hosts 出口白名单、出网网关的请求头替换行为，以及会话环境变量与密钥库的选型分层。

<meta property="og:title" content="进阶：密钥库安全注入与出网网关" />

## 概述 <span id="h-cs-intro" />

本篇讲 Managed Agents 的**密钥安全链路**：Vault 密钥库的占位符注入、`allowed_hosts` 出口白名单、出网网关的请求头替换，以及会话环境变量（`environment_variables`）与密钥库的选型分层。与[生产化篇](managed-agents-production.md)的关系：生产化篇只覆盖凭证接入的最短路径，本篇说明密钥在链路中的位置与存在形态。

Vault 的基础用法（创建、存凭证、挂载）见[密钥库](managed-agents-credential.md)。

## 谁需要读这一篇 <span id="h-cs-audience" />

- Agent 运行时要调外部 API（自有服务、第三方 SaaS），需要带 API Key / Token；
- 不希望密钥明文出现在：应用代码、Agent 配置与版本历史、沙箱进程、模型上下文、事件流日志；
- 在做安全合规评审，需要讲清楚「密钥到底在链路的哪些位置以什么形态存在」。

不需要密钥、只想传**非敏感配置**（API 地址、日志级别、功能开关）的，直接用[会话环境变量](#h-cs-selection)，不用读完整篇。

## 原理：占位符注入模型 <span id="h-cs-model" />

Vault 凭证的安全模型是「**密钥永不进沙箱，用时在网关替换**」：

| 阶段        | 发生什么                                                                                       |
| --------- | ------------------------------------------------------------------------------------------ |
| ① 配置（一次性） | 凭证存入 Vault：`name: MY_API_KEY`、`value: sk-…`（加密）、`allowed_hosts: api.example.com`           |
| ② 沙箱读取    | `os.environ["MY_API_KEY"]` 返回占位符 `BMA_SECRET_PLACEHOLDER_MY_API_KEY`                       |
| ③ 沙箱发请求   | 请求头携带占位符（例如 `Authorization: Bearer BMA_SECRET_PLACEHOLDER_MY_API_KEY`）发往 `api.example.com` |
| ④ 出网网关判定  | 命中 `allowed_hosts`：替换为真实值转发；未命中：占位符原样透出（真实密钥不泄露）                                           |

真实密钥只存在于两处：**凭据库（加密存储）**与**出网网关命中白名单 host 替换的那一瞬**；链路上由平台控制的可观测位置（沙箱进程、模型上下文、事件流里的平台事件）全部只见占位符。唯一例外是**外部服务的响应体**——被调用方自己回显的内容（如 httpbin 返回的请求头）会进入工具输出，这是外部服务的行为，平台不控制。即便 Agent 被 prompt 注入诱导把凭证发往恶意域名，网关也不会替换——对方只拿到一个无意义的占位符。

### 网关行为边界 <span id="h-cs-gateway" />

| 行为            | 说明                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------- |
| 替换哪个头         | **请求头**。占位符放在哪个请求头，就在哪个请求头替换；请求体与查询参数中的占位符**原样透出**                                            |
| 怎么定位要替换的凭证    | **按请求 host 匹配** `allowed_hosts`，不解析占位符变量名——即使发送一个不存在的占位符变量名，发往白名单 host 的请求仍会被替换为该 host 凭证的真实值 |
| 同一 host 多枚凭证  | 替换结果不确定（会取其中之一）。**建议一个 host 只配一枚凭证**                                                          |
| 非白名单 host 的请求 | **不会被拦截**（网络照常放行），只是请求头里保持占位符——`allowed_hosts` 决定密钥替换生效的 host 范围，不限制网络出站                      |
| 网关拦截方式        | **透明 MITM**：沙箱内无 proxy 环境变量，出站 HTTPS 在网络层被拦截（TLS 握手时收到网关的自签名证书）                               |
| 网关证书          | 沙箱已预置网关 CA——默认 TLS 校验可通过；仅个别环境 CA 配置异常才握手失败（见 步骤 5 说明）                                        |
| 拦截范围          | **所有会话**（不绑 Vault 的普通会话同样经网关出网）                                                               |

### 两条注入路径的选型分层 <span id="h-cs-selection" />

|                  | 会话环境变量 `environment_variables` | Vault 密钥                                |
| ---------------- | ------------------------------ | --------------------------------------- |
| 传值方式             | 建会话时明文键值对，创建响应原样回显             | 凭证预先存 Vault，会话/deployment 传 `vault_ids` |
| 沙箱内 `os.environ` | **真实值**                        | **占位符** `BMA_SECRET_PLACEHOLDER_<变量名>`  |
| 真实值出现在哪          | 沙箱进程内（及事件流，若 Agent 打印了它）       | 仅凭据库（加密）+ 出网网关替换的一瞬                     |
| 适用               | **非敏感配置**：API 地址、日志级别、开关、租户 ID | **高敏密钥**：API Key、Token、AccessKey        |
| Deployment 支持    | **不支持**（传了被静默忽略）               | 支持，`vault_ids` 在 deployment 级传入         |

选型原则：**安全要求不高的配置用环境变量，高敏密钥用密钥库**。定时/无人值守链路（Deployment）目前只能用密钥库。

## 前置 <span id="h-cs-prereq" />

- 一个阿里云百炼工作空间及其 ID、一把 DashScope API Key；
- 一个带 bash 工具的 Agent（内置工具集的 `configs[]` 里逐个启用了 bash，见[入门篇](managed-agents-data-analysis.md)的建 Agent 步骤）；
- 一个用于验证的外部回显服务（本篇用 `httpbin.org`——`/get` 端点会把发出的请求头原样回显，正好用来观测「对方到底收到了什么」）。

约定环境变量：

```bash
export AGENTSTUDIO_URL="https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio"
export DASHSCOPE_API_KEY="<你的 DashScope API Key>"  # gitleaks:allow
export AGENT_ID="agent_xxx"          # 带 bash 工具的 Agent
export MY_API_KEY="sk-DUMMY_KEY_FOR_SMOKE_TEST"   # 演示用假值 gitleaks:allow
```

## 步骤 1 · 建 Vault <span id="h-cs-step1" />

```bash
curl -X POST "$AGENTSTUDIO_URL/vaults" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "display_name": "生产环境密钥库",
    "metadata": { "team": "operations" }
  }'
```

响应 `id` 形如 `vlt_01M1KPMXH45N5QQ00PQX8H9T9Q`：

```bash
export VAULT_ID="vlt_xxx"
```

## 步骤 2 · 建密钥（凭证）：`allowed_hosts` 必填 <span id="h-cs-step2" />

凭证挂在 vault 之下，端点是**嵌套**的 `/vaults/{vault_id}/credentials`（没有顶级 `/credentials`，404）。

**结构**：`allowed_hosts` 必须写在 `auth.networking` **里面**，且**必填**：

```bash
curl -X POST "$AGENTSTUDIO_URL/vaults/$VAULT_ID/credentials" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "display_name": "天气服务 API Key",
    "auth": {
      "type": "environment_variable",
      "secret_name": "MY_API_KEY",
      "secret_value": "'"$MY_API_KEY"'",
      "networking": { "allowed_hosts": ["httpbin.org", "*.httpbin.org"] }
    }
  }'
```

要点：

- `secret_name`：环境变量名，沙箱里 `os.environ` 用这个名字取到**占位符**。
- `secret_value`：真实密钥。**只写不回显**——GET 回来时 `auth` 里只有 `secret_name` / `type` / `networking`。
- `networking.allowed_hosts`：**出口白名单，必填**。支持通配（`*.example.com`）。**这就是「配置时一次声明密钥只能发往哪些域名」**。
- `networking.type`：可选（传 `limited` 也会被接受），行为由 `allowed_hosts` 决定。
- 响应 `id` 前缀 `vcrd_`（不是 `cred_`）。

两个常见错误：

<Warning>
  **漏传 `allowed_hosts`** → 409 `CREDENTIAL_AUTH_NETWORKING_ERROR`「出口网络地址不能为空」。旧结构（只有 `networking: {type: "unrestricted"}`、顶层 `allowed_hosts`、或不带 networking）全部被拒。
</Warning>

<Warning>
  `auth.type` 仍只支持 `environment_variable`（传 `secret` / `static_bearer` / `mcp_oauth` 均 409 `CREDENTIAL_AUTH_TYPE_ERROR`）。
</Warning>

```bash
export CRED_ID="vcrd_xxx"
```

## 步骤 3 · 挂 Vault 建会话 <span id="h-cs-step3" />

```bash
curl -X POST "$AGENTSTUDIO_URL/sessions" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "'"$AGENT_ID"'",
    "title": "密钥注入验证",
    "vault_ids": [ "'"$VAULT_ID"'" ]
  }'
```

Deployment 中的接入方式相同（`vault_ids` 配置在 deployment 上，触发生成的每个 session 自动携带），见[生产化篇](managed-agents-production.md)。

## 步骤 4 · 验证一：沙箱里只有占位符 <span id="h-cs-step4" />

发一条消息让 Agent 打印环境变量：

```bash
curl -X POST "$AGENTSTUDIO_URL/sessions/$SESSION_ID/events" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": [
      { "type": "message", "role": "user",
        "content": [ { "type": "text", "text": "Run exactly this bash command and report the raw output verbatim, nothing else: printenv MY_API_KEY" } ] }
    ]
  }'
```

事件流（`tool_call_output`）：

```text
{"stdout":"BMA_SECRET_PLACEHOLDER_MY_API_KEY\n","stderr":"","exit_code":0,"interrupted":false}
```

**这就是预期行为**——沙箱里只有占位符。所以「验证密钥注入成功」不能靠 `printenv` 读真实值，正确的验证方式是步骤 5 的端到端请求验证。

## 步骤 5 · 验证二：出网请求被网关替换（正路径） <span id="h-cs-step5" />

让 Agent 把占位符放进请求头，调用白名单内的回显服务：

```bash
curl -X POST "$AGENTSTUDIO_URL/sessions/$SESSION_ID/events" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": [
      { "type": "message", "role": "user",
        "content": [ { "type": "text", "text": "Run exactly this bash command and report the raw output verbatim, nothing else: curl -sk --max-time 30 -H \"Authorization: Bearer $MY_API_KEY\" https://httpbin.org/get" } ] }
    ]
  }'
```

stdout（httpbin 把收到的请求头原样回显）：

```json
{
  "headers": {
    "Authorization": "Bearer sk-DUMMY_KEY_FOR_SMOKE_TEST",
    "Host": "httpbin.org",
    ...
  },
  "origin": "39.105.83.17"
}
```

**替换只在出网的一瞬发生**：沙箱内 `printenv` 是占位符，对方服务收到的是真实值。占位符也可以放在 `X-API-Key: ${MY_API_KEY}` 等自定义请求头中，网关按占位符所在的请求头替换。

### 负路径：发往非白名单 host <span id="h-cs-negative" />

同样的命令把 URL 换成白名单外的回显服务（如 `postman-echo.com`）：

```json
{
  "headers": {
    "authorization": "Bearer BMA_SECRET_PLACEHOLDER_MY_API_KEY",
    "host": "postman-echo.com",
    ...
  }
}
```

对方只拿到无意义的占位符，**真实密钥未泄露**。请求本身没有被拦截（HTTP 200 照常返回）——白名单的语义是「密钥替换生效的 host 范围」，而非「网络连通范围」。

### 出网 TLS 校验：默认可直接通过 <span id="h-cs-tls" />

网关做的是透明 MITM：沙箱内看不到 proxy 环境变量，出站 HTTPS 在网关完成 TLS 终结。**当前沙箱已预置网关 CA**（`SSL_CERT_FILE`、`CURL_CA_BUNDLE`、`REQUESTS_CA_BUNDLE` 均指向它），因此：

- `curl` 默认校验 → 正常退出 0；
- Python `requests`（默认 `verify=True`）→ 正常返回 200；

**直接使用默认校验即可，不要预先关闭它**。仅当个别环境出现证书错误（curl 退出码 60、`SSLError`）时，再检查上述 CA 环境变量是否指向网关证书；`-k` / `verify=False` 是排查手段，不是常规步骤。这一条对所有会话成立（不绑 Vault 的也一样）。

## 步骤 6 · 会话环境变量：非敏感配置的首选 <span id="h-cs-step6" />

不需要密钥级保护的配置，直接在**建会话时**传入，明文直通沙箱：

```bash
curl -X POST "$AGENTSTUDIO_URL/sessions" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "'"$AGENT_ID"'",
    "environment_id": "'"$ENV_ID"'",
    "title": "客户咨询 #1234",
    "environment_variables": {
      "API_BASE_URL": "https://new.example.com",
      "LOG_LEVEL": "info"
    }
  }'
```

行为：

- 沙箱内 `printenv API_BASE_URL` → `https://new.example.com`（**真实值**，Agent 的 bash / python 直接可用）；
- 创建响应与 `GET /sessions/{id}` 均**原样回显**该字段（和 `metadata` 同级）——注意这意味着它对有会话读权限的人可见，只放非敏感内容；
- **Deployment 不支持**：`POST /deployments` 传 `environment_variables` 不报错但被静默忽略，触发生成的 session 里没有这些变量。定时链路的注入只能走 `vault_ids`。

给 Agent 写提示词时直接引用变量名即可，例如：「调用 `$API_BASE_URL` 提供的接口，日志级别按 `$LOG_LEVEL`」。

## 步骤 7 · 运维与清理 <span id="h-cs-step7" />

- 轮换：Vault API 未提供显式轮换端点；直接更新 `secret_value` 是当前手段（update 须带完整 `auth` 值）。
- 清理顺序：**先删 credential（子）再删 vault（父）**——删除 vault 不会级联删凭证（孤儿数据），完整生命周期动词见[生产化篇](managed-agents-production.md)。
- Webhook 侧有 `vault.created / archived / deleted` 与 `vault_credential.created / archived / deleted` 事件可用于管控面监控，见[进阶：Webhook 事件通知](managed-agents-webhook-notifications.md)。

## 常见问题 <span id="h-cs-faq" />

<table style={{ display: "table", tableLayout: "fixed", width: "100%", overflowWrap: "anywhere" }}>
  <colgroup>
    <col style={{ width: "34%" }} />

    <col style={{ width: "30%" }} />

    <col style={{ width: "36%" }} />
  </colgroup>

  <thead>
    <tr>
      <th style={{ verticalAlign: "top" }}>症状</th>
      <th style={{ verticalAlign: "top" }}>原因</th>
      <th style={{ verticalAlign: "top" }}>解法</th>
    </tr>
  </thead>

  <tbody>
    <tr>
      <td style={{ verticalAlign: "top" }}>建凭证报 409 <code>CREDENTIAL\_AUTH\_NETWORKING\_ERROR</code>「出口网络地址不能为空」</td>
      <td style={{ verticalAlign: "top" }}><code>allowed\_hosts</code> 缺失或没嵌在 <code>auth.networking</code> 里</td>
      <td style={{ verticalAlign: "top" }}>按结构写：<code>"networking": \{"allowed\_hosts": \["api.example.com"]}</code></td>
    </tr>

    <tr>
      <td style={{ verticalAlign: "top" }}><code>printenv</code> 打出来是 <code>BMA\_SECRET\_PLACEHOLDER\_\*</code>，怀疑「注入失败」</td>
      <td style={{ verticalAlign: "top" }}>这就是新模型的正确行为</td>
      <td style={{ verticalAlign: "top" }}>用端到端请求验证（步骤 5）：白名单 host 收到真实值即注入成功</td>
    </tr>

    <tr>
      <td style={{ verticalAlign: "top" }}>沙箱里 curl 退出码 60 / requests 报 SSLError</td>
      <td style={{ verticalAlign: "top" }}>出网网关 MITM，证书不在沙箱 CA 库</td>
      <td style={{ verticalAlign: "top" }}>curl 加 <code>-k</code>、requests 加 <code>verify=False</code>（当前行为）</td>
    </tr>

    <tr>
      <td style={{ verticalAlign: "top" }}>对方服务说收到的还是占位符</td>
      <td style={{ verticalAlign: "top" }}>① 目标 host 不在该凭证的 <code>allowed\_hosts</code> 里；② 占位符位于请求体或查询参数（网关不替换）；③ 该 host 配了多枚凭证，替换歧义</td>
      <td style={{ verticalAlign: "top" }}>① 把目标 host 加进白名单；② 把凭证放进请求头；③ 一个 host 只配一枚凭证</td>
    </tr>

    <tr>
      <td style={{ verticalAlign: "top" }}>Deployment 触发的 session 拿不到 <code>environment\_variables</code></td>
      <td style={{ verticalAlign: "top" }}>Deployment 不支持该参数（静默忽略）</td>
      <td style={{ verticalAlign: "top" }}>定时链路用 <code>vault\_ids</code>；或应用侧先建 session 再发消息</td>
    </tr>

    <tr>
      <td style={{ verticalAlign: "top" }}>想验证密钥有没有泄露到事件流</td>
      <td style={{ verticalAlign: "top" }}>沙箱内打印的只有占位符</td>
      <td style={{ verticalAlign: "top" }}>在<b>沙箱输出与出站请求（替换前）</b>范围内搜真实值应为 0 命中、搜 <code>BMA\_SECRET\_PLACEHOLDER</code> 可见占位符。注意：<b>被调用服务的响应体</b>（如 httpbin 会把请求头回显进响应 JSON）会作为工具输出进入事件流——外部服务自己返回的内容不在此保证范围内，选择回显型端点做验证时用假值</td>
    </tr>
  </tbody>
</table>

## 小结 <span id="h-cs-summary" />

- **占位符模型**：密钥只存凭据库（加密），沙箱、模型上下文与平台事件全部只见 `BMA_SECRET_PLACEHOLDER_*`；真实值只在出网网关命中 `allowed_hosts` 的瞬间替换进请求头。外部服务响应体回显的内容（如 httpbin）不受此保证约束。
- **网关只替换请求头中的占位符、只按 host 匹配**：请求体与查询参数原样透出；非白名单 host 请求照常放行但密钥不出门。
- **一个 host 一枚凭证**：同 host 多凭证替换有歧义。
- **TLS**：沙箱出网走网关 MITM，但已预置网关 CA，默认校验可直接通过；证书异常时先排查 CA 环境变量，不要把关闭校验当常规步骤。
- **选型分层**：非敏感配置用会话环境变量（明文直通）；高敏密钥与 Deployment 无人值守链路用 Vault。

## 下一步 <span id="h-cs-next" />

- [密钥库](managed-agents-credential.md)：Vault 与凭证的控制台操作。
- [进阶：生产化定时晨报机器人](managed-agents-production.md)：`vault_ids` 在 Deployment 中的配置。
- [Credential API](api/credential-create.md)：凭证接口的完整参数。
