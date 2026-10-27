---
source: https://ark.volcengine.com/region:cn-beijing/docs/get-work-queue-stats-api
fetched: 2026-10-24
title: 查询 Work 队列状态
---

# 查询 Work 队列状态

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`GET https://ark.cn-beijing.volces.com/api/v3/environments/{environment_id}/work/stats`

查询自托管 Environment 中待拉取、待认领的 Work 数量、活跃 Worker 数及最早入队时间。

本接口仅用于观测 Work 队列，不执行 Work 的拉取、认领、续租或停止。

`queued` 状态的 Work 由以下两部分构成：

- `depth`：尚未被拉取的 Work 数量。
- `pending`：已被拉取但尚未认领的 Work 数量。

其他状态请通过查询 Work 列表查看。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**environment_id** `string` `必选` | 环境 ID

要操作的 Environment ID，以 `env-` 开头。填写创建环境或查询环境列表接口取得的 ID。

## 响应参数

**depth** `integer` | 待拉取条数

尚未被任何 Worker 通过拉取 Work 接口获取的 `queued` 状态 Work 数量。

**pending** `integer` | 待认领条数

已由拉取接口返回给 Worker、但尚未通过认领接口确认的 `queued` 状态 Work 数量。

**type** `string` | 对象类型

类型标识，固定为 `work_queue_stats`。

**workers_polling** `integer` | 活跃 Worker 数

最近 30 秒内携带非空 `Ark-Worker-ID` 发起过 Work 拉取请求的 Worker 数。未携带该请求头的 Worker 不计入本字段，因此该值可能低于实际运行的 Worker 数。

**oldest_queued_at** `string` | 最早入队时间

最早一条 `queued` 状态 Work 的创建时间，采用 UTC RFC 3339 格式。队列无待处理 Work 时不返回该字段。


## 代码示例

## 查询 Work 队列状态

### cURL


#### Request

```bash
curl -sS --fail-with-body \
  "https://ark.cn-beijing.volces.com/api/v3/environments/<ENVIRONMENT_ID>/work/stats" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

#### Response

```
{
  "depth": 3,
  "pending": 1,
  "workers_polling": 2,
  "oldest_queued_at": "2026-10-19T08:29:30Z",
  "type": "work_queue_stats"
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
    "/environments/<ENVIRONMENT_ID>/work/stats",
    cast_to=object,
)
print(json.dumps(result, ensure_ascii=False, indent=2))
```

#### Response

```
{
  "depth": 3,
  "pending": 1,
  "workers_polling": 2,
  "oldest_queued_at": "2026-10-19T08:29:30Z",
  "type": "work_queue_stats"
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
		"https://ark.cn-beijing.volces.com/api/v3/environments/<ENVIRONMENT_ID>/work/stats",
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
  "depth": 3,
  "pending": 1,
  "workers_polling": 2,
  "oldest_queued_at": "2026-10-19T08:29:30Z",
  "type": "work_queue_stats"
}
```
