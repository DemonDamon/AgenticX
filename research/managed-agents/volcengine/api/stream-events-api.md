---
source: https://ark.volcengine.com/region:cn-beijing/docs/stream-events-api
fetched: 2026-10-24
title: 流式获取会话事件
---

# 流式获取会话事件

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`GET https://ark.cn-beijing.volces.com/api/v3/sessions/{session_id}/events/stream`

通过 HTTP 长连接的 SSE（Server-Sent Events）协议订阅会话主线程收到的实时事件。所有事件的结构定义详情请参见 [会话事件结构参考](sessions-events-reference-v2.md)。

> **说明**
>
> - 子智能体线程内部的消息和工具调用需通过对应的 [线程事件流](stream-thread-events-api.md) 接收。
> - 本接口不支持断线续传。连接中断后，可通过 [获取会话事件列表](list-events-api.md) 查询中断期间产生的事件，再重新建立流式连接。
> - 连接建立后先收到 `: ready`。服务端随后约每 15 秒发送一次 `: heartbeat`；服务实例退出前可能发送 `: server draining, reconnect`。这些以冒号开头的行均为 SSE 注释，客户端应忽略并将读取超时设置为至少两个心跳周期。
> - 服务端通过 `data:` 行发送可解析的事件 JSON，可以省略显式 `event:` 行。连接通过 EOF、`session.deleted` 或客户端主动断开结束；业务处理是否完成以会话状态事件为准。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**session_id** `string` `必选` | 会话 ID

填写要订阅事件的会话 ID，形如 `sesn-...`

### Query 参数

> 在 URL Query String 中传入。

**event_deltas** `array` | 预览事件类型

指定需要通过 `event_start` 和 `event_delta` 接收预览内容的事件类型。当前支持 `agent.message` 和 `agent.thinking`。

未提供该参数时不返回预览帧。预览帧可能不完整，请以随后返回的完整事件为准。

> **说明**
>
> 多值可重复传入（`?event_deltas=agent.message&event_deltas=agent.thinking`），也可以使用逗号分隔（`?event_deltas=agent.message,agent.thinking`）。

> **注意**
>
> 参数名必须写为 `event_deltas`，不要写成 `event_deltas[]`。服务端会忽略未知参数名和不支持的事件类型，并继续返回 HTTP 200；被忽略的值不会产生预览帧。

## 响应参数

### 流式响应（SSE）

**data** `string` | 事件 JSON 数据

服务端通过 `data:` 行返回事件 JSON。SSE 响应中可能没有 `event:` 行；这种情况下，客户端仍可按默认的 `message` 事件读取 `data:` 内容。

根据事件种类解析 `type`：

* 完整事件顶层的 `type` 表示业务事件类型。
* 预览帧顶层的 `type` 固定为 `event_start` 或 `event_delta`。其中，`event_start.event.type` 表示被预览的业务事件类型。

完整事件和每个预览帧均包含各自的 `id`、`type` 和 `processed_at`。预览帧还包含以下增量信息：

* `event_start.event` 包含被预览事件的 `id` 和 `type`。
* `event_delta.delta` 包含增量 `type`、`content` 和 `index`。

预览帧顶层 `id` 是当前帧的 ID；`event_start.event.id` 和 `event_delta.event_id` 指向被预览的完整事件。

预览帧可能不完整，最终以同一被预览事件 ID 的完整事件为准。

`session_thread_id` 不是公共字段，仅在对应事件结构中明确列出时返回。完整结构请参见 [会话事件结构参考](sessions-events-reference-v2.md)。


## 代码示例

## 流式获取会话事件

### cURL


#### Request

```Bash
curl -sS --fail-with-body -N "https://ark.cn-beijing.volces.com/api/v3/sessions/<SESSION_ID>/events/stream" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Accept: text/event-stream"
```

#### Response

```
: ready

: heartbeat

data: {"id":"sevt-20260926143025-a1b2c","type":"user.message","processed_at":"2026-09-26T14:30:25.123Z","session_id":"<SESSION_ID>","content":[{"type":"text","text":"帮我梳理 Q3 目标"}]}

data: {"id":"sevt-20260926143027-c3d4e","type":"agent.message","processed_at":"2026-09-26T14:30:27.045Z","session_thread_id":"<THREAD_ID>","content":[{"type":"text","text":"好的，我先按 OKR 分层梳理。"}]}

data: {"id":"sevt-20260926143029-e5f6g","type":"session.status_idle","processed_at":"2026-09-26T14:30:29.220Z","stop_reason":{"type":"end_turn"}}
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

for event in client.sessions.events.stream("<SESSION_ID>"):
    print(event)
    if event.type in {"session.status_idle", "session.status_terminated"}:
        break
```

#### Response

```
: ready

: heartbeat

data: {"id":"sevt-20260926143025-a1b2c","type":"user.message","processed_at":"2026-09-26T14:30:25.123Z","session_id":"<SESSION_ID>","content":[{"type":"text","text":"帮我梳理 Q3 目标"}]}

data: {"id":"sevt-20260926143027-c3d4e","type":"agent.message","processed_at":"2026-09-26T14:30:27.045Z","session_thread_id":"<THREAD_ID>","content":[{"type":"text","text":"好的，我先按 OKR 分层梳理。"}]}

data: {"id":"sevt-20260926143029-e5f6g","type":"session.status_idle","processed_at":"2026-09-26T14:30:29.220Z","stop_reason":{"type":"end_turn"}}
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
                service.streamSessionEvents("<SESSION_ID>").execute();
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
: ready

: heartbeat

data: {"id":"sevt-20260926143025-a1b2c","type":"user.message","processed_at":"2026-09-26T14:30:25.123Z","session_id":"<SESSION_ID>","content":[{"type":"text","text":"帮我梳理 Q3 目标"}]}

data: {"id":"sevt-20260926143027-c3d4e","type":"agent.message","processed_at":"2026-09-26T14:30:27.045Z","session_thread_id":"<THREAD_ID>","content":[{"type":"text","text":"好的，我先按 OKR 分层梳理。"}]}

data: {"id":"sevt-20260926143029-e5f6g","type":"session.status_idle","processed_at":"2026-09-26T14:30:29.220Z","stop_reason":{"type":"end_turn"}}
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

	stream, err := client.StreamSessionEvents(ctx, "<SESSION_ID>")
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
: ready

: heartbeat

data: {"id":"sevt-20260926143025-a1b2c","type":"user.message","processed_at":"2026-09-26T14:30:25.123Z","session_id":"<SESSION_ID>","content":[{"type":"text","text":"帮我梳理 Q3 目标"}]}

data: {"id":"sevt-20260926143027-c3d4e","type":"agent.message","processed_at":"2026-09-26T14:30:27.045Z","session_thread_id":"<THREAD_ID>","content":[{"type":"text","text":"好的，我先按 OKR 分层梳理。"}]}

data: {"id":"sevt-20260926143029-e5f6g","type":"session.status_idle","processed_at":"2026-09-26T14:30:29.220Z","stop_reason":{"type":"end_turn"}}
```
