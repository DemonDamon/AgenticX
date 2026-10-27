---
source: https://ark.volcengine.com/region:cn-beijing/docs/get-work-item-api
fetched: 2026-10-24
title: 查询 Work 详情
---

# 查询 Work 详情

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`GET https://ark.cn-beijing.volces.com/api/v3/environments/{environment_id}/work/{work_id}`

查询指定 Work 的详细信息，包括当前状态、关联的 Session、资源标签和生命周期时间。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**environment_id** `string` `必选` | 环境 ID

要操作的 Environment ID，以 `env-` 开头。填写创建环境或查询环境列表接口取得的 ID。

**work_id** `string` `必选` | Work 标识符

要查询的 Work 唯一标识，取自拉取 Work 接口或查询 Work 列表接口响应中的 `id`，以 `sesn-` 开头。

## 响应参数

**created_at** `string` | 创建时间

服务端创建 Work 时记录的时间，格式为 RFC 3339。

**data** `object` | 载荷

Work 对应的 Session 信息。

**id** `string` | Session ID

`data.id`

Work 对应的 Session ID，可用于调用 Session 相关接口。

**type** `string` | 类型

`data.type`

当前固定为 `session`，表示 `data.id` 指向一个 Session。

**environment_id** `string` | 环境 ID

Work 所属的环境 ID，以 `env-` 开头。

**id** `string` | Work 标识符

Work ID，以 `sesn-` 开头。

**state** `string` | 当前状态

Work 当前状态：`queued` 表示已入队，`starting` 表示启动中，`active` 表示执行中，`stopping` 表示停止中，`stopped` 表示已停止。

**type** `string` | 对象类型

类型标识，固定为 `work`。

**updated_at** `string` | 更新时间

Work 最近一次状态迁移的时间，格式为 RFC 3339。

**acknowledged_at** `string` | 认领时间

Work 被 Worker 成功认领的时间，格式为 RFC 3339；Work 尚未被认领时不返回该字段。

**latest_heartbeat_at** `string` | 最近心跳时间

服务端最近一次收到 Work 心跳的时间，格式为 RFC 3339；尚未收到心跳时不返回该字段。

**started_at** `string` | 开始时间

Work 开始执行的时间，格式为 RFC 3339；尚未开始执行时不返回该字段。

**stop_requested_at** `string` | 停止请求时间

服务端首次处理停止 Work 请求的时间，格式为 RFC 3339。以下任一情况不返回该字段：未调用停止 Work 接口；Work 因心跳租约超时停止。

**stopped_at** `string` | 停止时间

Work 进入 `stopped` 状态的时间，格式为 RFC 3339；尚未停止时不返回该字段。

**tags** `object[]` | 资源标签

与当前 Work 关联的资源标签列表。

**key** `string` | 标签键

`tags.key`

资源标签的键，用于标识当前 Work 关联的标签。

**value** `string` | 标签值

`tags.value`

资源标签的值，用于描述当前 Work 在该标签键下的取值；未设置值时不返回该字段。


## 代码示例

## 查询 Work 详情

### cURL


#### Request

```bash
curl -sS --fail-with-body \
  "https://ark.cn-beijing.volces.com/api/v3/environments/<ENVIRONMENT_ID>/work/<WORK_ID>" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

#### Response

```
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
    "/environments/<ENVIRONMENT_ID>/work/<WORK_ID>",
    cast_to=object,
)
print(json.dumps(result, ensure_ascii=False, indent=2))
```

#### Response

```
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
		"https://ark.cn-beijing.volces.com/api/v3/environments/<ENVIRONMENT_ID>/work/<WORK_ID>",
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
```
