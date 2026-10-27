---
source: https://ark.volcengine.com/region:cn-beijing/docs/delete-credential-api
fetched: 2026-10-24
title: 删除凭证
---

# 删除凭证

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`DELETE https://ark.cn-beijing.volces.com/api/v3/vaults/{vault_id}/credentials/{credential_id}`

删除指定凭证。

> **警告**
>
> 删除后无法恢复或读取该凭证。后续运行也无法再使用该凭证访问 MCP 服务或注入环境变量。删除前请确认业务不再使用该凭证。

如果首次删除请求超时，可以使用相同的凭证 ID 重试。

在鉴权信息和项目均未改变的情况下，重试返回 404 `InvalidCredential.NotFound` 表示该凭证已不存在，此时停止重试。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**credential_id** `string` `必选` | 凭证 ID

凭证 ID，以 `vcrd-` 开头。

**vault_id** `string` `必选` | 保管库 ID

保管库 ID，以 `vlt-` 开头。

## 响应参数

**id** `string` | 凭证 ID

已删除的凭证 ID，以 `vcrd-` 开头，与路径参数中的值相同。

**type** `string` | 对象类型

表示当前对象是一条已删除的凭证记录。

取值固定为 `vault_credential_deleted`。


## 代码示例

## 删除凭证

### cURL


#### Request

```Bash
curl -sS --fail-with-body -X DELETE "https://ark.cn-beijing.volces.com/api/v3/vaults/<VAULT_ID>/credentials/<CRED_ID>" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

#### Response

```
{
  "id": "vcrd-example",
  "type": "vault_credential_deleted"
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

response = client.vaults.credentials.delete("<VAULT_ID>", "<CRED_ID>")
print(response)
```

#### Response

```
{
  "id": "vcrd-example",
  "type": "vault_credential_deleted"
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

        Object response = service.deleteCredential("<VAULT_ID>", "<CRED_ID>");
        System.out.println(response);

        service.shutdownExecutor();
    }
}
```

#### Response

```
{
  "id": "vcrd-example",
  "type": "vault_credential_deleted"
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

	response, err := client.DeleteCredential(ctx, "<VAULT_ID>", "<CRED_ID>")
	if err != nil {
		panic(err)
	}
	fmt.Println(response)
}
```

#### Response

```
{
  "id": "vcrd-example",
  "type": "vault_credential_deleted"
}
```
