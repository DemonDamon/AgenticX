---
source: https://ark.volcengine.com/region:cn-beijing/docs/update-memory-store-api
fetched: 2026-10-24
title: 更新记忆库
---

# 更新记忆库

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`POST https://ark.cn-beijing.volces.com/api/v3/memory_stores/{memory_store_id}`

按字段更新记忆库的名称、描述或自定义元数据。请求至少包含 `name`、`description` 和 `metadata` 中的一个字段。未传入的字段保持不变。

> **说明**
>
> 多个请求同时更新同一字段时，以服务端最后成功处理的值为准。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**memory_store_id** `string` `必选` | 记忆库 ID

用于定位要更新的记忆库，以 `memstore-` 开头。传入创建或查询接口返回的完整 ID，不要自行拼接。

### Body 参数

**description** `string` | 记忆库描述

用于替换现有描述的用途和存储内容说明。传空字符串会清空已有描述。

> **注意**
>
> UTF-8 编码后不得超过 2048 字节。

**metadata** `object` | 自定义元数据

用于整体替换记忆库现有的自定义元数据。省略或传 `null` 时保留原值，传空对象 `{}` 时清空全部键。

> **说明**
>
> 传入对象时，如需保留已有键，更新前先查询现有元数据，将需要保留的键与新值合并后再传。对象最多包含 64 个非空键；键和值均为字符串，UTF-8 序列化后不得超过 8192 字节。

**name** `string` | 记忆库名称

用于替换现有名称的记忆库名称。同一账号和项目下允许存在同名记忆库，可通过各自的记忆库 ID 区分。

> **注意**
>
> 长度为 1–64 个字符。

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

## 更新记忆库

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/memory_stores/<MEMORY_STORE_ID>" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d @- <<'EOF'
{
  "name": "团队规范 · Q3 修订版",
  "description": "存放团队常用规范与历史决策，Q3 补齐 skill hub 相关约定。",
  "metadata": {
    "owner": "team-agent-infra",
    "quarter": "2026Q3"
  }
}
EOF
```

#### Response

```
{
  "id": "<MEMORY_STORE_ID>",
  "type": "memory_store",
  "name": "团队规范 · Q3 修订版",
  "description": "存放团队常用规范与历史决策，Q3 补齐 skill hub 相关约定。",
  "memory_count": 12,
  "storage_bytes": 34567,
  "session_count": 2,
  "created_by": {"type": "user_actor", "user_id": "<USER_ID>"},
  "created_at": "2026-09-17T16:02:42Z",
  "updated_at": "2026-09-17T16:02:48Z",
  "metadata": {
    "owner": "team-agent-infra",
    "quarter": "2026Q3"
  }
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

store = client.memory_stores.update(
    "<MEMORY_STORE_ID>",
    name="团队规范 · Q3 修订版",
    description="存放团队常用规范与历史决策，Q3 补齐 skill hub 相关约定。",
    metadata={"owner": "team-agent-infra", "quarter": "2026Q3"},
)
print(store)
```

#### Response

```
{
  "id": "<MEMORY_STORE_ID>",
  "type": "memory_store",
  "name": "团队规范 · Q3 修订版",
  "description": "存放团队常用规范与历史决策，Q3 补齐 skill hub 相关约定。",
  "memory_count": 12,
  "storage_bytes": 34567,
  "session_count": 2,
  "created_by": {"type": "user_actor", "user_id": "<USER_ID>"},
  "created_at": "2026-09-17T16:02:42Z",
  "updated_at": "2026-09-17T16:02:48Z",
  "metadata": {
    "owner": "team-agent-infra",
    "quarter": "2026Q3"
  }
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
import com.volcengine.ark.runtime.models.memory.UpdateMemoryStoreRequest;
import com.volcengine.ark.runtime.service.ArkService;
import java.util.HashMap;
import java.util.Map;

public class Main {
    public static void main(String[] args) throws Exception {
        ArkService service = ArkService.builder()
                .apiKey(System.getenv("ARK_API_KEY"))
                .baseUrl("https://ark.cn-beijing.volces.com/api/v3")
                .build();

        Map<String, String> metadata = new HashMap<>();
        metadata.put("owner", "team-agent-infra");
        metadata.put("quarter", "2026Q3");
        MemoryStore store = service.updateMemoryStore(
                "<MEMORY_STORE_ID>",
                UpdateMemoryStoreRequest.builder()
                        .name("团队规范 · Q3 修订版")
                        .description("存放团队常用规范与历史决策，Q3 补齐 skill hub 相关约定。")
                        .metadata(metadata)
                        .build());
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
  "name": "团队规范 · Q3 修订版",
  "description": "存放团队常用规范与历史决策，Q3 补齐 skill hub 相关约定。",
  "memory_count": 12,
  "storage_bytes": 34567,
  "session_count": 2,
  "created_by": {"type": "user_actor", "user_id": "<USER_ID>"},
  "created_at": "2026-09-17T16:02:42Z",
  "updated_at": "2026-09-17T16:02:48Z",
  "metadata": {
    "owner": "team-agent-infra",
    "quarter": "2026Q3"
  }
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

	store, err := client.UpdateMemoryStore(ctx, "<MEMORY_STORE_ID>", &memorymodel.UpdateMemoryStoreRequest{
		Name:        memorymodel.NewOptString("团队规范 · Q3 修订版"),
		Description: memorymodel.NewOptString("存放团队常用规范与历史决策，Q3 补齐 skill hub 相关约定。"),
		Metadata: memorymodel.NewOptUpdateMemoryStoreRequestMetadata(
			memorymodel.UpdateMemoryStoreRequestMetadata{
				"owner":   "team-agent-infra",
				"quarter": "2026Q3",
			},
		),
	})
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
  "name": "团队规范 · Q3 修订版",
  "description": "存放团队常用规范与历史决策，Q3 补齐 skill hub 相关约定。",
  "memory_count": 12,
  "storage_bytes": 34567,
  "session_count": 2,
  "created_by": {"type": "user_actor", "user_id": "<USER_ID>"},
  "created_at": "2026-09-17T16:02:42Z",
  "updated_at": "2026-09-17T16:02:48Z",
  "metadata": {
    "owner": "team-agent-infra",
    "quarter": "2026Q3"
  }
}
```
