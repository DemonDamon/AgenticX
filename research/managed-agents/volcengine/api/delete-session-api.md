---
source: https://ark.volcengine.com/region:cn-beijing/docs/delete-session-api
fetched: 2026-10-24
title: 删除会话
---

# 删除会话

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`DELETE https://ark.cn-beijing.volces.com/api/v3/sessions/{session_id}`

永久删除不再需要的会话并释放其活跃会话占用。删除成功后，该会话将无法再通过 [查询会话详情](get-session-api.md) 或 [查询会话列表](list-sessions-api.md) 访问。相关运行资源可能继续在后台回收，无需轮询删除状态。

删除会话前，请根据会话状态处理：

- `idle` 或 `terminated`：可以直接删除。
- `running`：先发送 `user.interrupt`，等待状态恢复为 `idle` 后再删除。
- 其他状态：等待当前操作完成并恢复为 `idle` 后再删除。

如需中断当前任务但保留会话，请发送 `user.interrupt`，不要删除会话。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**session_id** `string` `必选` | 会话 ID

要删除的会话 ID，格式为 `sesn-` 开头的字符串。

## 响应参数

**id** `string` | 会话 ID

被删除的会话 ID。

**type** `string` | 对象类型

对象类型，固定为 `session_deleted`。


## 代码示例

## 删除会话

### cURL


#### Request

```Bash
curl -sS --fail-with-body -X DELETE "https://ark.cn-beijing.volces.com/api/v3/sessions/<SESSION_ID>" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

#### Response

```
{
  "id": "<SESSION_ID>",
  "type": "session_deleted"
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

response = client.sessions.delete("<SESSION_ID>")
print(response)
```

#### Response

```
{
  "id": "<SESSION_ID>",
  "type": "session_deleted"
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

        Object response = service.deleteSession("<SESSION_ID>");
        System.out.println(response);

        service.shutdownExecutor();
    }
}
```

#### Response

```
{
  "id": "<SESSION_ID>",
  "type": "session_deleted"
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

	response, err := client.DeleteSession(ctx, "<SESSION_ID>")
	if err != nil {
		panic(err)
	}
	fmt.Println(response)
}
```

#### Response

```
{
  "id": "<SESSION_ID>",
  "type": "session_deleted"
}
```
