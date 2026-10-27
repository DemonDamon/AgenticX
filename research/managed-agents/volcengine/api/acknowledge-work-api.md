---
source: https://ark.volcengine.com/region:cn-beijing/docs/acknowledge-work-api
fetched: 2026-10-24
title: 认领 Work
---

# 认领 Work

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`POST https://ark.cn-beijing.volces.com/api/v3/environments/{environment_id}/work/{work_id}/ack`

向服务端确认由当前 Worker 执行拉取 Work 接口返回的 Work。认领成功后，Work 状态从 `queued` 更新为 `starting`，并且不会再分配给其他 Worker。

认领 Work 时，请注意：

- 只有 `queued` 状态的 Work 可以被认领。
- 多个 Worker 并发认领同一个 Work 时，只有一个请求成功。
- 其余请求返回 HTTP 409 `Conflict`，错误消息包含当前状态。收到 409 后不要执行该 Work，应继续轮询其他 Work。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**environment_id** `string` `必选` | 环境 ID

要操作的 Environment ID，以 `env-` 开头。填写创建环境或查询环境列表接口取得的 ID。

**work_id** `string` `必选` | Work 标识符

要认领的 Work 唯一标识，取自拉取 Work 接口响应中的 `id`，以 `sesn-` 开头。

### Header 参数

> 在 HTTP 请求头中传入。

**Ark-Worker-ID** `string` | Worker 实例 ID

执行该 Work 的 Worker 实例 ID。建议传入拉取 Work 时使用的实例 ID。省略或传空字符串时，服务端按匿名 Worker 处理认领请求。

## 响应参数

**acknowledged_at** `string` | 认领时间

本次成功认领 Work 的时间，格式为 RFC 3339。

**created_at** `string` | 创建时间

服务端创建 Work 时记录的时间，格式为 RFC 3339。

**data** `object` | 工作载荷

Work 对应的 Session 信息。

**id** `string` | Session ID

`data.id`

Work 对应的 Session ID，可用于调用 Session 相关接口。

**type** `string` | 载荷类型

`data.type`

当前固定为 `session`，表示 `data.id` 指向一个 Session。

**environment_id** `string` | 环境 ID

Work 所属的环境 ID，以 `env-` 开头。

**id** `string` | Work 标识符

Work ID，以 `sesn-` 开头。

**state** `string` | 当前状态

认领成功后的 Work 状态，固定为 `starting`。

**type** `string` | 对象类型

类型标识，固定为 `work`。

**updated_at** `string` | 更新时间

Work 最近一次状态迁移的时间，格式为 RFC 3339。

**latest_heartbeat_at** `string` | 最近心跳时间

服务端最近一次接受 Work 心跳的时间，格式为 RFC 3339；尚未收到心跳时不返回该字段。

**started_at** `string` | 开始时间

Work 开始执行的时间，格式为 RFC 3339；尚未开始执行时不返回该字段。

**stop_requested_at** `string` | 停止请求时间

服务端首次处理停止 Work 请求的时间，格式为 RFC 3339。未调用停止 Work 接口，或 Work 因心跳租约超时停止时，不返回该字段。

**stopped_at** `string` | 停止时间

Work 进入 `stopped` 状态的时间，格式为 RFC 3339；尚未停止时不返回该字段。

**tags** `object[]` | 资源标签

与当前 Work 关联的资源标签列表。

**key** `string` | 标签键

`tags.key`

资源标签的键，用于标识当前 Work 关联的标签。

**value** `string` | 标签值

`tags.value`

资源标签的值，用于描述当前 Work 在该标签键下的取值；未设置值时不返回该字段。


## 代码示例

## 认领 Work

### cURL


#### Request

```bash
curl -sS --fail-with-body -X POST \
  "https://ark.cn-beijing.volces.com/api/v3/environments/<ENVIRONMENT_ID>/work/<WORK_ID>/ack" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Ark-Worker-ID: worker-01"
```

#### Response

```
{
  "id": "<WORK_ID>",
  "environment_id": "<ENVIRONMENT_ID>",
  "state": "starting",
  "type": "work",
  "data": {
    "id": "<SESSION_ID>",
    "type": "session"
  },
  "created_at": "2026-10-19T08:30:00Z",
  "updated_at": "2026-10-19T08:30:02Z",
  "acknowledged_at": "2026-10-19T08:30:02Z"
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

work = client.environments.work.ack(
    "<ENVIRONMENT_ID>",
    "<WORK_ID>",
    worker_id="worker-01",
)
print(work)
```

#### Response

```
{
  "id": "<WORK_ID>",
  "environment_id": "<ENVIRONMENT_ID>",
  "state": "starting",
  "type": "work",
  "data": {
    "id": "<SESSION_ID>",
    "type": "session"
  },
  "created_at": "2026-10-19T08:30:00Z",
  "updated_at": "2026-10-19T08:30:02Z",
  "acknowledged_at": "2026-10-19T08:30:02Z"
}
```

### Java


#### Request

```java
import com.volcengine.ark.runtime.models.environment.WorkItem;
import com.volcengine.ark.runtime.service.ArkService;

public class Main {
    public static void main(String[] args) throws Exception {
        ArkService service = ArkService.builder()
                .apiKey(System.getenv("ARK_API_KEY"))
                .baseUrl("https://ark.cn-beijing.volces.com/api/v3")
                .build();

        WorkItem work = service.ackEnvironmentWork(
                "<ENVIRONMENT_ID>", "<WORK_ID>", "worker-01");
        System.out.println(work);

        service.shutdownExecutor();
    }
}
```

#### Response

```
{
  "id": "<WORK_ID>",
  "environment_id": "<ENVIRONMENT_ID>",
  "state": "starting",
  "type": "work",
  "data": {
    "id": "<SESSION_ID>",
    "type": "session"
  },
  "created_at": "2026-10-19T08:30:00Z",
  "updated_at": "2026-10-19T08:30:02Z",
  "acknowledged_at": "2026-10-19T08:30:02Z"
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
	"github.com/volcengine/ark-runtime-go/arkruntime/model/environment"
)

func main() {
	ctx := context.Background()
	client := arkruntime.NewClientWithApiKey(
		os.Getenv("ARK_API_KEY"),
		arkruntime.WithBaseUrl("https://ark.cn-beijing.volces.com/api/v3"),
	)

	err := client.AckWork(ctx, &environment.AckWorkRequest{
		EnvironmentID: "<ENVIRONMENT_ID>",
		WorkID:        "<WORK_ID>",
		WorkerID:      environment.NewOptString("worker-01"),
	})
	if err != nil {
		panic(err)
	}
	fmt.Println("Work acknowledged.")
}
```

#### Response

```
{
  "id": "<WORK_ID>",
  "environment_id": "<ENVIRONMENT_ID>",
  "state": "starting",
  "type": "work",
  "data": {
    "id": "<SESSION_ID>",
    "type": "session"
  },
  "created_at": "2026-10-19T08:30:00Z",
  "updated_at": "2026-10-19T08:30:02Z",
  "acknowledged_at": "2026-10-19T08:30:02Z"
}
```
