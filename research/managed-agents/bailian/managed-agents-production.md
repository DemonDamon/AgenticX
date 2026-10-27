---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/managed-agents-production
fetched: 2026-10-23
title: 进阶：生产化定时晨报机器人
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 进阶：生产化定时晨报机器人

> 把 Managed Agents 接入生产：MCP 工具集接入、配置注入（会话环境变量与 Vault 密钥库）、Deployment 定时触发、人工审核（HITL）与资源生命周期管理，示例统一用 curl。

<meta property="og:title" content="进阶：生产化定时晨报机器人" />

## 概述 <span id="h-pr-intro" />

本篇讲 Managed Agents 的生产化改造：MCP 工具集接入（市场注册制）、配置注入（会话环境变量 + Vault 密钥库）、触发平台化（Deployment：手动 / cron 定时 / `initial_events`）、人审（HITL）、资源生命周期管理，以及数据驻留的当前行为。示例统一用 curl。

凭证注入的深度内容（Vault 占位符安全模型、出网网关、`allowed_hosts`）拆到[进阶：密钥库安全注入与出网网关](managed-agents-credential-security.md)——本篇只覆盖凭证接入的最短路径。

## 场景：云岭茶饮的晨报机器人 <span id="h-pr-scenario" />

「云岭茶饮」是一家虚构的连锁茶饮品牌，运营团队每天早上要做的第一件事，是翻一遍行业动态：竞品上了什么新品、供应链有什么风吹草动、有没有涉及茶饮的负面舆情。这件事重复、耗时、容易漏——典型该交给自动化的任务。要搭一个**晨报机器人**，把生产化的几块基础设施全部串起来：

| 需求                    | 用什么能力                                         |
| --------------------- | --------------------------------------------- |
| 每天早上 7:30 自动跑，不用人守着   | **Deployment**（cron 定时触发）                     |
| 触发时自动带上当天的任务说明        | **Deployment**（`initial_events` 触发时下发）        |
| 搜索行业动态                | **MCP 工具集**（市场里的 WebSearch 服务）                |
| 把晨报推送到公司 GitHub 仓库    | **Vault 密钥库**（注入 `GITHUB_TOKEN`，占位符 + 出网网关替换） |
| 遇到重大负面舆情，先停下等人确认      | **HITL**（`requires_action` + 轮询）              |
| 换季改 prompt、季度末停用、清理资源 | **版本管理 + 资源生命周期**                             |

端到端流程：建 vault、存一枚 GitHub token 密钥、建一个挂 WebSearch 工具集的 Agent → 先手动建 Session 试点验证（工具调用真的发生、密钥链路真的通）→ 再上 Deployment 把「定时 + 触发即跑」交给平台 → 验证版本锁定与运维动词（pause / archive）→ 最后按依赖顺序清理。

<Note>
  为什么定时链路用 Vault 而不是会话环境变量？因为 **Deployment 不支持 `environment_variables`**（传了被静默忽略，触发的 Session 里无此变量）——无人值守链路的凭证注入只有 `vault_ids` 一条路。应用侧自建 Session 的场景优先用环境变量（见 步骤 4）。
</Note>

## 前置 <span id="h-pr-prereq" />

- 一个阿里云百炼工作空间，及其工作空间 ID；
- 一把 DashScope API Key（一把 Key 覆盖工作空间内全部资源）；
- 一枚 GitHub PAT（演示用假值 `GITHUB_TOKEN` 表示——本篇只需要验证「注入」这个动作，用假 token 更安全）。

约定环境变量：

```bash
export AGENTSTUDIO_URL="https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio"
export DASHSCOPE_API_KEY="<你的 DashScope API Key>"  # gitleaks:allow
export GITHUB_TOKEN="ghp_DUMMY_TOKEN_FOR_SMOKE_TEST"  # gitleaks:allow
```

<Note>
  Managed Agents 当前仅 `cn-beijing` 单区域。所有请求带 `Authorization: Bearer $DASHSCOPE_API_KEY`，响应带 `x-request-id` 便于排查（请求体里也回显 `request_id` 字段）。
</Note>

## 原理：两条扩展线 + 一条触发线 <span id="h-pr-theory" />

给 Agent 扩展能力，生产上真正常用的是两条**互相独立**的线：

- **MCP 工具集**：Agent 声明一个（或多个）阿里云百炼 MCP 市场里的服务，运行时平台代替 Agent 去调那个服务的工具。适合「服务在公网、由阿里云百炼市场托管」的场景——不用管连接细节，也（通常）不用管 key。
- **配置/凭证注入（两条路，按敏感级分层）**：
  - **会话环境变量**（`environment_variables`，主推）：建会话时传键值对，**明文直通**沙箱进程，Agent 在 bash / python 里 `os.environ` 拿到真实值。适合非敏感配置与交互式会话——最简单，不用预建任何资源。限制：Deployment 不支持。
  - **Vault 密钥库**：密钥预先存进 vault，会话只带 `vault_ids`。沙箱内拿到的是**占位符**（`BMA_SECRET_PLACEHOLDER_*`），真实值仅在出网网关命中该密钥的 `allowed_hosts` 白名单时替换请求头中的占位符。适合高敏密钥与无人值守链路。完整安全模型见[进阶：密钥库安全注入与出网网关](managed-agents-credential-security.md)。

两者的组合才是完整形态：平台级外部能力走 MCP，用户级私密凭证走 Vault（密钥）或环境变量（配置）。

此外还有第三种模式，[入门篇](managed-agents-data-analysis.md)没展开：**自定义工具**——自己的服务。Agent 以 `function_call` 事件把调用抛回应用，应用算完再用 `function_call_output` 回填。服务只在内部网络可达时用这条。

本篇再补上**触发线**：入门篇的用法里，Session 由应用创建、消息由应用发——「谁在早上 7:30 把任务发出去」只能靠自写的定时脚本。**Deployment** 把这个角色交给平台：声明式地配好「哪个 Agent、锁哪个版本、触发时下发哪些消息、挂哪些凭证、什么时间表」，之后定时触发、Session 创建、`initial_events` 下发全部由平台完成，应用只需要来看结果。

<Note>
  **安全边界**：token 存进 vault 后**不再进入沙箱**——`printenv` 只能看到占位符；出网时由网关按 `allowed_hosts` 白名单替换。占位符保证覆盖**环境变量与出站请求（替换前）**；被调用服务的**响应体**（例如回显型的测试端点会把请求头原样返回）会作为工具输出进入事件流，这属于外部服务自身行为，不在占位符保证范围内。但注意两条仍然成立的边界：网关只替换请求头中的占位符；沙箱出站 HTTPS 走网关 MITM，但沙箱已预置网关 CA（`SSL_CERT_FILE` / `CURL_CA_BUNDLE` / `REQUESTS_CA_BUNDLE` 均指向它），curl 与 requests 默认校验可直接通过，仅在个别环境证书异常时才需要排查 CA 配置，细节与排查方法见[进阶：密钥库安全注入与出网网关](managed-agents-credential-security.md)。
</Note>

## 步骤 1 · 建 Vault <span id="h-pr-step1" />

Vault 有两个关键字段：`display_name`（控制台展示用）和 `metadata`（存内部用户 ID 等）。

```bash
curl -X POST "$AGENTSTUDIO_URL/vaults" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "display_name": "云岭茶饮 运营部",
    "metadata": {
      "internal_user_id": "u_yunling_ops",
      "team": "operations"
    }
  }'
```

响应返回 `id`（形如 `vlt_01M1G0W54ARXJ4W61B0N4281TK`）。记下它：

```bash
export VAULT_ID="vlt_xxx"
```

## 步骤 2 · 存 GitHub token 密钥 <span id="h-pr-step2" />

凭证挂在 vault 之下，端点是**嵌套**的 `/vaults/{vault_id}/credentials`（没有顶级 `/credentials` 端点，调用返回 404）。

每条凭证 = 变量名 + 值 + **出口白名单**。`auth.type` 当前仅支持 `environment_variable`（传 `static_bearer` / `mcp_oauth` 返回 `CREDENTIAL_AUTH_TYPE_ERROR`）。`allowed_hosts` **必填**且必须嵌在 `auth.networking` 里（漏传 → 409 `CREDENTIAL_AUTH_NETWORKING_ERROR`「出口网络地址不能为空」）：

```bash
curl -X POST "$AGENTSTUDIO_URL/vaults/$VAULT_ID/credentials" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "display_name": "GitHub PAT（晨报推送）",
    "auth": {
      "type": "environment_variable",
      "secret_name": "GITHUB_TOKEN",
      "secret_value": "'"$GITHUB_TOKEN"'",
      "networking": { "allowed_hosts": ["api.github.com", "github.com", "*.github.com"] }
    }
  }'
```

要点：

- `secret_name`：变量名。**沙箱里** `os.environ["GITHUB_TOKEN"]` 拿到的是占位符 `BMA_SECRET_PLACEHOLDER_GITHUB_TOKEN`——真实值只在出网请求命中白名单 host 时由网关替换进请求头。
- `secret_value`：真实密钥。**只写不回显**——GET 回来时 `auth` 里只有 `secret_name` / `type` / `networking`，没有值。
- `networking.allowed_hosts`：**密钥允许发往的域名白名单**，支持通配（`*.github.com`）。token 只会被替换到发往这些 host 的请求里——发往其他域名的请求保持占位符，防外泄。
- 响应 `id` 形如 `vcrd_01M1G0W5BYXJDRD32NMB16ER1Z`（前缀是 `vcrd_`，不是 `cred_`）。

```bash
export CRED_ID="vcrd_xxx"
```

## 步骤 3 · 建 Agent：挂 MCP 工具集 <span id="h-pr-step3" />

这一步把三样东西各自备好：**Agent 定义里声明 MCP server 与工具集**、**vault 里的凭证**（步骤 2 已完成）、**Session / Deployment 创建时通过 `vault_ids` 传入**（步骤 4 / 步骤 5）。

先建 Agent。`mcp_servers` 里声明市场服务，`type` 为 `official`、`name` 为**市场服务的 code**；`tools` 里用 `mcp_toolkit` 启用：

```bash
curl -X POST "$AGENTSTUDIO_URL/agents" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "morning-briefing",
    "description": "云岭茶饮行业晨报机器人：定时搜索行业动态并汇总",
    "model": { "id": "qwen3.7-plus" },
    "system": "你是云岭茶饮（连锁茶饮品牌）的晨报助理 [v1]。收到任务后：1) 用 bailian_web_search 搜索过去 24 小时茶饮/餐饮行业的重要动态；2) 把发现汇总成不超过 5 条的晨报，每条一句话带来源。输出开头带 [v1] 标记。不要打印任何凭证的值，除非任务明确要求验证注入。",
    "mcp_servers": [
      { "type": "official", "name": "WebSearch" }
    ],
    "tools": [
      {
        "type": "builtin_toolkit",
        "default_config": { "enabled": true, "permission_policy": { "type": "always_allow" } },
        "configs": [ { "name": "bash", "enabled": true } ]
      },
      {
        "type": "mcp_toolkit",
        "mcp_server_name": "WebSearch",
        "default_config": { "enabled": true },
        "configs": [ { "name": "bailian_web_search", "enabled": true } ]
      }
    ]
  }'
```

两个关键细节：

<Note>
  `configs` **必须逐工具启用**。`mcp_toolkit` 与 `builtin_toolkit` 同构：光有 `default_config.enabled: true` 不够，要在 `configs[ ]` 里把每个要用的工具（这里是 `bailian_web_search`）显式 `enabled: true`，否则 Agent 运行时**拿不到这个工具**，也不会有任何报错。
</Note>

<Warning>
  `mcp_servers.name` **声明时不校验存在性**。写一个市场里不存在的名字也能创建成功，运行时工具静默缺失，Agent 会回复「没有可用工具」。排查办法：发一条强制用工具的消息，看事件流里有没有 `mcp_call`。可用服务列表用 CLI 查：`bl mcp list`（列出账号下已激活的 MCP 服务器，含 code / 工具）。
</Warning>

市场服务由平台代理调用，endpoint 形如 `https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1/mcps/{code}/sse`，一般不需要提供凭证；需要自己 key 的服务，把 key 存进 vault、在 bash 里带鉴权请求头直连即可（bash 里拿到的是占位符，真实值由出网网关替换）。

```bash
export AGENT_ID="agent_xxx"
```

如果 MCP 工具之外还要跑脚本（读取凭证、处理文件），给 `tools` 再加一个[入门篇](managed-agents-data-analysis.md)讲过的 `builtin_toolkit`（bash/read/write 等），两者并存没有问题。纯 MCP 的 Agent 甚至可以不挂 Environment——Session 的 `environment_id` 留空也能跑。

## 步骤 4 · 手动试点：建 Session 验证工具与密钥链路 <span id="h-pr-step4" />

上定时任务之前，先用最简方式运行一轮，验证两件事：**工具调用真的发生、密钥链路真的通**。

### 首选：会话环境变量（非敏感配置 / 交互式会话） <span id="h-pr-envvars" />

应用侧自建 Session 时，**配置注入首选** `environment_variables`——明文键值对直接进沙箱，不用预建 vault，Agent 的 bash / python 里 `os.environ` 直接拿到真实值：

```bash
curl -X POST "$AGENTSTUDIO_URL/sessions" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "'"$AGENT_ID"'",
    "title": "Morning briefing pilot",
    "environment_variables": { "BRIEF_MAX_ITEMS": "5", "LOG_LEVEL": "info" }
  }'
```

验证：让 Agent 执行 `printenv BRIEF_MAX_ITEMS` → 输出 `5`（**真实值**）。创建响应与 GET 均回显该字段，注意只放非敏感内容。

交互式会话 + 非敏感配置 → 环境变量即可满足。**需要密钥级安全（沙箱内不见明文）或通过 Deployment 运行无人值守链路** → 使用下面的 vault 配置。

### 定时链路必需：vault\_ids 配置 <span id="h-pr-vaultids" />

Deployment 不支持 `environment_variables`，定时链路（步骤 5）的凭证只能靠 vault。创建 Session 时用 `vault_ids` 把密钥接入运行时（`agent` 字段传 Agent ID 字符串，Session 会锁定该 Agent 当前版本的完整快照）：

```bash
curl -X POST "$AGENTSTUDIO_URL/sessions" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "'"$AGENT_ID"'",
    "title": "Morning briefing pilot",
    "vault_ids": [ "'"$VAULT_ID"'" ]
  }'
```

```bash
export SESSION_ID="sesn_xxx"
```

<Note>
  `sessions.create` **不接受初始输入字段**，标准做法是「先创建 Session，再单独 POST 一条 `message` 事件」两步驱动。（若要「触发即带首条消息」，用后文的 Deployment，它支持 `initial_events`。）
</Note>

发一条消息验证**占位符注入**——让它原样执行 `printenv GITHUB_TOKEN`：

```bash
curl -X POST "$AGENTSTUDIO_URL/sessions/$SESSION_ID/events" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": [
      {
        "type": "message",
        "role": "user",
        "content": [
          { "type": "text", "text": "Run exactly this bash command and report the raw output, nothing else: printenv GITHUB_TOKEN" }
        ]
      }
    ]
  }'
```

观测走 SSE 实时流（消费方式见[入门篇](managed-agents-data-analysis.md)的「先开 SSE 流」，`event:` 行恒为 `message`，注释行有 `:connected` / `:HTTP_STATUS/200` / `:keepalive`）：

```bash
curl -N "$AGENTSTUDIO_URL/sessions/$SESSION_ID/events/stream" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Accept: text/event-stream"
```

占位符验证回合的事件流：

```text
session_status   {"session_status": "running"}
message          (user 消息回显)
model_request_start
tool_call        bash  {"command": "printenv GITHUB_TOKEN", ...}
tool_call_output bash  {"stdout":"BMA_SECRET_PLACEHOLDER_GITHUB_TOKEN\n","exit_code":0}
message          (assistant 汇报输出)
session_status   {"stop_reason": {"type": "end_turn"}, "session_status": "idle"}
```

**看到占位符就是注入成功的标志**。密钥的端到端验证（出网替换真的发生）：向白名单 host 发请求、看对方收到的是真实值，见[进阶：密钥库安全注入与出网网关](managed-agents-credential-security.md)。真实链路上 GitHub 推送同理——Agent 把占位符放进请求头调用 `api.github.com`，网关替换成真 PAT，GitHub 鉴权通过。

再发一条消息触发 MCP 工具（「用工具搜索茶饮行业最新动态」），MCP 调用产生的是**专属事件类型**，与 `tool_call` 平行：

```text
mcp_call        role=assistant  data: {"name": "bailian_web_search",
                                 "server_label": "WebSearch",
                                 "arguments": "{\"query\": \"茶饮行业 最新动态\", \"count\": 10}",
                                 "call_id": "call_xxx"}
mcp_call_output role=tool       data: {"output": "<MCP server 返回的 JSON>"}
```

即：内置工具走 `tool_call` / `tool_call_output`，MCP 工具走 `mcp_call` / `mcp_call_output`。收到 `session_status = idle` 且 `stop_reason.type == end_turn` 时本回合结束。

试点通过，两块地基都没问题。接下来把「每天 7:30 谁来发消息」这件事交给平台。

## 步骤 5 · Deployment：把定时任务交给平台 <span id="h-pr-step5" />

Deployment 是与 Agent / Environment / Session 平级的资源：声明「锁哪个版本的 Agent、触发时下发什么、挂哪些凭证、什么时间表」，之后触发、建 Session、下发 `initial_events` 都由平台完成。控制台操作见[部署](managed-agents-deployment.md)。

### 创建：锁版本的 agent + initial\_events + vault\_ids <span id="h-pr-create" />

```bash
curl -X POST "$AGENTSTUDIO_URL/deployments" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "morning-briefing-prod",
    "description": "云岭茶饮行业晨报：手动触发试点",
    "agent": { "id": "'"$AGENT_ID"'", "version": 1 },
    "initial_events": [
      {
        "type": "message",
        "role": "user",
        "content": [
          { "type": "text", "text": "这是今天的晨报任务：1) 用 bailian_web_search 搜索「茶饮行业 最新动态」，只采用今天日期往前 24 小时内发布的内容，每条附发布日期与来源 URL，找不到满足时间窗的资讯就明确说明；2) 用 bash 执行 printenv GITHUB_TOKEN 验证密钥已注入：只需确认输出是否以 BMA_SECRET_PLACEHOLDER_ 开头（沙箱内看不到真实值，不要尝试打印它）；3) 把通过时间窗的资讯整理成不超过 3 条的晨报，每条一句话。" }
        ]
      }
    ],
    "vault_ids": [ "'"$VAULT_ID"'" ],
    "metadata": { "team": "operations", "purpose": "daily-briefing" }
  }'
```

1. `agent` **必须传对象** `{id, version}`，不接受 ID 字符串（传字符串返回 `400 PARAMS_ILLEGAL`）。这与 `sessions.create` 不同（Session 传字符串 = 锁最新）。Deployment 是长期资源，创建时就**显式锁死 Agent 版本**——响应里会把该版本的完整快照（system / tools / model）展开回显。版本语义见下文「版本语义：锁死与漂移陷阱」。
2. `initial_events` **是触发时下发的输入数组**，形状与给 Session 发消息的 `input` 完全一致。它补上了 `sessions.create` 不接受初始输入的缺口：触发生成的 Session，第一条 user 消息就是它——「触发即跑」，不需要应用再补发一条消息。
3. `vault_ids` **在 deployment 级配置**：触发生成的每个 Session 都自动携带这些凭证（注入行为与手动建 Session 完全相同）。

不填 `schedule` 就是**手动模式**（只能通过 `POST /run` 触发）；填了就是定时模式（见下文 cron 小节）。创建成功响应（200）回显全部字段，`status` 为 `"active"`，id 形如 `depl_xxx`（前缀 `depl_`）。

```bash
export DEPLOYMENT_ID="depl_xxx"
```

### 触发：run 与 deployment\_run <span id="h-pr-run" />

```bash
curl -X POST "$AGENTSTUDIO_URL/deployments/$DEPLOYMENT_ID/run" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY"
```

返回 `deployment_run`（前缀 `drun_`），`session_id` 在异步生成前为 `null`：

```json
{
  "id": "drun_xxx",
  "type": "deployment_run",
  "agent": { "id": "agent_xxx", "version": 1 },
  "status": "running",
  "error": null,
  "deployment_id": "depl_xxx",
  "session_id": null,
  "trigger_source": "manual",
  "started_at": "2026-09-02T03:05:16.763Z",
  "finished_at": null
}
```

几秒后查触发历史拿 `session_id`（也是生产里判断「跑完了没」的方式——`status` 变 `succeeded`、`finished_at` 有值）：

```bash
curl "$AGENTSTUDIO_URL/deployments/$DEPLOYMENT_ID/runs" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY"
```

返回形状与 versions API 一致：`{data: [...], next_page, request_id}`，按时间倒序。`trigger_source` 区分 `"manual"` 与 `"schedule"`（cron）。

### 触发即跑：一次触发的完整采证 <span id="h-pr-evidence" />

对触发生成的 Session 拉事件（`GET /sessions/{id}/events?order=asc`，或 SSE），一次典型触发约 26 个事件，关键帧：

```text
session_status   running
message          (user) 这是今天的晨报任务：1) 用 bailian_web_search 搜索……   ← initial_events 下发
mcp_call         bailian_web_search  {"query": "茶饮行业 最新动态", "count": 10}
tool_call        bash  printenv GITHUB_TOKEN
mcp_call_output  (WebSearch 返回的行业动态 JSON)
tool_call_output (BMA_SECRET_PLACEHOLDER_GITHUB_TOKEN)
message          (assistant) [v1] 云岭茶饮晨报 · 2026年9月2日 + 3 条行业动态
session_status   idle  stop_reason={"type": "end_turn"}
```

一次触发同时完成三件事：**`initial_events` 作为首条 user 消息进入 Session**、**MCP 工具被调用**、**vault 密钥注入 deployment 生成的 Session（沙箱内为占位符，出网时网关替换）**。应用全程没有发过一条消息，触发与执行全部由平台完成。

### 版本语义：锁死与漂移陷阱 <span id="h-pr-versioning" />

Deployment 创建时锁 `{id, version}`，之后 Agent 升级**不影响**它。把 morning-briefing 的 prompt 从 v1 升到 v2（`POST /agents/{id}`，name + 当前 version 必填，见[进阶：提示词版本管理与回滚](managed-agents-prompt-versioning.md)），再触发同一个 deployment：

```text
deployment_run.agent.version = 1          ← 仍是 v1
session 输出开头 = [v1]                     ← 跑的是 v1 的 prompt
```

要升级 deployment 跑的版本，用 `POST /deployments/{id}` 更新（PATCH 语义，不传的字段保留）。但这里有个**生产陷阱**：

<Warning>
  **update 不带 `agent` 字段时，agent 会漂移到最新版本**。只改 `description`（body 里没有 agent），响应里 `agent.version` 从 1 变成 2——prompt 被悄悄升级了。安全做法：**任何 deployment 更新都显式带上 `agent {id, version}`**：

  ```bash
  curl -X POST "$AGENTSTUDIO_URL/deployments/$DEPLOYMENT_ID" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "description": "云岭茶饮行业晨报：手动触发试点（更新描述）",
      "agent": { "id": "'"$AGENT_ID"'", "version": 2 }
    }'
  ```

  （显式传 `agent {id, version: 1}` 也可把版本锁回 v1。）
</Warning>

对比记忆：**Session 锁的是「创建那一刻的最新或指定版本」快照；Deployment 锁的是「创建时显式指定的版本」，但 update 时不传 agent 会漂移到最新**。

### cron：定时触发 <span id="h-pr-cron" />

给 deployment 加 `schedule` 就是定时模式。验证调度可用每分钟表达式（正式场景换成业务时间表）：

```bash
curl -X POST "$AGENTSTUDIO_URL/deployments" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "morning-briefing-cron",
    "agent": { "id": "'"$AGENT_ID"'", "version": 1 },
    "initial_events": [ ... 同上 ... ],
    "schedule": { "type": "cron", "expression": "* * * * *", "timezone": "Asia/Shanghai" }
  }'
```

行为（expression `* * * * *`，每分钟）：

- **整分钟准时自动触发**，runs 列表里出现 `trigger_source: "schedule"` 的新 run，与手动 run 完全同构（同样创建 Session、下发 `initial_events`）。
- 响应的 `schedule` 对象带 `next_run_at` / `last_run_at`——判断「定时任务活着、下次几点跑」不用自己算 cron，查 deployment 对象即可。
- 正式的晨报场景：`"expression": "30 7 * * *"`（每天 07:30）、`"timezone": "Asia/Shanghai"`。

### 运维动词：pause / unpause / archive <span id="h-pr-verbs" />

| 动词   | 端点                               | 行为                                                                                      |
| ---- | -------------------------------- | --------------------------------------------------------------------------------------- |
| 暂停调度 | `POST /deployments/{id}/pause`   | `status: "paused"`、`paused_reason: {type: "manual"}`；**cron 不再触发**，`next_run_at` **冻结** |
| 恢复   | `POST /deployments/{id}/unpause` | `status: "active"`，从下一个调度点恢复；**暂停期间错过的触发不补跑**                                           |
| 归档   | `POST /deployments/{id}/archive` | `archived_at` 有值、`next_run_at` 清空（解除调度）；GET 仍可查，**列表默认过滤归档项**                           |
| 删除   | `DELETE /deployments/{id}`       | **405 不支持**——与 Agent 同款「只能归档不能删」                                                        |

三个容易混淆的点：

- **pause 只挡调度，不挡手动触发**：对 paused 的 deployment `POST /run` 仍可正常触发执行。需要停掉定时任务但保留应急手动触发时，使用 pause。
- **archive 才是彻底停用**：对 archived 的 deployment `POST /run` 返回 `409 DEPLOYMENT_STATE_CONFLICT "deployment archived"`——手动也触发不了。
- **并发触发不受限制**：前一次运行未结束时再次 `POST /run`，会各自创建 run 并行执行。需要控制并发时，在触发端自行限流，或通过 update 调整 schedule。

### 观察面小结 <span id="h-pr-observe" />

| 想知道什么          | 查哪里                                                         |
| -------------- | ----------------------------------------------------------- |
| 定时任务还活着吗、下次几点跑 | `GET /deployments/{id}` 的 `status` + `schedule.next_run_at` |
| 某次触发跑完了吗       | `GET /deployments/{id}/runs` 的 `status` / `finished_at`     |
| 某次触发干了什么       | run 的 `session_id` → `GET /sessions/{id}/events`（或 SSE）     |
| 运行是否失败         | run 的 `error` 字段 + session 事件流的 `session_status`            |

对「跑完了要通知我」这类需求，本篇的做法是**主动查询**（轮询 runs / 查 deployment 对象）；平台侧的事件推送（Webhook）见[进阶：Webhook 事件通知](managed-agents-webhook-notifications.md)——订阅 `session.status_idled` 等事件，让平台主动 POST 接收端。

## 步骤 6 · 生产里的人审（HITL） <span id="h-pr-step6" />

生产环境里的人审（HITL）不应该依赖长连接。人工审核的等待窗口可能是几分钟到几小时，如果这段时间一直靠 SSE 长连接挂着，既不好横向扩展（连接与实例绑定，无法自由调度），也扛不住服务重启（一次发布就丢掉全部在途审批）。正确的形态是：**让 Session 停在等待状态，由服务在需要时再去取状态、做决定、回填结果。**

Managed Agents 的 Session 天然支持这种「停下来等」的语义——当 Agent 需要人工确认某次工具调用时，Session 会转为 `idle` 并给出 `requires_action`，然后一直保持这个状态，直到回填确认结果。

### 方案 A：轮询历史事件 + `requires_action` <span id="h-pr-hitl-a" />

由服务定时拉取历史事件，判断 Session 是否停在「需要人工/工具介入」的状态。处于该状态时，最后一条事件的 `session_status` 为 `idle`、`stop_reason` 为 `requires_action`，并带上 `pending_batch_id` 与待处理的 `pending_call_ids`。

```bash
# 拉最新历史事件（倒序取最后一条）
curl -X GET "$AGENTSTUDIO_URL/sessions/$SESSION_ID/events?order=desc&limit=1" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY"
```

轮询逻辑（伪代码）：

```text
每隔 N 秒：
  GET /sessions/{id}/events?order=desc&limit=1
  读取最后一条的 session_status / stop_reason
  若 stop_reason == requires_action:
      取出待处理的工具调用（batch_id + pending_call_ids）
      把它升级入人工审核队列
  若 stop_reason == end_turn:
      本回合完成，结束轮询
```

人工做出决定后，用 `tool_approval_response` 事件批准或拒绝该工具调用（`batch_id` 取自 `stop_reason.pending_batch_id`，`call_id` 取自 `pending_call_ids` 中对应的一项）：

```bash
curl -X POST "$AGENTSTUDIO_URL/sessions/$SESSION_ID/events" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": [
      {
        "type": "tool_approval_response",
        "role": "user",
        "content": [
          {
            "type": "data",
            "data": {
              "batch_id": "<pending_batch_id>",
              "call_id": "<pending_call_ids 中对应项>",
              "result": "allow"
            }
          }
        ]
      }
    ]
  }'
```

拒绝时把 `result` 改为 `deny`。同一批次有多条待审批调用时，逐条回填（每条一个 `call_id`），全部收齐后工具才会执行。若是自托管函数结果的回填，则用 `function_call_output`（带 `call_id` + `output`）。

放到晨报场景：晨报 Agent 发现疑似重大负面舆情、要往公司 repo 写「舆情预警」之前，让它调用一个需要确认的动作（自定义工具或写入前确认），Session 停在 `requires_action`，服务轮询发现后推给运营值班群，人点「允许/拒绝」，回填 `tool_approval_response`，Agent 继续。工具审批的配置方式见[内置工具](managed-agents-builtin-tools.md)。

<Note>
  关于成本上限：Session 当前**不提供成本上限（budget）字段**，也没有触达上限时的通知事件。成本控制建议放到 Deployment 层做触发频率与并发限流，再配合事后用量核对作为补充。
</Note>

### 方案 B：Deployment 触发 + 事后查询 <span id="h-pr-hitl-b" />

如果触发场景是「定时」或「由外部系统手动触发一次任务」，直接用 步骤 5 的 Deployment：外部系统只需要 `POST /deployments/{id}/run`（或直接交给 cron），事后用 `GET /deployments/{id}/runs` 收结果——`status` 到 `succeeded` 只代表执行完成，还要用程序核验产物内容（例如逐条校验晨报资讯的发布日期是否落在时间窗内、来源 URL 是否可解析），不能以 run 状态代替内容验收。`session_id` 用于查询产物。全程无长连接。

## 步骤 7 · 数据驻留与区域 <span id="h-pr-step7" />

当前行为说明：Managed Agents 为**单区域部署（`cn-beijing`）**，Agent 推理与沙箱运行都发生在该区域。因此不提供推理区域选择参数，也不提供在 `sessions.create` 时对单个 Session 做区域覆盖的配置。

这一节**无需任何额外配置**：数据驻留由「单区域部署」这一事实保证。如果合规要求是「数据不出某个区域」，当前形态已经满足；如需多区域选择，以官方后续发布的能力为准。

## 步骤 8 · 资源生命周期：list / retrieve / update / archive / delete <span id="h-pr-step8" />

每种资源有一套动词，但**不是每种资源都支持全套**：

| 资源           | 列表/单查                                | 更新                                    | 归档                          | 删除                                       |
| ------------ | ------------------------------------ | ------------------------------------- | --------------------------- | ---------------------------------------- |
| agents       | GET `/agents`、`/agents/{id}`         | `POST /agents/{id}`（自动升 version）      | `POST /agents/{id}/archive` | **不支持**（DELETE 返回 405）                   |
| environments | GET `/environments`、`/{id}`          | `POST /environments/{id}`             | `POST /{id}/archive`        | DELETE 可用                                |
| sessions     | GET `/sessions`、`/{id}`              | —                                     | `POST /{id}/archive`        | DELETE 可用                                |
| deployments  | GET `/deployments`、`/{id}`（列表默认过滤归档） | `POST /deployments/{id}`（注意 agent 漂移） | `POST /{id}/archive`        | **不支持**（DELETE 405）                      |
| vaults       | GET `/vaults`、`/{id}`                | `POST /vaults/{id}`                   | `POST /{id}/archive`        | DELETE 可用                                |
| credentials  | GET `/vaults/{id}/credentials`       | —                                     | —                           | `DELETE /vaults/{vid}/credentials/{cid}` |

列出 agents：

```bash
curl -X GET "$AGENTSTUDIO_URL/agents?limit=5" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY"
```

查单个 agent：

```bash
curl -X GET "$AGENTSTUDIO_URL/agents/$AGENT_ID" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY"
```

更新 agent。注意三点：更新动词是 `POST /agents/{id}`，**不是** `PATCH`（405）；body 里**必须带当前 `version`** 做乐观并发控制；**必须带 `name`**（否则报 `AGENT_005 智能体名称不能为空`）。更新成功 version 自动 +1：

```bash
curl -X POST "$AGENTSTUDIO_URL/agents/$AGENT_ID" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "morning-briefing",
    "version": 1,
    "system": "你是云岭茶饮（连锁茶饮品牌）的晨报助理 [v2]。……（新 prompt）"
  }'
```

查看历史版本：

```bash
curl -X GET "$AGENTSTUDIO_URL/agents/$AGENT_ID/versions" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY"
```

**archive 与 delete 的取舍**：`archive` 保留记录供审计，拆掉容器、停止计量；`delete` 是彻底删除。生产中优先 `archive`。Agent 和 Deployment 只能归档不能删，归档后版本历史与触发记录仍保留可查。

## 步骤 9 · 清理 <span id="h-pr-step9" />

清理有**依赖顺序**，且有一处注意：**删除 vault 不会级联删除其下的 credentials**。先删 vault 再去删 credential，credential 端点仍然可用（孤儿数据）。正确顺序是子资源先于父资源：

```bash
# 1. 删除试点 session（支持 DELETE，返回 200）
curl -X DELETE "$AGENTSTUDIO_URL/sessions/$SESSION_ID" -H "Authorization: Bearer $DASHSCOPE_API_KEY"

# 2. 归档 deployment（DELETE 返回 405，只能 archive；归档即解除调度）
curl -X POST "$AGENTSTUDIO_URL/deployments/$DEPLOYMENT_ID/archive" -H "Authorization: Bearer $DASHSCOPE_API_KEY"

# 3. 删除 environment（支持 DELETE）
curl -X DELETE "$AGENTSTUDIO_URL/environments/$ENV_ID" -H "Authorization: Bearer $DASHSCOPE_API_KEY"

# 4. 归档 agent（DELETE 返回 405，只能 archive）
curl -X POST "$AGENTSTUDIO_URL/agents/$AGENT_ID/archive" -H "Authorization: Bearer $DASHSCOPE_API_KEY"

# 5. 先删 credential（子），再删 vault（父）——顺序不能反
curl -X DELETE "$AGENTSTUDIO_URL/vaults/$VAULT_ID/credentials/$CRED_ID" -H "Authorization: Bearer $DASHSCOPE_API_KEY"
curl -X DELETE "$AGENTSTUDIO_URL/vaults/$VAULT_ID" -H "Authorization: Bearer $DASHSCOPE_API_KEY"
```

deployment 生成的 session 也一样可删：从 `GET /deployments/{id}/runs` 收集全部 `session_id`，逐个 DELETE（注意 running 状态的 session 不能删，须等 idle）。

## 小结 <span id="h-pr-summary" />

这一篇把生产运维的骨架搭了起来：

- 用 **MCP 工具集**（`mcp_servers` official + `mcp_toolkit` configs 逐工具启用）让 Agent 调用市场外部服务，平台代理调用，事件流里看 `mcp_call` / `mcp_call_output`。
- **配置注入分两层**：非敏感配置走**会话环境变量**（`environment_variables` 明文直通沙箱，交互式会话首选）；高敏密钥走 **Vault**（占位符注入 + 出网网关按 `allowed_hosts` 白名单替换，token 不经过应用侧、不进 Agent 配置、不进沙箱）——定时链路（Deployment）只支持后者。
- 用 **Deployment** 把触发交给平台托管：`agent {id, version}` 显式锁版本，`initial_events` 触发即下发首条消息，cron 定时自动跑，`pause`（挡调度不挡手动）/ `unpause`（错过不补跑）/ `archive`（彻底停用）管生命周期，`GET runs` 收结果。
- 生产 HITL 的两条路：**轮询** `requires_action` + 回填 `tool_approval_response`，或 **Deployment 触发 + 事后查询 runs**。
- 生命周期动词按资源区别对待：**Agent 和 Deployment 只归档不删**，Session / Environment / Vault 可删，**credential 先于 vault 删**（无级联）。

有六处当前行为需要留意：**Deployment update 不传 agent 会漂移到最新版本**（更新时永远显式带 `{id, version}`）、**并发触发无冲突限制**（限流需自行实现）、**Session 无成本上限字段**（以 Deployment 层限流为补充）、**单区域 `cn-beijing`**、**`mcp_servers.name` 不做存在性校验**（写错名字静默失败）、**沙箱出网走网关 MITM**（已预置网关 CA，默认 TLS 校验可过；个别环境异常时排查 CA 配置）。

## 下一步 <span id="h-pr-next" />

- [进阶：密钥库安全注入与出网网关](managed-agents-credential-security.md)：占位符模型、网关替换行为与排查方法。
- [进阶：Webhook 事件通知](managed-agents-webhook-notifications.md)：让平台在任务跑完时主动通知。
- [进阶：提示词版本管理与回滚](managed-agents-prompt-versioning.md)：晨报 prompt 的灰度与回滚。
