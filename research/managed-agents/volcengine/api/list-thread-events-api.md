---
source: https://ark.volcengine.com/region:cn-beijing/docs/list-thread-events-api
fetched: 2026-10-24
title: 查询线程事件列表
---

# 查询线程事件列表

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`GET https://ark.cn-beijing.volces.com/api/v3/sessions/{session_id}/threads/{thread_id}/events`

分页查询指定线程中已经产生的消息、工具调用和状态事件。查询会话主线程中的事件时，请使用 [获取会话事件列表](list-events-api.md)；实时接收指定线程的事件时，请使用 [流式获取线程事件](stream-thread-events-api.md)。返回字段随事件类型变化，详情请参见 [会话事件结构参考](sessions-events-reference-v2.md)。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**session_id** `string` `必选` | 会话 ID

会话 ID，格式为 `sesn-` 开头的字符串

**thread_id** `string` `必选` | 线程 ID

线程 ID，形如 `sthr-xxxxx`。

### Query 参数

> 在 URL Query String 中传入。

**created_at[gt]** `string` | 起始时间（不含）

事件处理时间的起始边界（不含），采用 RFC 3339 格式。`created_at` 四个边界至多使用两个组成区间

**created_at[gte]** `string` | 起始时间（含）

事件处理时间的起始边界（含），采用 RFC 3339 格式。`created_at` 四个边界至多使用两个组成区间

**created_at[lt]** `string` | 结束时间（不含）

事件处理时间的结束边界（不含），采用 RFC 3339 格式。`created_at` 四个边界至多使用两个组成区间

**created_at[lte]** `string` | 结束时间（含）

事件处理时间的结束边界（含），采用 RFC 3339 格式。`created_at` 四个边界至多使用两个组成区间

**limit** `integer` `默认值 50` | 每页事件数

每页返回的事件数量。

> **说明**
>
> `limit` 为 0 时按默认值 50 处理；大于 200 时按 200 处理。负数或无法解析为整数的值会返回参数错误。

**取值范围**：`[0, 200]`

**order** `string` `默认值 asc` | 排序方向

事件排序方向。

> **说明**
>
> `desc` 表示倒序；省略、传入 `asc` 或其他值时均按正序返回。

**page** `string` | 下一页标识

下一页标识。请将上一页返回的 `next_page` 原样传入；不传则从第一页开始

**types** `string[]` | 事件类型筛选

按事件类型筛选，可重复传入，例如 `types=user.message&types=agent.message`。支持的取值请参见 [会话事件结构参考](sessions-events-reference-v2.md)

## 响应参数

**data** `object[]` | 事件列表

指定线程的事件列表，用于查询子智能体线程内部的消息和工具调用。

每个事件对象包含 `id`、`type`、`processed_at` 以及随 `type` 变化的业务字段。

* 查询会话主线程中的事件时，请使用 [获取会话事件列表](list-events-api.md)。
* 完整字段结构请参见 [会话事件结构参考](sessions-events-reference-v2.md)。

**id** `string` | 事件 ID

`data.id`

事件唯一标识符，形如 `sevt-...`

**processed_at** `string` | 处理时间

`data.processed_at`

事件处理时间，采用 RFC 3339 格式

**type** `string` | 事件类型

`data.type`

事件类型（如 `user.message`、`agent.message`、`session.status_idle` 等）

**next_page** `string` | 下一页标识

下一页标识，请原样传入下一次请求的 `page` 参数；无更多数据时不返回该字段


## 代码示例

## 获取线程事件列表

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/sessions/<SESSION_ID>/threads/<THREAD_ID>/events?limit=50&order=asc" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

#### Response

```
{
  "data": [
    {
      "id": "sevt-20260926143027-c3d4e",
      "type": "agent.message",
      "processed_at": "2026-09-26T14:30:27.045Z",
      "content": [{"type": "text", "text": "好的，我先按 OKR 分层梳理。"}]
    },
    {
      "id": "sevt-20260926143029-e5f6g",
      "type": "session.thread_status_idle",
      "processed_at": "2026-09-26T14:30:29.220Z",
      "session_thread_id": "<THREAD_ID>",
      "agent_name": "researcher",
      "stop_reason": {"type": "end_turn"}
    }
  ]
}
```

### Python


#### Request

```python
import json
import os
import urllib.parse
import urllib.request

query = urllib.parse.urlencode({"limit": 50, "order": "asc"})
req = urllib.request.Request(
    "https://ark.cn-beijing.volces.com/api/v3/sessions/<SESSION_ID>/threads/<THREAD_ID>/events?" + query,
    headers={"Authorization": f"Bearer {os.environ['ARK_API_KEY']}"},
)

with urllib.request.urlopen(req) as resp:
    print(resp.read().decode())
```

#### Response

```
{
  "data": [
    {
      "id": "sevt-20260926143027-c3d4e",
      "type": "agent.message",
      "processed_at": "2026-09-26T14:30:27.045Z",
      "content": [{"type": "text", "text": "好的，我先按 OKR 分层梳理。"}]
    },
    {
      "id": "sevt-20260926143029-e5f6g",
      "type": "session.thread_status_idle",
      "processed_at": "2026-09-26T14:30:29.220Z",
      "session_thread_id": "<THREAD_ID>",
      "agent_name": "researcher",
      "stop_reason": {"type": "end_turn"}
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
import com.volcengine.ark.runtime.models.session.ListSessionEventsResponse;
import com.volcengine.ark.runtime.service.ArkService;

public class Main {
    public static void main(String[] args) throws Exception {
        ArkService service = ArkService.builder()
                .apiKey(System.getenv("ARK_API_KEY"))
                .baseUrl("https://ark.cn-beijing.volces.com/api/v3")
                .build();

        ListSessionEventsResponse page = service.listSessionThreadEvents(
                "<SESSION_ID>", "<THREAD_ID>",
                null, null, null, null, 50, "asc", null, null);
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
      "id": "sevt-20260926143027-c3d4e",
      "type": "agent.message",
      "processed_at": "2026-09-26T14:30:27.045Z",
      "content": [{"type": "text", "text": "好的，我先按 OKR 分层梳理。"}]
    },
    {
      "id": "sevt-20260926143029-e5f6g",
      "type": "session.thread_status_idle",
      "processed_at": "2026-09-26T14:30:29.220Z",
      "session_thread_id": "<THREAD_ID>",
      "agent_name": "researcher",
      "stop_reason": {"type": "end_turn"}
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

	resp, err := client.ListSessionThreadEvents(ctx, "<SESSION_ID>", "<THREAD_ID>",
		&sessionmodel.SessionThreadsListEventsParams{
			Limit: sessionmodel.NewOptInt32(50),
			Order: sessionmodel.NewOptListSessionsOrder(sessionmodel.ListSessionsOrderAsc),
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
      "id": "sevt-20260926143027-c3d4e",
      "type": "agent.message",
      "processed_at": "2026-09-26T14:30:27.045Z",
      "content": [{"type": "text", "text": "好的，我先按 OKR 分层梳理。"}]
    },
    {
      "id": "sevt-20260926143029-e5f6g",
      "type": "session.thread_status_idle",
      "processed_at": "2026-09-26T14:30:29.220Z",
      "session_thread_id": "<THREAD_ID>",
      "agent_name": "researcher",
      "stop_reason": {"type": "end_turn"}
    }
  ]
}
```
