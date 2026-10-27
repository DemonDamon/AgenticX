---
source: https://ark.volcengine.com/region:cn-beijing/docs/list-resources-api
fetched: 2026-10-24
title: 查询会话资源列表
---

# 查询会话资源列表

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`GET https://ark.cn-beijing.volces.com/api/v3/sessions/{session_id}/resources`

查询指定会话已挂载的资源列表。接口全量返回，最多返回 1000 条，无分页参数。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**session_id** `string` `必选` | 会话 ID

会话 ID，格式为 `sesn-` 开头的字符串

## 响应参数

**data** `object[]` | 资源列表

指定会话当前挂载的资源列表。

文件资源 `object`

通过 Files API 上传并挂载到会话的文件。

**created_at** `string` | 挂载时间

`data.created_at`

资源挂载到会话的时间，采用 RFC 3339 格式。

**id** `string` | 资源 ID

`data.id`

会话资源 ID。

**type** `string` | 资源类型

`data.type`

资源类型，固定为 `file`。

**updated_at** `string` | 更新时间

`data.updated_at`

会话资源信息最后更新的时间，采用 RFC 3339 格式。

**access** `string` | 访问权限

`data.access`

文件访问权限，固定为 `read_only`。

**file_id** `string` | 文件 ID

`data.file_id`

当前可用的文件 ID。

**mount_path** `string` | 挂载路径

`data.mount_path`

文件在会话运行环境中的完整挂载路径。

记忆库资源 `object`

挂载到会话的记忆库。

**created_at** `string` | 挂载时间

`data.created_at`

资源挂载到会话的时间，采用 RFC 3339 格式。

**id** `string` | 资源 ID

`data.id`

会话资源 ID。

**type** `string` | 资源类型

`data.type`

资源类型，固定为 `memory_store`。

**updated_at** `string` | 更新时间

`data.updated_at`

会话资源信息最后更新的时间，采用 RFC 3339 格式。

**access** `string` | 访问权限

`data.access`

会话对记忆库的访问权限。

- `read_only`：智能体只能读取记忆库。

- `read_write`：智能体可以读取和修改记忆库。

**instructions** `string` | 使用指导

`data.instructions`

会话当前用于该记忆库的使用指导。

**memory_store_id** `string` | 记忆库 ID

`data.memory_store_id`

挂载到会话的记忆库 ID。

TOS 资源 `object`

挂载到会话的 TOS 对象目录。

**created_at** `string` | 挂载时间

`data.created_at`

资源挂载到会话的时间，采用 RFC 3339 格式。

**id** `string` | 资源 ID

`data.id`

会话资源 ID。

**type** `string` | 资源类型

`data.type`

资源类型，固定为 `tos`。

**updated_at** `string` | 更新时间

`data.updated_at`

会话资源信息最后更新的时间，采用 RFC 3339 格式。

**access** `string` | 访问权限

`data.access`

会话对 TOS 目录的访问权限。可选值：`read_only`、`read_write`。

**mount_path** `string` | 挂载路径

`data.mount_path`

TOS 目录在会话运行环境中的挂载路径。创建会话时未指定挂载路径，则不返回该字段。

**tos_bucket** `string` | TOS 存储桶

`data.tos_bucket`

TOS 挂载源所在的存储桶名称。

**tos_key** `string` | TOS 目录前缀

`data.tos_key`

TOS 中已挂载目录的对象前缀。

**tos_region** `string` | TOS 地域

`data.tos_region`

TOS 挂载源所在地域的 Region ID。


## 代码示例

## 查询会话资源列表

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/sessions/<SESSION_ID>/resources" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

#### Response

```
{
  "data": [
    {
      "id": "sesrsc-01hx3z9r0w8n3p5q6s7t8v9x20",
      "type": "memory_store",
      "memory_store_id": "<MEMORY_STORE_ID>",
      "access": "read_only",
      "created_at": "2026-07-15T08:30:20.000Z",
      "updated_at": "2026-07-15T08:30:20.000Z"
    },
    {
      "id": "sesrsc-01hx3z9r0w8n3p5q6s7t8v9x21",
      "type": "file",
      "file_id": "<FILE_ID>",
      "mount_path": "/mnt/session/uploads/<FILE_NAME>",
      "access": "read_only",
      "created_at": "2026-07-15T08:30:22.000Z",
      "updated_at": "2026-07-15T08:30:22.000Z"
    }
  ]
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

page = client.sessions.resources.list("<SESSION_ID>")
print(page)
```

#### Response

```
{
  "data": [
    {
      "id": "sesrsc-01hx3z9r0w8n3p5q6s7t8v9x20",
      "type": "memory_store",
      "memory_store_id": "<MEMORY_STORE_ID>",
      "access": "read_only",
      "created_at": "2026-07-15T08:30:20.000Z",
      "updated_at": "2026-07-15T08:30:20.000Z"
    },
    {
      "id": "sesrsc-01hx3z9r0w8n3p5q6s7t8v9x21",
      "type": "file",
      "file_id": "<FILE_ID>",
      "mount_path": "/mnt/session/uploads/<FILE_NAME>",
      "access": "read_only",
      "created_at": "2026-07-15T08:30:22.000Z",
      "updated_at": "2026-07-15T08:30:22.000Z"
    }
  ]
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
import com.volcengine.ark.runtime.models.session.ListSessionResourcesResponse;
import com.volcengine.ark.runtime.service.ArkService;

public class Main {
    public static void main(String[] args) throws Exception {
        ArkService service = ArkService.builder()
                .apiKey(System.getenv("ARK_API_KEY"))
                .baseUrl("https://ark.cn-beijing.volces.com/api/v3")
                .build();

        ListSessionResourcesResponse page = service.listSessionResources("<SESSION_ID>");
        System.out.println(page);

        service.shutdownExecutor();
    }
}
```

#### Response

```
{
  "data": [
    {
      "id": "sesrsc-01hx3z9r0w8n3p5q6s7t8v9x20",
      "type": "memory_store",
      "memory_store_id": "<MEMORY_STORE_ID>",
      "access": "read_only",
      "created_at": "2026-07-15T08:30:20.000Z",
      "updated_at": "2026-07-15T08:30:20.000Z"
    },
    {
      "id": "sesrsc-01hx3z9r0w8n3p5q6s7t8v9x21",
      "type": "file",
      "file_id": "<FILE_ID>",
      "mount_path": "/mnt/session/uploads/<FILE_NAME>",
      "access": "read_only",
      "created_at": "2026-07-15T08:30:22.000Z",
      "updated_at": "2026-07-15T08:30:22.000Z"
    }
  ]
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

	resp, err := client.ListSessionResources(ctx, "<SESSION_ID>")
	if err != nil {
		panic(err)
	}
	fmt.Println(resp)
}
```

#### Response

```
{
  "data": [
    {
      "id": "sesrsc-01hx3z9r0w8n3p5q6s7t8v9x20",
      "type": "memory_store",
      "memory_store_id": "<MEMORY_STORE_ID>",
      "access": "read_only",
      "created_at": "2026-07-15T08:30:20.000Z",
      "updated_at": "2026-07-15T08:30:20.000Z"
    },
    {
      "id": "sesrsc-01hx3z9r0w8n3p5q6s7t8v9x21",
      "type": "file",
      "file_id": "<FILE_ID>",
      "mount_path": "/mnt/session/uploads/<FILE_NAME>",
      "access": "read_only",
      "created_at": "2026-07-15T08:30:22.000Z",
      "updated_at": "2026-07-15T08:30:22.000Z"
    }
  ]
}
```
