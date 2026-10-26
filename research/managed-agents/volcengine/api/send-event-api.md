---
source: https://ark.volcengine.com/region:cn-beijing/docs/send-event-api
fetched: 2026-10-24
title: 发送会话事件
---

# 发送会话事件

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`POST https://ark.cn-beijing.volces.com/api/v3/sessions/{session_id}/events`

向指定会话发送用户侧事件。

需要实时接收智能体输出和状态变化时，创建会话后先建立 [流式事件连接](stream-events-api.md)，再调用本接口发送事件。无需实时接收时，可在发送后通过 [获取会话事件列表](list-events-api.md) 查询结果。

接口成功响应仅表示事件已受理，不表示本轮处理完成。事件字段结构请参见 [会话事件结构参考](sessions-events-reference-v2.md)。

> **说明**
>
> `user.message` 事件的 `content` 数组支持文本、图片、文档、视频等多种内容块。图片、文档和视频块均可将 `source.type` 设为 `file`，并通过 `source.file_id` 引用 Files API 已上传的文件。`purpose` 为 `user_data` 或 `agent` 的文件均可复用。文件能否直接传入当前模型，由模型能力和内容类型共同决定；不满足条件时，可通过会话 `resources` 将文件挂载到会话运行环境中处理。字段结构详情请参见 [会话事件结构参考](sessions-events-reference-v2.md)。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**session_id** `string` `必选` | 会话 ID

填写要接收事件的会话 ID，形如 `sesn-...`

### Body 参数

**events** `object[]` `必选` | 事件列表

要发送的用户侧事件列表，至少包含 1 条事件。每个事件对象至少包含 `type` 字段，其余字段随事件类型不同而变化。

支持的事件类型、字段结构和批次顺序请参见 [会话事件结构参考](sessions-events-reference-v2.md)。

> **说明**
>
> 整个请求体不能超过 10 MiB。

**type** `string` `必选` | 事件类型

`events.type`

事件类型标识符。支持的取值及对应字段结构详见 [会话事件结构参考](sessions-events-reference-v2.md)。

## 响应参数

**data** `object[]` | 已接收事件列表

服务端已受理的事件列表，与请求中的 `events` 一一对应。每个元素的字段随 `type` 变化，详情请参见 [会话事件结构参考](sessions-events-reference-v2.md)。

接口成功响应仅表示事件已受理，不表示本轮处理完成。可通过 [流式获取会话事件](stream-events-api.md) 实时接收结果，或通过 [获取会话事件列表](list-events-api.md) 查询已经产生的事件。

**type** `string` | 事件类型

`data.type`

事件类型，与请求中传入的 `type` 一致，如 `user.message`

**id** `string` | 事件 ID

`data.id`

回执中的事件 ID。服务端会为未提供 ID 的用户事件生成形如 `sevt-...` 的 ID；`system.message` 等事件可能返回空字符串，最终事件 ID 以事件列表或流式事件为准


## 代码示例

## 发送会话事件

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/sessions/<SESSION_ID>/events" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d @- <<'EOF'
{
  "events": [
    {
      "type": "user.message",
      "content": [{"type": "text", "text": "帮我梳理 Q3 目标，并列出交付判据"}]
    }
  ]
}
EOF
```

#### Response

```
{
  "data": [
    {
      "id": "sevt-20260926143025-a1b2c",
      "type": "user.message",
      "content": [
        {"type": "text", "text": "帮我梳理 Q3 目标，并列出交付判据"}
      ]
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

resp = client.sessions.events.send(
    "<SESSION_ID>",
    events=[
        {
            "type": "user.message",
            "content": [
                {"type": "text", "text": "帮我梳理 Q3 目标，并列出交付判据"}
            ],
        }
    ],
)
print(resp)
```

#### Response

```
{
  "data": [
    {
      "id": "sevt-20260926143025-a1b2c",
      "type": "user.message",
      "content": [
        {"type": "text", "text": "帮我梳理 Q3 目标，并列出交付判据"}
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
import com.volcengine.ark.runtime.models.session.ManagedAgentsMessageContentBlock;
import com.volcengine.ark.runtime.models.session.ManagedAgentsTextBlock;
import com.volcengine.ark.runtime.models.session.ManagedAgentsUserMessageEventParams;
import com.volcengine.ark.runtime.models.session.SendSessionEventsRequest;
import com.volcengine.ark.runtime.models.session.SendSessionEventsResponse;
import com.volcengine.ark.runtime.service.ArkService;
import java.util.Arrays;
import java.util.Collections;

public class Main {
    public static void main(String[] args) throws Exception {
        ArkService service = ArkService.builder()
                .apiKey(System.getenv("ARK_API_KEY"))
                .baseUrl("https://ark.cn-beijing.volces.com/api/v3")
                .build();

        ManagedAgentsTextBlock text = ManagedAgentsTextBlock.builder()
                .text("帮我梳理 Q3 目标，并列出交付判据")
                .build();
        ManagedAgentsUserMessageEventParams userMsg =
                ManagedAgentsUserMessageEventParams.builder()
                        .content(Collections.<ManagedAgentsMessageContentBlock>singletonList(text))
                        .build();
        SendSessionEventsResponse resp = service.sendSessionEvents(
                "<SESSION_ID>",
                SendSessionEventsRequest.builder()
                        .events(Arrays.asList(userMsg))
                        .build());
        System.out.println(resp);

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
      "content": [
        {"type": "text", "text": "帮我梳理 Q3 目标，并列出交付判据"}
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

	textBlock := sessionmodel.ManagedAgentsMessageContentBlock{
		OneOf: sessionmodel.NewManagedAgentsTextBlockManagedAgentsMessageContentBlockSum(
			sessionmodel.ManagedAgentsTextBlock{Text: "帮我梳理 Q3 目标，并列出交付判据"},
		),
	}
	userMsg := sessionmodel.ManagedAgentsEventParams{
		OneOf: sessionmodel.NewManagedAgentsUserMessageEventParamsManagedAgentsEventParamsSum(
			sessionmodel.ManagedAgentsUserMessageEventParams{
				Content: []sessionmodel.ManagedAgentsMessageContentBlock{textBlock},
			},
		),
	}
	resp, err := client.SendSessionEvents(ctx, "<SESSION_ID>", &sessionmodel.SendSessionEventsRequest{
		Events: []sessionmodel.ManagedAgentsEventParams{userMsg},
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
      "content": [
        {"type": "text", "text": "帮我梳理 Q3 目标，并列出交付判据"}
      ]
    }
  ]
}
```
