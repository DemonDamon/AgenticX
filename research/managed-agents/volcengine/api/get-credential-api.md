---
source: https://ark.volcengine.com/region:cn-beijing/docs/get-credential-api
fetched: 2026-10-24
title: 查询凭证详情
---

# 查询凭证详情

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`GET https://ark.cn-beijing.volces.com/api/v3/vaults/{vault_id}/credentials/{credential_id}`

查询指定凭证的详细信息。

已配置自动刷新的 OAuth 凭证会返回访问令牌过期时间和用于刷新访问令牌的非敏感字段。响应不返回以下密文字段：`access_token`、`token`、`secret_value`、`refresh_token` 和 `client_secret`。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**credential_id** `string` `必选` | 凭证 ID

凭证 ID，以 `vcrd-` 开头。

**vault_id** `string` `必选` | 保管库 ID

保管库 ID，以 `vlt-` 开头。

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

## 查询凭证详情

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/vaults/<VAULT_ID>/credentials/<CRED_ID>" \
  -H "Authorization: Bearer $ARK_API_KEY"
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
    "mcp_server_url": "https://mcp.example.com/github"
  },
  "metadata": {
    "team": "agent-infra"
  },
  "created_at": "2026-07-15T08:00:00Z",
  "updated_at": "2026-07-15T09:00:00Z"
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

credential = client.vaults.credentials.retrieve("<VAULT_ID>", "<CRED_ID>")
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
    "mcp_server_url": "https://mcp.example.com/github"
  },
  "metadata": {
    "team": "agent-infra"
  },
  "created_at": "2026-07-15T08:00:00Z",
  "updated_at": "2026-07-15T09:00:00Z"
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
import com.volcengine.ark.runtime.models.vault.Credential;
import com.volcengine.ark.runtime.service.ArkService;

public class Main {
    public static void main(String[] args) throws Exception {
        ArkService service = ArkService.builder()
                .apiKey(System.getenv("ARK_API_KEY"))
                .baseUrl("https://ark.cn-beijing.volces.com/api/v3")
                .build();

        Credential credential = service.getCredential("<VAULT_ID>", "<CRED_ID>");
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
    "mcp_server_url": "https://mcp.example.com/github"
  },
  "metadata": {
    "team": "agent-infra"
  },
  "created_at": "2026-07-15T08:00:00Z",
  "updated_at": "2026-07-15T09:00:00Z"
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
)

func main() {
	ctx := context.Background()
    client := arkruntime.NewClientWithApiKey(
		os.Getenv("ARK_API_KEY"),
        arkruntime.WithBaseUrl("https://ark.cn-beijing.volces.com/api/v3"),
	)

	cred, err := client.GetCredential(ctx, "<VAULT_ID>", "<CRED_ID>")
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
    "mcp_server_url": "https://mcp.example.com/github"
  },
  "metadata": {
    "team": "agent-infra"
  },
  "created_at": "2026-07-15T08:00:00Z",
  "updated_at": "2026-07-15T09:00:00Z"
}
```
