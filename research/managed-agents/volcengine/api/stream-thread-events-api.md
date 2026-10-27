---
source: https://ark.volcengine.com/region:cn-beijing/docs/stream-thread-events-api
fetched: 2026-10-24
title: 流式获取线程事件
---

# 流式获取线程事件

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`GET https://ark.cn-beijing.volces.com/api/v3/sessions/{session_id}/threads/{thread_id}/stream`

通过 SSE（Server-Sent Events）协议订阅指定线程视角的实时事件。订阅主线程时，可能同时收到子线程的创建、状态变化和需要主线程处理的工具请求通知。所有事件的结构定义详情请参见 [会话事件结构参考](sessions-events-reference-v2.md)。

> **说明**
>
> - 本接口不支持断线续传。连接中断后，可通过 [获取线程事件列表](list-thread-events-api.md) 查询中断期间产生的事件，再重新建立流式连接。
> - 连接建立后先收到 `: ready`，随后约每 15 秒收到 `: heartbeat`。服务实例退出前可能发送 `: server draining, reconnect`，收到后应重新连接。客户端应忽略这些 SSE 注释行，并将读取超时设置为至少两个心跳周期。
> - 服务端通过 `data:` 行发送事件 JSON，可以省略显式 `event:` 行。线程进入 `idle` 不会自动关闭连接；客户端不再监听时需要主动断开。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**session_id** `string` `必选` | 会话 ID

会话 ID，形如 `sesn-...`

**thread_id** `string` `必选` | 线程 ID

线程 ID，以 `sthr-` 开头

### Query 参数

> 在 URL Query String 中传入。

**event_deltas** `array` | 流式预览事件类型

指定希望以 `event_start` 和 `event_delta` 预览的事件类型。当前支持 `agent.message` 和 `agent.thinking`；未提供时不返回预览帧

> **说明**
>
> 多值可重复传入（`?event_deltas=agent.message&event_deltas=agent.thinking`）或使用逗号分隔（`?event_deltas=agent.message,agent.thinking`）。未识别的值会被忽略。

## 响应参数

### SSE 流式响应，每个事件为一个 SessionEvent 对象，仅包含当前线程相关事件

**data** `string` | 事件 JSON 数据

服务端通过 `data:` 行返回事件 JSON。SSE 响应中可能没有 `event:` 行；这种情况下，客户端仍可按默认的 `message` 事件读取 `data:` 内容。

JSON 中的 `type` 字段表示具体的业务事件类型。

完整事件的公共字段包括 `id`、`type` 和 `processed_at`。`session_thread_id` 仅在对应事件结构中明确列出时返回，其他字段随 `type` 不同。

**event** `string` | SSE 事件类型

SSE 事件类型固定为 `message`。服务端不显式返回 `event:` 行时，SSE 客户端使用该默认值；业务事件类型从 `data.type` 读取


## 代码示例

## 流式获取线程事件

### cURL


#### Request

```Bash
curl -sS --fail-with-body -N \
  "https://ark.cn-beijing.volces.com/api/v3/sessions/<SESSION_ID>/threads/<THREAD_ID>/stream" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Accept: text/event-stream"
```

#### Response

```
: ready

data: {"id":"sevt-20260715083015-a1b2c","type":"session.status_running","processed_at":"2026-07-15T08:30:15.123Z"}

data: {"id":"sevt-20260715083015-b2c3d","type":"user.message","processed_at":"2026-07-15T08:30:15.130Z","content":[{"type":"text","text":"帮我梳理 Q3 目标"}]}

data: {"id":"sevt-20260715083017-c3d4e","type":"agent.message","processed_at":"2026-07-15T08:30:17.045Z","session_thread_id":"<THREAD_ID>","content":[{"type":"text","text":"好的，我先按 OKR 分层梳理。"}]}

data: {"id":"sevt-20260715083017-d4e5f","type":"session.thread_status_idle","processed_at":"2026-07-15T08:30:17.100Z","session_thread_id":"<THREAD_ID>","agent_name":"demo-agent","stop_reason":{"type":"end_turn"}}

data: {"id":"sevt-20260715083017-e5f6g","type":"session.status_idle","processed_at":"2026-07-15T08:30:17.101Z","stop_reason":{"type":"end_turn"}}

: heartbeat
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

for event in client.sessions.threads.stream("<SESSION_ID>", "<THREAD_ID>"):
    print(event.data.model_dump_json(exclude_none=True, exclude_defaults=True))
    if event.type in {"session.status_idle", "session.status_terminated"}:
        break
```

#### Response

```
{"id":"sevt-20260715083017-c3d4e","type":"agent.message","processed_at":"2026-07-15T08:30:17.045Z","session_thread_id":"<THREAD_ID>","content":[{"type":"text","text":"好的，我先按 OKR 分层梳理。"}]}
{"id":"sevt-20260715083017-d4e5f","type":"session.thread_status_idle","processed_at":"2026-07-15T08:30:17.100Z","session_thread_id":"<THREAD_ID>","agent_name":"demo-agent","stop_reason":{"type":"end_turn"}}
{"id":"sevt-20260715083017-e5f6g","type":"session.status_idle","processed_at":"2026-07-15T08:30:17.101Z","stop_reason":{"type":"end_turn"}}
```

### Java


#### Request

```java
// Maven dependency: com.volcengine:ark-runtime:0.9.0
import com.volcengine.ark.runtime.service.ArkService;
import okhttp3.ResponseBody;
import okio.BufferedSource;
import retrofit2.Response;

public class Main {
    public static void main(String[] args) throws Exception {
        ArkService service = ArkService.builder()
                .apiKey(System.getenv("ARK_API_KEY"))
                .baseUrl("https://ark.cn-beijing.volces.com/api/v3")
                .build();

        Response<ResponseBody> response =
                service.streamSessionThreadEvents("<SESSION_ID>", "<THREAD_ID>").execute();
        if (!response.isSuccessful() || response.body() == null) {
            throw new IllegalStateException("stream failed: " + response.code());
        }
        try (ResponseBody body = response.body()) {
            BufferedSource source = body.source();
            String line;
            while ((line = source.readUtf8Line()) != null) {
                if (line.startsWith("data:")) {
                    System.out.println(line.substring(5).trim());
                }
                if (line.contains("session.status_idle")
                        || line.contains("session.status_terminated")) {
                    break;
                }
            }
        }

        service.shutdownExecutor();
    }
}
```

#### Response

```
{"id":"sevt-20260715083017-c3d4e","type":"agent.message","processed_at":"2026-07-15T08:30:17.045Z","session_thread_id":"<THREAD_ID>","content":[{"type":"text","text":"好的，我先按 OKR 分层梳理。"}]}
{"id":"sevt-20260715083017-d4e5f","type":"session.thread_status_idle","processed_at":"2026-07-15T08:30:17.100Z","session_thread_id":"<THREAD_ID>","agent_name":"demo-agent","stop_reason":{"type":"end_turn"}}
{"id":"sevt-20260715083017-e5f6g","type":"session.status_idle","processed_at":"2026-07-15T08:30:17.101Z","stop_reason":{"type":"end_turn"}}
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
)

func main() {
	ctx := context.Background()
	client := arkruntime.NewClientWithApiKey(
		os.Getenv("ARK_API_KEY"),
		arkruntime.WithBaseUrl("https://ark.cn-beijing.volces.com/api/v3"),
	)

	stream, err := client.StreamSessionThreadEvents(ctx, "<SESSION_ID>", "<THREAD_ID>")
	if err != nil {
		panic(err)
	}
	defer stream.Close()

	for stream.Next() {
		frame := stream.Event()
		fmt.Printf("%s: %s\n", frame.Type, frame.RawPayload)
		if frame.Type == "session.status_idle" || frame.Type == "session.status_terminated" {
			break
		}
	}
	if err := stream.Err(); err != nil {
		panic(err)
	}
}
```

#### Response

```
agent.message: {"id":"sevt-20260715083017-c3d4e","type":"agent.message","processed_at":"2026-07-15T08:30:17.045Z","session_thread_id":"<THREAD_ID>","content":[{"type":"text","text":"好的，我先按 OKR 分层梳理。"}]}
session.thread_status_idle: {"id":"sevt-20260715083017-d4e5f","type":"session.thread_status_idle","processed_at":"2026-07-15T08:30:17.100Z","session_thread_id":"<THREAD_ID>","agent_name":"demo-agent","stop_reason":{"type":"end_turn"}}
session.status_idle: {"id":"sevt-20260715083017-e5f6g","type":"session.status_idle","processed_at":"2026-07-15T08:30:17.101Z","stop_reason":{"type":"end_turn"}}
```
