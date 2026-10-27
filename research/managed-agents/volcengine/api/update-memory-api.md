---
source: https://ark.volcengine.com/region:cn-beijing/docs/update-memory-api
fetched: 2026-10-24
title: 更新记忆
---

# 更新记忆

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`POST https://ark.cn-beijing.volces.com/api/v3/memory_stores/{memory_store_id}/memories/{memory_id}`

按字段更新记忆的正文、路径或两者；未传字段保持不变。更新 `path` 后，响应会返回新的记忆 ID，旧 ID 立即失效，继续使用旧 ID 查询、更新或删除会返回 404 `ResourceNotFound`；后续请求必须改用响应中的新 ID。

> **说明**
>
> - 并发修改导致冲突时，重新查询最新记忆后再重试。
> - 更新响应不返回记忆正文（`content`）。需要确认更新后的正文时，调用查询记忆详情接口。
> - 仅传入与当前值相同的 `path` 且不传 `content` 时，不会产生实际更新，ID、版本标识和更新时间保持不变。
> - 常见失败包括：记忆库或记忆不存在、路径或内容不合法、目标路径已存在、正文超过 100 KiB，以及并发修改冲突。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**memory_id** `string` `必选` | 记忆 ID

用于定位要更新的记忆，以 `mem-` 开头。传入创建、列表或更新接口返回的完整 ID，不要自行拼接。

**memory_store_id** `string` `必选` | 记忆库 ID

用于指定记忆所属的记忆库，以 `memstore-` 开头。传入创建或查询记忆库接口返回的完整 ID，不要自行拼接。

### Body 参数

**content** `string` | 记忆内容

用于替换现有正文的记忆内容。省略时保持现有正文不变。

> **注意**
>
> 记忆正文必须是有效的 UTF-8 文本，且不得超过 102400 字节（100 KiB）。`content` 与 `path` 至少提供一个。

**path** `string` | 记忆路径

用于重命名记忆的文件路径。省略时保持现有路径不变。

> **注意**
>
> 路径必须以 `/` 开头，以 `.md` 或 `.txt` 结尾，UTF-8 编码后不得超过 1024 字节，且不得包含控制字符、`%`、`;` 或 `?`；路径段不得为空、`.` 或 `..`。`content` 与 `path` 至少提供一个。

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

## 更新记忆条目

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/memory_stores/<MEMORY_STORE_ID>/memories/<MEMORY_ID>" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d @- <<'EOF'
{
  "content": "Q3 目标（已修订）：完成托管智能体接口全量上线，并接入 skill hub。"
}
EOF
```

#### Response

```
{
  "id": "<MEMORY_ID>",
  "type": "memory",
  "memory_store_id": "<MEMORY_STORE_ID>",
  "path": "/notes/2026/q3-plan.md",
  "content_sha256": "046f9e0b839a060b93aca62932d586e2d6d70f03b6c248d02345dc98c4d8ec3d",
  "content_size_bytes": 91,
  "memory_version_id": "<NEW_MEMORY_VERSION_ID>",
  "created_by": {"type": "user_actor", "user_id": "<USER_ID>"},
  "created_at": "2026-09-17T16:02:50Z",
  "updated_at": "2026-09-17T16:02:57Z"
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

memory = client.memory_stores.memories.update(
    "<MEMORY_STORE_ID>",
    "<MEMORY_ID>",
    content="Q3 目标（已修订）：完成托管智能体接口全量上线，并接入 skill hub。",
)
print(memory)
```

#### Response

```
{
  "id": "<MEMORY_ID>",
  "type": "memory",
  "memory_store_id": "<MEMORY_STORE_ID>",
  "path": "/notes/2026/q3-plan.md",
  "content_sha256": "046f9e0b839a060b93aca62932d586e2d6d70f03b6c248d02345dc98c4d8ec3d",
  "content_size_bytes": 91,
  "memory_version_id": "<NEW_MEMORY_VERSION_ID>",
  "created_by": {"type": "user_actor", "user_id": "<USER_ID>"},
  "created_at": "2026-09-17T16:02:50Z",
  "updated_at": "2026-09-17T16:02:57Z"
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
import com.volcengine.ark.runtime.models.memory.UpdateMemoryRequest;
import com.volcengine.ark.runtime.service.ArkService;

public class Main {
    public static void main(String[] args) throws Exception {
        ArkService service = ArkService.builder()
                .apiKey(System.getenv("ARK_API_KEY"))
                .baseUrl("https://ark.cn-beijing.volces.com/api/v3")
                .build();

        Memory memory = service.updateMemory(
                "<MEMORY_STORE_ID>", "<MEMORY_ID>",
                UpdateMemoryRequest.builder()
                        .content("Q3 目标（已修订）：完成托管智能体接口全量上线，并接入 skill hub。")
                        .build());
        System.out.println(memory);

        service.shutdownExecutor();
    }
}
```

#### Response

```
{
  "id": "<MEMORY_ID>",
  "type": "memory",
  "memory_store_id": "<MEMORY_STORE_ID>",
  "path": "/notes/2026/q3-plan.md",
  "content_sha256": "046f9e0b839a060b93aca62932d586e2d6d70f03b6c248d02345dc98c4d8ec3d",
  "content_size_bytes": 91,
  "memory_version_id": "<NEW_MEMORY_VERSION_ID>",
  "created_by": {"type": "user_actor", "user_id": "<USER_ID>"},
  "created_at": "2026-09-17T16:02:50Z",
  "updated_at": "2026-09-17T16:02:57Z"
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

	mem, err := client.UpdateMemory(ctx, "<MEMORY_STORE_ID>", "<MEMORY_ID>", &memorymodel.UpdateMemoryRequest{
		Content: memorymodel.NewOptString("Q3 目标（已修订）：完成托管智能体接口全量上线，并接入 skill hub。"),
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
  "id": "<MEMORY_ID>",
  "type": "memory",
  "memory_store_id": "<MEMORY_STORE_ID>",
  "path": "/notes/2026/q3-plan.md",
  "content_sha256": "046f9e0b839a060b93aca62932d586e2d6d70f03b6c248d02345dc98c4d8ec3d",
  "content_size_bytes": 91,
  "memory_version_id": "<NEW_MEMORY_VERSION_ID>",
  "created_by": {"type": "user_actor", "user_id": "<USER_ID>"},
  "created_at": "2026-09-17T16:02:50Z",
  "updated_at": "2026-09-17T16:02:57Z"
}
```
