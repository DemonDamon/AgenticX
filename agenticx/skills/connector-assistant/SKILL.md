---
name: connector-assistant
description: 连接器助手（Connector Assistant）。当用户想在对话里新建 / 接入 / 更新一个「连接器」（把外部系统、MCP Server、API 接到 Near）时使用：先列模板与已有实例去重，匹配模板则复用，否则用一张结构化表单问清系统类型、认证方式与上游地址，再创建连接器、用掩码卡片收凭证、做连通性检查。连接器不是分身（Avatar）。
metadata:
  author: AgenticX
  version: "1.1.0"
  display_name: 连接器助手
---

# 连接器助手

## 0. 概念：连接器 ≠ 分身

- **连接器（Connector）**＝一个「模板实例」：把外部系统接进 Near，在「设置 → 连接器 → 我的连接」、市场卡片、对话框连接器选择器里**只出现一次**。三种形态：
  - `mcp`：远程 MCP Server（存于 `~/.agenticx/mcp.json`）；
  - `rest`：HTTP API，登记到**本机连接器网关**（connector-runtime，`~/.agenticx/connector-runtime/connectors/<id>.json`），对话里通过网关 MCP 工具 `search_actions → get_action_guide → execute_action` 调用，实例 id 形如 `rest:<id>`；
  - `database`：SQLite / MySQL / PostgreSQL，内置只读 MCP（`list_tables` / `describe_table` / `query`），存于 mcp.json。
- **分身（Avatar）**＝另一个智能体人格，与连接器无关。
- **通用 MCP Server ≠ 连接器**：手动添加 / 导入 / 市场安装的 MCP 只在「插件市场 → MCP」里展示与管理，不进「我的连接」。用户只是想**加一个 MCP Server**（不要求作为连接器）时，不走本助手，引导到「插件市场 → MCP → + 新建 MCP」（远程 URL / 导入 JSON）；「新建连接器」菜单里没有「新建自定义 MCP」。只有用户明确要把它**作为连接器**接入时，才用 `connector_manage create` 建（会打连接器标，出现在「我的连接」）。
- 用户说「创建一个连接器 叫 abc」→ `abc` 是**连接器名**。**禁止** `create_avatar`、禁止追问「abc 是不是分身」、禁止说「无法创建原生连接器」然后结束。

## 1. 工具

只用 `connector_manage`（不要手写 / `file_edit` mcp.json，不要 `mcp_import`）：

| action | 用途 |
|---|---|
| `list_templates` | 模板目录（`create_via`: `mcp_url` 可在对话里建；`ui_native` 需在 UI 握手；`unavailable` 未接线） |
| `list_instances` | 已有实例：`instances`（mcp / database）+ `rest_instances`（网关 REST），只返回 `has_credential`，不含密钥 |
| `create` | 新建 / 更新 MCP 实例（`mcp_oauth:true` = 标准 MCP OAuth，verify 时浏览器授权） |
| `create_rest` | 登记 REST 连接器（OpenAPI/Swagger URL 或文件优先；否则简短接口清单） |
| `create_database` | 新建数据库连接器（默认只读 + 行数上限） |
| `request_credential` | 弹出**掩码卡片**按类型收凭证（多字段），**你拿不到明文**；OAuth 授权码模式会在填完后自动打开系统浏览器授权 |
| `authorize_oauth` | 重新走 OAuth 授权码（PKCE）浏览器授权（REST） |
| `verify` | 探活：MCP 握手 / REST 执行一个无参 read 动作 / 数据库连接 + 列表 |
| `delete` | 仅在用户**明确要求删除**时使用 |

## 2. 流程（严格按序）

### 第 1 步：先盘点，避免重复建设
1. 并行调用 `connector_manage {action:"list_templates"}` 与 `{action:"list_instances"}`。
2. 按名称 / 关键词匹配：
   - **已有同名或同系统实例** → 告诉用户已存在，用 `request_clarification` 问「直接使用 / 更新连接」（单题即可）。选「更新」时 `create` 带 `overwrite:true`。
   - **命中模板且 `create_via=mcp_url`** → 走模板实例：`template_id` 用该模板 id。模板带 `mcp_url`（官方端点，已核实）时**不要再问地址**，`url` 可省略（自动用 `mcp_url`）；否则只问上游地址（第 2 步只保留 Q3）。认证方式按模板 `auth`：
     - `mcp_oauth`（官方远程 MCP，OAuth 2.1 + 动态客户端注册，如腾讯文档 / Notion / Linear / Cloudflare / 天眼查 / 企查查）→ **只需名称**，绝不索要 Token / Client ID / Secret；create 自动 `mcp_oauth:true`，随后 `verify` 打开系统浏览器授权，令牌只存本机 `~/.agenticx/connectors/oauth/`（0600）。
     - 模板带 `auth_query`（如高德 `key`、百度地图 `ak`、腾讯地图 `key`、快递100 `key`）→ create 自动 `auth_style:"query"` + `query_param`，再 `request_credential` 用掩码卡片收 Key。
     - 模板带 `auth_header`（如盈米 `x-api-key`）→ create 自动 `auth_style:"header"` + `header_name`，同样用掩码卡片收 Key。
     - `api_key`/`custom_credential` → `bearer`（模板 create 未传 `auth_style` 时自动 bearer）；`none` → `none`。
     - 模板带 `credential_label` / `credential_help_url`（如恒生聚源：`Access Token` + 飞书「如何获取凭证」文档）→ 收凭证前在回复里用一句话附上该链接（Markdown 链接，如「[如何获取凭证](<credential_help_url>)」），`request_credential` 的 `credential_label` 用模板给的名称（不传也会自动取模板值）。
   - **命中 `ui_native` 模板**（腾讯会议 / TAPD / GitHub / 飞书 / 企业微信 / Agent Mail）→ 不在对话里建，引导用户到「市场 / 设置 → 连接器」点「连接」完成授权；结束。
   - **命中 `unavailable` 模板**（OAuth 类）→ 说明暂未接线，可改用该服务的 MCP Server URL 走自定义。
   - **都不匹配** → 第 2 步。

### 第 2 步：一张结构化表单问清楚（只调用一次 `request_clarification`）
不要拆成多次提问，不要写成正文问题。`<名称>` 换成用户给的连接器名：

```json
{
  "prompt": "为了创建连接器「<名称>」，需要确认以下信息",
  "decisions": [
    {
      "id": "system_type",
      "question": "<名称> 要接入的是什么类型的系统？",
      "options": ["REST API（提供 HTTP 接口文档）", "MCP Server（提供 MCP 接入 URL）", "数据库直连（需手动配置）", "其他（自定义输入）"],
      "custom_option": "其他（自定义输入）"
    },
    {
      "id": "auth",
      "question": "该系统的认证方式是什么？",
      "options": ["无需认证", "Bearer Token", "自定义请求头", "Query 参数", "AK/SK 签名", "OAuth 2.0", "其他（自定义输入）"],
      "custom_option": "其他（自定义输入）"
    },
    {
      "id": "upstream_url",
      "question": "请提供上游服务地址（REST API 的 base_url，或 MCP Server 完整 URL，须含 path）",
      "input_type": "url",
      "label": "上游地址",
      "placeholder": "https://example.com/api 或 https://example.com/mcp"
    }
  ],
  "allow_free_text": false,
  "submit_label": "确认",
  "skip_label": "忽略"
}
```

用户点「忽略」（结果为「用户未提供具体内容」）→ 简短说明可随时从「+ 新建连接器」继续，结束。

### 第 3 步：按类型分支，只追问该类型缺的字段
已知字段不重复问；缺的字段**合并成一次** `request_clarification`（`input_type:"text"`/`"url"`），**绝不**在表单里问密钥（密钥只走第 5 步掩码卡片）。

**MCP Server** → 第 4 步（`create`）。认证方式映射：

| 用户选择 | create 参数 |
|---|---|
| 无需认证 | `auth_style:"none"` |
| Bearer Token | `auth_style:"bearer"` |
| 自定义请求头 | `auth_style:"header"` + `header_name`（问名字，默认 `X-API-Key`） |
| Query 参数 | `auth_style:"query"` + `query_param`（默认 `api_key`） |
| OAuth 2.0 | `auth_style:"none"` + `mcp_oauth:true`（服务端支持标准 MCP OAuth 时；verify 打开浏览器授权）。模板 `auth=mcp_oauth` 时自动设置，无需再问 |
| AK/SK 签名 | MCP 不支持签名认证；若该系统实际是 HTTP API → 按 REST 处理 |

**REST API** → `create_rest`。追问：
1. 「是否有 OpenAPI / Swagger 文档？」→ 有：`spec_source`（URL 或本机文件路径，**优先**）；没有：请用户给简短接口清单 `endpoints`（每行 `METHOD /path 描述`，如 `GET /orders/{id} 查询订单`）。
2. `base_url`：表单 Q3 已给则直接用（OpenAPI 里有 servers 时可省略）。
3. 认证（映射到 `auth_type`）：

| 用户选择 | auth_type | 需追问（非密钥） | 卡片收集（密钥） |
|---|---|---|---|
| 无需认证 | `none` | — | — |
| Bearer Token | `bearer` | — | Token |
| 自定义请求头 | `api_key_header` | `header_name` | API Key |
| Query 参数 | `api_key_query` | `query_param` | API Key |
| AK/SK 签名 | `hmac` | AK/签名/时间戳请求头名（默认 `X-Access-Key`/`X-Signature`/`X-Timestamp`），签名串模板（默认 `{method}\n{path}\n{query}\n{timestamp}\n{body_sha256}`），hex/base64 | AK（明文显示）+ SK |
| OAuth 2.0（服务间） | `oauth2_client_credentials` | `token_url`、`scopes` | Client ID + Client Secret |
| OAuth 2.0（用户授权） | `oauth2_authorization_code` | `authorize_url`、`token_url`、`scopes`（通常含 `offline_access`） | Client ID (+Secret)，随后系统浏览器授权 |

未指定认证且有 OpenAPI 时可省略 `auth_type`，按文档的 securitySchemes 推断（结果 `auth_from_spec:true`，向用户确认）。
AK/SK 仅覆盖**通用 HMAC-SHA256 请求头签名**；AWS SigV4、阿里云/腾讯云官方签名不在支持范围，要如实说明。

**数据库直连** → `create_database`。追问：`db_type`（SQLite / MySQL / PostgreSQL）；SQLite 问文件路径 `db_path`；MySQL/PostgreSQL 问 `db_host`、`db_port`（默认 3306/5432）、`db_name`、`db_user`（**不问密码**，密码走第 5 步）。默认只读；只有用户明确要求写入时才 `allow_writes:true`，并提醒风险。

**其他** → 依据描述判断能否归入以上三类；不能则说明并结束。

### 第 4 步：创建
- MCP：`connector_manage {action:"create", name, url, auth_style, header_name?, query_param?, template_id?, mcp_oauth?}`
- REST：`connector_manage {action:"create_rest", name, base_url?, spec_source? | endpoints?, auth_type?, header_name?/query_param?/hmac_*?/token_url?/authorize_url?/scopes?}`
- 数据库：`connector_manage {action:"create_database", name, db_type, db_path? | db_host, db_port, db_name, db_user, allow_writes?}`

通用结果处理：
- `error=exists` → 已有实例（返回 `existing`），问「直接使用 / 更新」，**不要换个名字再建一份**；更新带 `overwrite:true`。
- `error=duplicate` → 名称被占用，请用户换名。
- `error=invalid_form` / `spec_invalid` / `driver_missing` → 指出原因并只重问该字段。
- `gateway_unavailable` → 本机连接器网关未就绪（桌面端未打包网关时会出现），如实告知。

### 第 5 步：收凭证（仅当 `needs_credential=true`）
- MCP：`{action:"request_credential", server_name, credential_label:"API Key" 或 "Token"}`（模板有 `credential_label` 时用模板值，如恒生聚源 `Access Token`；create 结果带 `credential_help_url` 时先把「如何获取凭证」链接发给用户，掩码卡片里也会显示该链接）
- REST：`{action:"request_credential", instance_id:"rest:<id>"}`（按认证类型自动给出多字段卡片；OAuth 授权码会在提交后打开系统浏览器，用户在浏览器里同意即可）
- 数据库：`{action:"request_credential", server_name}`（数据库密码；SQLite 无需）
- **永远不要**让用户把 Token / Key / 密码 / Secret 发在聊天里；如果用户主动贴了，提醒其已暴露、建议到服务端轮换，并仍通过掩码卡片重新填写。
- 不要在回复里复述、拼接、猜测任何凭证内容。
- 返回 `skipped` / `no_answer` → 提示可稍后再填；`no_refresh_token` → 说明需在 scopes 中加入 `offline_access`（或服务方等价设置）后重试 `authorize_oauth`。

### 第 6 步：探活
`connector_manage {action:"verify", server_name | instance_id}`：
- MCP 成功 → 报告可用工具数；失败：401/403 多为凭证错误（可再走第 5 步），404 多为 URL path 错误，超时多为网络 / 内网地址。
- REST → 执行首个无必填参数的 read 动作；`no_probe_action` 表示没有可直接探测的动作（不算失败，提示用户用 `execute_action` 实测）。
- 数据库 → 返回表数量与前若干个表名。

### 第 7 步：汇报
简短列出：连接器名、类型（MCP / REST / 数据库）、地址（host 即可）、认证方式（不含密钥）、探活结果（REST 附动作数，数据库附只读与行数上限），并提示：
「可在 **设置 → 连接器 → 我的连接** 查看 / 更新凭证 / 删除；在对话框的连接器选择器里即可启用。」

## 3. 红线
- 不重复建设：先 list，再决定复用 / 更新 / 新建；同一模板只保留一个实例。
- 不泄露密钥：凭证只走 `request_credential` 掩码卡片；工具结果里也不会出现明文。
- 不越权：不改其它 MCP 条目；`delete` 只在用户明确要求删除某个连接器时使用。
- 数据库默认只读；写入需用户明确同意。
