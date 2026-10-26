---
source: https://ark.volcengine.com/region:cn-beijing/docs/get-vault-api
fetched: 2026-10-24
title: 查询保管库详情
---

# 查询保管库详情

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`GET https://ark.cn-beijing.volces.com/api/v3/vaults/{vault_id}`

查询指定保管库的详细信息。

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

**created_at** `string` | 创建时间

保管库的创建时间，采用 RFC 3339 格式。

**display_name** `string` | 保管库展示名

保管库的展示名称，用于识别该保管库。

**id** `string` | 保管库 ID

保管库 ID，以 `vlt-` 开头。

**type** `string` | 对象类型

表示当前对象是一个保管库。

取值固定为 `vault`。

**updated_at** `string` | 更新时间

保管库最后一次更新的时间，采用 RFC 3339 格式。

**metadata** `object` | 自定义元数据

为保管库设置的字符串键值对，可用于分类或关联业务信息。未设置时返回 `null`。


## 代码示例

## 查询保管库详情

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/vaults/<VAULT_ID>" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

#### Response

```
{
  "id": "<VAULT_ID>",
  "type": "vault",
  "display_name": "Agent Infra · 生产凭证",
  "metadata": {
    "team": "agent-infra",
    "env": "prod"
  },
  "created_at": "2026-07-15T08:00:00Z",
  "updated_at": "2026-07-15T09:00:00Z"
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

vault = client.vaults.retrieve("<VAULT_ID>")
print(vault)
```

#### Response

```
{
  "id": "<VAULT_ID>",
  "type": "vault",
  "display_name": "Agent Infra · 生产凭证",
  "metadata": {
    "team": "agent-infra",
    "env": "prod"
  },
  "created_at": "2026-07-15T08:00:00Z",
  "updated_at": "2026-07-15T09:00:00Z"
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
import com.volcengine.ark.runtime.models.vault.Vault;
import com.volcengine.ark.runtime.service.ArkService;

public class Main {
    public static void main(String[] args) throws Exception {
        ArkService service = ArkService.builder()
                .apiKey(System.getenv("ARK_API_KEY"))
                .baseUrl("https://ark.cn-beijing.volces.com/api/v3")
                .build();

        Vault vault = service.getVault("<VAULT_ID>");
        System.out.println(vault);

        service.shutdownExecutor();
    }
}
```

#### Response

```
{
  "id": "<VAULT_ID>",
  "type": "vault",
  "display_name": "Agent Infra · 生产凭证",
  "metadata": {
    "team": "agent-infra",
    "env": "prod"
  },
  "created_at": "2026-07-15T08:00:00Z",
  "updated_at": "2026-07-15T09:00:00Z"
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

	vault, err := client.GetVault(ctx, "<VAULT_ID>")
	if err != nil {
		panic(err)
	}
	fmt.Println(vault)
}
```

#### Response

```
{
  "id": "<VAULT_ID>",
  "type": "vault",
  "display_name": "Agent Infra · 生产凭证",
  "metadata": {
    "team": "agent-infra",
    "env": "prod"
  },
  "created_at": "2026-07-15T08:00:00Z",
  "updated_at": "2026-07-15T09:00:00Z"
}
```
