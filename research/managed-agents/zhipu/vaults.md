---
source: https://docs.bigmodel.cn/cn/managed-agents/vaults
fetched: 2026-10-23
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 凭据管理

Vault 是凭据的集合：你把 MCP 服务器的 token、OAuth 凭据或环境变量密钥注册进 Vault，创建会话时通过 **vault\_ids** 引用。密钥只写不读——所有 token、secret 在任何响应中都不会回显，Agent 与沙箱也拿不到原始值。

## 控制台操作

进入 **Managed Agents → 凭据库**，创建 Vault，再在详情中添加凭据，按服务要求填写认证方式与匹配范围。在创建会话或定时任务时选择该 Vault，使运行能够使用其中凭据。

列表用于查看凭据状态与管理操作，不回显密钥原文。轮换时更新凭据，再通过真实服务调用确认；不要将密钥复制到聊天、System Prompt 或 Skill。凭据库的共享与注入范围见本页安全边界。

## 创建 Vault

```bash theme={null}
vault=$(curl -sS "$BASE_URL/v1/vaults" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22" \
  -H "content-type: application/json" \
  -d '{
    "display_name": "Production credentials"
  }')

VAULT_ID=$(jq -r '.id' <<< "$vault")
```

字段：**display\_name**（必填，1–255 字符）、**metadata**（可选，最多 16 个 string 键值）。

## 添加凭据

**POST /v1/vaults/:vaultId/credentials** 创建凭据。**auth** 是按 type 区分的鉴权对象，支持五种类型：

| 类型 | 用途 | 身份键（不可变） |
| - | - | - |
| **static\_bearer** | MCP 服务器的静态 Bearer token | mcp\_server\_url |
| **mcp\_oauth** | MCP 服务器的 OAuth（支持自动刷新） | mcp\_server\_url |
| **bearer** | 普通 HTTPS origin 的静态 Bearer | host |
| **oauth** | 普通 HTTPS origin 的 OAuth | host |
| **environment\_variable** | 以环境变量名提供给沙箱；进程中看到的是 `omasec_` 代理值，真实密钥只在访问允许的目标主机时由平台代入请求 | secret\_name |

```bash theme={null}
curl -sS "$BASE_URL/v1/vaults/$VAULT_ID/credentials" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22" \
  -H "content-type: application/json" \
  -d '{
    "display_name": "GitHub MCP token",
    "auth": {
      "type": "static_bearer",
      "mcp_server_url": "https://api.githubcopilot.com/mcp/",
      "token": "ghp_xxxxxxxxxxxx"
    }
  }'
```

```bash theme={null}
curl -sS "$BASE_URL/v1/vaults/$VAULT_ID/credentials" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22" \
  -H "content-type: application/json" \
  -d '{
    "auth": {
      "type": "mcp_oauth",
      "mcp_server_url": "https://mcp.example.com/",
      "access_token": "at_xxxxxxxx",
      "expires_at": "2026-09-01T00:00:00Z",
      "refresh": {
        "token_endpoint": "https://auth.example.com/oauth/token",
        "client_id": "my-client",
        "refresh_token": "rt_xxxxxxxx",
        "token_endpoint_auth": {
          "type": "client_secret_basic",
          "client_secret": "cs_xxxxxxxx"
        }
      }
    }
  }'
```

OAuth 类型的要点：**access\_token** 必填；配置了 **refresh** 后平台会在过期前用 refresh\_token 自动换新。**token\_endpoint\_auth.type** 支持 none / client\_secret\_basic / client\_secret\_post（none 仅创建时接受）。

```bash theme={null}
curl -sS "$BASE_URL/v1/vaults/$VAULT_ID/credentials" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22" \
  -H "content-type: application/json" \
  -d '{
    "auth": {
      "type": "environment_variable",
      "secret_name": "EXAMPLE_API_KEY",
      "secret_value": "sk-xxxxxxxx",
      "networking": {
        "type": "limited",
        "allowed_hosts": ["api.example.com"]
      }
    }
  }'
```

**environment\_variable** 类型必须声明 **networking** 策略（unrestricted，或 limited + allowed\_hosts，至多 16 项，支持 \*.example.com 通配），限定携带该密钥的出站请求能到达哪些主机。

## 在创建会话时引用

创建会话时传 **vault\_ids**（最多 20 个、不重复，顺序即匹配优先级）。MCP 凭据按 **mcp\_server\_url** 与 Agent 声明的服务器 URL 匹配；无匹配凭据的服务器以未认证方式连接。详见[连接 MCP](mcp.md)。

## 验证 MCP OAuth

不必等到会话里才发现凭据失效。**mcp\_oauth\_validate** 会向目标服务器发起 MCP initialize 探测：

```bash theme={null}
curl -sS -X POST "$BASE_URL/v1/vaults/$VAULT_ID/credentials/$CREDENTIAL_ID/mcp_oauth_validate" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22"
```

响应包含：**status**（valid / invalid / unknown 综合结论）、**mcp\_probe**（initialize 探测的 HTTP 摘要，敏感值已脱敏）、**refresh**（刷新尝试结果：succeeded / failed / connect\_error / no\_refresh\_token）、**has\_refresh\_token**（是否配置了 refresh token，不泄露其值）。

## 轮换凭据

**POST /v1/vaults/:vaultId/credentials/:credentialId** 做部分更新：提供的 secret 被替换，省略的 secret 保留。身份字段（**mcp\_server\_url** / **host** / **secret\_name**，以及 refresh 的 token\_endpoint / client\_id / resource）不可变，更新时必须省略——要换目标就新建一条凭据。

```bash theme={null}
curl -sS "$BASE_URL/v1/vaults/$VAULT_ID/credentials/$CREDENTIAL_ID" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22" \
  -H "content-type: application/json" \
  -d '{
    "auth": {
      "type": "static_bearer",
      "token": "ghp_new_token_xxxx"
    }
  }'
```

**auth.type** 必须与原凭据相同。OAuth 凭据可分别轮换 access\_token、refresh\_token、client\_secret，或用 **refresh: null** 清除刷新配置。

## 凭据生命周期与其他操作

| 接口 | 说明 |
| - | - |
| GET /v1/vaults · GET /v1/vaults/:id | 列出 / 获取 Vault（include\_archived 可选） |
| POST /v1/vaults/:id | 更新 display\_name / metadata |
| POST /v1/vaults/:id/archive · DELETE /v1/vaults/:id | 归档 / 删除 Vault |
| GET /v1/vaults/:id/credentials · GET .../credentials/:cid | 列出 / 获取凭据（仅非敏感字段） |
| POST .../credentials/:cid/archive · DELETE .../credentials/:cid | 归档 / 删除凭据 |

读取接口只返回非敏感字段：凭据的 token / secret / client\_secret 永不回显；OAuth 凭据回显 expires\_at 与不含秘密值的 refresh 配置。

## 安全边界

* 密钥只写不读：创建和轮换时提交的 token / secret 不会出现在任何 API 响应里。
* Agent 与沙箱拿不到凭据原文；MCP 与 HTTPS 出站由平台侧注入，不进入提示词。
* **environment\_variable** 注入的是 `omasec_` 代理值，不是 **secret\_value** 原文；真实密钥仅在目标主机命中该凭据 networking 规则时由平台代入出站请求。
* 会话创建前可用 **mcp\_oauth\_validate** 探测 MCP OAuth 是否仍有效，不必等到会话里才发现失败。

## Multi Agent 与 GitHub 凭据

Session 的 vault\_ids 提供所有线程可用的凭据集合；各线程 MCP 是否可用由其自身 Agent 的 mcp\_servers 决定。不要只为主 Agent 准备凭据而遗漏成员 URL。

environment\_variable 值是平台代理占位值，可用于出站 header 替换，不等于将真实 secret 交给进程；不支持用它在本地做签名或在 JSON body 中直接换票。GitHub Repository token 属于独立资源，按仓库路径注入，不通过 Vault 自动授权 GitHub API。

Vault 归档会清除 active 凭据密文并阻止新 Session 引用；读取历史元数据不代表仍可使用凭据。

## 下一步

> **[连接 MCP](mcp.md)**
>
> 凭据与 MCP 服务器的匹配规则

> **[创建会话](create-session.md)**
>
> vault\_ids 的使用

> **[本页对应 OpenAPI](api-reference.md#vaults)**
>
> Vault：凭据创建、轮换、验证 MCP OAuth


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.