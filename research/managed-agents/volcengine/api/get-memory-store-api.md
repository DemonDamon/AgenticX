---
source: https://ark.volcengine.com/region:cn-beijing/docs/get-memory-store-api
fetched: 2026-10-24
title: 查询记忆库详情
---

# 查询记忆库详情

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`GET https://ark.cn-beijing.volces.com/api/v3/memory_stores/{memory_store_id}`

按 ID 查询单个记忆库的配置、自定义元数据和当前统计值。需要浏览多个记忆库时，使用查询记忆库列表接口。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**memory_store_id** `string` `必选` | 记忆库 ID

用于定位要查询的记忆库，以 `memstore-` 开头。传入创建或列表接口返回的完整 ID，不要自行拼接。

## 响应参数

**created_at** `string` | 创建时间

记忆库创建时间，采用 RFC 3339 UTC 格式。

**created_by** `object` | 创建者

创建该记忆库的操作者信息。

**type** `string` | 操作者类型

`created_by.type`

创建者类型，固定为 `user_actor`。

**user_id** `string` | 用户 ID

`created_by.user_id`

创建该记忆库的用户 ID，由服务端根据当前请求的身份自动记录，可用于按创建者筛选记忆库。

**id** `string` | 记忆库 ID

服务端生成的记忆库 ID，以 `memstore-` 开头。后续查询、更新或删除记忆库时，作为 `memory_store_id` 路径参数传入。

**memory_count** `integer` | 记忆条目数量

记忆库当前包含的记忆条目数量。

**metadata** `object` | 自定义元数据

创建或更新记忆库时设置的自定义元数据。

**name** `string` | 记忆库名称

记忆库名称，用于识别和管理该记忆库。

**session_count** `integer` | 活跃会话数

当前挂载该记忆库的活跃会话数量。

**storage_bytes** `integer` | 内容总字节数

记忆库当前所有记忆正文的总字节数。

**type** `string` | 对象类型

对象类型，固定为 `memory_store`。

**updated_at** `string` | 更新时间

记忆库更新时间，采用 RFC 3339 UTC 格式。

**description** `string` | 记忆库描述

记忆库的用途和存储内容说明。

**dream_id** `string` | Dream 任务 ID

仅 Dream 输出记忆库返回，表示创建该输出 Memory Store 的 Dream ID；普通 Memory Store 不返回该字段。

**dream_status** `string` | Dream 任务状态

仅 Dream 输出记忆库返回，表示创建该输出 Memory Store 的 Dream 当前状态；普通 Memory Store 不返回该字段。可选值：`pending`、`running`、`completed`、`failed`、`canceled`。

**mountable** `boolean` | 是否可挂载

表示当前是否可以挂载、读取或修改该 Memory Store。普通 Memory Store 返回 `true`；Dream 输出记忆库在 `pending` 或 `running` 状态时返回 `false`，在 `completed`、`failed` 或 `canceled` 状态时返回 `true`。

**project_name** `string` | 项目名称

记忆库实际所属的项目名称。

**usage_ready** `boolean` | 用量是否就绪

表示 `memory_count` 和 `storage_bytes` 是否已可作为准确统计值。普通 Memory Store 返回 `true`；Dream 输出记忆库在 `pending` 或 `running` 状态时返回 `false`，在 `completed`、`failed` 或 `canceled` 状态时返回 `true`。


## 代码示例

## 查询记忆库详情

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/memory_stores/<MEMORY_STORE_ID>" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

#### Response

```
{
  "id": "<MEMORY_STORE_ID>",
  "type": "memory_store",
  "name": "<MEMORY_STORE_NAME>",
  "description": "用于存放团队常用规范和历史决策的长期记忆库",
  "memory_count": 12,
  "storage_bytes": 34567,
  "session_count": 2,
  "created_by": {"type": "user_actor", "user_id": "<USER_ID>"},
  "created_at": "2026-09-17T16:02:42Z",
  "updated_at": "2026-09-17T16:02:48Z",
  "metadata": {}
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

store = client.memory_stores.retrieve("<MEMORY_STORE_ID>")
print(store)
```

#### Response

```
{
  "id": "<MEMORY_STORE_ID>",
  "type": "memory_store",
  "name": "<MEMORY_STORE_NAME>",
  "description": "用于存放团队常用规范和历史决策的长期记忆库",
  "memory_count": 12,
  "storage_bytes": 34567,
  "session_count": 2,
  "created_by": {"type": "user_actor", "user_id": "<USER_ID>"},
  "created_at": "2026-09-17T16:02:42Z",
  "updated_at": "2026-09-17T16:02:48Z",
  "metadata": {}
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
import com.volcengine.ark.runtime.models.memory.MemoryStore;
import com.volcengine.ark.runtime.service.ArkService;

public class Main {
    public static void main(String[] args) throws Exception {
        ArkService service = ArkService.builder()
                .apiKey(System.getenv("ARK_API_KEY"))
                .baseUrl("https://ark.cn-beijing.volces.com/api/v3")
                .build();

        MemoryStore store = service.getMemoryStore("<MEMORY_STORE_ID>");
        System.out.println(store);

        service.shutdownExecutor();
    }
}
```

#### Response

```
{
  "id": "<MEMORY_STORE_ID>",
  "type": "memory_store",
  "name": "<MEMORY_STORE_NAME>",
  "description": "用于存放团队常用规范和历史决策的长期记忆库",
  "memory_count": 12,
  "storage_bytes": 34567,
  "session_count": 2,
  "created_by": {"type": "user_actor", "user_id": "<USER_ID>"},
  "created_at": "2026-09-17T16:02:42Z",
  "updated_at": "2026-09-17T16:02:48Z",
  "metadata": {}
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

	store, err := client.GetMemoryStore(ctx, "<MEMORY_STORE_ID>")
	if err != nil {
		panic(err)
	}
	fmt.Println(store)
}
```

#### Response

```
{
  "id": "<MEMORY_STORE_ID>",
  "type": "memory_store",
  "name": "<MEMORY_STORE_NAME>",
  "description": "用于存放团队常用规范和历史决策的长期记忆库",
  "memory_count": 12,
  "storage_bytes": 34567,
  "session_count": 2,
  "created_by": {"type": "user_actor", "user_id": "<USER_ID>"},
  "created_at": "2026-09-17T16:02:42Z",
  "updated_at": "2026-09-17T16:02:48Z",
  "metadata": {}
}
```
