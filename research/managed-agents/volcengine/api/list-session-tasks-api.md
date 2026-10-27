---
source: https://ark.volcengine.com/region:cn-beijing/docs/list-session-tasks-api
fetched: 2026-10-24
title: 查询会话任务列表
---

# 查询会话任务列表

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`GET https://ark.cn-beijing.volces.com/api/v3/sessions/{session_id}/tasks`

分页查询指定会话中的后台工具任务，可按任务状态或会话线程筛选。

列表只返回任务摘要，不返回执行结果 `result`。如需读取任务结果、日志位置或产物路径，请使用 [查询会话任务](get-session-task-api.md)。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**session_id** `string` `必选` | 会话 ID

要查询后台工具任务的会话 ID，格式为 `sesn-` 开头的字符串。

### Query 参数

> 在 URL Query String 中传入。

**cursor** `integer` | 下一页标识

下一页标识。按以下方式翻页：

1. 首次查询时省略。
2. 后续查询时，将上一页响应中的 `next_cursor` 原样传入。
3. 响应不再返回 `next_cursor` 时，停止查询。

不要解析、生成或修改该值。

> **说明**
>
> 传入 `0` 时，按首次查询处理。

**最小值**：`0`

**limit** `integer` `默认值 20` | 每页任务数

每页返回的任务数量。

> **说明**
>
> 省略 `limit` 或传入 `0` 时，按 20 处理；传入大于 50 的整数时，按 50 处理。负数或无法解析为整数的值会返回参数错误。

**最小值**：`0`

**session_thread_id** `string` | 会话线程 ID

发起任务的会话线程 ID。传入后，只返回该线程创建的后台工具任务；省略时返回整个会话的任务。

**state** `string` | 任务状态

按任务状态筛选结果。支持使用半角逗号分隔多个状态。

> **说明**
>
> * 省略时不按状态筛选。
> * 状态值不匹配任何任务时返回空列表。
>
> 支持以下任务状态：
>
> * `queued`：任务正在等待执行。
> * `running`：任务正在执行，或产物正在保存到会话工作区。
> * `succeeded`：任务执行成功。
> * `failed`：任务执行失败。
> * `cancelled`：任务已取消。
> * `unknown`：当前无法确认任务状态。保留 `task_id` 并稍后查询；状态可能恢复为 `running` 或实际结束状态，因此不要将该状态视为成功。

## 响应参数

**items** `object[]` | 任务列表

后台工具任务摘要列表，按创建顺序倒序返回。正常执行的 `bash` 命令只有转为后台任务后，才会出现在列表中。列表项不包含任务执行结果 `result`；如需读取结果，请查询单个任务。

**created_at** `integer` | 创建时间

`items.created_at`

任务提交时间，采用 Unix 毫秒时间戳。

**session_id** `string` | 会话 ID

`items.session_id`

任务所属的会话 ID。

**session_thread_id** `string` | 会话线程 ID

`items.session_thread_id`

发起该任务的会话线程 ID。

**state** `string` | 任务状态

`items.state`

任务的当前状态。

`unknown` 表示当前无法确认任务状态，不是稳定结束状态。保留 `task_id` 并稍后查询；状态可能恢复为 `running` 或实际结束状态，因此不要将该状态视为成功。取值：`queued` / `running` / `succeeded` / `failed` / `cancelled` / `unknown`。

**task_id** `string` | 任务 ID

`items.task_id`

后台工具任务的唯一标识，格式为 `task-` 开头的字符串。

**tool** `object` | 工具信息

`items.tool`

产生该任务的工具调用信息。

**name** `string` | 工具名称

`items.tool.name`

产生该任务的工具名称，例如 `bash` 或 `video_generate`。

**description** `string` | 工具调用说明

`items.tool.description`

工具调用的用途说明。没有可用说明时，不返回该字段。

**tool_use_id** `string` | 工具调用 ID

`items.tool.tool_use_id`

Agent 发起该次工具调用时生成的工具调用 ID。没有可用 ID 时，不返回该字段。

**error_code** `string` | 失败类型

`items.error_code`

任务失败、取消或状态未知，且服务端记录了失败原因时的失败类型。可选值：`upstream`、`timeout`、`fetch`、`killed`、`internal`。

**error_message** `string` | 失败信息

`items.error_message`

任务失败、取消或状态未知，且服务端记录了失败原因时的原因说明。

**finished_at** `integer` | 结束时间

`items.finished_at`

任务进入结束状态的时间，采用 Unix 毫秒时间戳。任务尚未结束时，不返回该字段。

**started_at** `integer` | 开始时间

`items.started_at`

任务开始执行的时间，采用 Unix 毫秒时间戳。任务尚未开始时，不返回该字段。

**summary** `string` | 任务摘要

`items.summary`

工具执行内容的摘要。服务端未生成摘要时，不返回该字段。

**next_cursor** `integer` | 下一页标识

下一页标识。返回该字段时，将其原样传入下一次请求的 `cursor`；未返回时表示已到最后一页。


## 代码示例

## 查询会话任务列表

### cURL


#### Request

```bash
curl -sS --fail-with-body \
  "https://ark.cn-beijing.volces.com/api/v3/sessions/${SESSION_ID}/tasks?session_thread_id=${SESSION_THREAD_ID}&state=queued,running&limit=20" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

#### Response

```
{
  "items": [
    {
      "task_id": "task-20260910173330-54321",
      "tool": {
        "name": "video_generate",
        "tool_use_id": "toolu_02",
        "description": "Generate a city night video"
      },
      "session_id": "<SESSION_ID>",
      "session_thread_id": "sthr-20260910171500-abcde",
      "state": "running",
      "summary": "生成一段城市夜景视频",
      "created_at": 1789032810494,
      "started_at": 1789032813926
    }
  ],
  "next_cursor": 1024
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
        "session_thread_id",
        "<SESSION_THREAD_ID>"
    ),
    (
        "state",
        "queued,running"
    ),
    (
        "limit",
        20
    )
], doseq=True)
path = "/sessions/<SESSION_ID>/tasks" + "?" + query

result = client.get(
    path,
    cast_to=object,
)
print(json.dumps(result, ensure_ascii=False, indent=2))
```

#### Response

```
{
  "items": [
    {
      "task_id": "task-20260910173330-54321",
      "tool": {
        "name": "video_generate",
        "tool_use_id": "toolu_02",
        "description": "Generate a city night video"
      },
      "session_id": "<SESSION_ID>",
      "session_thread_id": "sthr-20260910171500-abcde",
      "state": "running",
      "summary": "生成一段城市夜景视频",
      "created_at": 1789032810494,
      "started_at": 1789032813926
    }
  ],
  "next_cursor": 1024
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
		"https://ark.cn-beijing.volces.com/api/v3/sessions/<SESSION_ID>/tasks?session_thread_id=<SESSION_THREAD_ID>&state=queued,running&limit=20",
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
  "items": [
    {
      "task_id": "task-20260910173330-54321",
      "tool": {
        "name": "video_generate",
        "tool_use_id": "toolu_02",
        "description": "Generate a city night video"
      },
      "session_id": "<SESSION_ID>",
      "session_thread_id": "sthr-20260910171500-abcde",
      "state": "running",
      "summary": "生成一段城市夜景视频",
      "created_at": 1789032810494,
      "started_at": 1789032813926
    }
  ],
  "next_cursor": 1024
}
```
