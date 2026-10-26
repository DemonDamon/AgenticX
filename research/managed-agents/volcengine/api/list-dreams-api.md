---
source: https://ark.volcengine.com/region:cn-beijing/docs/list-dreams-api
fetched: 2026-10-24
title: 查询 Dream 列表
---

# 查询 Dream 列表

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`GET https://ark.cn-beijing.volces.com/api/v3/dreams`

分页查询当前账号和项目下的 Dream 任务。支持按任务状态和输入 Memory Store 筛选，并按创建时间升序或降序返回。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Query 参数

> 在 URL Query String 中传入。

**limit** `integer` `默认值 20` | 每页数量

每页返回的 Dream 数量，取值范围为 1～100。

**取值范围**：`[1, 100]`

**order** `string` `默认值 desc` | 排序方式

Dream 的创建时间排序方式。`asc` 表示升序，`desc` 表示降序。

**page** `string` | 下一页标识

首次请求时省略该参数。

后续请求将上一次响应返回的 `next_page` 原样传入该参数。

不要解析、生成或修改该值；该值必须与当前账号、项目、状态、输入 Memory Store 筛选条件和排序方式匹配。

**source_memory_store_query** `string` | 输入记忆库筛选

按输入 Memory Store 筛选 Dream。传入完整 ID 时精确匹配；传入名称时执行子串匹配，其中 `%`、`_` 和反斜线均按普通字符处理。

**status** `string[]` | 状态过滤

按 Dream 状态过滤。可以重复传入该 query 参数，匹配任一指定状态；省略时返回所有状态。可选值：`pending`、`running`、`completed`、`failed`、`canceled`。

## 响应参数

**data** `object[]` | Dream 列表

当前页的 Dream 列表，按 `order` 指定的创建时间顺序返回。

**created_at** `string` | 创建时间

`data.created_at`

任务创建时间，RFC 3339 格式。

**id** `string` | Dream ID

`data.id`

Dream 任务的唯一标识符，格式为 `drm-` 开头的字符串。

**inputs** `object[]` | 任务输入

`data.inputs`

创建任务时保存的输入快照。

源记忆库输入 `object`

创建任务时保存的源 Memory Store 输入。

**memory_store_id** `string` | 源记忆库 ID

`data.inputs.memory_store_id`

源 Memory Store ID。

**type** `string` | 输入类型

`data.inputs.type`

输入类型，固定为 `memory_store`。

**memory_store_name** `string` | 输入记忆库名称

`data.inputs.memory_store_name`

输入 Memory Store 的当前名称。关联的 Memory Store 已删除时省略。

历史会话输入 `object`

创建任务时保存的历史 Session 输入。

**session_ids** `string[]` | 历史会话 ID

`data.inputs.session_ids`

创建任务时保存的历史 Session ID 列表。

**type** `string` | 输入类型

`data.inputs.type`

输入类型，固定为 `sessions`。

**model** `object` | 模型信息

`data.model`

执行记忆整理任务的模型信息。

**id** `string` | 模型 ID

`data.model.id`

执行记忆整理任务的模型 ID。

**outputs** `object[]` | 任务输出

`data.outputs`

Dream 创建的输出 Memory Store。访问时机和内容完整性由 `status` 表示。

**memory_store_id** `string` | 输出记忆库 ID

`data.outputs.memory_store_id`

Dream 创建的输出 Memory Store ID。

**type** `string` | 输出类型

`data.outputs.type`

输出类型，固定为 `memory_store`。

**memory_store_name** `string` | 输出记忆库名称

`data.outputs.memory_store_name`

输出 Memory Store 的当前名称。关联的 Memory Store 已删除时省略。

**status** `string` | 任务状态

`data.status`

Dream 任务状态。

- `pending`：任务已受理，正在等待执行，输出 Memory Store 尚不可访问。
- `running`：任务正在执行，输出 Memory Store 尚不可访问。
- `completed`：任务已完成，输出 Memory Store 可以使用。
- `failed`：任务执行失败，输出 Memory Store 可以访问，但内容可能为空或不完整；可通过 `error` 查看原因。
- `canceled`：任务已取消，输出 Memory Store 可以访问，但内容可能为空或不完整。

**type** `string` | 对象类型

`data.type`

对象类型，固定为 `dream`。

**ended_at** `string` | 结束时间

`data.ended_at`

任务进入终态的时间，RFC 3339 格式。任务未结束时为 `null`。

**error** `object` | 失败信息

`data.error`

任务异步执行失败的信息。任务未失败时为 `null`。

**message** `string` | 错误信息

`data.error.message`

Dream 执行失败的原因，用于定位任务失败问题。

**type** `string` | 错误类型

`data.error.type`

错误类型。`timeout` 表示任务超时；`internal_error` 表示任务执行期间发生内部错误。

**instructions** `string` | 整理指令

`data.instructions`

创建任务时传入的记忆整理要求。未传入时为 `null`。

**running_time** `number` | 累计运行时长

`data.running_time`

Dream 排除空闲间隔后的累计运行时长，单位为秒。暂未获得时为 `null`。

**usage** `object` | 用量统计

`data.usage`

任务的 Token 用量。值为 `null` 时表示用量未知，不能解释为零消耗。

**cache_creation_input_tokens** `integer` | 缓存创建 Token 数

`data.usage.cache_creation_input_tokens`

写入缓存的输入 Token 数。

**cache_read_input_tokens** `integer` | 缓存读取 Token 数

`data.usage.cache_read_input_tokens`

从缓存读取的输入 Token 数。

**input_tokens** `integer` | 输入 Token 数

`data.usage.input_tokens`

本次 Dream 执行消耗的输入 token 数。

**output_tokens** `integer` | 输出 Token 数

`data.usage.output_tokens`

本次 Dream 执行生成的输出 token 数。

**next_page** `string` | 下一页标识

下一页标识。响应未返回 `next_page` 时，表示无更多数据，应停止分页查询。

**total_count** `integer` | Dream 总数

满足当前筛选条件的 Dream 总数，不受分页影响。


## 代码示例

## 查询 Dream 列表

### cURL


#### Request

```bash
curl -sS --fail-with-body -G \
  "https://ark.cn-beijing.volces.com/api/v3/dreams" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  --data-urlencode "status=running" \
  --data-urlencode "status=completed" \
  --data-urlencode "source_memory_store_query=$INPUT_MEMORY_STORE_ID" \
  --data-urlencode "order=desc" \
  --data-urlencode "limit=20"
```

#### Response

```
{
  "data": [
    {
      "type": "dream",
      "id": "drm-20260924143000-a1b2c",
      "status": "completed",
      "inputs": [
        {
          "type": "memory_store",
          "memory_store_id": "memstore-20260920100000-source",
          "memory_store_name": "project-memory"
        },
        {
          "type": "sessions",
          "session_ids": [
            "sesn-20260921100000-a1b2c",
            "sesn-20260922100000-d3e4f"
          ]
        }
      ],
      "outputs": [
        {
          "type": "memory_store",
          "memory_store_id": "memstore-20260924143000-output",
          "memory_store_name": "dream-curated-memory"
        }
      ],
      "model": {
        "id": "<MODEL_ID>"
      },
      "instructions": "保留稳定偏好和已验证结论；删除重复、过期和包含个人身份的信息；按主题组织结果。",
      "created_at": "2026-09-24T06:30:00Z",
      "ended_at": "2026-09-24T06:42:00Z",
      "usage": {
        "input_tokens": 18420,
        "output_tokens": 3260,
        "cache_read_input_tokens": 5120,
        "cache_creation_input_tokens": 1024
      },
      "running_time": 672.8,
      "error": null
    }
  ],
  "next_page": "page-20260924143000-next",
  "total_count": 2
}
```

### Python


#### Request

```python
import json
import os
from urllib.parse import urlencode

from arkruntime import Ark

client = Ark(
    api_key=os.environ["ARK_API_KEY"],
    base_url="https://ark.cn-beijing.volces.com/api/v3",
)

query = urlencode([
    (
        "status",
        "running"
    ),
    (
        "status",
        "completed"
    ),
    (
        "source_memory_store_query",
        "<INPUT_MEMORY_STORE_ID>"
    ),
    (
        "order",
        "desc"
    ),
    (
        "limit",
        20
    )
], doseq=True)
path = "/dreams" + "?" + query

result = client.get(
    path,
    cast_to=object,
)
print(json.dumps(result, ensure_ascii=False, indent=2))
```

#### Response

```
{
  "data": [
    {
      "type": "dream",
      "id": "drm-20260924143000-a1b2c",
      "status": "completed",
      "inputs": [
        {
          "type": "memory_store",
          "memory_store_id": "memstore-20260920100000-source",
          "memory_store_name": "project-memory"
        },
        {
          "type": "sessions",
          "session_ids": [
            "sesn-20260921100000-a1b2c",
            "sesn-20260922100000-d3e4f"
          ]
        }
      ],
      "outputs": [
        {
          "type": "memory_store",
          "memory_store_id": "memstore-20260924143000-output",
          "memory_store_name": "dream-curated-memory"
        }
      ],
      "model": {
        "id": "<MODEL_ID>"
      },
      "instructions": "保留稳定偏好和已验证结论；删除重复、过期和包含个人身份的信息；按主题组织结果。",
      "created_at": "2026-09-24T06:30:00Z",
      "ended_at": "2026-09-24T06:42:00Z",
      "usage": {
        "input_tokens": 18420,
        "output_tokens": 3260,
        "cache_read_input_tokens": 5120,
        "cache_creation_input_tokens": 1024
      },
      "running_time": 672.8,
      "error": null
    }
  ],
  "next_page": "page-20260924143000-next",
  "total_count": 2
}
```

### Go


#### Request

```go
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"

	"github.com/volcengine/ark-runtime-go/arkruntime"
	"github.com/volcengine/ark-runtime-go/arkruntime/model"
)

type jsonResponse struct {
	model.HttpHeader
	value map[string]interface{}
}

func (response *jsonResponse) UnmarshalJSON(data []byte) error {
	return json.Unmarshal(data, &response.value)
}

func main() {
	client := arkruntime.NewClientWithApiKey(
		os.Getenv("ARK_API_KEY"),
		arkruntime.WithBaseUrl("https://ark.cn-beijing.volces.com/api/v3"),
	)
	response := &jsonResponse{}
	err := client.Do(
		context.Background(),
		http.MethodGet,
		"https://ark.cn-beijing.volces.com/api/v3/dreams?status=running&status=completed&source_memory_store_query=<INPUT_MEMORY_STORE_ID>&order=desc&limit=20",
		"",
		"",
		response,
	)
	if err != nil {
		panic(err)
	}

	output, err := json.MarshalIndent(response.value, "", "  ")
	if err != nil {
		panic(err)
	}
	fmt.Println(string(output))
}
```

#### Response

```
{
  "data": [
    {
      "type": "dream",
      "id": "drm-20260924143000-a1b2c",
      "status": "completed",
      "inputs": [
        {
          "type": "memory_store",
          "memory_store_id": "memstore-20260920100000-source",
          "memory_store_name": "project-memory"
        },
        {
          "type": "sessions",
          "session_ids": [
            "sesn-20260921100000-a1b2c",
            "sesn-20260922100000-d3e4f"
          ]
        }
      ],
      "outputs": [
        {
          "type": "memory_store",
          "memory_store_id": "memstore-20260924143000-output",
          "memory_store_name": "dream-curated-memory"
        }
      ],
      "model": {
        "id": "<MODEL_ID>"
      },
      "instructions": "保留稳定偏好和已验证结论；删除重复、过期和包含个人身份的信息；按主题组织结果。",
      "created_at": "2026-09-24T06:30:00Z",
      "ended_at": "2026-09-24T06:42:00Z",
      "usage": {
        "input_tokens": 18420,
        "output_tokens": 3260,
        "cache_read_input_tokens": 5120,
        "cache_creation_input_tokens": 1024
      },
      "running_time": 672.8,
      "error": null
    }
  ],
  "next_page": "page-20260924143000-next",
  "total_count": 2
}
```
