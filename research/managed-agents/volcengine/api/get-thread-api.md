---
source: https://ark.volcengine.com/region:cn-beijing/docs/get-thread-api
fetched: 2026-10-24
title: 查询线程详情
---

# 查询线程详情

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`GET https://ark.cn-beijing.volces.com/api/v3/sessions/{session_id}/threads/{thread_id}`

查询指定线程的当前状态、关联智能体和主子关系。已知 `thread_id` 时使用本接口。

查看全部线程请使用 [查询线程列表](list-threads-api.md)；排查执行过程请使用 [获取线程事件列表](list-thread-events-api.md)。

> **说明**
>
> 线程信息是根据会话执行事件形成的当前视图：
>
> - `created_at` 表示首次观察到该线程的时间。
> - `updated_at` 表示最近一次状态变化时间。

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

线程 ID，形如 `sthr-...`

## 响应参数

**agent_name** `string` | 智能体名称

线程关联的智能体名称

**created_at** `string` | 创建时间

首次观察到该线程的时间，采用 RFC 3339 格式。

**id** `string` | 线程 ID

线程唯一标识符，形如 `sthr-...`

**parent_thread_id** `string / null` | 父线程 ID

子线程的父线程 ID；主线程返回 `null`。

**session_id** `string` | 会话 ID

所属会话 ID，形如 `sesn-...`

**status** `string` | 线程状态

线程状态：
- `running` 智能体正在处理
- `idle` 空闲（等待用户输入或工具结果）
- `rescheduling` 调度中
- `terminated` 已终止

**type** `string` | 对象类型

对象类型，固定为 `session_thread`

**updated_at** `string` | 更新时间

最近一次线程状态变化的时间，采用 RFC 3339 格式。


## 代码示例

## 查询会话线程详情

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/sessions/<SESSION_ID>/threads/<THREAD_ID>" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

#### Response

```
{
  "id": "<THREAD_ID>",
  "session_id": "<SESSION_ID>",
  "status": "idle",
  "agent_name": "<AGENT_NAME>",
  "parent_thread_id": null,
  "created_at": "2026-07-15T08:30:14.900Z",
  "updated_at": "2026-07-15T08:30:19.220Z",
  "type": "session_thread"
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

thread = client.sessions.threads.retrieve("<SESSION_ID>", "<THREAD_ID>")
print(thread)
```

#### Response

```
{
  "id": "<THREAD_ID>",
  "session_id": "<SESSION_ID>",
  "status": "idle",
  "agent_name": "<AGENT_NAME>",
  "parent_thread_id": null,
  "created_at": "2026-07-15T08:30:14.900Z",
  "updated_at": "2026-07-15T08:30:19.220Z",
  "type": "session_thread"
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
import com.volcengine.ark.runtime.models.session.SessionThread;
import com.volcengine.ark.runtime.service.ArkService;

public class Main {
    public static void main(String[] args) throws Exception {
        ArkService service = ArkService.builder()
                .apiKey(System.getenv("ARK_API_KEY"))
                .baseUrl("https://ark.cn-beijing.volces.com/api/v3")
                .build();

        SessionThread thread = service.getSessionThread("<SESSION_ID>", "<THREAD_ID>");
        System.out.println(thread);

        service.shutdownExecutor();
    }
}
```

#### Response

```
{
  "id": "<THREAD_ID>",
  "session_id": "<SESSION_ID>",
  "status": "idle",
  "agent_name": "<AGENT_NAME>",
  "parent_thread_id": null,
  "created_at": "2026-07-15T08:30:14.900Z",
  "updated_at": "2026-07-15T08:30:19.220Z",
  "type": "session_thread"
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
)

func main() {
	ctx := context.Background()
    client := arkruntime.NewClientWithApiKey(
		os.Getenv("ARK_API_KEY"),
        arkruntime.WithBaseUrl("https://ark.cn-beijing.volces.com/api/v3"),
	)

	t, err := client.GetSessionThread(ctx, "<SESSION_ID>", "<THREAD_ID>")
	if err != nil {
		panic(err)
	}
	fmt.Println(t)
}
```

#### Response

```
{
  "id": "<THREAD_ID>",
  "session_id": "<SESSION_ID>",
  "status": "idle",
  "agent_name": "<AGENT_NAME>",
  "parent_thread_id": null,
  "created_at": "2026-07-15T08:30:14.900Z",
  "updated_at": "2026-07-15T08:30:19.220Z",
  "type": "session_thread"
}
```
