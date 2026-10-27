---
source: https://ark.volcengine.com/region:cn-beijing/docs/use-vaults-authentication
fetched: 2026-10-24
title: 使用 Vaults 认证
---

# 使用 Vaults 认证

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

当你使用 Managed Agents 构建需要访问第三方服务的应用时，可以通过 Vaults（凭据保管库）保存并隔离每个应用用户的凭据。你的服务端只需为每个用户创建 Vault、写入 Credential，并保存用户与 `vault_id` 的映射，无需自行维护密钥存储，也无需在每次调用中重复传递 token。

创建 Session 时，通过 `vault_ids` 传入当前用户的 Vault ID；Agent 调用 MCP 服务时会自动使用对应的 Credential 完成鉴权。这样，同一个 Agent 可以安全地服务多个用户，并分别访问各自有权限的第三方资源。

> **说明：示例**
>
> 你使用 Managed Agents 构建了一个 GitHub 代码助手。Alice 发起任务时，服务端创建 Session 并绑定 Alice 的 Vault，Agent 使用 Alice 的 GitHub 权限；Bob 发起任务时，服务端绑定 Bob 的 Vault，Agent 使用 Bob 的 GitHub 权限。

## 准备工作

开始前你需要：

- 已创建的 API Key：配置为环境变量 `ARK_API_KEY`，详情请参见 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey)。
- 已创建的 Agent：详情请参见 [定义 Agent](define-agent.md)。
- 已创建的 Environment：详情请参见 [配置云环境](configure-cloud-environment.md)。

本章节示例的 Base URL 与鉴权方式详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

## 创建 Vault

> **注意：权限边界**
>
> Vault 和凭据在工作空间内共享，不按 API Key 单独隔离。持有同一工作空间任一 API Key 的服务，都可以通过 Vault ID 在 Session 中引用其中的凭据。仅向受信任的服务开放工作空间 API Key。

Vault 是绑定到某个终端用户的凭据集合。给它一个 `display_name`，可选用 `metadata` 标记以便映射回你自己的用户记录：

**选项：Curl**

```Bash
curl https://ark.cn-beijing.volces.com/api/v3/vaults \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "display_name": "Alice",
    "metadata": {"external_user_id": "usr_abc123"}
  }'
```

响应是完整的 Vault 记录：

```json
{
  "type": "vault",
  "id": "vlt-20260701120000-pqrst",
  "display_name": "Alice",
  "metadata": {"external_user_id": "usr_abc123"},
  "created_at": "2026-06-29T10:00:00Z",
  "updated_at": "2026-06-29T10:00:00Z"
}
```

## 添加凭据

| 类型 | 适用场景 | 注入方式 |
| --- | --- | --- |
| `mcp_oauth` | MCP 服务器用 OAuth 2.0 | Session 连接 MCP URL 时注入访问令牌；启用自动刷新后，平台在令牌临近过期时换取新令牌 |
| `static_bearer` | MCP 用固定 Bearer token（API Key、个人访问令牌） | 无刷新流程，直接注入 |
| `mcp_static` | MCP 使用固定密钥，需要以 Bearer、自定义 Header 或 URL 查询参数注入 | 通过 `injection_type` 选择注入位置 |
| `environment_variable` | 通过环境变量鉴权的命令行、SDK、直接 API 调用 | 沙箱内是不透明占位符，**出口处**替换为真实值，Agent 永远看不到密钥 |
| `env_oauth` | CLI 或 SDK 使用短效 OAuth 访问令牌 | 按 `secret_name` 注入；启用自动刷新后，在 Session 使用凭据时换取新令牌 |

你提供的实际密钥（`token`、`access_token`、`refresh_token`、`client_secret`、`secret_value`）是敏感的**只写**字段，API 响应不会返回这些字段。

### MCP OAuth 凭据

当 MCP 服务器使用 OAuth 2.0 时，使用 `mcp_oauth`。创建凭据时，配置 MCP 服务地址和当前访问令牌。

如需启用自动刷新，创建或更新凭据时同时提供 `expires_at` 和完整的 `refresh` 对象。Session 连接 MCP 服务时，平台读取该凭据。访问令牌进入 `expires_at` 前 5 分钟刷新窗口时，平台自动换取并注入新令牌。该机制由读取操作触发，不在后台定时刷新。

`refresh.token_endpoint_auth.type` 三选一：

- `none`：公共客户端，不提供 `client_secret`。
- `client_secret_basic`：使用 `client_secret` 的 HTTP Basic 鉴权，同时提供 `client_secret`。
- `client_secret_post`：把 `client_secret` 放在 POST 请求体里，同时提供 `client_secret`。

**选项：Curl**

```Bash
curl https://ark.cn-beijing.volces.com/api/v3/vaults/vlt-20260701120000-pqrst/credentials \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "display_name": "Alice Slack",
    "auth": {
      "type": "mcp_oauth",
      "mcp_server_url": "https://mcp.slack.com/mcp",
      "access_token": "xoxp-...",
      "expires_at": "2099-12-31T23:59:59Z",
      "refresh": {
        "token_endpoint": "https://slack.com/api/oauth.v2.access",
        "client_id": "1234567890.0987654321",
        "scope": "channels:read chat:write",
        "refresh_token": "xoxe-1-...",
        "token_endpoint_auth": {
          "type": "client_secret_post",
          "client_secret": "abc123..."
        }
      }
    }
  }'
```

### MCP 静态 Bearer 凭据

当 MCP 服务器接受固定 Bearer token（API Key、个人访问令牌） 时，用 `static_bearer`。无需刷新流程：

**选项：Curl**

```Bash
curl https://ark.cn-beijing.volces.com/api/v3/vaults/vlt-20260701120000-pqrst/credentials \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "display_name": "Linear API key",
    "auth": {
      "type": "static_bearer",
      "mcp_server_url": "https://mcp.linear.app/mcp",
      "token": "lin_api_your_linear_key"
    }
  }'
```

### MCP 静态凭据

当 MCP 服务器使用固定密钥，但不一定采用 Bearer 鉴权时，使用 `mcp_static`。通过 `injection_type` 选择注入方式：

- `bearer`：以 `Authorization: Bearer <token>` 请求头注入。不要传 `injection_name`，`token` 中也不要包含 `Bearer ` 前缀。
- `header`：以自定义请求头注入，必须通过 `injection_name` 指定请求头名称。
- `query`：以 URL 查询参数注入，必须通过 `injection_name` 指定参数名。

以下示例将密钥注入 `X-API-Key` 请求头：

```json
{
  "auth": {
    "type": "mcp_static",
    "mcp_server_url": "https://mcp.example.com/mcp",
    "token": "<MCP_API_KEY>",
    "injection_type": "header",
    "injection_name": "X-API-Key"
  }
}
```

> **说明**
>
> **最小权限原则。** 把固定密钥的权限范围限定为 Agent 所需的最小集合。Agent 可以执行该密钥允许的任何操作，过大的权限范围会在 Agent 异常时扩大影响。

### 环境变量凭据

用 `environment_variable` 通过环境变量对外部服务鉴权，适用于命令行、SDK 或直接 API 调用。

`networking.allowed_hosts` 控制密钥可以被替换到哪些出站主机：

- `"type": "limited"` + 显式主机列表（**推荐**）。
- `"type": "unrestricted"`（仅当调用方访问的域名无法提前枚举时使用）。

**选项：Curl**

```Bash
curl https://ark.cn-beijing.volces.com/api/v3/vaults/vlt-20260701120000-pqrst/credentials \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "display_name": "Notion API key for sandbox",
    "auth": {
      "type": "environment_variable",
      "secret_name": "NOTION_API_KEY",
      "secret_value": "sk-your-secret-here",
      "networking": {
        "type": "limited",
        "allowed_hosts": ["api.notion.com"]
      }
    }
  }'
```

> **说明**
>
> **替换仅发生在出站方向。** 如果客户端使用存储的密钥交换临时访问令牌，返回的令牌会以未脱敏形式进入运行环境。此类流程应由业务侧管理令牌交换和存储。

### 环境 OAuth 凭据

当 CLI 或 SDK 需要从环境变量读取 OAuth 访问令牌时，使用 `env_oauth`。创建凭据时，先配置当前访问令牌（`access_token`）、注入令牌的环境变量名（`secret_name`），以及允许携带该令牌的目标主机（`networking`）。

对于会过期的访问令牌，可以启用自动刷新。创建或更新凭据时，提供以下信息：

- 刷新时机：通过 `expires_at` 提供当前访问令牌的过期时间。
- 令牌端点：通过 `refresh.token_endpoint` 提供第三方 OAuth 服务的令牌端点。
- 刷新令牌：通过 `refresh.refresh_token` 提供换取新访问令牌的凭据。
- 客户端身份：通过 `refresh.client_id` 和 `refresh.token_endpoint_auth` 提供 OAuth 客户端身份及鉴权方式。鉴权方式需要客户端密钥时，还需提供 `refresh.token_endpoint_auth.client_secret`。

Session 访问 `networking` 允许的目标主机时，平台读取该凭据。访问令牌进入 `expires_at` 前 5 分钟刷新窗口时，平台调用 `refresh.token_endpoint` 获取新令牌、更新凭据，再把新令牌注入出站请求。该机制由读取操作触发，不在后台定时刷新。

**选项：Curl**

```Bash
curl https://ark.cn-beijing.volces.com/api/v3/vaults/vlt-20260701120000-pqrst/credentials \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "display_name": "GitHub CLI OAuth",
    "auth": {
      "type": "env_oauth",
      "access_token": "<OAUTH_ACCESS_TOKEN>",
      "expires_at": "<ACCESS_TOKEN_EXPIRES_AT>",
      "refresh": {
        "token_endpoint": "https://github.com/login/oauth/access_token",
        "client_id": "<OAUTH_CLIENT_ID>",
        "refresh_token": "<OAUTH_REFRESH_TOKEN>",
        "token_endpoint_auth": {
          "type": "client_secret_post",
          "client_secret": "<OAUTH_CLIENT_SECRET>"
        }
      },
      "secret_name": "GITHUB_TOKEN",
      "networking": {
        "type": "limited",
        "allowed_hosts": ["api.github.com"]
      }
    }
  }'
```

> **注意**
>
> - **启用自动刷新时，同时提供 `expires_at` 和完整的 `refresh` 对象。** 缺少 `expires_at` 时，平台无法判断刷新时机；缺少 `refresh` 时，平台不会调用 OAuth 令牌端点。
> - **OAuth 令牌端点必须返回 JSON。** `access_token` 必须是字符串；如果返回 `expires_in`，该字段必须是整数秒数。`expires_in` 返回 `"3600"` 等字符串值时，刷新失败。平台会保留当前访问令牌，本次出站请求可能因令牌过期返回 401。检查 `refresh.token_endpoint` 返回字段的类型和 `refresh.token_endpoint_auth` 配置；刷新令牌失效时，重新授权并更新凭据。
> - **替换发生在沙箱出口处，不在沙箱内。** 沙箱里的进程看到的是不透明占位符，而不是真实值。具体影响如下：
>     - 启动时校验凭据格式的客户端可能拒绝占位符。
>     - 用密钥做请求签名的客户端（例如 AWS SigV4）会生成无效签名。
>     - 环境变量注入只适合把密钥值原样写入出站请求头的客户端。
> - **通过凭据限制注入目标。** 在凭据的 `networking` 中设置 `type: limited`，并通过 `allowed_hosts` 显式列出允许注入的出站主机。

### 凭据约束

- **每个 Vault 内的匹配键必须唯一。** `mcp_server_url`（`mcp_oauth`、`static_bearer`、`mcp_static`）和 `secret_name`（`environment_variable`、`env_oauth`）在同一 Vault 的有效凭据中不能重复。重复创建返回 409。
- **匹配键不可变。** 要修改 `mcp_server_url` 或 `secret_name`，需要删除旧凭据，再创建新凭据。
- **每个 Vault 最多包含 100 个凭据。** 超出限制时返回 409。

MCP 类型凭据（`mcp_oauth`、`static_bearer`、`mcp_static`）在创建时会立即连接目标 MCP 服务器探测握手。无法完成握手时，创建请求返回 4xx 错误。`environment_variable` 和 `env_oauth` 不在创建时验证密钥或访问令牌是否有效；无效值会在 Session 访问对应主机时表现为鉴权错误或下游服务错误，但不会阻止 Session 继续运行。

## 在创建 Session 时引用 Vaults

创建 Session 时传 `vault_ids` 数组，把一个或多个 Vaults 挂到 Session：

**选项：Curl**

```Bash
curl https://ark.cn-beijing.volces.com/api/v3/sessions \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "agent-20260701120000-abcde",
    "environment_id": "env-20260701120000-fghij",
    "vault_ids": ["vlt-20260701120000-pqrst"],
    "title": "Alice Slack digest"
  }'
```

**运行时行为**：

- 当 Agent 连接到某 MCP URL 时，**没有任何凭据匹配** `mcp_server_url` → 尝试匿名连接；若服务器要求鉴权则报错。
- **多个 Vaults 都包含匹配凭据** → **第一个匹配的 Vaults 优先**。
- 在 [多 Agent](multi-agent.md) 中，Vaults 凭据**按线程**生效；若某 Agent 自身定义里声明了匹配的 MCP 服务器，该 Agent 用这些凭据鉴权。

## 轮换凭据

密钥值和 `display_name` 可以更新。结构性字段（`mcp_server_url`、`secret_name`、`token_endpoint`、`client_id`） 在创建后即被锁定。要修改结构性字段，删除旧凭据再创建新的：

**选项：Curl**

```Bash
curl https://ark.cn-beijing.volces.com/api/v3/vaults/vlt-20260701120000-pqrst/credentials/vcrd-20260701120500-uvwxy \
  -X POST \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "auth": {
      "type": "mcp_oauth",
      "access_token": "xoxp-new-...",
      "expires_at": "2099-12-31T23:59:59Z",
      "refresh": {"refresh_token": "xoxe-1-new-..."}
    }
  }'
```

OAuth 凭据的自动刷新信息可按以下方式更新：

- 启用自动刷新：在 `auth` 中同时提供 `expires_at` 和完整的 `refresh` 对象。`token_endpoint_auth.type` 为 `client_secret_basic` 或 `client_secret_post` 时，同时提供 `client_secret`；为 `none` 时，省略 `client_secret`。
- 更新自动刷新信息：只提供需要变更的字段，未提供的字段保留原值。可以更新 `refresh_token`、`token_endpoint_auth`、`resource` 和 `scope`，不能修改 `token_endpoint` 和 `client_id`。

## 凭据生命周期

Session 运行期间，平台在使用凭据时重新解析当前值。更新或删除凭据后，后续请求会读取新的凭据状态，无需重启 Session。

对于已启用自动刷新的 `mcp_oauth`、`env_oauth` 凭据，读取操作会在访问令牌进入 5 分钟刷新窗口时触发自动刷新。刷新成功后，平台持久化新的访问令牌和过期时间；OAuth 服务同时轮换 `refresh_token` 时，平台也会保存新的 `refresh_token`。

## 其他操作

- 列出 Vault、凭据：`GET /vaults` 或 `GET /vaults/{vault_id}/credentials`；分页返回，按最新优先排序。
- 如需停用单个凭据，删除对应凭据；如需停用某个终端用户的全部凭据，删除对应 Vault。删除操作不可恢复。
