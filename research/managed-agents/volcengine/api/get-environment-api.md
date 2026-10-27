---
source: https://ark.volcengine.com/region:cn-beijing/docs/get-environment-api
fetched: 2026-10-24
title: 查询环境详情
---

# 查询环境详情

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`GET https://ark.cn-beijing.volces.com/api/v3/environments/{environment_id}`

查询当前项目中指定 Environment 的详细信息。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**environment_id** `string` `必选` | 环境 ID

要查询的 Environment ID，以 `env-` 开头。可从创建环境或查询环境列表接口的响应中获取。

> **说明**
>
> 本接口仅查询当前 API Key 所属项目中的 Environment。其他项目的 ID 与不存在的 ID 均返回 HTTP 404 `InvalidEnvironment.NotFound`。

## 响应参数

**created_at** `string` | 创建时间

Environment 创建时间，采用 RFC 3339 格式的 UTC 时间。

**id** `string` | 环境 ID

Environment ID，由服务端生成，以 `env-` 开头。

**name** `string` | 环境名称

Environment 的名称。

**type** `string` | 对象类型

对象类型，固定为 `environment`。

**updated_at** `string` | 更新时间

Environment 最后更新时间，采用 RFC 3339 格式的 UTC 时间。

**config** `object` | 环境配置

Environment 当前生效的运行配置。

**type** `string` | 环境类型

`config.type`

Environment 的运行方式。`cloud` 表示由火山方舟提供运行环境，`self_hosted` 表示由调用方提供运行环境。

**env** `object` | 环境变量

`config.env`

Environment 运行时使用的环境变量，以字符串键值对形式返回。

**networking** `object` | 出网策略

`config.networking`

Environment 当前生效的出网配置。对于 `self_hosted` Environment，服务端固定返回 `type` 为 `unrestricted`。

**type** `string` | 出网策略类型

`config.networking.type`

Environment 的出网方式。`unrestricted` 表示不限制出网目标。

**packages** `object` | 依赖包配置

`config.packages`

Environment 启动时预装的依赖包。

**apt** `string[]` | apt 包

`config.packages.apt`

Environment 启动时通过 apt 预装的系统包。

**cargo** `string[]` | Cargo 包

`config.packages.cargo`

Environment 启动时通过 Cargo 预装的 Rust crate。

**gem** `string[]` | gem 包

`config.packages.gem`

Environment 启动时通过 RubyGems 预装的 Ruby 包。

**go** `string[]` | go 包

`config.packages.go`

Environment 启动时通过 Go 工具链预装的模块依赖。

**npm** `string[]` | npm 包

`config.packages.npm`

Environment 启动时通过 npm 预装的 Node.js 包。

**pip** `string[]` | pip 包

`config.packages.pip`

Environment 启动时通过 pip 预装的 Python 包。

**type** `string` | 配置类型

`config.packages.type`

依赖包配置的类型标识。

取值固定为 `packages`。

**setup_script** `string` | 启动脚本

`config.setup_script`

Environment 启动时执行的初始化脚本。

**tos** `object` | 产物存储配置

`config.tos`

智能体产物的持久化存储位置。

**bucket** `string` | TOS 桶

`config.tos.bucket`

存储智能体产物的 TOS Bucket 名称。

**prefix** `string` | 对象前缀

`config.tos.prefix`

智能体产物在 TOS Bucket 内的基础目录前缀。平台注册 outputs 产物时，会以 `{prefix}outputs/{env-id}/{session-id}/` 作为 Files API 写入前缀。

最终对象路径以 Files API 响应中的 `tos.object_key` 为准，通常还会包含 `ark_processed/{file_id}/{file_type}/{filename}`。

**description** `string` | 环境描述

Environment 的用途说明。

**metadata** `object` | 自定义元数据

Environment 的自定义业务属性，以字符串键值对形式返回。


## 代码示例

## 查询环境详情

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/environments/<ENVIRONMENT_ID>" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

#### Response

```
{
  "id": "env-example",
  "type": "environment",
  "name": "<ENVIRONMENT_NAME>",
  "config": {
    "type": "cloud",
    "networking": {"type": "unrestricted"},
    "packages": {"pip": ["pandas"], "apt": ["curl"]},
    "env": {"MY_KEY_0": "value_0"}
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

environment = client.environments.retrieve("<ENVIRONMENT_ID>")
print(environment)
```

#### Response

```
{
  "id": "env-example",
  "type": "environment",
  "name": "<ENVIRONMENT_NAME>",
  "config": {
    "type": "cloud",
    "networking": {"type": "unrestricted"},
    "packages": {"pip": ["pandas"], "apt": ["curl"]},
    "env": {"MY_KEY_0": "value_0"}
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
import com.volcengine.ark.runtime.models.environment.Environment;
import com.volcengine.ark.runtime.service.ArkService;

public class Main {
    public static void main(String[] args) throws Exception {
        ArkService service = ArkService.builder()
                .apiKey(System.getenv("ARK_API_KEY"))
                .baseUrl("https://ark.cn-beijing.volces.com/api/v3")
                .build();

        Environment env = service.getEnvironment("<ENVIRONMENT_ID>");
        System.out.println(env);

        service.shutdownExecutor();
    }
}
```

#### Response

```
{
  "id": "env-example",
  "type": "environment",
  "name": "<ENVIRONMENT_NAME>",
  "config": {
    "type": "cloud",
    "networking": {"type": "unrestricted"},
    "packages": {"pip": ["pandas"], "apt": ["curl"]},
    "env": {"MY_KEY_0": "value_0"}
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
)

func main() {
	ctx := context.Background()
    client := arkruntime.NewClientWithApiKey(
		os.Getenv("ARK_API_KEY"),
        arkruntime.WithBaseUrl("https://ark.cn-beijing.volces.com/api/v3"),
	)

	env, err := client.GetEnvironment(ctx, "<ENVIRONMENT_ID>")
	if err != nil {
		panic(err)
	}
	fmt.Println(env)
}
```

#### Response

```
{
  "id": "env-example",
  "type": "environment",
  "name": "<ENVIRONMENT_NAME>",
  "config": {
    "type": "cloud",
    "networking": {"type": "unrestricted"},
    "packages": {"pip": ["pandas"], "apt": ["curl"]},
    "env": {"MY_KEY_0": "value_0"}
  },
  "created_at": "2026-07-15T08:00:00Z",
  "updated_at": "2026-07-15T08:00:00Z"
}
```
