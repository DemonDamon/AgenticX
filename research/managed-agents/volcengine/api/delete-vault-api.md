---
source: https://ark.volcengine.com/region:cn-beijing/docs/delete-vault-api
fetched: 2026-10-24
title: 删除保管库
---

# 删除保管库

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`DELETE https://ark.cn-beijing.volces.com/api/v3/vaults/{vault_id}`

删除指定保管库及其中的全部凭证。

> **警告**
>
> 删除保管库会同时删除其中的全部凭证。
>
> 删除后无法恢复保管库或凭证，后续运行也无法再使用这些凭证。
>
> 删除前，确认业务不再使用该保管库。

保管库仍被 `running` 状态的 Session 引用时，返回 HTTP 409 `Conflict`。请先中断相关 Session 并等待其不再处于 `running` 状态，或等待本轮对话运行结束后重试。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**vault_id** `string` `必选` | 保管库 ID

保管库 ID，以 `vlt-` 开头。

## 响应参数

**id** `string` | 保管库 ID

已删除的保管库 ID，以 `vlt-` 开头，与路径参数中的值相同。

**type** `string` | 对象类型

表示当前对象是一个已删除的保管库记录。

取值固定为 `vault_deleted`。


## 代码示例

## 删除保管库

### cURL


#### Request

```Bash
curl -sS --fail-with-body -X DELETE "https://ark.cn-beijing.volces.com/api/v3/vaults/<VAULT_ID>" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

#### Response

```
{
  "id": "vlt-example",
  "type": "vault_deleted"
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

response = client.vaults.delete("<VAULT_ID>")
print(response)
```

#### Response

```
{
  "id": "vlt-example",
  "type": "vault_deleted"
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

        Object response = service.deleteVault("<VAULT_ID>");
        System.out.println(response);

        service.shutdownExecutor();
    }
}
```

#### Response

```
{
  "id": "vlt-example",
  "type": "vault_deleted"
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

	response, err := client.DeleteVault(ctx, "<VAULT_ID>")
	if err != nil {
		panic(err)
	}
	fmt.Println(response)
}
```

#### Response

```
{
  "id": "vlt-example",
  "type": "vault_deleted"
}
```
