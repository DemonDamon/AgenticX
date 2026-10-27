---
source: https://ark.volcengine.com/region:cn-beijing/docs/get-resource-api
fetched: 2026-10-24
title: 查询会话资源
---

# 查询会话资源

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`GET https://ark.cn-beijing.volces.com/api/v3/sessions/{session_id}/resources/{resource_id}`

按 `session_id` 和 `resource_id` 查询单个已挂载资源。响应字段随 `type` 变化；`file` 资源的后续引用请以查询返回的 `file_id` 为准。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**resource_id** `string` `必选` | 资源 ID

会话资源 ID，形如 `sesrsc-...`，可从添加资源或资源列表响应的 `id` 字段获得

**session_id** `string` `必选` | 会话 ID

填写资源所属的会话 ID，形如 `sesn-...`

## 响应参数

**created_at** `string` | 挂载时间

资源挂载到会话的时间，采用 RFC 3339 格式。

**id** `string` | 资源 ID

会话资源 ID。

**type** `string` | 资源类型

资源类型，用于确定返回哪些类型专属字段。可选值：`file`、`memory_store`、`tos`。

**updated_at** `string` | 更新时间

会话资源信息最后更新的时间，采用 RFC 3339 格式。

**access** `string` | 访问权限

资源访问权限。`file` 固定为 `read_only`；其他资源返回对应的挂载配置。取值：`read_only` / `read_write`。

**file_id** `string` | 文件 ID

当 `type` 为 `file` 时返回，表示当前可用的文件 ID。

**instructions** `string` | 使用指导

当 `type` 为 `memory_store` 时返回，表示会话当前用于该记忆库的使用指导。

**memory_store_id** `string` | 记忆库 ID

当 `type` 为 `memory_store` 时返回，表示挂载到会话的记忆库 ID。

**mount_path** `string` | 挂载路径

当 `type` 为 `file` 或 `tos` 时返回，表示资源在会话运行环境中的挂载路径。创建会话时未指定 TOS 挂载路径，则不返回该字段。

**tos_bucket** `string` | TOS 存储桶

当 `type` 为 `tos` 时返回，表示挂载源所在的 TOS 存储桶名称。

**tos_key** `string` | TOS 目录前缀

当 `type` 为 `tos` 时返回，表示 TOS 中已挂载目录的对象前缀。

**tos_region** `string` | TOS 地域

当 `type` 为 `tos` 时返回，表示挂载源所在地域的 Region ID。


## 代码示例

## 查询会话资源详情

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/sessions/<SESSION_ID>/resources/<RESOURCE_ID>" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

#### Response

```
{
  "id": "<RESOURCE_ID>",
  "type": "memory_store",
  "memory_store_id": "<MEMORY_STORE_ID>",
  "access": "read_only",
  "created_at": "2026-07-15T08:30:20.000Z",
  "updated_at": "2026-07-15T08:30:20.000Z"
}
```

### Python


#### Request

```python
import json
import os
import urllib.request

req = urllib.request.Request(
    "https://ark.cn-beijing.volces.com/api/v3/sessions/<SESSION_ID>/resources/<RESOURCE_ID>",
    headers={"Authorization": f"Bearer {os.environ['ARK_API_KEY']}"},
)

with urllib.request.urlopen(req) as resp:
    print(resp.read().decode())
```

#### Response

```
{
  "id": "<RESOURCE_ID>",
  "type": "memory_store",
  "memory_store_id": "<MEMORY_STORE_ID>",
  "access": "read_only",
  "created_at": "2026-07-15T08:30:20.000Z",
  "updated_at": "2026-07-15T08:30:20.000Z"
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
                .url("https://ark.cn-beijing.volces.com/api/v3"
                        + "/sessions/<SESSION_ID>/resources/<RESOURCE_ID>")
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
  "id": "<RESOURCE_ID>",
  "type": "memory_store",
  "memory_store_id": "<MEMORY_STORE_ID>",
  "access": "read_only",
  "created_at": "2026-07-15T08:30:20.000Z",
  "updated_at": "2026-07-15T08:30:20.000Z"
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
	req, _ := http.NewRequestWithContext(ctx, "GET",
		"https://ark.cn-beijing.volces.com/api/v3/sessions/<SESSION_ID>/resources/<RESOURCE_ID>", nil)
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
  "id": "<RESOURCE_ID>",
  "type": "memory_store",
  "memory_store_id": "<MEMORY_STORE_ID>",
  "access": "read_only",
  "created_at": "2026-07-15T08:30:20.000Z",
  "updated_at": "2026-07-15T08:30:20.000Z"
}
```
