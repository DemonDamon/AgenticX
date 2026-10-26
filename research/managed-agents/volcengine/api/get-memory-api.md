---
source: https://ark.volcengine.com/region:cn-beijing/docs/get-memory-api
fetched: 2026-10-24
title: 查询记忆详情
---

# 查询记忆详情

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`GET https://ark.cn-beijing.volces.com/api/v3/memory_stores/{memory_store_id}/memories/{memory_id}`

按 ID 查询单条记忆的完整信息，包括 `content` 正文。

* 浏览路径和精简元信息时，使用查询记忆列表接口。
* 获取某条记忆的完整正文时，使用本接口，并传入同一记忆库下的完整记忆 ID。

调用前需已创建记忆库和记忆条目。

> **说明**
>
> 记忆库不存在或不可访问时返回 404 `InvalidMemoryStore.NotFound`；记忆不存在时返回 404 `ResourceNotFound`。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**memory_id** `string` `必选` | 记忆 ID

用于定位要查询的记忆，以 `mem-` 开头。传入创建、列表或更新接口返回的完整 ID，不要自行拼接。

**memory_store_id** `string` `必选` | 记忆库 ID

用于指定记忆所属的记忆库，以 `memstore-` 开头。传入创建或列表接口返回的完整 ID，不要自行拼接。

## 响应参数

**content** `string` | 记忆内容

记忆正文，为 UTF-8 文本。本接口返回 `content`；可结合 `content_sha256` 和 `content_size_bytes` 校验完整性。

**content_sha256** `string` | 内容摘要

记忆正文的 SHA-256 摘要，以小写十六进制字符串表示，可用于校验内容完整性。

**content_size_bytes** `integer` | 内容字节数

记忆正文采用 UTF-8 编码后的字节数。

**created_at** `string` | 创建时间

记忆创建时间，采用 RFC 3339 UTC 格式。

**created_by** `object` | 创建者

创建该记忆的操作者信息。

**type** `string` | 操作者类型

`created_by.type`

操作者类型。`user_actor` 表示通过用户身份写入，`session_actor` 表示会话中的智能体写入。

**session_id** `string` | 会话 ID

`created_by.session_id`

写入该记忆的会话 ID，仅 `type` 为 `session_actor` 时返回。

**user_id** `string` | 用户 ID

`created_by.user_id`

写入该记忆的用户 ID，仅 `type` 为 `user_actor` 时返回。

**id** `string` | 记忆 ID

服务端生成的记忆 ID，以 `mem-` 开头。后续查询、更新或删除记忆时，作为 `memory_id` 路径参数传入。

**memory_store_id** `string` | 记忆库 ID

该记忆所属的记忆库 ID。

**memory_version_id** `string` | 版本 ID

记忆条目的当前版本标识。内容或路径成功更新后，该值会变化。

**path** `string` | 记忆路径

记忆在记忆库中的文件路径。

**type** `string` | 对象类型

对象类型，固定为 `memory`。

**updated_at** `string` | 更新时间

记忆最后更新时间，采用 RFC 3339 UTC 格式。


## 代码示例

## 查询记忆详情

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/memory_stores/<MEMORY_STORE_ID>/memories/<MEMORY_ID>" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

#### Response

```
{
  "id": "mem-<VALUE>",
  "type": "memory",
  "memory_store_id": "<MEMORY_STORE_ID>",
  "path": "/notes/2026/q3-plan.md",
  "content": "Q3 目标：完成托管智能体接口全量上线。",
  "content_sha256": "e774ea541686b734b4d19d3460264bc350ecaebef7f45e7ca2bc31a712b2a694",
  "content_size_bytes": 54,
  "memory_version_id": "<MEMORY_VERSION_ID>",
  "created_by": {"type": "user_actor", "user_id": "<USER_ID>"},
  "created_at": "2026-09-17T16:02:50Z",
  "updated_at": "2026-09-17T16:02:51Z"
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

memory = client.memory_stores.memories.retrieve(
    "<MEMORY_STORE_ID>", "<MEMORY_ID>"
)
print(memory)
```

#### Response

```
{
  "id": "mem-<VALUE>",
  "type": "memory",
  "memory_store_id": "<MEMORY_STORE_ID>",
  "path": "/notes/2026/q3-plan.md",
  "content": "Q3 目标：完成托管智能体接口全量上线。",
  "content_sha256": "e774ea541686b734b4d19d3460264bc350ecaebef7f45e7ca2bc31a712b2a694",
  "content_size_bytes": 54,
  "memory_version_id": "<MEMORY_VERSION_ID>",
  "created_by": {"type": "user_actor", "user_id": "<USER_ID>"},
  "created_at": "2026-09-17T16:02:50Z",
  "updated_at": "2026-09-17T16:02:51Z"
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
import com.volcengine.ark.runtime.models.memory.Memory;
import com.volcengine.ark.runtime.service.ArkService;

public class Main {
    public static void main(String[] args) throws Exception {
        ArkService service = ArkService.builder()
                .apiKey(System.getenv("ARK_API_KEY"))
                .baseUrl("https://ark.cn-beijing.volces.com/api/v3")
                .build();

        Memory memory = service.getMemory("<MEMORY_STORE_ID>", "<MEMORY_ID>");
        System.out.println(memory);

        service.shutdownExecutor();
    }
}
```

#### Response

```
{
  "id": "mem-<VALUE>",
  "type": "memory",
  "memory_store_id": "<MEMORY_STORE_ID>",
  "path": "/notes/2026/q3-plan.md",
  "content": "Q3 目标：完成托管智能体接口全量上线。",
  "content_sha256": "e774ea541686b734b4d19d3460264bc350ecaebef7f45e7ca2bc31a712b2a694",
  "content_size_bytes": 54,
  "memory_version_id": "<MEMORY_VERSION_ID>",
  "created_by": {"type": "user_actor", "user_id": "<USER_ID>"},
  "created_at": "2026-09-17T16:02:50Z",
  "updated_at": "2026-09-17T16:02:51Z"
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

	mem, err := client.GetMemory(ctx, "<MEMORY_STORE_ID>", "<MEMORY_ID>")
	if err != nil {
		panic(err)
	}
	fmt.Println(mem)
}
```

#### Response

```
{
  "id": "mem-<VALUE>",
  "type": "memory",
  "memory_store_id": "<MEMORY_STORE_ID>",
  "path": "/notes/2026/q3-plan.md",
  "content": "Q3 目标：完成托管智能体接口全量上线。",
  "content_sha256": "e774ea541686b734b4d19d3460264bc350ecaebef7f45e7ca2bc31a712b2a694",
  "content_size_bytes": 54,
  "memory_version_id": "<MEMORY_VERSION_ID>",
  "created_by": {"type": "user_actor", "user_id": "<USER_ID>"},
  "created_at": "2026-09-17T16:02:50Z",
  "updated_at": "2026-09-17T16:02:51Z"
}
```
