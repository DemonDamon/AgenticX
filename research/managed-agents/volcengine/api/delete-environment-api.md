---
source: https://ark.volcengine.com/region:cn-beijing/docs/delete-environment-api
fetched: 2026-10-24
title: 删除环境
---

# 删除环境

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`DELETE https://ark.cn-beijing.volces.com/api/v3/environments/{environment_id}`

永久删除当前项目中指定的 Environment。

> **注意：删除条件**
>
> 当 Environment 仍被 `idle` 或 `running` 状态的 Session 使用时，服务端返回 HTTP 400 `InvalidAction`。先结束相关 Session，再删除 Environment。
>
> 删除操作不可撤销。重复删除已不存在的 Environment 会返回 HTTP 404 `InvalidEnvironment.NotFound`；超时重试时，可将该结果视为资源已经删除。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**environment_id** `string` `必选` | 环境 ID

要删除的 Environment ID，以 `env-` 开头。可从创建环境或查询环境列表接口的响应中获取。

## 响应参数

**id** `string` | 环境 ID

已删除的 Environment ID，以 `env-` 开头，与路径参数中的值相同。

**type** `string` | 对象类型

对象类型，固定为 `environment_deleted`。


## 代码示例

## 删除环境

### cURL


#### Request

```Bash
curl -sS --fail-with-body -X DELETE "https://ark.cn-beijing.volces.com/api/v3/environments/<ENVIRONMENT_ID>" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

#### Response

```
{
  "id": "env-example",
  "type": "environment_deleted"
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

response = client.environments.delete("<ENVIRONMENT_ID>")
print(response)
```

#### Response

```
{
  "id": "env-example",
  "type": "environment_deleted"
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
import com.volcengine.ark.runtime.service.ArkService;

public class Main {
    public static void main(String[] args) throws Exception {
        ArkService service = ArkService.builder()
                .apiKey(System.getenv("ARK_API_KEY"))
                .baseUrl("https://ark.cn-beijing.volces.com/api/v3")
                .build();

        Object response = service.deleteEnvironment("<ENVIRONMENT_ID>");
        System.out.println(response);

        service.shutdownExecutor();
    }
}
```

#### Response

```
{
  "id": "env-example",
  "type": "environment_deleted"
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

	response, err := client.DeleteEnvironment(ctx, "<ENVIRONMENT_ID>")
	if err != nil {
		panic(err)
	}
	fmt.Println(response)
}
```

#### Response

```
{
  "id": "env-example",
  "type": "environment_deleted"
}
```
