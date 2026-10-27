---
source: https://ark.volcengine.com/region:cn-beijing/docs/list-vaults-api
fetched: 2026-10-24
title: 查询保管库列表
---

# 查询保管库列表

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`GET https://ark.cn-beijing.volces.com/api/v3/vaults`

查询当前项目中的保管库列表，结果按创建时间降序排列。

根据响应中是否包含 `next_page` 判断是否有更多结果：

* 包含 `next_page` 时，将该值原样传入下一次请求的 `page`。
* 不包含 `next_page` 时，表示没有更多结果，停止分页查询。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Query 参数

> 在 URL Query String 中传入。

**limit** `integer` `默认值 20` | 每页数量

每页返回的保管库数量。

**取值范围**：`[1, 100]`

**page** `string` | 下一页标识

用于告诉服务端从上一页结束的位置继续返回数据。该值由服务端生成，不是页码。

首次请求 `GET /api/v3/vaults?limit=20` 时不传 `page`。后续翻页规则如下：

* 响应返回 `"next_page": "<NEXT_PAGE>"` 时，将该值传入下一次请求：`GET /api/v3/vaults?limit=20&page=<NEXT_PAGE>`。
* 响应不包含 `next_page` 时，表示没有更多结果。

不要自行生成或修改该值。

**scene** `string` | 保管库场景

按保管库的使用场景过滤。省略或传空值时不过滤。

* `default`：普通业务场景。
* `dreams`：记忆整理场景。

传入其他值不会报错；没有匹配的场景时返回空列表。

## 响应参数

**data** `object[]` | 保管库列表

查询到的保管库列表。

**created_at** `string` | 创建时间

`data.created_at`

保管库的创建时间，采用 RFC 3339 格式。

**display_name** `string` | 保管库展示名

`data.display_name`

保管库的展示名称，用于识别该保管库。

**id** `string` | 保管库 ID

`data.id`

保管库 ID，以 `vlt-` 开头。

**type** `string` | 对象类型

`data.type`

表示当前对象是一个保管库。

取值固定为 `vault`。

**updated_at** `string` | 更新时间

`data.updated_at`

保管库最后一次更新的时间，采用 RFC 3339 格式。

**metadata** `object` | 自定义元数据

`data.metadata`

为保管库设置的字符串键值对，可用于分类或关联业务信息。未设置时返回 `null`。

**scene** `string` | 保管库场景

`data.scene`

保管库的使用场景。

* `default`：普通业务场景。
* `dreams`：记忆整理场景。

**next_page** `string` | 下一页标识

下一页标识。无更多数据时不返回；后续请求需将该值原样作为 `page` 传入。


## 代码示例

## 查询保管库列表

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/vaults?limit=20" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

#### Response

```
{
  "data": [
    {
      "id": "vlt-01hx3z9r0w8n3p5q6s7t8v9x40",
      "type": "vault",
      "display_name": "Agent Infra · 生产凭证",
      "metadata": {
        "team": "agent-infra",
        "env": "prod"
      },
      "created_at": "2026-07-15T08:00:00Z",
      "updated_at": "2026-07-15T09:00:00Z"
    }
  ],
  "next_page": "page_xxxxxxxx"
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

page = client.vaults.list(limit=20)
print(page)
```

#### Response

```
{
  "data": [
    {
      "id": "vlt-01hx3z9r0w8n3p5q6s7t8v9x40",
      "type": "vault",
      "display_name": "Agent Infra · 生产凭证",
      "metadata": {
        "team": "agent-infra",
        "env": "prod"
      },
      "created_at": "2026-07-15T08:00:00Z",
      "updated_at": "2026-07-15T09:00:00Z"
    }
  ],
  "next_page": "page_xxxxxxxx"
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
import com.volcengine.ark.runtime.models.vault.ListVaultsResponse;
import com.volcengine.ark.runtime.service.ArkService;

public class Main {
    public static void main(String[] args) throws Exception {
        ArkService service = ArkService.builder()
                .apiKey(System.getenv("ARK_API_KEY"))
                .baseUrl("https://ark.cn-beijing.volces.com/api/v3")
                .build();

        ListVaultsResponse page = service.listVaults(20, null);
        System.out.println(page);

        service.shutdownExecutor();
    }
}
```

#### Response

```
{
  "data": [
    {
      "id": "vlt-01hx3z9r0w8n3p5q6s7t8v9x40",
      "type": "vault",
      "display_name": "Agent Infra · 生产凭证",
      "metadata": {
        "team": "agent-infra",
        "env": "prod"
      },
      "created_at": "2026-07-15T08:00:00Z",
      "updated_at": "2026-07-15T09:00:00Z"
    }
  ],
  "next_page": "page_xxxxxxxx"
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

	resp, err := client.ListVaults(ctx, &vaultmodel.VaultsListParams{
		Limit: vaultmodel.NewOptInt32(20),
	})
	if err != nil {
		panic(err)
	}
	fmt.Println(resp)
}
```

#### Response

```
{
  "data": [
    {
      "id": "vlt-01hx3z9r0w8n3p5q6s7t8v9x40",
      "type": "vault",
      "display_name": "Agent Infra · 生产凭证",
      "metadata": {
        "team": "agent-infra",
        "env": "prod"
      },
      "created_at": "2026-07-15T08:00:00Z",
      "updated_at": "2026-07-15T09:00:00Z"
    }
  ],
  "next_page": "page_xxxxxxxx"
}
```
