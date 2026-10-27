---
source: https://ark.volcengine.com/region:cn-beijing/docs/delete-agent-api
fetched: 2026-10-24
title: 删除智能体
---

# 删除智能体

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`DELETE https://ark.cn-beijing.volces.com/api/v3/agents/{agent_id}`

删除指定的智能体。删除后，无法再通过 API 查询或恢复该智能体及其历史版本。

* 存在 `running` 状态的会话时，删除请求返回 400 `InvalidAction`；其他状态的会话不阻止删除。
* 重复删除、智能体不存在或调用方无权访问时，返回 404 `InvalidAgent`。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**agent_id** `string` `必选` | 智能体 ID

要删除的智能体 ID，以 `agent-` 开头。该 ID 可通过创建智能体接口返回，或在控制台智能体列表页面获取。

## 响应参数

**id** `string` | 智能体 ID

被删除的智能体 ID，以 `agent-` 开头，与请求中的 `agent_id` 相同。


## 代码示例

## 删除智能体

### cURL


#### Request

```Bash
curl -sS --fail-with-body -X DELETE "https://ark.cn-beijing.volces.com/api/v3/agents/<AGENT_ID>" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

#### Response

```
{
  "id": "<AGENT_ID>"
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

response = client.agents.delete("<AGENT_ID>")
print(response)
```

#### Response

```
{
  "id": "<AGENT_ID>"
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

        Object response = service.deleteAgent("<AGENT_ID>");
        System.out.println(response);

        service.shutdownExecutor();
    }
}
```

#### Response

```
{
  "id": "<AGENT_ID>"
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

	response, err := client.DeleteAgent(ctx, "<AGENT_ID>")
	if err != nil {
		panic(err)
	}
	fmt.Println(response)
}
```

#### Response

```
{
  "id": "<AGENT_ID>"
}
```
