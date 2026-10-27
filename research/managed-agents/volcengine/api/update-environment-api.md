---
source: https://ark.volcengine.com/region:cn-beijing/docs/update-environment-api
fetched: 2026-10-24
title: 更新环境
---

# 更新环境

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`POST https://ark.cn-beijing.volces.com/api/v3/environments/{environment_id}`

更新指定 Environment 的描述、运行配置或自定义元数据。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**environment_id** `string` `必选` | 环境 ID

要更新的 Environment ID，以 `env-` 开头。可从创建环境或查询环境列表接口的响应中获取。

### Body 参数

**config** `object` | 环境配置

指定需要更新的 Environment 运行配置。

> **说明**
>
> * 省略整个 `config` 或传 `null` 时，不修改 Environment 的运行配置。
> * `self_hosted` Environment 不支持修改运行时配置。

**env** `object` | 环境变量

`config.env`

Environment 运行时使用的环境变量，以变量名和变量值组成的字符串键值对形式传入。

> **说明**
>
> * 省略或传 `null` 时保留原有环境变量；传入对象时整体替换现有 `env` 映射，传入空对象 `{}` 时清空环境变量。
> * 最多包含 64 个键值对，所有键和值合计不超过 32 KiB。键不能为空且不能包含 `=` 或 NUL 字符，值不能包含 NUL 字符。

**networking** `object` | 出网策略

`config.networking`

Environment 的出网配置。

> **说明**
>
> 省略或传 `null` 时保留原有出网策略；传入对象时整体替换现有 `networking` 配置。

**type** `string` `必选` | 出网策略类型

`config.networking.type`

Environment 的出网方式。`unrestricted` 表示不限制出网目标。

**packages** `object` | 依赖包配置

`config.packages`

Environment 启动时预装的依赖包。

> **说明**
>
> * 省略或传 `null` 时保留原有依赖包配置；传入对象时整体替换现有 `packages` 配置；传入空对象 `{}` 时清空全部依赖包配置。
> * 需要追加依赖时，先读取现有配置，在本地合并后完整传入。
> * 每个依赖包名称去除首尾空白后不能为空，不能包含 NUL 字符，也不能以连字符开头。

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

> **说明**
>
> 省略或传 `null` 时保留原有启动脚本；传入字符串时替换原值，传入空字符串 `""` 时清空。

**tos** `object` | 产物存储配置

`config.tos`

指定智能体产物的持久化存储位置。

> **说明**
>
> - 省略或传 `null` 时保留原有产物存储配置。
> - 显式传入时整体替换现有 `tos` 配置，并且必须同时提供 `bucket` 和 `prefix`；空对象 `{}` 或仅提供一个字段会被拒绝。
> - `bucket` 长度为 3～63 字节，仅支持小写字母、数字和连字符，首尾必须是小写字母或数字。
> - `prefix` 最长 512 字节，必须是相对目录，不能包含反斜杠、控制字符、空路径段、`.` 或 `..` 路径段。
> - 保存配置前，服务端会检查 Bucket 与 Prefix 已存在、Bucket 与当前 API 接入地域一致，并且方舟访问该 Bucket 的角色具有读写权限。
> - 更新 Environment 只影响之后创建的 Session，已有 Session 继续使用创建时保存的 Environment 配置。

**bucket** `string` | TOS 桶

`config.tos.bucket`

存储智能体产物的 TOS Bucket 名称。

**prefix** `string` | 对象前缀

`config.tos.prefix`

智能体产物在 TOS Bucket 内的基础目录前缀。平台注册 outputs 产物时，会以 `{prefix}outputs/{env-id}/{session-id}/` 作为 Files API 写入前缀。

最终对象路径以 Files API 响应中的 `tos.object_key` 为准，通常还会包含 `ark_processed/{file_id}/{file_type}/{filename}`。

**type** `string` | 环境类型

`config.type`

Environment 的运行方式。`cloud` 表示由火山方舟提供运行环境，`self_hosted` 表示由调用方提供运行环境。

> **说明**
>
> 省略或传 `null` 时保留当前类型。提供时必须设为 `cloud` 或 `self_hosted`，服务端会按合并后的类型校验完整配置。

**description** `string` | 环境描述

用于说明 Environment 的用途，最长 300 个字符。省略或传 `null` 时保留原值，传空字符串 `""` 时清空。

**metadata** `object` | 自定义元数据

用于记录 Environment 的业务属性，以字符串键值对形式传入，便于关联和管理资源。

> **说明**
>
> * 省略、传 `null` 或传空对象 `{}` 时，不修改自定义元数据。
> * 按键更新：非空值用于新增或覆盖，空字符串用于删除对应键。更新后最多包含 16 个键值对，键最长 64 个字符，值最长 512 个字符。

**name** `string` | 环境名称

Environment 的名称。该字段仅用于兼容回传当前值；Environment 名称创建后不可修改，传入不同名称时服务端返回 HTTP 409 `Conflict`。

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

## 更新环境

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/environments/<ENVIRONMENT_ID>" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d @- <<'EOF'
{
  "description": "预装 pandas 与 numpy 的通用数据分析环境",
  "config": {
    "packages": {
      "pip": ["pandas", "numpy"]
    }
  }
}
EOF
```

#### Response

```
{
  "id": "env-example",
  "type": "environment",
  "name": "<ENVIRONMENT_NAME>",
  "description": "预装 pandas 与 numpy 的通用数据分析环境",
  "config": {
    "type": "cloud",
    "networking": {"type": "unrestricted"},
    "packages": {"pip": ["pandas", "numpy"]}
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

environment = client.environments.update(
    "<ENVIRONMENT_ID>",
    description="预装 pandas 与 numpy 的通用数据分析环境",
    config={"packages": {"pip": ["pandas", "numpy"]}},
)
print(environment)
```

#### Response

```
{
  "id": "env-example",
  "type": "environment",
  "name": "<ENVIRONMENT_NAME>",
  "description": "预装 pandas 与 numpy 的通用数据分析环境",
  "config": {
    "type": "cloud",
    "networking": {"type": "unrestricted"},
    "packages": {"pip": ["pandas", "numpy"]}
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
import com.volcengine.ark.runtime.models.environment.EnvConfig;
import com.volcengine.ark.runtime.models.environment.Environment;
import com.volcengine.ark.runtime.models.environment.PackagesConfig;
import com.volcengine.ark.runtime.models.environment.UpdateEnvironmentRequest;
import com.volcengine.ark.runtime.service.ArkService;
import java.util.Arrays;

public class Main {
    public static void main(String[] args) throws Exception {
        ArkService service = ArkService.builder()
                .apiKey(System.getenv("ARK_API_KEY"))
                .baseUrl("https://ark.cn-beijing.volces.com/api/v3")
                .build();

        Environment env = service.updateEnvironment(
                "<ENVIRONMENT_ID>",
                UpdateEnvironmentRequest.builder()
                        .description("预装 pandas 与 numpy 的通用数据分析环境")
                        .config(EnvConfig.builder()
                                .packages(PackagesConfig.builder()
                                        .pip(Arrays.asList("pandas", "numpy"))
                                        .build())
                                .build())
                        .build());
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
  "description": "预装 pandas 与 numpy 的通用数据分析环境",
  "config": {
    "type": "cloud",
    "networking": {"type": "unrestricted"},
    "packages": {"pip": ["pandas", "numpy"]}
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
	envmodel "github.com/volcengine/ark-runtime-go/arkruntime/model/environment"
)

func main() {
	ctx := context.Background()
    client := arkruntime.NewClientWithApiKey(
		os.Getenv("ARK_API_KEY"),
        arkruntime.WithBaseUrl("https://ark.cn-beijing.volces.com/api/v3"),
	)

	env, err := client.UpdateEnvironment(ctx, "<ENVIRONMENT_ID>", &envmodel.UpdateEnvironmentRequest{
		Description: envmodel.NewOptString("预装 pandas 与 numpy 的通用数据分析环境"),
		Config: envmodel.NewOptEnvConfig(envmodel.EnvConfig{
			Packages: envmodel.NewOptPackagesConfig(envmodel.PackagesConfig{
				Pip: []string{"pandas", "numpy"},
			}),
		}),
	})
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
  "description": "预装 pandas 与 numpy 的通用数据分析环境",
  "config": {
    "type": "cloud",
    "networking": {"type": "unrestricted"},
    "packages": {"pip": ["pandas", "numpy"]}
  },
  "created_at": "2026-07-15T08:00:00Z",
  "updated_at": "2026-07-15T09:00:00Z"
}
```
