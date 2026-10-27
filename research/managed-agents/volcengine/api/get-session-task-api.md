---
source: https://ark.volcengine.com/region:cn-beijing/docs/get-session-task-api
fetched: 2026-10-24
title: 查询会话任务
---

# 查询会话任务

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`GET https://ark.cn-beijing.volces.com/api/v3/sessions/{session_id}/tasks/{task_id}`

查询指定后台工具任务的最新状态，以及结束后的执行结果和产物定位信息。

查询单个任务时，任务状态为 `succeeded`、`failed`、`cancelled` 或 `unknown`，响应包含 `result`；任务状态为 `queued` 或 `running` 时不返回。

`unknown` 表示当前无法确认任务状态，不是稳定结束状态。保留 `task_id` 并稍后查询；状态可能恢复为 `running` 或实际结束状态，因此不要将该状态视为成功。

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

要查询的后台工具任务 ID，格式为 `task-` 开头的字符串。可从工具调用返回或任务列表响应的 `task_id` 字段获得。

## 响应参数

**created_at** `integer` | 创建时间

任务记录的创建时间，采用 Unix 毫秒时间戳。

**session_id** `string` | 会话 ID

任务所属的会话 ID。

**session_thread_id** `string` | 会话线程 ID

发起该任务的会话线程 ID。

**state** `string` | 任务状态

任务的当前状态：

* `queued`：任务正在等待执行。
* `running`：任务正在执行，或产物正在保存到会话工作区。
* `succeeded`：任务执行成功。
* `failed`：任务执行失败。
* `cancelled`：任务已取消。
* `unknown`：当前无法确认任务状态，不是稳定结束状态。保留 `task_id` 并稍后查询；状态可能恢复为 `running` 或实际结束状态，因此不要将该状态视为成功。

**task_id** `string` | 任务 ID

后台工具任务的唯一标识，格式为 `task-` 开头的字符串。

**tool** `object` | 工具信息

产生该任务的工具调用信息。

**name** `string` | 工具名称

`tool.name`

产生该任务的工具名称，例如 `bash` 或 `video_generate`。

**description** `string` | 工具调用说明

`tool.description`

工具调用的用途说明。没有可用说明时，不返回该字段。

**tool_use_id** `string` | 工具调用 ID

`tool.tool_use_id`

Agent 发起该次工具调用时生成的工具调用 ID。没有可用 ID 时，不返回该字段。

**error_code** `string` | 失败类型

任务失败、取消或状态未知，且服务端记录了失败原因时的失败类型：

* `upstream`：工具依赖的服务执行失败。
* `timeout`：任务执行超时。
* `fetch`：任务结果获取或保存失败。
* `killed`：任务执行过程被终止。
* `internal`：平台处理任务时发生错误。底层错误原因不会返回，请携带 `task_id` 联系技术支持。

**error_message** `string` | 失败信息

任务失败、取消或状态未知，且服务端记录了失败原因时的原因说明。`error_code` 为 `internal` 时，返回平台侧失败说明，不返回底层错误原因。

**finished_at** `integer` | 结束时间

任务进入结束状态的时间，采用 Unix 毫秒时间戳。任务尚未结束时，不返回该字段。

**result** `object` | 执行结果

任务执行结果。

查询单个任务时，任务状态为 `succeeded`、`failed`、`cancelled` 或 `unknown`，响应包含 `result`；任务状态为 `queued` 或 `running` 时不返回。

**content** `object[]` | 结果内容

`result.content`

工具返回的结果内容块列表。

**text** `string` | 文本内容

`result.content.text`

工具执行结果或失败原因的文本说明。

**type** `string` | 内容类型

`result.content.type`

内容块类型，固定为 `text`。

**status** `string` | 结果状态

`result.status`

工具执行结果状态：

* `ok`：任务成功结束。
* `error`：任务失败、取消或状态未知。

**meta_info** `object` | 结果元信息

`result.meta_info`

用于读取日志、定位会话工作区产物或关联上游生成任务的信息。没有可用元信息时，不返回该字段。

**exit_code** `integer` | 退出码

`result.meta_info.exit_code`

Bash 命令的退出码。执行环境未返回退出码时，不返回该字段。

**output_path** `string` | 产物路径

`result.meta_info.output_path`

工具产物或兼容模式输出在会话工作区中的文件路径。

**stderr_path** `string` | 标准错误路径

`result.meta_info.stderr_path`

Bash 标准错误在会话工作区中的文件路径。

**stdout_path** `string` | 标准输出路径

`result.meta_info.stdout_path`

Bash 标准输出在会话工作区中的文件路径。

**task_id** `string` | 生成任务 ID

`result.meta_info.task_id`

视频生成任务在内容生成服务中的任务 ID。

**video_url** `string` | 视频地址

`result.meta_info.video_url`

生成成功后返回的临时视频访问地址。地址未保留或不可用时，不返回该字段。

**started_at** `integer` | 开始时间

任务开始执行的时间，采用 Unix 毫秒时间戳。任务尚未开始时，不返回该字段。

**summary** `string` | 任务摘要

工具执行内容的摘要。服务端未生成摘要时，不返回该字段。


## 代码示例

## 查询会话任务

### cURL


#### Request

```bash
curl -sS --fail-with-body \
  "https://ark.cn-beijing.volces.com/api/v3/sessions/${SESSION_ID}/tasks/${TASK_ID}" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

#### Response

```
{
  "task_id": "<TASK_ID>",
  "tool": {
    "name": "video_generate",
    "tool_use_id": "toolu_02",
    "description": "Generate a city night video"
  },
  "session_id": "<SESSION_ID>",
  "session_thread_id": "sthr-20260910171500-abcde",
  "state": "succeeded",
  "summary": "生成一段城市夜景视频",
  "result": {
    "status": "ok",
    "content": [
      {
        "type": "text",
        "text": "Successfully generated and saved video to /workspace/out/city.mp4"
      }
    ],
    "meta_info": {
      "task_id": "cgt-20260910173331-el3ow",
      "video_url": "https://example.com/video.mp4",
      "output_path": "/workspace/out/city.mp4"
    }
  },
  "created_at": 1789032810494,
  "started_at": 1789032813926,
  "finished_at": 1789032884862
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
    "/sessions/<SESSION_ID>/tasks/<TASK_ID>",
    cast_to=object,
)
print(json.dumps(result, ensure_ascii=False, indent=2))
```

#### Response

```
{
  "task_id": "<TASK_ID>",
  "tool": {
    "name": "video_generate",
    "tool_use_id": "toolu_02",
    "description": "Generate a city night video"
  },
  "session_id": "<SESSION_ID>",
  "session_thread_id": "sthr-20260910171500-abcde",
  "state": "succeeded",
  "summary": "生成一段城市夜景视频",
  "result": {
    "status": "ok",
    "content": [
      {
        "type": "text",
        "text": "Successfully generated and saved video to /workspace/out/city.mp4"
      }
    ],
    "meta_info": {
      "task_id": "cgt-20260910173331-el3ow",
      "video_url": "https://example.com/video.mp4",
      "output_path": "/workspace/out/city.mp4"
    }
  },
  "created_at": 1789032810494,
  "started_at": 1789032813926,
  "finished_at": 1789032884862
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
		"https://ark.cn-beijing.volces.com/api/v3/sessions/<SESSION_ID>/tasks/<TASK_ID>",
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
  "task_id": "<TASK_ID>",
  "tool": {
    "name": "video_generate",
    "tool_use_id": "toolu_02",
    "description": "Generate a city night video"
  },
  "session_id": "<SESSION_ID>",
  "session_thread_id": "sthr-20260910171500-abcde",
  "state": "succeeded",
  "summary": "生成一段城市夜景视频",
  "result": {
    "status": "ok",
    "content": [
      {
        "type": "text",
        "text": "Successfully generated and saved video to /workspace/out/city.mp4"
      }
    ],
    "meta_info": {
      "task_id": "cgt-20260910173331-el3ow",
      "video_url": "https://example.com/video.mp4",
      "output_path": "/workspace/out/city.mp4"
    }
  },
  "created_at": 1789032810494,
  "started_at": 1789032813926,
  "finished_at": 1789032884862
}
```
