---
source: https://ark.volcengine.com/region:cn-beijing/docs/list-memories-api
fetched: 2026-10-24
title: 查询记忆列表
---

# 查询记忆列表

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`GET https://ark.cn-beijing.volces.com/api/v3/memory_stores/{memory_store_id}/memories`

查询指定记忆库中的记忆条目。支持按 `path_prefix` 筛选，并通过 `depth` 折叠子目录。列表项仅包含路径和精简信息，不含 `content`；需要正文时，调用查询记忆详情接口。

> **说明**
>
> 记忆库不存在或不可访问时返回 404 `InvalidMemoryStore.NotFound`。`path_prefix`、`depth`、`order_by`、`limit` 或下一页标识不合法时返回 400 `InvalidParameter`；翻页期间保持筛选条件和每页数量不变。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**memory_store_id** `string` `必选` | 记忆库 ID

用于指定目标记忆库，以 `memstore-` 开头。传入创建或查询记忆库接口返回的完整 ID，不要自行拼接。

### Query 参数

> 在 URL Query String 中传入。

**depth** `integer` | 折叠层数

控制从 `path_prefix` 之后展示的目录层数。省略时，平铺返回全部匹配的记忆。

例如，`path_prefix` 为 `/preferences/` 且 `depth` 为 `1` 时：

* `/preferences/language.md` 作为 `memory` 返回。
* 更深层级的记忆合并为 `/preferences/editors/` 等 `memory_prefix` 项。

> **说明**
>
> 取值必须大于等于 1。取值大于匹配路径的实际目录层级时，所有匹配的记忆均以 `memory` 类型返回，不再生成 `memory_prefix` 折叠项。

**最小值**：`1`

**limit** `integer` `默认值 100` | 每页数量

单页返回的记忆条目数量。

**取值范围**：`[1, 2000]`

**order_by** `string` `默认值 path` | 排序字段

指定列表排序方式。可选值：`path`、`updated_at`、`created_at`。

> **说明**
>
> - `path`：按路径字典序排列。
> - `updated_at`：按更新时间倒序排列。
> - `created_at`：按创建时间倒序排列。

**page** `string` | 下一页标识

上一页响应返回的下一页标识。首次请求时省略；后续请求将 `next_page` 的值原样传入。

> **说明**
>
> 下一页标识与 `path_prefix`、`depth`、`order_by` 和 `limit` 绑定。翻页过程中修改任一参数会返回 400 `InvalidParameter`。

**path_prefix** `string` | 路径前缀

按记忆 `path` 字段的目录前缀筛选。非空值必须以 `/` 开头；服务端按目录边界匹配，`/foo` 与 `/foo/` 等价，不会匹配 `/foobar.md`。

## 响应参数

**data** `object[]` | 记忆列表

记忆列表项。`type` 为 `memory` 时返回文件元信息；`type` 为 `memory_prefix` 时返回折叠目录的 `path` 和 `memory_count`。

**path** `string` | 记忆路径

`data.path`

记忆文件或折叠目录的路径；`memory_prefix` 类型时以 `/` 结尾。

**type** `string` | 列表项类型

`data.type`

列表项类型。`memory` 表示记忆文件，`memory_prefix` 表示折叠目录。

**content_sha256** `string` | 内容摘要

`data.content_sha256`

记忆正文的 SHA-256 摘要，以小写十六进制字符串表示，仅 `type` 为 `memory` 时返回。

**content_size_bytes** `integer` | 内容字节数

`data.content_size_bytes`

记忆正文采用 UTF-8 编码后的字节数，仅 `type` 为 `memory` 时返回。

**created_at** `string` | 创建时间

`data.created_at`

创建时间，仅 `type` 为 `memory` 时返回，采用 RFC 3339 UTC 格式。

**id** `string` | 记忆 ID

`data.id`

服务端生成的记忆 ID，仅 `type` 为 `memory` 时返回。后续查询、更新或删除记忆时，作为 `memory_id` 路径参数传入。

**memory_count** `integer` | 记忆条数

`data.memory_count`

折叠目录下的记忆条数，仅 `type` 为 `memory_prefix` 时返回。

**memory_store_id** `string` | 记忆库 ID

`data.memory_store_id`

该记忆所属的记忆库 ID，仅 `type` 为 `memory` 时返回。

**memory_version_id** `string` | 版本 ID

`data.memory_version_id`

记忆条目的当前版本标识，仅 `type` 为 `memory` 时返回。内容或路径成功更新后，该值会变化。

**updated_at** `string` | 更新时间

`data.updated_at`

最后更新时间，仅 `type` 为 `memory` 时返回，采用 RFC 3339 UTC 格式。

**next_page** `string` | 下一页标识

下一页标识。返回非空值时，将其原样传入下一次请求的 `page` 参数；无更多数据时不返回该字段。

**prefixes** `string[]` | 折叠前缀列表

当前返回空数组。折叠目录通过 `data[]` 中 `type` 为 `memory_prefix` 的列表项返回。


## 代码示例

## 查询记忆条目列表

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/memory_stores/<MEMORY_STORE_ID>/memories?limit=20&path_prefix=/notes/" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

#### Response

```
{
  "data": [
    {
      "type": "memory",
      "id": "mem-<VALUE>",
      "memory_store_id": "<MEMORY_STORE_ID>",
      "path": "/notes/2026/q3-plan.md",
      "content_sha256": "e774ea541686b734b4d19d3460264bc350ecaebef7f45e7ca2bc31a712b2a694",
      "content_size_bytes": 54,
      "memory_version_id": "<MEMORY_VERSION_ID>",
      "created_at": "2026-09-17T16:02:50Z",
      "updated_at": "2026-09-17T16:02:51Z"
    }
  ],
  "next_page": "<NEXT_PAGE>",
  "prefixes": []
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

page = client.memory_stores.memories.list(
    "<MEMORY_STORE_ID>",
    path_prefix="/notes/",
    limit=20,
)
print(page)
```

#### Response

```
{
  "data": [
    {
      "type": "memory",
      "id": "mem-<VALUE>",
      "memory_store_id": "<MEMORY_STORE_ID>",
      "path": "/notes/2026/q3-plan.md",
      "content_sha256": "e774ea541686b734b4d19d3460264bc350ecaebef7f45e7ca2bc31a712b2a694",
      "content_size_bytes": 54,
      "memory_version_id": "<MEMORY_VERSION_ID>",
      "created_at": "2026-09-17T16:02:50Z",
      "updated_at": "2026-09-17T16:02:51Z"
    }
  ],
  "next_page": "<NEXT_PAGE>",
  "prefixes": []
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
import com.volcengine.ark.runtime.models.memory.ListMemoriesResponse;
import com.volcengine.ark.runtime.service.ArkService;

public class Main {
    public static void main(String[] args) throws Exception {
        ArkService service = ArkService.builder()
                .apiKey(System.getenv("ARK_API_KEY"))
                .baseUrl("https://ark.cn-beijing.volces.com/api/v3")
                .build();

        ListMemoriesResponse page = service.listMemories(
                "<MEMORY_STORE_ID>", "/notes/", null, null, 20, null);
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
      "type": "memory",
      "id": "mem-<VALUE>",
      "memory_store_id": "<MEMORY_STORE_ID>",
      "path": "/notes/2026/q3-plan.md",
      "content_sha256": "e774ea541686b734b4d19d3460264bc350ecaebef7f45e7ca2bc31a712b2a694",
      "content_size_bytes": 54,
      "memory_version_id": "<MEMORY_VERSION_ID>",
      "created_at": "2026-09-17T16:02:50Z",
      "updated_at": "2026-09-17T16:02:51Z"
    }
  ],
  "next_page": "<NEXT_PAGE>",
  "prefixes": []
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

	resp, err := client.ListMemories(ctx, "<MEMORY_STORE_ID>", &memorymodel.MemoriesListParams{
		PathPrefix: memorymodel.NewOptString("/notes/"),
		Limit:      memorymodel.NewOptInt32(20),
	})
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
      "type": "memory",
      "id": "mem-<VALUE>",
      "memory_store_id": "<MEMORY_STORE_ID>",
      "path": "/notes/2026/q3-plan.md",
      "content_sha256": "e774ea541686b734b4d19d3460264bc350ecaebef7f45e7ca2bc31a712b2a694",
      "content_size_bytes": 54,
      "memory_version_id": "<MEMORY_VERSION_ID>",
      "created_at": "2026-09-17T16:02:50Z",
      "updated_at": "2026-09-17T16:02:51Z"
    }
  ],
  "next_page": "<NEXT_PAGE>",
  "prefixes": []
}
```

## 查询末页

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/memory_stores/<MEMORY_STORE_ID>/memories?limit=20&path_prefix=/notes/&page=<NEXT_PAGE>" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

#### Response

```
{
  "data": [],
  "prefixes": []
}
```
