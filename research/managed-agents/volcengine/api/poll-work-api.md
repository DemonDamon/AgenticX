---
source: https://ark.volcengine.com/region:cn-beijing/docs/poll-work-api
fetched: 2026-10-24
title: 长轮询拉取待执行 Work
---

# 长轮询拉取待执行 Work

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`GET https://ark.cn-beijing.volces.com/api/v3/environments/{environment_id}/work/poll`

自托管 Worker 按以下顺序处理 Work：

1. 拉取待执行 Work。

2. 调用认领 Work 接口。

3. 执行期间定期续租 Work。

4. 完成或终止任务时停止 Work。

本接口负责长轮询拉取待执行 Work：

- 命中时，返回仍为 `queued` 的 Work。
- 未命中、长轮询到期或请求在等待期间结束时，返回 HTTP 200 和空对象 `{}`。
- 客户端根据响应中是否存在 `id` 判断是否获取到 Work。

拉取到 Work 仅表示临时获取。请立即调用认领 Work 接口。

超过认领超时阈值（`reclaim_older_than_ms`）仍未认领时，该 Work 可被其他 Worker 再次获取。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**environment_id** `string` `必选` | 环境 ID

要操作的 Environment ID，以 `env-` 开头。填写创建环境或查询环境列表接口取得的 ID。

### Query 参数

> 在 URL Query String 中传入。

**block_ms** `integer` `默认值 0` | 长轮询等待时间

没有可分配 Work 时服务端继续等待的最长时间，单位为毫秒；省略或传非正数时不等待，无 Work 则返回 HTTP 200 和空对象 `{}`。取值 1～999，大于 999 按 999 处理。

**reclaim_older_than_ms** `integer` `默认值 5000` | 认领超时阈值

拉取 Work 后等待完成认领的时长，单位为毫秒；超时未认领时，其他 Worker 可再次获取该 Work。

> **说明**
>
> 省略或传入非正数时，服务端按 5000 毫秒计算认领超时。

### Header 参数

> 在 HTTP 请求头中传入。

**Ark-Worker-ID** `string` | Worker 实例 ID

发起本次 Work 拉取请求的 Worker 实例 ID。认领完成前，同一 ID 再次发起请求时，服务端会优先返回此前获取的 Work。

> **说明**
>
> 非空值还用于统计 `workers_polling`。建议每个 Worker 实例使用一个稳定值；省略或传空字符串仍可获取 Work，但重复拉取 Work 不会被识别为同一 Worker，活跃 Worker 数也可能低于实际值。

## 响应参数

**acknowledged_at** `string` | 认领时间

Work 被 Worker 成功认领的时间，格式为 RFC 3339；尚未认领时不返回该字段。

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

**latest_heartbeat_at** `string` | 最近心跳时间

服务端最近一次接受 Work 心跳的时间，格式为 RFC 3339；尚未收到心跳时不返回该字段。

**started_at** `string` | 开始时间

Work 开始执行的时间，格式为 RFC 3339；尚未开始执行时不返回该字段。

**state** `string` | 当前状态

命中 Work 时固定为 `queued`，表示该 Work 正在等待完成认领。

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

**type** `string` | 对象类型

类型标识，固定为 `work`。

**updated_at** `string` | 更新时间

Work 最近一次状态迁移的时间，格式为 RFC 3339。


## 代码示例

## 长轮询拉取待执行 Work

### cURL


#### Request

```bash
curl -sS --fail-with-body \
  "https://ark.cn-beijing.volces.com/api/v3/environments/<ENVIRONMENT_ID>/work/poll?block_ms=999&reclaim_older_than_ms=5000" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Ark-Worker-ID: worker-01"
```

#### Response

```
{
  "id": "<WORK_ID>",
  "environment_id": "<ENVIRONMENT_ID>",
  "state": "queued",
  "type": "work",
  "data": {
    "id": "<SESSION_ID>",
    "type": "session"
  },
  "created_at": "2026-10-19T08:30:00Z",
  "updated_at": "2026-10-19T08:30:00Z"
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

work = client.environments.work.poll(
    "<ENVIRONMENT_ID>",
    worker_id="worker-01",
    block_ms=999,
    reclaim_older_than_ms=5000,
)
print(work)
```

#### Response

```
{
  "id": "<WORK_ID>",
  "environment_id": "<ENVIRONMENT_ID>",
  "state": "queued",
  "type": "work",
  "data": {
    "id": "<SESSION_ID>",
    "type": "session"
  },
  "created_at": "2026-10-19T08:30:00Z",
  "updated_at": "2026-10-19T08:30:00Z"
}
```

### Java


#### Request

```java
import com.volcengine.ark.runtime.models.environment.EnvironmentWorkPoll200Response;
import com.volcengine.ark.runtime.service.ArkService;

public class Main {
    public static void main(String[] args) throws Exception {
        ArkService service = ArkService.builder()
                .apiKey(System.getenv("ARK_API_KEY"))
                .baseUrl("https://ark.cn-beijing.volces.com/api/v3")
                .build();

        EnvironmentWorkPoll200Response work = service.pollEnvironmentWork(
                "<ENVIRONMENT_ID>", "worker-01", 999, 5000);
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
  "state": "queued",
  "type": "work",
  "data": {
    "id": "<SESSION_ID>",
    "type": "session"
  },
  "created_at": "2026-10-19T08:30:00Z",
  "updated_at": "2026-10-19T08:30:00Z"
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

	work, err := client.PollWork(ctx, &environment.PollWorkRequest{
		EnvironmentID:      "<ENVIRONMENT_ID>",
		WorkerID:           "worker-01",
		BlockMS:            999,
		ReclaimOlderThanMS: 5000,
	})
	if err != nil {
		panic(err)
	}
	fmt.Println(work)
}
```

#### Response

```
{
  "id": "<WORK_ID>",
  "environment_id": "<ENVIRONMENT_ID>",
  "state": "queued",
  "type": "work",
  "data": {
    "id": "<SESSION_ID>",
    "type": "session"
  },
  "created_at": "2026-10-19T08:30:00Z",
  "updated_at": "2026-10-19T08:30:00Z"
}
```
