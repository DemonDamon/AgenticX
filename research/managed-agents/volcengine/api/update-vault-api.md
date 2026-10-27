---
source: https://ark.volcengine.com/region:cn-beijing/docs/update-vault-api
fetched: 2026-10-24
title: 更新保管库
---

# 更新保管库

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`POST https://ark.cn-beijing.volces.com/api/v3/vaults/{vault_id}`

更新指定保管库的展示名称或自定义元数据。请求体为空，或者只传入空的 `metadata` 对象时，服务端返回当前保管库信息，不修改数据或更新时间。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**vault_id** `string` `必选` | 保管库 ID

保管库 ID，以 `vlt-` 开头。

### Body 参数

**display_name** `string` | 保管库展示名

保管库的展示名称，用于在保管库列表和详情中识别该保管库。省略时保留原值。

**metadata** `object` | 自定义元数据

用于分类或关联业务信息的字符串键值对：

* 省略或传入空对象时，保留全部原值。
* 提供非空值时，新增或覆盖对应键。
* 值为空字符串时，删除对应键。

更新后最多 16 对；键长度为 1～64 个字符，值最长 512 个字符。

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

## 更新保管库

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/vaults/<VAULT_ID>" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d @- <<'EOF'
{
  "display_name": "Agent Infra · 生产凭证 (2026H2)",
  "metadata": {
    "env": "prod",
    "review_cycle": "2026H2"
  }
}
EOF
```

#### Response

```
{
  "id": "<VAULT_ID>",
  "type": "vault",
  "display_name": "Agent Infra · 生产凭证 (2026H2)",
  "metadata": {
    "team": "agent-infra",
    "env": "prod",
    "review_cycle": "2026H2"
  },
  "created_at": "2026-07-15T08:00:00Z",
  "updated_at": "2026-07-15T10:00:00Z"
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

vault = client.vaults.update(
    "<VAULT_ID>",
    display_name="Agent Infra · 生产凭证 (2026H2)",
    metadata={"env": "prod", "review_cycle": "2026H2"},
)
print(vault)
```

#### Response

```
{
  "id": "<VAULT_ID>",
  "type": "vault",
  "display_name": "Agent Infra · 生产凭证 (2026H2)",
  "metadata": {
    "team": "agent-infra",
    "env": "prod",
    "review_cycle": "2026H2"
  },
  "created_at": "2026-07-15T08:00:00Z",
  "updated_at": "2026-07-15T10:00:00Z"
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
import com.volcengine.ark.runtime.models.vault.UpdateVaultRequest;
import com.volcengine.ark.runtime.models.vault.Vault;
import com.volcengine.ark.runtime.service.ArkService;
import java.util.HashMap;
import java.util.Map;

public class Main {
    public static void main(String[] args) throws Exception {
        ArkService service = ArkService.builder()
                .apiKey(System.getenv("ARK_API_KEY"))
                .baseUrl("https://ark.cn-beijing.volces.com/api/v3")
                .build();

        Map<String, String> metadata = new HashMap<>();
        metadata.put("env", "prod");
        metadata.put("review_cycle", "2026H2");
        Vault vault = service.updateVault(
                "<VAULT_ID>",
                UpdateVaultRequest.builder()
                        .displayName("Agent Infra · 生产凭证 (2026H2)")
                        .metadata(metadata)
                        .build());
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
  "display_name": "Agent Infra · 生产凭证 (2026H2)",
  "metadata": {
    "team": "agent-infra",
    "env": "prod",
    "review_cycle": "2026H2"
  },
  "created_at": "2026-07-15T08:00:00Z",
  "updated_at": "2026-07-15T10:00:00Z"
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
	vaultmodel "github.com/volcengine/ark-runtime-go/arkruntime/model/vault"
)

func main() {
	ctx := context.Background()
    client := arkruntime.NewClientWithApiKey(
		os.Getenv("ARK_API_KEY"),
        arkruntime.WithBaseUrl("https://ark.cn-beijing.volces.com/api/v3"),
	)

	vault, err := client.UpdateVault(ctx, "<VAULT_ID>", &vaultmodel.UpdateVaultRequest{
		DisplayName: vaultmodel.NewOptString("Agent Infra · 生产凭证 (2026H2)"),
		Metadata: vaultmodel.NewOptUpdateVaultRequestMetadata(
			vaultmodel.UpdateVaultRequestMetadata{
				"env":          "prod",
				"review_cycle": "2026H2",
			},
		),
	})
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
  "display_name": "Agent Infra · 生产凭证 (2026H2)",
  "metadata": {
    "team": "agent-infra",
    "env": "prod",
    "review_cycle": "2026H2"
  },
  "created_at": "2026-07-15T08:00:00Z",
  "updated_at": "2026-07-15T10:00:00Z"
}
```
