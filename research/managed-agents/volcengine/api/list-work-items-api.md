---
source: https://ark.volcengine.com/region:cn-beijing/docs/list-work-items-api
fetched: 2026-10-24
title: 查询 Work 列表
---

# 查询 Work 列表

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`GET https://ark.cn-beijing.volces.com/api/v3/environments/{environment_id}/work`

分页查询指定自托管 Environment 中的 Work，适用于查看 Work 状态和排查任务。结果按创建时间从新到旧排列。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**environment_id** `string` `必选` | 环境 ID

要操作的 Environment ID，以 `env-` 开头。填写创建环境或查询环境列表接口取得的 ID。

### Query 参数

> 在 URL Query String 中传入。

**limit** `integer` `默认值 50` | 每页数量

单页返回的最大条数；大于 200 时按 200 处理。

> **说明**
>
> 省略或传入非正数时，服务端每页最多返回 50 条。

**page** `string` | 下一页标识

用于告诉服务端从上一页结束的位置继续返回数据。该值由服务端生成，不是页码。

> **说明**
>
> 1. 首次请求不传 `page`，例如 `GET /api/v3/environments/{environment_id}/work?limit=20`。
> 2. 响应包含 `next_page` 时，将其原样传入下一次请求，例如 `GET /api/v3/environments/{environment_id}/work?limit=20&page=<NEXT_PAGE>`。
> 3. 响应不包含 `next_page` 时，表示没有更多结果。请勿自行生成或修改该值。

## 响应参数

**data** `object[]` | Work 列表

当前页的 Work 列表。

**created_at** `string` | 创建时间

`data.created_at`

服务端创建 Work 时记录的时间，格式为 RFC 3339。

**data** `object` | 工作载荷

`data.data`

Work 对应的 Session 信息。

**id** `string` | Session ID

`data.data.id`

Work 对应的 Session ID，可用于调用 Session 相关接口。

**type** `string` | 载荷类型

`data.data.type`

当前固定为 `session`，表示 `data.id` 指向一个 Session。

**environment_id** `string` | 环境 ID

`data.environment_id`

Work 所属的环境 ID，以 `env-` 开头。

**id** `string` | Work 标识符

`data.id`

Work ID，以 `sesn-` 开头。

**state** `string` | 当前状态

`data.state`

Work 当前状态：`queued` 为已入队，`starting` 为启动中，`active` 为执行中，`stopping` 为停止中，`stopped` 为已停止。

**type** `string` | 对象类型

`data.type`

类型标识，固定为 `work`。

**updated_at** `string` | 更新时间

`data.updated_at`

Work 最近一次状态迁移的时间，格式为 RFC 3339。

**acknowledged_at** `string` | 认领时间

`data.acknowledged_at`

Work 被 Worker 成功认领的时间，格式为 RFC 3339；尚未认领时不返回该字段。

**latest_heartbeat_at** `string` | 最近心跳时间

`data.latest_heartbeat_at`

服务端最近一次接受 Work 心跳的时间，格式为 RFC 3339；尚未收到心跳时不返回该字段。

**started_at** `string` | 开始时间

`data.started_at`

Work 开始执行的时间，格式为 RFC 3339；尚未开始执行时不返回该字段。

**stop_requested_at** `string` | 停止请求时间

`data.stop_requested_at`

服务端收到 Work 停止请求的时间，格式为 RFC 3339；尚未收到停止请求时不返回该字段。

**stopped_at** `string` | 停止时间

`data.stopped_at`

Work 进入 `stopped` 状态的时间，格式为 RFC 3339；尚未停止时不返回该字段。

**tags** `object[]` | 资源标签

`data.tags`

与当前 Work 关联的资源标签列表。

**key** `string` | 标签键

`data.tags.key`

资源标签的键，用于标识当前 Work 关联的标签。

**value** `string` | 标签值

`data.tags.value`

资源标签的值，用于描述当前 Work 在该标签键下的取值；未设置值时不返回该字段。

**next_page** `string` | 下一页标识

服务端生成的下一页标识。返回该字段表示还有更多结果；不返回表示已到最后一页。

> **说明**
>
> 将该值原样传入下一次请求的 `page` 参数。


## 代码示例

## 查询 Work 列表

### cURL


#### Request

```bash
curl -sS --fail-with-body \
  "https://ark.cn-beijing.volces.com/api/v3/environments/<ENVIRONMENT_ID>/work?limit=20" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

#### Response

```
{
  "data": [
    {
      "id": "<WORK_ID>",
      "environment_id": "<ENVIRONMENT_ID>",
      "state": "active",
      "type": "work",
      "data": {
        "id": "<SESSION_ID>",
        "type": "session"
      },
      "created_at": "2026-10-19T08:30:00Z",
      "updated_at": "2026-10-19T08:30:05Z",
      "acknowledged_at": "2026-10-19T08:30:02Z",
      "started_at": "2026-10-19T08:30:05Z",
      "latest_heartbeat_at": "2026-10-19T08:30:35Z"
    }
  ]
}
```

### Python


#### Request

```python
import json
import os

from arkruntime import Ark

client = Ark(
    api_key=os.environ["ARK_API_KEY"],
    base_url="https://ark.cn-beijing.volces.com/api/v3",
)

result = client.get(
    "/environments/<ENVIRONMENT_ID>/work?limit=20",
    cast_to=object,
)
print(json.dumps(result, ensure_ascii=False, indent=2))
```

#### Response

```
{
  "data": [
    {
      "id": "<WORK_ID>",
      "environment_id": "<ENVIRONMENT_ID>",
      "state": "active",
      "type": "work",
      "data": {
        "id": "<SESSION_ID>",
        "type": "session"
      },
      "created_at": "2026-10-19T08:30:00Z",
      "updated_at": "2026-10-19T08:30:05Z",
      "acknowledged_at": "2026-10-19T08:30:02Z",
      "started_at": "2026-10-19T08:30:05Z",
      "latest_heartbeat_at": "2026-10-19T08:30:35Z"
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
		"https://ark.cn-beijing.volces.com/api/v3/environments/<ENVIRONMENT_ID>/work?limit=20",
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
      "id": "<WORK_ID>",
      "environment_id": "<ENVIRONMENT_ID>",
      "state": "active",
      "type": "work",
      "data": {
        "id": "<SESSION_ID>",
        "type": "session"
      },
      "created_at": "2026-10-19T08:30:00Z",
      "updated_at": "2026-10-19T08:30:05Z",
      "acknowledged_at": "2026-10-19T08:30:02Z",
      "started_at": "2026-10-19T08:30:05Z",
      "latest_heartbeat_at": "2026-10-19T08:30:35Z"
    }
  ]
}
```
