---
source: https://ark.volcengine.com/region:cn-beijing/docs/list-events-api
fetched: 2026-10-24
title: 查询会话事件列表
---

# 查询会话事件列表

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`GET https://ark.cn-beijing.volces.com/api/v3/sessions/{session_id}/events`

分页查询会话主线程中已经产生的事件，支持按事件处理时间和事件类型筛选。实时接收事件请使用 [流式获取会话事件](stream-events-api.md)，查询子线程事件请使用 [获取线程事件列表](list-thread-events-api.md)。返回字段随事件类型变化，详情请参见 [会话事件结构参考](sessions-events-reference-v2.md)。

> **说明**
>
> - 默认按事件产生时间正序返回（从旧到新）。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**session_id** `string` `必选` | 会话 ID

填写要查询事件的会话 ID，形如 `sesn-...`

### Query 参数

> 在 URL Query String 中传入。

**created_at[gt]** `string` | 起始时间（不含）

事件处理时间的起始边界（不含），采用 RFC 3339 格式。同时传入多个时间边界时，仅返回满足全部边界条件的事件

**created_at[gte]** `string` | 起始时间（含）

事件处理时间的起始边界（含），采用 RFC 3339 格式。同时传入多个时间边界时，仅返回满足全部边界条件的事件

**created_at[lt]** `string` | 结束时间（不含）

事件处理时间的结束边界（不含），采用 RFC 3339 格式。同时传入多个时间边界时，仅返回满足全部边界条件的事件

**created_at[lte]** `string` | 结束时间（含）

事件处理时间的结束边界（含），采用 RFC 3339 格式。同时传入多个时间边界时，仅返回满足全部边界条件的事件

**limit** `integer` `默认值 50` | 每页事件数

每页返回的事件数量。

> **说明**
>
> 当 `limit` 大于 200 时，服务端会按 200 处理，不会返回参数错误。

**取值范围**：`[1, 200]`

**order** `string` `默认值 asc` | 排序方向

排序方向，`asc` 按事件产生时间正序（从旧到新），`desc` 倒序。

**page** `string` | 下一页标识

下一页标识。请将上一页返回的 `next_page` 原样传入；不传则从第一页开始

**types** `string[]` | 事件类型筛选

按事件类型筛选，可重复传入，例如 `types=user.message&types=agent.message`。支持的取值请参见 [会话事件结构参考](sessions-events-reference-v2.md)

## 响应参数

**data** `object[]` | 事件列表

本接口返回会话主线程中的历史事件，包括用户输入、智能体输出、会话状态，以及模型调用与结果评估事件。

每个事件对象包含 `id`、`type`、`processed_at` 和随 `type` 变化的业务字段。

只有对应事件结构明确包含时，才会返回 `session_thread_id`；主线程中的常规消息通常不含该字段。子智能体线程内部的消息和工具调用，需通过对应线程的事件列表接口查询。

完整事件类型和字段结构见 [会话事件结构参考](sessions-events-reference-v2.md)。

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

## 获取会话事件列表

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/sessions/<SESSION_ID>/events?limit=50&order=asc&types=user.message&types=agent.message" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

#### Response

```
{
  "data": [
    {
      "id": "sevt-20260926143025-a1b2c",
      "type": "user.message",
      "processed_at": "2026-09-26T14:30:25.123Z",
      "session_id": "<SESSION_ID>",
      "content": [{"type": "text", "text": "帮我梳理 Q3 目标"}]
    },
    {
      "id": "sevt-20260926143027-c3d4e",
      "type": "agent.message",
      "processed_at": "2026-09-26T14:30:27.045Z",
      "content": [
        {"type": "text", "text": "好的，我先按 OKR 分层梳理，随后逐条给出交付判据。"}
      ]
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

query = urllib.parse.urlencode(
    [
        ("limit", 50),
        ("order", "asc"),
        ("types", "user.message"),
        ("types", "agent.message"),
    ]
)
req = urllib.request.Request(
    "https://ark.cn-beijing.volces.com/api/v3/sessions/<SESSION_ID>/events?" + query,
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
      "id": "sevt-20260926143025-a1b2c",
      "type": "user.message",
      "processed_at": "2026-09-26T14:30:25.123Z",
      "session_id": "<SESSION_ID>",
      "content": [{"type": "text", "text": "帮我梳理 Q3 目标"}]
    },
    {
      "id": "sevt-20260926143027-c3d4e",
      "type": "agent.message",
      "processed_at": "2026-09-26T14:30:27.045Z",
      "content": [
        {"type": "text", "text": "好的，我先按 OKR 分层梳理，随后逐条给出交付判据。"}
      ]
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
import java.util.Arrays;

public class Main {
    public static void main(String[] args) throws Exception {
        ArkService service = ArkService.builder()
                .apiKey(System.getenv("ARK_API_KEY"))
                .baseUrl("https://ark.cn-beijing.volces.com/api/v3")
                .build();

        ListSessionEventsResponse page = service.listSessionEvents(
                "<SESSION_ID>", null, null, null, null, 50, "asc", null,
                Arrays.asList("user.message", "agent.message"));
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
      "id": "sevt-20260926143025-a1b2c",
      "type": "user.message",
      "processed_at": "2026-09-26T14:30:25.123Z",
      "session_id": "<SESSION_ID>",
      "content": [{"type": "text", "text": "帮我梳理 Q3 目标"}]
    },
    {
      "id": "sevt-20260926143027-c3d4e",
      "type": "agent.message",
      "processed_at": "2026-09-26T14:30:27.045Z",
      "content": [
        {"type": "text", "text": "好的，我先按 OKR 分层梳理，随后逐条给出交付判据。"}
      ]
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

	resp, err := client.ListSessionEvents(ctx, "<SESSION_ID>", &sessionmodel.SessionEventsListEventsParams{
		Limit: sessionmodel.NewOptInt32(50),
		Order: sessionmodel.NewOptListSessionsOrder(sessionmodel.ListSessionsOrderAsc),
		Types: []string{"user.message", "agent.message"},
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
      "id": "sevt-20260926143025-a1b2c",
      "type": "user.message",
      "processed_at": "2026-09-26T14:30:25.123Z",
      "session_id": "<SESSION_ID>",
      "content": [{"type": "text", "text": "帮我梳理 Q3 目标"}]
    },
    {
      "id": "sevt-20260926143027-c3d4e",
      "type": "agent.message",
      "processed_at": "2026-09-26T14:30:27.045Z",
      "content": [
        {"type": "text", "text": "好的，我先按 OKR 分层梳理，随后逐条给出交付判据。"}
      ]
    }
  ]
}
```
