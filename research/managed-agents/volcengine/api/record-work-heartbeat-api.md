---
source: https://ark.volcengine.com/region:cn-beijing/docs/record-work-heartbeat-api
fetched: 2026-10-24
title: 续租 Work
---

# 续租 Work

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`POST https://ark.cn-beijing.volces.com/api/v3/environments/{environment_id}/work/{work_id}/heartbeat`

执行 Work 期间，Worker 应每 30～60 秒调用本接口续租。

认领后的第一次心跳会将 Work 状态从 `starting` 更新为 `active`。

后续请求应将上一次响应的 `last_heartbeat` 原样传入 `expected_last_heartbeat`。

多个 Worker 同时为同一 Work 续租，或 `expected_last_heartbeat` 不是最近一次返回值时，服务端返回 HTTP 412 `PreconditionFailed`。

收到该错误后，应先查询 Work 的最新状态。

确认仍由当前 Worker 执行后，再发送心跳。

若心跳中断，Work 会在最近一次成功心跳的租约到期并经过 60 秒宽限期后进入 `stopped`。

若响应的 `lease_extended` 为 `false`，Worker 应停止执行并退出心跳循环。

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

要续租的 Work 唯一标识，取自拉取 Work 接口响应中的 `id`，以 `sesn-` 开头。

### Query 参数

> 在 URL Query String 中传入。

**desired_ttl_seconds** `integer` `默认值 300` | 期望租约 TTL

Worker 期望本次续租采用的租约 TTL，单位为秒。

> **说明**
>
> 传入正数时使用请求值；省略或传入非正数时，服务端按 300 秒处理。

**expected_last_heartbeat** `string` | 乐观并发校验值

用于防止多个 Worker 同时续租同一 Work。第一次心跳可省略，也可传 `NO_HEARTBEAT`；后续请求必须原样传入上一次响应的 `last_heartbeat`。默认值：`NO_HEARTBEAT`

## 响应参数

**last_heartbeat** `string` | 最近心跳时间

服务端记录的本次心跳时间，格式为 RFC 3339。发送下一次心跳时，将该值原样传入 `expected_last_heartbeat`。

**lease_extended** `boolean` | 租约是否续上

本次心跳是否延长 Work 租约：`true` 表示已延长；`false` 表示 Work 正在停止或已经停止，租约未延长。是否继续执行需结合 `state` 判断。

**state** `string` | 当前状态

Work 当前状态。可选值：`queued`、`active`、`stopping`、`stopped`。

> **说明**
>
> - `queued`：Work 仍处于待认领状态，应先调用认领 Work 接口，不应开始执行。
> - `active`：Work 正在执行，可以继续发送心跳。
> - `stopping`：已收到停止请求，应停止当前任务。
> - `stopped`：Work 已停止，不应继续执行或发送心跳。

**ttl_seconds** `integer` | 实际生效 TTL

服务端为当前 Work 记录的租约 TTL，单位为秒。

**type** `string` | 对象类型

类型标识，固定为 `work_heartbeat`。


## 代码示例

## 续租 Work

### cURL


#### Request

```bash
curl -sS --fail-with-body -X POST \
  "https://ark.cn-beijing.volces.com/api/v3/environments/<ENVIRONMENT_ID>/work/<WORK_ID>/heartbeat?desired_ttl_seconds=300&expected_last_heartbeat=NO_HEARTBEAT" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

#### Response

```
{
  "last_heartbeat": "2026-10-19T08:30:35Z",
  "lease_extended": true,
  "state": "active",
  "ttl_seconds": 300,
  "type": "work_heartbeat"
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

work = client.environments.work.heartbeat(
    "<ENVIRONMENT_ID>",
    "<WORK_ID>",
    desired_ttl_seconds=300,
    expected_last_heartbeat="NO_HEARTBEAT",
)
print(work)
```

#### Response

```
{
  "last_heartbeat": "2026-10-19T08:30:35Z",
  "lease_extended": true,
  "state": "active",
  "ttl_seconds": 300,
  "type": "work_heartbeat"
}
```

### Java


#### Request

```java
import com.volcengine.ark.runtime.models.environment.HeartbeatWorkResponse;
import com.volcengine.ark.runtime.service.ArkService;

public class Main {
    public static void main(String[] args) throws Exception {
        ArkService service = ArkService.builder()
                .apiKey(System.getenv("ARK_API_KEY"))
                .baseUrl("https://ark.cn-beijing.volces.com/api/v3")
                .build();

        HeartbeatWorkResponse work = service.heartbeatEnvironmentWork(
                "<ENVIRONMENT_ID>",
                "<WORK_ID>",
                "NO_HEARTBEAT",
                300);
        System.out.println(work);

        service.shutdownExecutor();
    }
}
```

#### Response

```
{
  "last_heartbeat": "2026-10-19T08:30:35Z",
  "lease_extended": true,
  "state": "active",
  "ttl_seconds": 300,
  "type": "work_heartbeat"
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

	work, err := client.HeartbeatWork(ctx, &environment.HeartbeatWorkRequest{
		EnvironmentID:         "<ENVIRONMENT_ID>",
		WorkID:                "<WORK_ID>",
		DesiredTTLSeconds:     environment.NewOptInt64(300),
		ExpectedLastHeartbeat: environment.NewOptString("NO_HEARTBEAT"),
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
  "last_heartbeat": "2026-10-19T08:30:35Z",
  "lease_extended": true,
  "state": "active",
  "ttl_seconds": 300,
  "type": "work_heartbeat"
}
```
