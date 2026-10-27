---
source: https://ark.volcengine.com/region:cn-beijing/docs/create-memory-api
fetched: 2026-10-24
title: 创建记忆
---

# 创建记忆

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`POST https://ark.cn-beijing.volces.com/api/v3/memory_stores/{memory_store_id}/memories`

在指定记忆库中创建一条文本记忆。创建后可将该记忆库挂载到会话，供智能体读取或更新其中的记忆。调用前需先创建记忆库，并使用创建或查询记忆库接口返回的 ID。

> **说明**
>
> 创建记忆时，响应不返回记忆内容（`content`）。需要正文时，调用查询记忆详情接口。
>
> **创建失败的常见原因**：
>
> - 记忆库不存在或不可访问。
> - 路径格式不合法。
> - 记忆内容不是有效的 UTF-8 文本。
> - 记忆内容超过 100 KiB。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**memory_store_id** `string` `必选` | 记忆库 ID

用于指定目标记忆库，以 `memstore-` 开头。传入创建或查询记忆库接口返回的完整 ID，不要自行拼接。

### Body 参数

**content** `string` `必选` | 记忆内容

写入记忆文件的正文。

> **注意**
>
> 记忆内容必须是有效的 UTF-8 文本，允许空字符串，且不得超过 102400 字节（100 KiB）。

**path** `string` `必选` | 记忆路径

记忆在记忆库中的文件路径。

> **注意**
>
> 路径必须以 `/` 开头，以 `.md` 或 `.txt` 结尾，UTF-8 编码后不超过 1024 字节，且不得包含控制字符、`%`、`;` 或 `?`；路径段不得为空、`.` 或 `..`。

## 响应参数

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

操作者类型，固定为 `user_actor`，表示该 Memory 由当前 API 调用方创建。

**user_id** `string` | 用户 ID

`created_by.user_id`

写入该记忆的用户 ID。

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

## 创建记忆条目

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/memory_stores/<MEMORY_STORE_ID>/memories" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d @- <<'EOF'
{
  "path": "/notes/2026/q3-plan.md",
  "content": "Q3 目标：完成托管智能体接口全量上线。"
}
EOF
```

#### Response

```
{
  "id": "mem-<VALUE>",
  "type": "memory",
  "memory_store_id": "<MEMORY_STORE_ID>",
  "path": "/notes/2026/q3-plan.md",
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

memory = client.memory_stores.memories.create(
    "<MEMORY_STORE_ID>",
    path="/notes/2026/q3-plan.md",
    content="Q3 目标：完成托管智能体接口全量上线。",
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
import com.volcengine.ark.runtime.models.memory.CreateMemoryRequest;
import com.volcengine.ark.runtime.models.memory.Memory;
import com.volcengine.ark.runtime.service.ArkService;

public class Main {
    public static void main(String[] args) throws Exception {
        ArkService service = ArkService.builder()
                .apiKey(System.getenv("ARK_API_KEY"))
                .baseUrl("https://ark.cn-beijing.volces.com/api/v3")
                .build();

        Memory memory = service.createMemory(
                "<MEMORY_STORE_ID>",
                CreateMemoryRequest.builder()
                        .path("/notes/2026/q3-plan.md")
                        .content("Q3 目标：完成托管智能体接口全量上线。")
                        .build());
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
	memorymodel "github.com/volcengine/ark-runtime-go/arkruntime/model/memory"
)

func main() {
	ctx := context.Background()
    client := arkruntime.NewClientWithApiKey(
		os.Getenv("ARK_API_KEY"),
        arkruntime.WithBaseUrl("https://ark.cn-beijing.volces.com/api/v3"),
	)

	mem, err := client.CreateMemory(ctx, "<MEMORY_STORE_ID>", &memorymodel.CreateMemoryRequest{
		Path:    "/notes/2026/q3-plan.md",
		Content: "Q3 目标：完成托管智能体接口全量上线。",
	})
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
  "content_sha256": "e774ea541686b734b4d19d3460264bc350ecaebef7f45e7ca2bc31a712b2a694",
  "content_size_bytes": 54,
  "memory_version_id": "<MEMORY_VERSION_ID>",
  "created_by": {"type": "user_actor", "user_id": "<USER_ID>"},
  "created_at": "2026-09-17T16:02:50Z",
  "updated_at": "2026-09-17T16:02:51Z"
}
```
