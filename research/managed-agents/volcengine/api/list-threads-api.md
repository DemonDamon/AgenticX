---
source: https://ark.volcengine.com/region:cn-beijing/docs/list-threads-api
fetched: 2026-10-24
title: 查询线程列表
---

# 查询线程列表

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`GET https://ark.cn-beijing.volces.com/api/v3/sessions/{session_id}/threads`

分页查询指定会话下的主线程和子线程。会话开始执行后形成主线程；智能体委派子任务时形成子线程。

主线程排在最前，子线程按创建时间正序返回。

> **说明**
>
> 新建会话在尚未开始处理任何事件时，线程列表可能为空。本接口仅支持 `limit` 和 `page` 分页，不支持按状态、智能体或父线程筛选，也不支持反转排序。单次最多返回 1000 条。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**session_id** `string` `必选` | 会话 ID

会话 ID，形如 `sesn-...`

### Query 参数

> 在 URL Query String 中传入。

**limit** `integer` `默认值 1000` | 每页线程数

每页返回的线程数量，有效取值范围为 0～1000。

> **说明**
>
> 省略 `limit` 或传入 0 时，按 1000 处理；传入大于 1000 的整数时，按 1000 处理。负数或无法解析为整数的值会返回参数错误。

**最小值**：`0`

**page** `string` | 下一页标识

下一页标识。请将上一页响应中的 `next_page` 原样传入；不传则从第一页开始

## 响应参数

**data** `object[]` | 线程列表

线程列表。新建会话在尚未开始处理任何事件时可能返回空数组；首次执行开始后才会出现主线程视图

**agent_name** `string` | 智能体名称

`data.agent_name`

线程关联的智能体名称

**created_at** `string` | 创建时间

`data.created_at`

首次观察到该线程的时间，采用 RFC 3339 格式。

**id** `string` | 线程 ID

`data.id`

线程唯一标识符，形如 `sthr-...`

**parent_thread_id** `string / null` | 父线程 ID

`data.parent_thread_id`

子线程的父线程 ID；主线程返回 `null`。

**session_id** `string` | 会话 ID

`data.session_id`

所属会话 ID，形如 `sesn-...`

**status** `string` | 线程状态

`data.status`

线程状态：
- `running` 智能体正在处理
- `idle` 空闲（等待用户输入或工具结果）
- `rescheduling` 调度中
- `terminated` 已终止

线程不能单独删除；`terminated` 线程仍可能出现在列表中。

**type** `string` | 对象类型

`data.type`

对象类型，固定为 `session_thread`

**updated_at** `string` | 更新时间

`data.updated_at`

最近一次线程状态变化的时间，采用 RFC 3339 格式。

**next_page** `string` | 下一页标识

下一页标识。若为空或字段不返回，表示已到最后一页


## 代码示例

## 查询线程列表

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/sessions/<SESSION_ID>/threads?limit=100" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

#### Response

```
{
  "data": [
    {
      "id": "sthr-01hx3z9r0w8n3p5q6s7t8v9x0z",
      "session_id": "<SESSION_ID>",
      "type": "session_thread",
      "status": "idle",
      "agent_name": "<AGENT_NAME>",
      "parent_thread_id": null,
      "created_at": "2026-07-15T08:30:14.900Z",
      "updated_at": "2026-07-15T08:30:19.220Z"
    },
    {
      "id": "sthr-01hx3z9r0w8n3p5q6s7t8v9x22",
      "session_id": "<SESSION_ID>",
      "type": "session_thread",
      "status": "running",
      "agent_name": "<AGENT_NAME>-sub",
      "parent_thread_id": "sthr-01hx3z9r0w8n3p5q6s7t8v9x0z",
      "created_at": "2026-07-15T08:31:04.000Z",
      "updated_at": "2026-07-15T08:31:04.000Z"
    }
  ]
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

page = client.sessions.threads.list("<SESSION_ID>", limit=100)
print(page)
```

#### Response

```
{
  "data": [
    {
      "id": "sthr-01hx3z9r0w8n3p5q6s7t8v9x0z",
      "session_id": "<SESSION_ID>",
      "type": "session_thread",
      "status": "idle",
      "agent_name": "<AGENT_NAME>",
      "parent_thread_id": null,
      "created_at": "2026-07-15T08:30:14.900Z",
      "updated_at": "2026-07-15T08:30:19.220Z"
    },
    {
      "id": "sthr-01hx3z9r0w8n3p5q6s7t8v9x22",
      "session_id": "<SESSION_ID>",
      "type": "session_thread",
      "status": "running",
      "agent_name": "<AGENT_NAME>-sub",
      "parent_thread_id": "sthr-01hx3z9r0w8n3p5q6s7t8v9x0z",
      "created_at": "2026-07-15T08:31:04.000Z",
      "updated_at": "2026-07-15T08:31:04.000Z"
    }
  ]
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
import com.volcengine.ark.runtime.models.session.ListSessionThreadsResponse;
import com.volcengine.ark.runtime.service.ArkService;

public class Main {
    public static void main(String[] args) throws Exception {
        ArkService service = ArkService.builder()
                .apiKey(System.getenv("ARK_API_KEY"))
                .baseUrl("https://ark.cn-beijing.volces.com/api/v3")
                .build();

        ListSessionThreadsResponse page = service.listSessionThreads("<SESSION_ID>", 100, null);
        System.out.println(page);

        service.shutdownExecutor();
    }
}
```

#### Response

```
{
  "data": [
    {
      "id": "sthr-01hx3z9r0w8n3p5q6s7t8v9x0z",
      "session_id": "<SESSION_ID>",
      "type": "session_thread",
      "status": "idle",
      "agent_name": "<AGENT_NAME>",
      "parent_thread_id": null,
      "created_at": "2026-07-15T08:30:14.900Z",
      "updated_at": "2026-07-15T08:30:19.220Z"
    },
    {
      "id": "sthr-01hx3z9r0w8n3p5q6s7t8v9x22",
      "session_id": "<SESSION_ID>",
      "type": "session_thread",
      "status": "running",
      "agent_name": "<AGENT_NAME>-sub",
      "parent_thread_id": "sthr-01hx3z9r0w8n3p5q6s7t8v9x0z",
      "created_at": "2026-07-15T08:31:04.000Z",
      "updated_at": "2026-07-15T08:31:04.000Z"
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
	"fmt"
	"os"

	"github.com/volcengine/ark-runtime-go/arkruntime"
	sessionmodel "github.com/volcengine/ark-runtime-go/arkruntime/model/session"
)

func main() {
	ctx := context.Background()
    client := arkruntime.NewClientWithApiKey(
		os.Getenv("ARK_API_KEY"),
        arkruntime.WithBaseUrl("https://ark.cn-beijing.volces.com/api/v3"),
	)

	resp, err := client.ListSessionThreads(ctx, "<SESSION_ID>", &sessionmodel.SessionThreadsListParams{
		Limit: sessionmodel.NewOptInt32(100),
	})
	if err != nil {
		panic(err)
	}
	fmt.Println(resp)
}
```

#### Response

```
{
  "data": [
    {
      "id": "sthr-01hx3z9r0w8n3p5q6s7t8v9x0z",
      "session_id": "<SESSION_ID>",
      "type": "session_thread",
      "status": "idle",
      "agent_name": "<AGENT_NAME>",
      "parent_thread_id": null,
      "created_at": "2026-07-15T08:30:14.900Z",
      "updated_at": "2026-07-15T08:30:19.220Z"
    },
    {
      "id": "sthr-01hx3z9r0w8n3p5q6s7t8v9x22",
      "session_id": "<SESSION_ID>",
      "type": "session_thread",
      "status": "running",
      "agent_name": "<AGENT_NAME>-sub",
      "parent_thread_id": "sthr-01hx3z9r0w8n3p5q6s7t8v9x0z",
      "created_at": "2026-07-15T08:31:04.000Z",
      "updated_at": "2026-07-15T08:31:04.000Z"
    }
  ]
}
```
