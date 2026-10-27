---
source: https://ark.volcengine.com/region:cn-beijing/docs/create-vault-api
fetched: 2026-10-24
title: 创建保管库
---

# 创建保管库

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`POST https://ark.cn-beijing.volces.com/api/v3/vaults`

创建保管库，用于集中管理 Session 运行时需要使用的凭证。保管库本身不存储密文，密文保存在其中的各条凭证内。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Body 参数

**display_name** `string` `必选` | 保管库展示名

保管库的展示名称，用于在保管库列表和详情中识别该保管库。

**metadata** `object` | 自定义元数据

用于分类或关联业务信息的字符串键值对。最多 16 对；键长度为 1～64 个字符，值最长 512 个字符。

> **说明**
>
> 用户级凭证场景推荐使用 `external_user_id` 键存储客户产品侧的用户唯一标识，用于将保管库与终端用户建立映射。例如 `{"external_user_id": "usr_abc123"}`。

**scene** `string` `默认值 default` | 保管库场景

用于标记保管库的使用场景。

* `default`：普通业务场景。
* `dreams`：记忆整理场景。

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

**scene** `string` | 保管库场景

保管库的使用场景。

* `default`：普通业务场景。
* `dreams`：记忆整理场景。


## 代码示例

## 创建保管库

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/vaults" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d @- <<'EOF'
{
  "display_name": "Agent Infra · 生产凭证",
  "metadata": {
    "team": "agent-infra",
    "env": "prod"
  }
}
EOF
```

#### Response

```
{
  "id": "vlt-01hx3z9r0w8n3p5q6s7t8v9x40",
  "type": "vault",
  "display_name": "Agent Infra · 生产凭证",
  "metadata": {
    "team": "agent-infra",
    "env": "prod"
  },
  "created_at": "2026-07-15T08:00:00Z",
  "updated_at": "2026-07-15T08:00:00Z"
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

vault = client.vaults.create(
    display_name="Agent Infra · 生产凭证",
    metadata={"team": "agent-infra", "env": "prod"},
)
print(vault)
```

#### Response

```
{
  "id": "vlt-01hx3z9r0w8n3p5q6s7t8v9x40",
  "type": "vault",
  "display_name": "Agent Infra · 生产凭证",
  "metadata": {
    "team": "agent-infra",
    "env": "prod"
  },
  "created_at": "2026-07-15T08:00:00Z",
  "updated_at": "2026-07-15T08:00:00Z"
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
import com.volcengine.ark.runtime.models.vault.CreateVaultRequest;
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
        metadata.put("team", "agent-infra");
        metadata.put("env", "prod");
        Vault vault = service.createVault(
                CreateVaultRequest.builder()
                        .displayName("Agent Infra · 生产凭证")
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
  "id": "vlt-01hx3z9r0w8n3p5q6s7t8v9x40",
  "type": "vault",
  "display_name": "Agent Infra · 生产凭证",
  "metadata": {
    "team": "agent-infra",
    "env": "prod"
  },
  "created_at": "2026-07-15T08:00:00Z",
  "updated_at": "2026-07-15T08:00:00Z"
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

	vault, err := client.CreateVault(ctx, &vaultmodel.CreateVaultRequest{
		DisplayName: "Agent Infra · 生产凭证",
		Metadata: vaultmodel.NewOptCreateVaultRequestMetadata(vaultmodel.CreateVaultRequestMetadata{
			"team": "agent-infra",
			"env":  "prod",
		}),
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
  "id": "vlt-01hx3z9r0w8n3p5q6s7t8v9x40",
  "type": "vault",
  "display_name": "Agent Infra · 生产凭证",
  "metadata": {
    "team": "agent-infra",
    "env": "prod"
  },
  "created_at": "2026-07-15T08:00:00Z",
  "updated_at": "2026-07-15T08:00:00Z"
}
```
