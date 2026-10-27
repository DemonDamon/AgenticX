---
source: https://ark.volcengine.com/region:cn-beijing/docs/stop-work-api
fetched: 2026-10-24
title: 停止 Work
---

# 停止 Work

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`POST https://ark.cn-beijing.volces.com/api/v3/environments/{environment_id}/work/{work_id}/stop`

请求停止指定 Work。`force` 取值决定停止方式：

- `false`：服务端先将 Work 状态更新为 `stopping`，让 Worker 在约 60 秒内停止当前任务；等待结束后，Work 状态变为 `stopped`。
- `true`：服务端不等待 Worker 结束任务，直接将 Work 状态更新为 `stopped`。

本接口支持幂等调用。重复停止不会重置已记录的停止状态和时间，接口返回该 Work 的最新状态。

Work 仍处于 `stopping` 时，可以再次传入 `force=true` 立即停止。

正在执行的 Worker 会在后续心跳响应中看到 `state` 为 `stopping` 或 `stopped`，且 `lease_extended` 为 `false`。

收到该结果后，应终止当前任务进程，并释放该任务占用的本地资源。

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

要停止的 Work 唯一标识，取自拉取 Work 接口响应中的 `id`，以 `sesn-` 开头。

### Body 参数

**force** `boolean` `默认值 false` | 是否强制停止

是否要求服务端立即停止 Work。`false` 表示先进入 `stopping`，约 60 秒后停止；`true` 表示立即进入 `stopped`。

## 响应参数

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

Work 当前状态。`stopping` 表示停止请求处理中；`stopped` 表示已停止。

**type** `string` | 对象类型

类型标识，固定为 `work`。

**updated_at** `string` | 更新时间

Work 最近一次状态迁移的时间，格式为 RFC 3339。

**acknowledged_at** `string` | 认领时间

Work 被 Worker 成功认领的时间，格式为 RFC 3339；尚未认领时不返回该字段。

**latest_heartbeat_at** `string` | 最近心跳时间

服务端最近一次接受 Work 心跳的时间，格式为 RFC 3339；尚未收到心跳时不返回该字段。

**started_at** `string` | 开始时间

Work 开始执行的时间，格式为 RFC 3339；尚未开始执行时不返回该字段。

**stop_requested_at** `string` | 停止请求时间

第一次停止请求的时间，格式为 RFC 3339。重复调用不会覆盖该值。

**stopped_at** `string` | 停止时间

Work 进入 `stopped` 状态的时间，格式为 RFC 3339。`force` 为 `true` 时立即返回；`force` 为 `false` 的首次响应不返回该字段，Work 停止后再次查询时返回。

**tags** `object[]` | 资源标签

与当前 Work 关联的资源标签列表。

**key** `string` | 标签键

`tags.key`

资源标签的键，用于标识当前 Work 关联的标签。

**value** `string` | 标签值

`tags.value`

资源标签的值，用于描述当前 Work 在该标签键下的取值；未设置值时不返回该字段。


## 代码示例

## 停止 Work

### cURL


#### Request

```bash
curl -sS --fail-with-body \
  "https://ark.cn-beijing.volces.com/api/v3/environments/<ENVIRONMENT_ID>/work/<WORK_ID>/stop" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"force": false}'
```

#### Response

```
{
  "id": "<WORK_ID>",
  "environment_id": "<ENVIRONMENT_ID>",
  "state": "stopping",
  "type": "work",
  "data": {
    "id": "<SESSION_ID>",
    "type": "session"
  },
  "created_at": "2026-10-19T08:30:00Z",
  "updated_at": "2026-10-19T08:31:00Z",
  "acknowledged_at": "2026-10-19T08:30:02Z",
  "started_at": "2026-10-19T08:30:05Z",
  "latest_heartbeat_at": "2026-10-19T08:30:35Z",
  "stop_requested_at": "2026-10-19T08:31:00Z"
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

work = client.environments.work.stop(
    "<ENVIRONMENT_ID>",
    "<WORK_ID>",
    force=False,
)
print(work)
```

#### Response

```
{
  "id": "<WORK_ID>",
  "environment_id": "<ENVIRONMENT_ID>",
  "state": "stopping",
  "type": "work",
  "data": {
    "id": "<SESSION_ID>",
    "type": "session"
  },
  "created_at": "2026-10-19T08:30:00Z",
  "updated_at": "2026-10-19T08:31:00Z",
  "acknowledged_at": "2026-10-19T08:30:02Z",
  "started_at": "2026-10-19T08:30:05Z",
  "latest_heartbeat_at": "2026-10-19T08:30:35Z",
  "stop_requested_at": "2026-10-19T08:31:00Z"
}
```

### Java


#### Request

```java
import com.volcengine.ark.runtime.models.environment.StopWorkBody;
import com.volcengine.ark.runtime.models.environment.WorkItem;
import com.volcengine.ark.runtime.service.ArkService;

public class Main {
    public static void main(String[] args) throws Exception {
        ArkService service = ArkService.builder()
                .apiKey(System.getenv("ARK_API_KEY"))
                .baseUrl("https://ark.cn-beijing.volces.com/api/v3")
                .build();

        WorkItem work = service.stopEnvironmentWork(
                "<ENVIRONMENT_ID>",
                "<WORK_ID>",
                StopWorkBody.builder().force(false).build());
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
  "state": "stopping",
  "type": "work",
  "data": {
    "id": "<SESSION_ID>",
    "type": "session"
  },
  "created_at": "2026-10-19T08:30:00Z",
  "updated_at": "2026-10-19T08:31:00Z",
  "acknowledged_at": "2026-10-19T08:30:02Z",
  "started_at": "2026-10-19T08:30:05Z",
  "latest_heartbeat_at": "2026-10-19T08:30:35Z",
  "stop_requested_at": "2026-10-19T08:31:00Z"
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

	err := client.StopWork(ctx, &environment.StopWorkRequest{
		EnvironmentID: "<ENVIRONMENT_ID>",
		WorkID:        "<WORK_ID>",
		Force:         environment.NewOptBool(false),
	})
	if err != nil {
		panic(err)
	}
	fmt.Println("Stop requested.")
}
```

#### Response

```
{
  "id": "<WORK_ID>",
  "environment_id": "<ENVIRONMENT_ID>",
  "state": "stopping",
  "type": "work",
  "data": {
    "id": "<SESSION_ID>",
    "type": "session"
  },
  "created_at": "2026-10-19T08:30:00Z",
  "updated_at": "2026-10-19T08:31:00Z",
  "acknowledged_at": "2026-10-19T08:30:02Z",
  "started_at": "2026-10-19T08:30:05Z",
  "latest_heartbeat_at": "2026-10-19T08:30:35Z",
  "stop_requested_at": "2026-10-19T08:31:00Z"
}
```
