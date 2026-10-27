---
source: https://ark.volcengine.com/region:cn-beijing/docs/create-credential-api
fetched: 2026-10-24
title: 创建凭证
---

# 创建凭证

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`POST https://ark.cn-beijing.volces.com/api/v3/vaults/{vault_id}/credentials`

在指定保管库中创建凭证。创建成功后，可通过返回的凭证 ID 查询、更新或删除该凭证。

每个保管库最多包含 100 条凭证，超出时返回 HTTP 409 `Conflict`。

通过 `auth.type` 选择鉴权方式：

* `mcp_oauth`：使用 OAuth 访问令牌连接 MCP 服务。
* `static_bearer`：使用静态 Bearer 令牌连接 MCP 服务。
* `mcp_static`：将静态密钥注入 MCP 请求，支持请求头或查询参数等注入位置。
* `environment_variable`：通过环境变量向运行环境注入凭证。
* `env_oauth`：使用 OAuth 访问令牌，并通过环境变量向运行环境注入该令牌。

响应不返回以下密文字段：`access_token`、`token`、`secret_value`、`refresh_token` 和 `client_secret`。

本接口不支持幂等键，服务端不会自动识别或合并重复的创建请求。

如果创建请求超时，请先查询凭证列表，确认目标凭证是否已经创建，再决定是否重试。直接重试相同目标的创建请求会返回 HTTP 409 `Conflict`，且响应不包含已有凭证 ID。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**vault_id** `string` `必选` | 保管库 ID

保管库 ID，以 `vlt-` 开头。

### Body 参数

**auth** `object` `必选` | 鉴权配置

用于配置凭证的鉴权方式。根据 `type` 的值填写对应字段。

> **注意**
>
> 创建 `mcp_oauth`、`static_bearer` 或 `mcp_static` 凭证时，服务端会同步访问目标 MCP 服务：
>
> * 返回内容不符合 MCP 协议时，返回 HTTP 424 `MCPInvalidResponse`。
> * MCP 服务返回 5xx 或连接异常时，返回 HTTP 424 `UpstreamUnavailable`。
> * 校验失败时，不创建凭证。
>
> 同一保管库中的 MCP 凭证不能使用相同的 `mcp_server_url`，重复时返回 HTTP 409 `Conflict`。

MCP OAuth 凭证 `object`

调用方提供 OAuth 访问令牌和 MCP 服务地址，用于连接指定的 MCP 服务。

提供 `expires_at` 和 `refresh` 后，服务端在 Session 使用该凭据时自动刷新访问令牌。

**access_token** `string` `必选` | 访问令牌

`auth.access_token`

用于访问 MCP 服务的 OAuth 访问令牌。

**mcp_server_url** `string` `必选` | MCP 服务器 URL

`auth.mcp_server_url`

MCP 服务的访问地址。

* 必须使用 HTTPS，不能包含用户信息，也不能指向本地或私有网络地址。
* URL 中 `#` 后的片段不参与请求，服务端保存时会移除该片段。
* 创建后不可修改。

**type** `string` `必选` | 鉴权类型

`auth.type`

选择使用 OAuth 访问令牌连接 MCP 服务。

取值固定为 `mcp_oauth`。

**expires_at** `string` | 过期时间

`auth.expires_at`

访问令牌的过期时间，采用 RFC 3339 格式。启用自动刷新时，与 `refresh` 一起提供；省略时，服务端无法判断主动刷新时机。

**refresh** `object` | 访问令牌刷新

`auth.refresh`

用于在 Session 使用该凭据且访问令牌进入 `expires_at` 前 5 分钟刷新窗口时自动获取新令牌。

必须与 `expires_at` 同时配置。省略 `refresh` 时，服务端不会自动刷新访问令牌。

**client_id** `string` | 客户端 ID

`auth.refresh.client_id`

向 OAuth 令牌端点请求访问令牌时使用的客户端 ID。请求中包含 `refresh` 时必填。

**refresh_token** `string` | 刷新令牌

`auth.refresh.refresh_token`

用于向 OAuth 令牌端点获取新访问令牌的刷新令牌。请求中包含 `refresh` 时必填。

**resource** `string` | 资源标识

`auth.refresh.resource`

OAuth 授权请求对应的资源标识。

**scope** `string` | 授权范围

`auth.refresh.scope`

OAuth 服务支持的授权范围。

* 多个范围通常使用空格分隔，例如 `read write`。
* 具体取值以 OAuth 服务提供方为准。
* 省略时，服务端刷新令牌时不传入 `scope`。

**token_endpoint** `string` | OAuth 令牌端点

`auth.refresh.token_endpoint`

用于刷新访问令牌的 OAuth 端点地址。请求中包含 `refresh` 时必填。

**token_endpoint_auth** `object` | OAuth 客户端鉴权

`auth.refresh.token_endpoint_auth`

服务端向 OAuth 令牌端点提交刷新请求时使用的客户端鉴权配置。

**type** `string` `必选` | 鉴权方式

`auth.refresh.token_endpoint_auth.type`

服务端向 OAuth 令牌端点提交刷新请求时使用的客户端鉴权方式：

* `none`：仅提交 `client_id`，不使用客户端密钥。
* `client_secret_basic`：通过 HTTP Basic Authentication 提交 `client_id` 和 `client_secret`。
* `client_secret_post`：在请求体中提交 `client_id` 和 `client_secret`。

**client_secret** `string` | 客户端密钥

`auth.refresh.token_endpoint_auth.client_secret`

OAuth 客户端密钥。

* `type` 为 `client_secret_basic` 或 `client_secret_post` 时必填。
* `type` 为 `none` 时必须省略。

静态 Bearer 令牌凭证 `object`

调用方提供静态 Bearer 令牌，用于连接指定的 MCP 服务。

**mcp_server_url** `string` `必选` | MCP 服务器 URL

`auth.mcp_server_url`

MCP 服务的访问地址。

* 必须使用 HTTPS，不能包含用户信息，也不能指向本地或私有网络地址。
* URL 中 `#` 后的片段不参与请求，服务端保存时会移除该片段。
* 创建后不可修改。

**token** `string` `必选` | Bearer 令牌

`auth.token`

用于访问 MCP 服务的静态 Bearer 令牌。

**type** `string` `必选` | 鉴权类型

`auth.type`

选择使用静态 Bearer 令牌连接 MCP 服务。

取值固定为 `static_bearer`。

MCP 静态凭证 `object`

调用方提供静态密钥及其注入方式，用于鉴权发往指定 MCP 服务的请求。

**mcp_server_url** `string` `必选` | MCP 服务器 URL

`auth.mcp_server_url`

MCP 服务的访问地址。

* 必须使用 HTTPS，不能包含用户信息，也不能指向本地或私有网络地址。
* URL 中 `#` 后的片段不参与请求，服务端保存时会移除该片段。
* 创建后不可修改。

**token** `string` `必选` | 密钥值

`auth.token`

注入 MCP 请求的静态密钥。

不要包含 `Bearer ` 前缀；`injection_type` 为 `bearer` 时，请求头使用 `Authorization: Bearer <token>`。

**type** `string` `必选` | 鉴权类型

`auth.type`

选择将静态密钥注入 MCP 请求。通过 `injection_type` 指定请求头或查询参数等注入位置。

取值固定为 `mcp_static`。

**injection_name** `string` | 注入名

`auth.injection_name`

自定义请求头名称或查询参数名。

* `injection_type` 为 `header` 时，必须传入该字段。请求头名称必须符合 HTTP token 规则，且不能使用 `Authorization`、`Host`、`Content-Length`、`Cookie` 或 `Proxy-Authorization`；传入这些名称会返回 HTTP 400 `InvalidParameter`。
* `injection_type` 为 `query` 时，必须传入该字段。该字段必须是单个参数名，不能包含 `?`、`&` 或 `=`。
* `injection_type` 为 `bearer` 时，不能传入该字段。

**injection_type** `string` `默认值 bearer` | 注入方式

`auth.injection_type`

密钥注入到出向 MCP 请求的方式：

* `bearer`：使用 `Authorization: Bearer <token>`，且不能传入 `injection_name`。
* `header`：使用 `injection_name` 指定的自定义请求头名称。
* `query`：使用 `injection_name` 指定的 URL 查询参数名。

环境变量注入凭证 `object`

调用方提供环境变量名、凭证值和网络范围，用于向运行环境注入凭证。

**networking** `object` `必选` | 网络范围

`auth.networking`

控制凭证可以注入的目标主机范围。

**type** `string` `必选` | 网络范围类型

`auth.networking.type`

控制凭证可以注入的目标主机范围：

* `unrestricted`：可以注入发往任意公网主机的请求。
* `limited`：仅可以注入发往 `allowed_hosts` 所列主机的请求。

**allowed_hosts** `string[]` | 允许主机列表

`auth.networking.allowed_hosts`

`type` 为 `limited` 时必填，包含 1～16 个允许注入凭证的公网主机。

每项填写纯域名、通配域名或公网 IPv4 地址，例如 `api.example.com`、`*.example.com` 或 `192.0.2.1`。

不支持 URL、端口、路径、IPv6 地址或内网地址。`type` 为 `unrestricted` 时必须省略该字段。

**secret_name** `string` `必选` | 环境变量名

`auth.secret_name`

向运行环境注入凭证时使用的环境变量名。名称必须匹配 `^[A-Za-z_][A-Za-z0-9_]*$`。

名称在当前保管库内必须唯一，重复时返回 HTTP 409 `Conflict`。创建后不可修改。

**secret_value** `string` `必选` | 环境变量值

`auth.secret_value`

向运行环境注入的凭证值，不能为空，最大为 4096 字节。

**type** `string` `必选` | 鉴权类型

`auth.type`

选择通过环境变量向运行环境注入凭证。

取值固定为 `environment_variable`。

环境 OAuth 凭证 `object`

调用方提供 OAuth 访问令牌、环境变量名和网络范围，用于向运行环境注入令牌。

提供 `expires_at` 和 `refresh` 后，服务端在 Session 使用该凭据时自动刷新访问令牌。

**access_token** `string` `必选` | 访问令牌

`auth.access_token`

向运行环境注入并用于目标服务鉴权的 OAuth 访问令牌。

**networking** `object` `必选` | 网络范围

`auth.networking`

控制访问令牌可以注入的目标主机范围。

**type** `string` `必选` | 网络范围类型

`auth.networking.type`

控制凭证可以注入的目标主机范围：

* `unrestricted`：可以注入发往任意公网主机的请求。
* `limited`：仅可以注入发往 `allowed_hosts` 所列主机的请求。

**allowed_hosts** `string[]` | 允许主机列表

`auth.networking.allowed_hosts`

`type` 为 `limited` 时必填，包含 1～16 个允许注入凭证的公网主机。

每项填写纯域名、通配域名或公网 IPv4 地址，例如 `api.example.com`、`*.example.com` 或 `192.0.2.1`。

不支持 URL、端口、路径、IPv6 地址或内网地址。`type` 为 `unrestricted` 时必须省略该字段。

**secret_name** `string` `必选` | 环境变量名

`auth.secret_name`

向运行环境注入访问令牌时使用的环境变量名。名称必须匹配 `^[A-Za-z_][A-Za-z0-9_]*$`。

名称在当前保管库内必须唯一，重复时返回 HTTP 409 `Conflict`。创建后不可修改。

**type** `string` `必选` | 鉴权类型

`auth.type`

选择使用 OAuth 访问令牌，并通过环境变量向运行环境注入该令牌。

取值固定为 `env_oauth`。

**expires_at** `string` | 过期时间

`auth.expires_at`

访问令牌的过期时间，采用 RFC 3339 格式。启用自动刷新时，与 `refresh` 一起提供；省略时，服务端无法判断主动刷新时机。

**refresh** `object` | 访问令牌刷新

`auth.refresh`

用于在 Session 使用该凭据且访问令牌进入 `expires_at` 前 5 分钟刷新窗口时自动获取新令牌。

启用自动刷新时，与 `expires_at` 一起提供；省略时，服务端不会自动刷新访问令牌。

**client_id** `string` | 客户端 ID

`auth.refresh.client_id`

向 OAuth 令牌端点请求访问令牌时使用的客户端 ID。请求中包含 `refresh` 时必填。

**refresh_token** `string` | 刷新令牌

`auth.refresh.refresh_token`

用于向 OAuth 令牌端点获取新访问令牌的刷新令牌。请求中包含 `refresh` 时必填。

**resource** `string` | 资源标识

`auth.refresh.resource`

OAuth 授权请求对应的资源标识。

**scope** `string` | 授权范围

`auth.refresh.scope`

OAuth 服务支持的授权范围。

* 多个范围通常使用空格分隔，例如 `read write`。
* 具体取值以 OAuth 服务提供方为准。
* 省略时，服务端刷新令牌时不传入 `scope`。

**token_endpoint** `string` | OAuth 令牌端点

`auth.refresh.token_endpoint`

用于刷新访问令牌的 OAuth 端点地址。请求中包含 `refresh` 时必填。

**token_endpoint_auth** `object` | OAuth 客户端鉴权

`auth.refresh.token_endpoint_auth`

服务端向 OAuth 令牌端点提交刷新请求时使用的客户端鉴权配置。

**type** `string` `必选` | 鉴权方式

`auth.refresh.token_endpoint_auth.type`

服务端向 OAuth 令牌端点提交刷新请求时使用的客户端鉴权方式：

* `none`：仅提交 `client_id`，不使用客户端密钥。
* `client_secret_basic`：通过 HTTP Basic Authentication 提交 `client_id` 和 `client_secret`。
* `client_secret_post`：在请求体中提交 `client_id` 和 `client_secret`。

**client_secret** `string` | 客户端密钥

`auth.refresh.token_endpoint_auth.client_secret`

OAuth 客户端密钥。

* `type` 为 `client_secret_basic` 或 `client_secret_post` 时必填。
* `type` 为 `none` 时必须省略。

**display_name** `string` `必选` | 凭证展示名

凭证的展示名称，用于在凭证列表和详情中识别该凭证。

**metadata** `object` | 自定义元数据

用于分类或关联业务信息的字符串键值对。创建时保存本次提供的完整对象，最多 16 对；键长度为 1～64 个字符，值最长 512 个字符。

## 响应参数

**auth** `object` | 鉴权配置

凭证的鉴权方式及可公开返回的配置。字段结构由 `type` 决定，响应只返回与 `type` 匹配的一种结构。

MCP OAuth 凭证 `object`

服务端返回 MCP OAuth 凭证的鉴权类型和 MCP 服务地址。配置自动刷新时，还返回访问令牌过期时间和用于刷新访问令牌的字段。

响应不返回访问令牌、刷新令牌或客户端密钥。

**mcp_server_url** `string` | MCP 服务器 URL

`auth.mcp_server_url`

MCP 服务的访问地址。

**type** `string` | 鉴权类型

`auth.type`

表示该凭证使用 OAuth 访问令牌连接 MCP 服务。

取值固定为 `mcp_oauth`。

**expires_at** `string` | 过期时间

`auth.expires_at`

访问令牌的过期时间，采用 RFC 3339 格式。Session 使用该凭据且访问令牌进入 5 分钟刷新窗口时，服务端尝试自动刷新。

**refresh** `object` | 访问令牌刷新

`auth.refresh`

服务端返回用于刷新访问令牌的字段，不返回刷新令牌或客户端密钥。

**client_id** `string` | 客户端 ID

`auth.refresh.client_id`

向 OAuth 令牌端点请求访问令牌时使用的客户端 ID。

**resource** `string` | 资源标识

`auth.refresh.resource`

OAuth 授权请求对应的资源标识。

**scope** `string` | 授权范围

`auth.refresh.scope`

OAuth 令牌允许访问的权限范围。

**token_endpoint** `string` | OAuth 令牌端点

`auth.refresh.token_endpoint`

用于刷新访问令牌的 OAuth 端点地址。

**token_endpoint_auth** `object` | OAuth 客户端鉴权

`auth.refresh.token_endpoint_auth`

服务端向 OAuth 令牌端点提交刷新请求时使用的客户端鉴权配置。

**type** `string` | 鉴权方式

`auth.refresh.token_endpoint_auth.type`

服务端向 OAuth 令牌端点提交刷新请求时使用的客户端鉴权方式：

* `none`：仅提交 `client_id`，不使用客户端密钥。
* `client_secret_basic`：通过 HTTP Basic Authentication 提交客户端信息。
* `client_secret_post`：在请求体中提交客户端信息。

静态 Bearer 令牌凭证 `object`

服务端返回静态 Bearer 令牌凭证的公开配置，不返回令牌。

**mcp_server_url** `string` | MCP 服务器 URL

`auth.mcp_server_url`

MCP 服务的访问地址。

**type** `string` | 鉴权类型

`auth.type`

表示该凭证使用静态 Bearer 令牌连接 MCP 服务。

取值固定为 `static_bearer`。

MCP 静态凭证 `object`

服务端返回 MCP 静态凭证的公开注入配置，不返回密钥值。

**injection_type** `string` | 注入方式

`auth.injection_type`

服务端返回的密钥注入方式：

* `bearer`：通过 `Authorization: Bearer <token>` 请求头注入。
* `header`：通过 `injection_name` 指定的自定义请求头注入。
* `query`：通过 `injection_name` 指定的 URL 查询参数注入。

**mcp_server_url** `string` | MCP 服务器 URL

`auth.mcp_server_url`

MCP 服务的访问地址。

**type** `string` | 鉴权类型

`auth.type`

表示该凭证会将静态密钥注入 MCP 请求，注入位置由 `injection_type` 指定。

取值固定为 `mcp_static`。

**injection_name** `string` | 注入名

`auth.injection_name`

自定义请求头名称或查询参数名。`injection_type` 为 `header` 或 `query` 时返回该字段；`injection_type` 为 `bearer` 时不返回。

环境变量注入凭证 `object`

服务端返回环境变量凭证的公开注入配置，不返回环境变量值。

**networking** `object` | 网络范围

`auth.networking`

凭证可注入的目标主机范围。

**type** `string` | 网络范围类型

`auth.networking.type`

凭证的目标主机范围：

* `unrestricted`：可以注入发往任意公网主机的请求。
* `limited`：仅可以注入发往 `allowed_hosts` 所列主机的请求。

**allowed_hosts** `string[]` | 允许主机列表

`auth.networking.allowed_hosts`

`type` 为 `limited` 时返回允许注入凭证的公网主机列表，每项为纯域名、通配域名或公网 IPv4 地址。`type` 为 `unrestricted` 时不返回。

**secret_name** `string` | 环境变量名

`auth.secret_name`

向运行环境注入凭证时使用的环境变量名。

**type** `string` | 鉴权类型

`auth.type`

表示该凭证通过环境变量向运行环境注入凭证。

取值固定为 `environment_variable`。

环境 OAuth 凭证 `object`

服务端返回环境 OAuth 凭证的鉴权类型、环境变量名和网络范围。配置自动刷新时，还返回访问令牌过期时间和用于刷新访问令牌的字段。

响应不返回访问令牌、刷新令牌或客户端密钥。

**networking** `object` | 网络范围

`auth.networking`

访问令牌可注入的目标主机范围。

**type** `string` | 网络范围类型

`auth.networking.type`

凭证的目标主机范围：

* `unrestricted`：可以注入发往任意公网主机的请求。
* `limited`：仅可以注入发往 `allowed_hosts` 所列主机的请求。

**allowed_hosts** `string[]` | 允许主机列表

`auth.networking.allowed_hosts`

`type` 为 `limited` 时返回允许注入凭证的公网主机列表，每项为纯域名、通配域名或公网 IPv4 地址。`type` 为 `unrestricted` 时不返回。

**secret_name** `string` | 环境变量名

`auth.secret_name`

向运行环境注入访问令牌时使用的环境变量名。

**type** `string` | 鉴权类型

`auth.type`

表示该凭证使用 OAuth 访问令牌，并通过环境变量向运行环境注入该令牌。

取值固定为 `env_oauth`。

**expires_at** `string` | 过期时间

`auth.expires_at`

访问令牌的过期时间，采用 RFC 3339 格式。Session 使用该凭据且访问令牌进入 5 分钟刷新窗口时，服务端尝试自动刷新。

**refresh** `object` | 访问令牌刷新

`auth.refresh`

服务端返回用于刷新访问令牌的字段，不返回刷新令牌或客户端密钥。

**client_id** `string` | 客户端 ID

`auth.refresh.client_id`

向 OAuth 令牌端点请求访问令牌时使用的客户端 ID。

**resource** `string` | 资源标识

`auth.refresh.resource`

OAuth 授权请求对应的资源标识。

**scope** `string` | 授权范围

`auth.refresh.scope`

OAuth 令牌允许访问的权限范围。

**token_endpoint** `string` | OAuth 令牌端点

`auth.refresh.token_endpoint`

用于刷新访问令牌的 OAuth 端点地址。

**token_endpoint_auth** `object` | OAuth 客户端鉴权

`auth.refresh.token_endpoint_auth`

服务端向 OAuth 令牌端点提交刷新请求时使用的客户端鉴权配置。

**type** `string` | 鉴权方式

`auth.refresh.token_endpoint_auth.type`

服务端向 OAuth 令牌端点提交刷新请求时使用的客户端鉴权方式：

* `none`：仅提交 `client_id`，不使用客户端密钥。
* `client_secret_basic`：通过 HTTP Basic Authentication 提交客户端信息。
* `client_secret_post`：在请求体中提交客户端信息。

**created_at** `string` | 创建时间

凭证的创建时间，采用 RFC 3339 格式。

**id** `string` | 凭证 ID

凭证 ID，以 `vcrd-` 开头。

**type** `string` | 对象类型

表示当前对象是一条保管库凭证。

取值固定为 `vault_credential`。

**updated_at** `string` | 更新时间

凭证最后一次更新的时间，采用 RFC 3339 格式。

**vault_id** `string` | 保管库 ID

凭证所属的保管库 ID，以 `vlt-` 开头。

**display_name** `string` | 凭证展示名

凭证的展示名称，用于识别该凭证。

**metadata** `object` | 自定义元数据

为凭证设置的字符串键值对，可用于分类或关联业务信息。


## 代码示例

## 创建凭证

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/vaults/<VAULT_ID>/credentials" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d @- <<'EOF'
{
  "display_name": "GitHub 只读 MCP",
  "auth": {
    "type": "static_bearer",
    "mcp_server_url": "<MCP_SERVER_URL>",
    "token": "<STATIC_BEARER_TOKEN>"
  },
  "metadata": {
    "team": "agent-infra"
  }
}
EOF
```

#### Response

```
{
  "id": "vcrd-example",
  "type": "vault_credential",
  "vault_id": "vlt-example",
  "display_name": "GitHub 只读 MCP",
  "auth": {
    "type": "static_bearer",
    "mcp_server_url": "<MCP_SERVER_URL>"
  },
  "metadata": {
    "team": "agent-infra"
  },
  "created_at": "2026-07-15T08:00:00Z",
  "updated_at": "2026-07-15T08:00:00Z"
}
```

### Python


#### Request

```python
import os

from arkruntime import Ark

client = Ark(
    api_key=os.environ["ARK_API_KEY"],
    base_url="https://ark.cn-beijing.volces.com/api/v3",
)

credential = client.vaults.credentials.create(
    "<VAULT_ID>",
    display_name="GitHub 只读 MCP",
    auth={
        "type": "static_bearer",
        "mcp_server_url": "<MCP_SERVER_URL>",
        "token": "<STATIC_BEARER_TOKEN>",
    },
    metadata={"team": "agent-infra"},
)
print(credential)
```

#### Response

```
{
  "id": "vcrd-example",
  "type": "vault_credential",
  "vault_id": "vlt-example",
  "display_name": "GitHub 只读 MCP",
  "auth": {
    "type": "static_bearer",
    "mcp_server_url": "<MCP_SERVER_URL>"
  },
  "metadata": {
    "team": "agent-infra"
  },
  "created_at": "2026-07-15T08:00:00Z",
  "updated_at": "2026-07-15T08:00:00Z"
}
```

### Java


#### Request

```java
// pom.xml 依赖：
//   <dependency>
//     <groupId>com.volcengine</groupId>
//     <artifactId>ark-runtime</artifactId>
//     <version>0.9.0</version>
//   </dependency>
import com.volcengine.ark.runtime.models.vault.CreateCredentialRequest;
import com.volcengine.ark.runtime.models.vault.Credential;
import com.volcengine.ark.runtime.models.vault.CredentialAuth;
import com.volcengine.ark.runtime.models.vault.CredentialAuthType;
import com.volcengine.ark.runtime.service.ArkService;
import java.util.Collections;

public class Main {
    public static void main(String[] args) throws Exception {
        ArkService service = ArkService.builder()
                .apiKey(System.getenv("ARK_API_KEY"))
                .baseUrl("https://ark.cn-beijing.volces.com/api/v3")
                .build();

        Credential credential = service.createCredential(
                "<VAULT_ID>",
                CreateCredentialRequest.builder()
                        .displayName("GitHub 只读 MCP")
                        .metadata(Collections.singletonMap("team", "agent-infra"))
                        .auth(CredentialAuth.builder()
                                .type(CredentialAuthType.STATIC_BEARER)
                                .mcpServerUrl("<MCP_SERVER_URL>")
                                .token("<STATIC_BEARER_TOKEN>")
                                .build())
                        .build());
        System.out.println(credential);

        service.shutdownExecutor();
    }
}
```

#### Response

```
{
  "id": "vcrd-example",
  "type": "vault_credential",
  "vault_id": "vlt-example",
  "display_name": "GitHub 只读 MCP",
  "auth": {
    "type": "static_bearer",
    "mcp_server_url": "<MCP_SERVER_URL>"
  },
  "metadata": {
    "team": "agent-infra"
  },
  "created_at": "2026-07-15T08:00:00Z",
  "updated_at": "2026-07-15T08:00:00Z"
}
```

### Go


#### Request

```go
package main

import (
	"context"
	"fmt"
	"os"

	"github.com/volcengine/ark-runtime-go/arkruntime"
	vaultmodel "github.com/volcengine/ark-runtime-go/arkruntime/model/vault"
)

func main() {
	ctx := context.Background()
    client := arkruntime.NewClientWithApiKey(
		os.Getenv("ARK_API_KEY"),
        arkruntime.WithBaseUrl("https://ark.cn-beijing.volces.com/api/v3"),
	)

	cred, err := client.CreateCredential(ctx, "<VAULT_ID>", &vaultmodel.CreateCredentialRequest{
		DisplayName: vaultmodel.NewOptString("GitHub 只读 MCP"),
		Metadata: vaultmodel.NewOptCreateCredentialRequestMetadata(
			vaultmodel.CreateCredentialRequestMetadata{"team": "agent-infra"},
		),
		Auth: vaultmodel.CredentialAuth{
			Type:         vaultmodel.CredentialAuthTypeStaticBearer,
			McpServerURL: vaultmodel.NewOptString("<MCP_SERVER_URL>"),
			Token:        vaultmodel.NewOptString("<STATIC_BEARER_TOKEN>"),
		},
	})
	if err != nil {
		panic(err)
	}
	fmt.Println(cred)
}
```

#### Response

```
{
  "id": "vcrd-example",
  "type": "vault_credential",
  "vault_id": "vlt-example",
  "display_name": "GitHub 只读 MCP",
  "auth": {
    "type": "static_bearer",
    "mcp_server_url": "<MCP_SERVER_URL>"
  },
  "metadata": {
    "team": "agent-infra"
  },
  "created_at": "2026-07-15T08:00:00Z",
  "updated_at": "2026-07-15T08:00:00Z"
}
```
