---
source: https://ark.volcengine.com/region:cn-beijing/docs/list-memory-stores-api
fetched: 2026-10-24
title: 查询记忆库列表
---

# 查询记忆库列表

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`GET https://ark.cn-beijing.volces.com/api/v3/memory_stores`

查询当前账号和项目下的记忆库。支持按创建者和记忆库名称筛选，结果默认按创建时间倒序排列。每个列表项包含记忆条数、活跃会话数等信息。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Query 参数

> 在 URL Query String 中传入。

**created_by** `string[]` | 创建者 ID

按创建者用户 ID 筛选。用户 ID 可从记忆库响应的 `created_by.user_id` 获取。

* 传入多个用户 ID 时，重复使用同名查询参数，例如 `created_by=<USER_ID_1>&created_by=<USER_ID_2>`。
* 多个 ID 之间为“或”关系：返回创建者 ID 与任一传入值相同的记忆库。
* 省略时不按创建者筛选。

**exclude_dreaming** `boolean` `默认值 false` | 排除未完成记忆库

返回结果可包含普通记忆库和 Dream 输出记忆库。`true` 表示排除 `pending` 或 `running` 状态的 Dream 输出记忆库；`false` 或省略表示不排除这些记忆库。

**limit** `integer` `默认值 20` | 每页数量

单页返回的记忆库数量。

**取值范围**：`[1, 100]`

**name** `string` | 记忆库名称

按记忆库名称进行子串包含匹配。例如，`name=demo` 可匹配名称中包含 `demo` 的记忆库；`%` 和 `_` 按普通字符处理，不作为通配符。

**page** `string` | 下一页标识

上一页返回的下一页标识；首次请求省略，后续将 `next_page` 原样传入，且标识与当前筛选条件绑定。筛选条件变化或标识无效时返回 400 `InvalidParameter`，请从第一页查询。

## 响应参数

**data** `object[]` | 记忆库列表

符合筛选条件的记忆库列表。

**created_at** `string` | 创建时间

`data.created_at`

记忆库创建时间，采用 RFC 3339 UTC 格式。

**created_by** `object` | 创建者

`data.created_by`

创建该记忆库的操作者信息。

**type** `string` | 操作者类型

`data.created_by.type`

创建者类型，固定为 `user_actor`。

**user_id** `string` | 用户 ID

`data.created_by.user_id`

创建该记忆库的用户 ID，由服务端根据当前请求的身份自动记录，可用于按创建者筛选记忆库。

**id** `string` | 记忆库 ID

`data.id`

服务端生成的记忆库 ID，以 `memstore-` 开头。后续查询、更新或删除记忆库时，作为 `memory_store_id` 路径参数传入。

**memory_count** `integer` | 记忆条目数量

`data.memory_count`

记忆库当前包含的记忆条目数量。

**metadata** `object` | 自定义元数据

`data.metadata`

创建或更新记忆库时设置的自定义元数据。

**name** `string` | 记忆库名称

`data.name`

记忆库名称，用于识别和管理该记忆库。

**session_count** `integer` | 活跃会话数

`data.session_count`

当前挂载该记忆库的活跃会话数量。

**storage_bytes** `integer` | 内容总字节数

`data.storage_bytes`

记忆库当前所有记忆正文的总字节数。

**type** `string` | 对象类型

`data.type`

对象类型，固定为 `memory_store`。

**updated_at** `string` | 更新时间

`data.updated_at`

记忆库更新时间，采用 RFC 3339 UTC 格式。

**description** `string` | 记忆库描述

`data.description`

记忆库的用途和存储内容说明。

**dream_id** `string` | Dream 任务 ID

`data.dream_id`

仅 Dream 输出记忆库返回，表示创建该输出 Memory Store 的 Dream ID；普通 Memory Store 不返回该字段。

**dream_status** `string` | Dream 任务状态

`data.dream_status`

仅 Dream 输出记忆库返回，表示创建该输出 Memory Store 的 Dream 当前状态；普通 Memory Store 不返回该字段。可选值：`pending`、`running`、`completed`、`failed`、`canceled`。

**mountable** `boolean` | 是否可挂载

`data.mountable`

表示当前是否可以挂载、读取或修改该 Memory Store。普通 Memory Store 返回 `true`；Dream 输出记忆库在 `pending` 或 `running` 状态时返回 `false`，在 `completed`、`failed` 或 `canceled` 状态时返回 `true`。

**project_name** `string` | 项目名称

`data.project_name`

记忆库实际所属的项目名称。

**usage_ready** `boolean` | 用量是否就绪

`data.usage_ready`

表示 `memory_count` 和 `storage_bytes` 是否已可作为准确统计值。普通 Memory Store 返回 `true`；Dream 输出记忆库在 `pending` 或 `running` 状态时返回 `false`，在 `completed`、`failed` 或 `canceled` 状态时返回 `true`。

**next_page** `string` | 下一页标识

下一页标识。返回非空值时，将其原样传入下一次请求的 `page` 参数；无更多数据时不返回该字段。


## 代码示例

## 查询记忆库列表

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/memory_stores?limit=20" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

#### Response

```
{
  "data": [
    {
      "id": "memstore-<VALUE>",
      "type": "memory_store",
      "name": "<MEMORY_STORE_NAME>",
      "memory_count": 12,
      "storage_bytes": 34567,
      "session_count": 2,
      "created_by": {"type": "user_actor", "user_id": "<USER_ID>"},
      "created_at": "2026-09-17T06:36:52Z",
      "updated_at": "2026-09-17T06:37:03Z",
      "metadata": {}
    }
  ],
  "next_page": "<NEXT_PAGE>"
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

page = client.memory_stores.list(limit=20)
print(page)
```

#### Response

```
{
  "data": [
    {
      "id": "memstore-<VALUE>",
      "type": "memory_store",
      "name": "<MEMORY_STORE_NAME>",
      "memory_count": 12,
      "storage_bytes": 34567,
      "session_count": 2,
      "created_by": {"type": "user_actor", "user_id": "<USER_ID>"},
      "created_at": "2026-09-17T06:36:52Z",
      "updated_at": "2026-09-17T06:37:03Z",
      "metadata": {}
    }
  ],
  "next_page": "<NEXT_PAGE>"
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
import com.volcengine.ark.runtime.models.memory.ListMemoryStoresResponse;
import com.volcengine.ark.runtime.service.ArkService;

public class Main {
    public static void main(String[] args) throws Exception {
        ArkService service = ArkService.builder()
                .apiKey(System.getenv("ARK_API_KEY"))
                .baseUrl("https://ark.cn-beijing.volces.com/api/v3")
                .build();

        ListMemoryStoresResponse page = service.listMemoryStores(20, null, null, null);
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
      "id": "memstore-<VALUE>",
      "type": "memory_store",
      "name": "<MEMORY_STORE_NAME>",
      "memory_count": 12,
      "storage_bytes": 34567,
      "session_count": 2,
      "created_by": {"type": "user_actor", "user_id": "<USER_ID>"},
      "created_at": "2026-09-17T06:36:52Z",
      "updated_at": "2026-09-17T06:37:03Z",
      "metadata": {}
    }
  ],
  "next_page": "<NEXT_PAGE>"
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

	resp, err := client.ListMemoryStores(ctx, &memorymodel.MemoryStoresListParams{
		Limit: memorymodel.NewOptInt32(20),
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
      "id": "memstore-<VALUE>",
      "type": "memory_store",
      "name": "<MEMORY_STORE_NAME>",
      "memory_count": 12,
      "storage_bytes": 34567,
      "session_count": 2,
      "created_by": {"type": "user_actor", "user_id": "<USER_ID>"},
      "created_at": "2026-09-17T06:36:52Z",
      "updated_at": "2026-09-17T06:37:03Z",
      "metadata": {}
    }
  ],
  "next_page": "<NEXT_PAGE>"
}
```
