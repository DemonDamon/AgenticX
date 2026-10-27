---
source: https://ark.volcengine.com/region:cn-beijing/docs/list-credentials-api
fetched: 2026-10-24
title: 查询凭证列表
---

# 查询凭证列表

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`GET https://ark.cn-beijing.volces.com/api/v3/vaults/{vault_id}/credentials`

查询指定保管库中的凭证列表。结果按创建时间降序排列。

需要继续查询时，将响应中的 `next_page` 原样传入下一次请求的 `page`。响应不包含 `next_page` 时，表示没有更多结果。

已配置自动刷新的 OAuth 凭证会返回访问令牌过期时间和用于刷新访问令牌的非敏感字段。响应不返回以下密文字段：`access_token`、`token`、`secret_value`、`refresh_token` 和 `client_secret`。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**vault_id** `string` `必选` | 保管库 ID

保管库 ID，以 `vlt-` 开头。

### Query 参数

> 在 URL Query String 中传入。

**limit** `integer` `默认值 20` | 每页数量

每页返回的凭证数量。

**取值范围**：`[1, 100]`

**page** `string` | 下一页标识

用于告诉服务端从上一页结束的位置继续返回数据。该值由服务端生成，不是页码。

首次请求 `GET /api/v3/vaults/<VAULT_ID>/credentials?limit=20` 时不传 `page`。后续翻页规则如下：

* 响应返回 `"next_page": "<NEXT_PAGE>"` 时，将该值传入下一次请求：`GET /api/v3/vaults/<VAULT_ID>/credentials?limit=20&page=<NEXT_PAGE>`。
* 响应不包含 `next_page` 时，表示没有更多结果。

不要自行生成或修改该值。

## 响应参数

**data** `object[]` | 凭证列表

查询到的凭证列表。

**auth** `object` | 鉴权配置

`data.auth`

凭证的鉴权方式及可公开返回的配置。字段结构由 `type` 决定，响应只返回与 `type` 匹配的一种结构。

MCP OAuth 凭证 `object`

服务端返回 MCP OAuth 凭证的鉴权类型和 MCP 服务地址。配置自动刷新时，还返回访问令牌过期时间和用于刷新访问令牌的字段。

响应不返回访问令牌、刷新令牌或客户端密钥。

**mcp_server_url** `string` | MCP 服务器 URL

`data.auth.mcp_server_url`

MCP 服务的访问地址。

**type** `string` | 鉴权类型

`data.auth.type`

表示该凭证使用 OAuth 访问令牌连接 MCP 服务。

取值固定为 `mcp_oauth`。

**expires_at** `string` | 过期时间

`data.auth.expires_at`

访问令牌的过期时间，采用 RFC 3339 格式。Session 使用该凭据且访问令牌进入 5 分钟刷新窗口时，服务端尝试自动刷新。

**refresh** `object` | 访问令牌刷新

`data.auth.refresh`

服务端返回用于刷新访问令牌的字段，不返回刷新令牌或客户端密钥。

**client_id** `string` | 客户端 ID

`data.auth.refresh.client_id`

向 OAuth 令牌端点请求访问令牌时使用的客户端 ID。

**resource** `string` | 资源标识

`data.auth.refresh.resource`

OAuth 授权请求对应的资源标识。

**scope** `string` | 授权范围

`data.auth.refresh.scope`

OAuth 令牌允许访问的权限范围。

**token_endpoint** `string` | OAuth 令牌端点

`data.auth.refresh.token_endpoint`

用于刷新访问令牌的 OAuth 端点地址。

**token_endpoint_auth** `object` | OAuth 客户端鉴权

`data.auth.refresh.token_endpoint_auth`

服务端向 OAuth 令牌端点提交刷新请求时使用的客户端鉴权配置。

**type** `string` | 鉴权方式

`data.auth.refresh.token_endpoint_auth.type`

服务端向 OAuth 令牌端点提交刷新请求时使用的客户端鉴权方式：

* `none`：仅提交 `client_id`，不使用客户端密钥。
* `client_secret_basic`：通过 HTTP Basic Authentication 提交客户端信息。
* `client_secret_post`：在请求体中提交客户端信息。

静态 Bearer 令牌凭证 `object`

服务端返回静态 Bearer 令牌凭证的公开配置，不返回令牌。

**mcp_server_url** `string` | MCP 服务器 URL

`data.auth.mcp_server_url`

MCP 服务的访问地址。

**type** `string` | 鉴权类型

`data.auth.type`

表示该凭证使用静态 Bearer 令牌连接 MCP 服务。

取值固定为 `static_bearer`。

MCP 静态凭证 `object`

服务端返回 MCP 静态凭证的公开注入配置，不返回密钥值。

**injection_type** `string` | 注入方式

`data.auth.injection_type`

服务端返回的密钥注入方式：

* `bearer`：通过 `Authorization: Bearer <token>` 请求头注入。
* `header`：通过 `injection_name` 指定的自定义请求头注入。
* `query`：通过 `injection_name` 指定的 URL 查询参数注入。

**mcp_server_url** `string` | MCP 服务器 URL

`data.auth.mcp_server_url`

MCP 服务的访问地址。

**type** `string` | 鉴权类型

`data.auth.type`

表示该凭证会将静态密钥注入 MCP 请求，注入位置由 `injection_type` 指定。

取值固定为 `mcp_static`。

**injection_name** `string` | 注入名

`data.auth.injection_name`

自定义请求头名称或查询参数名。`injection_type` 为 `header` 或 `query` 时返回该字段；`injection_type` 为 `bearer` 时不返回。

环境变量注入凭证 `object`

服务端返回环境变量凭证的公开注入配置，不返回环境变量值。

**networking** `object` | 网络范围

`data.auth.networking`

凭证可注入的目标主机范围。

**type** `string` | 网络范围类型

`data.auth.networking.type`

凭证的目标主机范围：

* `unrestricted`：可以注入发往任意公网主机的请求。
* `limited`：仅可以注入发往 `allowed_hosts` 所列主机的请求。

**allowed_hosts** `string[]` | 允许主机列表

`data.auth.networking.allowed_hosts`

`type` 为 `limited` 时返回允许注入凭证的公网主机列表，每项为纯域名、通配域名或公网 IPv4 地址。`type` 为 `unrestricted` 时不返回。

**secret_name** `string` | 环境变量名

`data.auth.secret_name`

向运行环境注入凭证时使用的环境变量名。

**type** `string` | 鉴权类型

`data.auth.type`

表示该凭证通过环境变量向运行环境注入凭证。

取值固定为 `environment_variable`。

环境 OAuth 凭证 `object`

服务端返回环境 OAuth 凭证的鉴权类型、环境变量名和网络范围。配置自动刷新时，还返回访问令牌过期时间和用于刷新访问令牌的字段。

响应不返回访问令牌、刷新令牌或客户端密钥。

**networking** `object` | 网络范围

`data.auth.networking`

访问令牌可注入的目标主机范围。

**type** `string` | 网络范围类型

`data.auth.networking.type`

凭证的目标主机范围：

* `unrestricted`：可以注入发往任意公网主机的请求。
* `limited`：仅可以注入发往 `allowed_hosts` 所列主机的请求。

**allowed_hosts** `string[]` | 允许主机列表

`data.auth.networking.allowed_hosts`

`type` 为 `limited` 时返回允许注入凭证的公网主机列表，每项为纯域名、通配域名或公网 IPv4 地址。`type` 为 `unrestricted` 时不返回。

**secret_name** `string` | 环境变量名

`data.auth.secret_name`

向运行环境注入访问令牌时使用的环境变量名。

**type** `string` | 鉴权类型

`data.auth.type`

表示该凭证使用 OAuth 访问令牌，并通过环境变量向运行环境注入该令牌。

取值固定为 `env_oauth`。

**expires_at** `string` | 过期时间

`data.auth.expires_at`

访问令牌的过期时间，采用 RFC 3339 格式。Session 使用该凭据且访问令牌进入 5 分钟刷新窗口时，服务端尝试自动刷新。

**refresh** `object` | 访问令牌刷新

`data.auth.refresh`

服务端返回用于刷新访问令牌的字段，不返回刷新令牌或客户端密钥。

**client_id** `string` | 客户端 ID

`data.auth.refresh.client_id`

向 OAuth 令牌端点请求访问令牌时使用的客户端 ID。

**resource** `string` | 资源标识

`data.auth.refresh.resource`

OAuth 授权请求对应的资源标识。

**scope** `string` | 授权范围

`data.auth.refresh.scope`

OAuth 令牌允许访问的权限范围。

**token_endpoint** `string` | OAuth 令牌端点

`data.auth.refresh.token_endpoint`

用于刷新访问令牌的 OAuth 端点地址。

**token_endpoint_auth** `object` | OAuth 客户端鉴权

`data.auth.refresh.token_endpoint_auth`

服务端向 OAuth 令牌端点提交刷新请求时使用的客户端鉴权配置。

**type** `string` | 鉴权方式

`data.auth.refresh.token_endpoint_auth.type`

服务端向 OAuth 令牌端点提交刷新请求时使用的客户端鉴权方式：

* `none`：仅提交 `client_id`，不使用客户端密钥。
* `client_secret_basic`：通过 HTTP Basic Authentication 提交客户端信息。
* `client_secret_post`：在请求体中提交客户端信息。

**created_at** `string` | 创建时间

`data.created_at`

凭证的创建时间，采用 RFC 3339 格式。

**id** `string` | 凭证 ID

`data.id`

凭证 ID，以 `vcrd-` 开头。

**type** `string` | 对象类型

`data.type`

表示当前对象是一条保管库凭证。

取值固定为 `vault_credential`。

**updated_at** `string` | 更新时间

`data.updated_at`

凭证最后一次更新的时间，采用 RFC 3339 格式。

**vault_id** `string` | 保管库 ID

`data.vault_id`

凭证所属的保管库 ID，以 `vlt-` 开头。

**display_name** `string` | 凭证展示名

`data.display_name`

凭证的展示名称，用于识别该凭证。

**metadata** `object` | 自定义元数据

`data.metadata`

为凭证设置的字符串键值对，可用于分类或关联业务信息。

**next_page** `string` | 下一页标识

下一页标识。无更多数据时不返回；后续请求需将该值原样作为 `page` 传入。


## 代码示例

## 查询凭证列表

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/vaults/<VAULT_ID>/credentials?limit=20" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

#### Response

```
{
  "data": [
    {
      "id": "vcrd-example",
      "type": "vault_credential",
      "vault_id": "vlt-example",
      "display_name": "GitHub 只读 MCP",
      "auth": {
        "type": "static_bearer",
        "mcp_server_url": "https://mcp.example.com/github"
      },
      "metadata": {"team": "agent-infra"},
      "created_at": "2026-07-15T08:00:00Z",
      "updated_at": "2026-07-15T09:00:00Z"
    }
  ],
  "next_page": "page_xxxxxxxx"
}
```

#### 查询下一页

将上一页响应中的 `next_page` 原样作为 `page` 传入：

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/vaults/<VAULT_ID>/credentials?limit=20&page=<NEXT_PAGE>" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

### Python


#### Request

```python
import os
import urllib.parse
import urllib.request

query = urllib.parse.urlencode({"limit": 20})
req = urllib.request.Request(
    "https://ark.cn-beijing.volces.com/api/v3/vaults/<VAULT_ID>/credentials?" + query,
    headers={"Authorization": f"Bearer {os.environ['ARK_API_KEY']}"},
)

with urllib.request.urlopen(req) as resp:
    print(resp.read().decode())
```

#### Response

```
{
  "data": [
    {
      "id": "vcrd-example",
      "type": "vault_credential",
      "vault_id": "vlt-example",
      "display_name": "GitHub 只读 MCP",
      "auth": {
        "type": "static_bearer",
        "mcp_server_url": "https://mcp.example.com/github"
      },
      "metadata": {"team": "agent-infra"},
      "created_at": "2026-07-15T08:00:00Z",
      "updated_at": "2026-07-15T09:00:00Z"
    }
  ],
  "next_page": "page_xxxxxxxx"
}
```

### Java


#### Request

```java
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

public class Main {
    public static void main(String[] args) throws Exception {
        Request req = new Request.Builder()
                .url("https://ark.cn-beijing.volces.com/api/v3/vaults/<VAULT_ID>/credentials?limit=20")
                .addHeader("Authorization", "Bearer " + System.getenv("ARK_API_KEY"))
                .build();
        try (Response resp = new OkHttpClient().newCall(req).execute()) {
            String responseBody = resp.body() == null ? "" : resp.body().string();
            if (!resp.isSuccessful()) {
                throw new IllegalStateException(
                        "HTTP " + resp.code() + ": " + responseBody);
            }
            System.out.println(responseBody);
        }

    }
}
```

#### Response

```
{
  "data": [
    {
      "id": "vcrd-example",
      "type": "vault_credential",
      "vault_id": "vlt-example",
      "display_name": "GitHub 只读 MCP",
      "auth": {
        "type": "static_bearer",
        "mcp_server_url": "https://mcp.example.com/github"
      },
      "metadata": {"team": "agent-infra"},
      "created_at": "2026-07-15T08:00:00Z",
      "updated_at": "2026-07-15T09:00:00Z"
    }
  ],
  "next_page": "page_xxxxxxxx"
}
```

### Go


#### Request

```go
package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
)

func main() {
	ctx := context.Background()
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		"https://ark.cn-beijing.volces.com/api/v3/vaults/<VAULT_ID>/credentials?limit=20",
		nil,
	)
	if err != nil {
		panic(err)
	}
	req.Header.Set("Authorization", "Bearer "+os.Getenv("ARK_API_KEY"))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		panic(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= http.StatusBadRequest {
		body, _ := io.ReadAll(resp.Body)
		panic(fmt.Sprintf("HTTP %d: %s", resp.StatusCode, body))
	}
	if _, err := io.Copy(os.Stdout, resp.Body); err != nil {
		panic(err)
	}
	fmt.Println()
}
```

#### Response

```
{
  "data": [
    {
      "id": "vcrd-example",
      "type": "vault_credential",
      "vault_id": "vlt-example",
      "display_name": "GitHub 只读 MCP",
      "auth": {
        "type": "static_bearer",
        "mcp_server_url": "https://mcp.example.com/github"
      },
      "metadata": {"team": "agent-infra"},
      "created_at": "2026-07-15T08:00:00Z",
      "updated_at": "2026-07-15T09:00:00Z"
    }
  ],
  "next_page": "page_xxxxxxxx"
}
```
