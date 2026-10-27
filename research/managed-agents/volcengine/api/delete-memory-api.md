---
source: https://ark.volcengine.com/region:cn-beijing/docs/delete-memory-api
fetched: 2026-10-24
title: 删除记忆
---

# 删除记忆

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`DELETE https://ark.cn-beijing.volces.com/api/v3/memory_stores/{memory_store_id}/memories/{memory_id}`

删除单条记忆条目。删除后，原 `path` 可用于重新创建同名记忆。仅删除单条记忆时使用本接口；需要删除整个记忆库及其中全部记忆时，使用删除记忆库接口。

> **注意**
>
> 即使所属记忆库已挂载到会话，也可以删除该记忆。删除后，相关会话将无法再读取该条目；删除前需确认业务影响。

> **说明**
>
> 当记忆库不存在或当前账号、项目无权访问时，统一返回 404 `InvalidMemoryStore.NotFound`；记忆不存在时返回 404 `ResourceNotFound`。重复删除已不存在的记忆时，可将 404 `ResourceNotFound` 视为目标记忆已不存在。并发修改导致删除失败时返回 409 `ResourceConflict`，重新查询后再重试。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**memory_id** `string` `必选` | 记忆 ID

用于定位要删除的记忆，以 `mem-` 开头。传入创建、列表或更新接口返回的完整 ID，不要自行拼接。

**memory_store_id** `string` `必选` | 记忆库 ID

用于指定记忆所属的记忆库，以 `memstore-` 开头。传入创建或查询接口返回的完整 ID，不要自行拼接。

## 响应参数

**id** `string` | 记忆 ID

已删除的记忆条目 ID，与请求中的 `memory_id` 相同。

**type** `string` | 对象类型

对象类型，固定为 `memory_deleted`。


## 代码示例

## 删除记忆条目

### cURL


#### Request

```Bash
curl -sS --fail-with-body -X DELETE "https://ark.cn-beijing.volces.com/api/v3/memory_stores/<MEMORY_STORE_ID>/memories/<MEMORY_ID>" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

#### Response

```
{
  "id": "<MEMORY_ID>",
  "type": "memory_deleted"
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

response = client.memory_stores.memories.delete("<MEMORY_STORE_ID>", "<MEMORY_ID>")
print(response)
```

#### Response

```
{
  "id": "<MEMORY_ID>",
  "type": "memory_deleted"
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
import com.volcengine.ark.runtime.service.ArkService;

public class Main {
    public static void main(String[] args) throws Exception {
        ArkService service = ArkService.builder()
                .apiKey(System.getenv("ARK_API_KEY"))
                .baseUrl("https://ark.cn-beijing.volces.com/api/v3")
                .build();

        Object response = service.deleteMemory("<MEMORY_STORE_ID>", "<MEMORY_ID>");
        System.out.println(response);

        service.shutdownExecutor();
    }
}
```

#### Response

```
{
  "id": "<MEMORY_ID>",
  "type": "memory_deleted"
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

	response, err := client.DeleteMemory(ctx, "<MEMORY_STORE_ID>", "<MEMORY_ID>")
	if err != nil {
		panic(err)
	}
	fmt.Println(response)
}
```

#### Response

```
{
  "id": "<MEMORY_ID>",
  "type": "memory_deleted"
}
```
