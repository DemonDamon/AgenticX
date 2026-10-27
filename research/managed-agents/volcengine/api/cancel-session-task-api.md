---
source: https://ark.volcengine.com/region:cn-beijing/docs/cancel-session-task-api
fetched: 2026-10-24
title: 取消会话任务
---

# 取消会话任务

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`POST https://ark.cn-beijing.volces.com/api/v3/sessions/{session_id}/tasks/{task_id}/cancel`

请求取消指定后台工具任务。接口成功返回只表示取消请求已处理，不表示任务一定已经停止；响应中的 `state` 表示任务在取消请求处理后的状态，具体如下：

* `cancelled`：取消请求已生效，任务已取消。
* `succeeded`：收到取消请求时，任务已经执行成功，因此没有再取消。
* `failed`：收到取消请求时，任务已经执行失败，因此没有再取消。
* `unknown`：当前无法确认任务状态，不表示取消成功。建议稍后查询任务状态，或自行查看命令的执行结果。
* `queued`：任务还在排队。未返回 `message`，表示取消请求已受理；返回 `message`，表示取消请求未受理。
* `running`：任务正在执行。未返回 `message`，表示取消请求已受理；返回 `message`，表示当前阶段无法取消。

`state` 为 `queued` 或 `running` 时，请继续使用 [查询会话任务](get-session-task-api.md) 查询状态。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**session_id** `string` `必选` | 会话 ID

任务所属的会话 ID，格式为 `sesn-` 开头的字符串。

**task_id** `string` `必选` | 任务 ID

要取消的后台工具任务 ID，格式为 `task-` 开头的字符串。可从工具调用返回或任务列表响应的 `task_id` 字段获得。

## 响应参数

**state** `string` | 任务状态

任务在取消请求处理后的状态。请根据该字段判断取消是否生效、任务是否已经结束或是否需要继续查询：

* `cancelled`：取消请求已生效，任务已取消。
* `succeeded`：收到取消请求时，任务已经执行成功，因此没有再取消。
* `failed`：收到取消请求时，任务已经执行失败，因此没有再取消。
* `unknown`：当前无法确认任务状态，不表示取消成功。建议稍后查询任务状态，或自行查看命令的执行结果。
* `queued`：任务还在排队。未返回 `message`，表示取消请求已受理；返回 `message`，表示取消请求未受理，具体原因见 `message`。请继续查询任务状态。
* `running`：任务正在执行。未返回 `message`，表示取消请求已受理；返回 `message`，表示当前阶段无法取消，具体原因见 `message`。请继续查询任务状态。

**message** `string` | 取消结果说明

取消请求未受理时返回，用于说明原因。

当 `state` 为 `queued` 或 `running` 且返回该字段时，请根据说明处理，并继续查询任务状态。未返回该字段，表示取消请求已受理。

当 `state` 为 `succeeded`、`failed`、`cancelled` 或 `unknown` 时，不返回该字段。


## 代码示例

## 取消会话任务

### cURL


#### Request

```bash
curl -sS --fail-with-body \
  "https://ark.cn-beijing.volces.com/api/v3/sessions/${SESSION_ID}/tasks/${TASK_ID}/cancel" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

#### Response

```
{
  "state": "running"
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

result = client.post(
    "/sessions/<SESSION_ID>/tasks/<TASK_ID>/cancel",
    cast_to=object,
    body={},
)
print(json.dumps(result, ensure_ascii=False, indent=2))
```

#### Response

```
{
  "state": "running"
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
		http.MethodPost,
		"https://ark.cn-beijing.volces.com/api/v3/sessions/<SESSION_ID>/tasks/<TASK_ID>/cancel",
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
  "state": "running"
}
```
