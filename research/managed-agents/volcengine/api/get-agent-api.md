---
source: https://ark.volcengine.com/region:cn-beijing/docs/get-agent-api
fetched: 2026-10-24
title: 查询智能体详情
---

# 查询智能体详情

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`GET https://ark.cn-beijing.volces.com/api/v3/agents/{agent_id}`

根据智能体 ID 获取配置详情。省略 `version` 时返回最新配置；指定 `version` 时返回对应的历史版本。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**agent_id** `string` `必选` | 智能体 ID

要查询的智能体 ID。通过创建智能体接口 (POST /agents) 返回, 或在控制台智能体列表页面获取。

### Query 参数

> 在 URL Query String 中传入。

**version** `integer` | 版本号

要查询的智能体版本号。省略时返回最新配置；填写时返回对应的历史版本。

**最小值**：`1`

## 响应参数

**created_at** `string` | 创建时间

省略 `version` 时为智能体创建时间；指定 `version` 时为该版本的创建时间。采用 ISO 8601 格式。

**id** `string` | 智能体 ID

智能体唯一标识，以 `agent-` 开头。更新或删除智能体，以及创建会话时，需要使用该值。

**name** `string` | 智能体名称

用于识别和管理智能体的名称。

**type** `string` | 对象类型

返回对象的类型，表示该对象为智能体。

取值固定为 `agent`。

**updated_at** `string` | 更新时间

省略 `version` 时为智能体最后更新时间；指定 `version` 时与 `created_at` 相同，表示该历史版本的创建时间。采用 ISO 8601 格式。

**version** `integer` | 版本号

当前智能体配置的版本号。

**base_agent** `string` | 基础 Agent 类型

智能体创建时确定的基础 Agent 类型。  Seedance Managed Agent 返回 `ultra_vision_agent_preview`。 
可选值：`ark_agent_preview`、`ultra_vision_agent_preview`。

**description** `string` | 智能体描述

智能体的用途、能力范围和适用场景。

**display_name** `string` | 展示名称

智能体的展示名称。

**mcp_servers** `object[]` | MCP 服务列表

智能体已配置的 MCP 服务列表。

**name** `string` | MCP 服务名称

`mcp_servers.name`

用于标识 MCP 服务的名称。

**type** `string` | 接入方式

`mcp_servers.type`

MCP 服务的接入方式。

取值固定为 `url`。

**url** `string` | 服务地址

`mcp_servers.url`

MCP 服务的访问地址。

**metadata** `object` | 自定义元数据

智能体的自定义键值对元数据。

**model** `object` | 模型配置

智能体使用的模型配置。

**id** `string` | 模型或接入点 ID

`model.id`

智能体调用的模型 ID 或推理接入点 ID。例如模型 ID `doubao-seed-2-1-pro-260628`，或推理接入点 ID `ep-20260907123456-abcd1`。

**reasoning_effort** `string` | 推理投入档位

`model.reasoning_effort`

模型在深度思考时使用的推理投入档位。可选值：`none`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`。

**service_tier** `string` | 推理服务档位

`model.service_tier`

模型调用使用的推理服务档位。可选值：`auto`、`default`、`fast`。

**speed** `string` | 推理速度档位

`model.speed`

模型使用的推理速度档位。可选值：`standard`、`fast`。

**thinking** `string` | 深度思考

`model.thinking`

模型的深度思考模式。`auto` 表示由模型决定是否启用深度思考。取值：`enabled` / `disabled` / `auto`。

**multiagent** `object` | 多智能体配置

智能体与子智能体之间的协作配置。

**agents** `object[]` | 子智能体列表

`multiagent.agents`

参与协作的子智能体列表。

**type** `string` | 子智能体来源

`multiagent.agents.type`

子智能体的来源。`agent` 表示引用已存在的智能体；`self` 表示复用当前智能体配置作为子智能体参与协作。

**id** `string` | 智能体 ID

`multiagent.agents.id`

被引用智能体的 ID。

**version** `integer` | 智能体版本

`multiagent.agents.version`

被引用智能体的版本号。

**type** `string` | 协作模式

`multiagent.type`

多智能体协作模式，取值固定为 `coordinator`。当前智能体负责分配任务并汇总子智能体的结果。

**skills** `object[]` | 技能列表

智能体已绑定的技能列表。

**type** `string` | 技能来源

`skills.type`

技能来源。

- `ark`：方舟预置技能。
- `skill_hub`：来自 SkillHub 的公共技能。
- `custom`：当前账号通过 Skills API 创建的自定义技能。

**skill_id** `string` | 技能 ID

`skills.skill_id`

绑定到智能体的技能 ID。

**version** `string` | 技能版本

`skills.version`

绑定到智能体的技能版本号。

**system** `string` | 系统提示词

您为智能体配置并保存的系统提示词，用于定义智能体的角色和行为要求。

**tags** `object[]` | 标签列表

智能体的标签列表。省略 `version` 查询最新配置时可能返回；指定 `version` 查询历史版本时不返回该字段。

**key** `string` | 标签键

`tags.key`

标签键，用于分类和检索。

**value** `string` | 标签值

`tags.value`

标签对应的值。

**tools** `object[]` | 工具列表

您为智能体配置的工具列表。

**type** `string` | 工具类型

`tools.type`

工具类型。

- `agent_toolset_20260916`：使用方舟内置的 `bash`、`edit`、`read`、`write`、`glob`、`grep`、`web_fetch` 和 `web_search` 工具。
- `agent_toolset_multimodal_20260825`：使用 `image_generate`、`video_generate`、`visual_search`、`general_search`、`compose_video` 和 `todo_write` 工具。
- `mcp_toolset`：使用指定 MCP 服务提供的工具。
- `custom`：使用由客户端执行的自定义工具。
可选值：`agent_toolset_20260401`、`agent_toolset_20260701`、`agent_toolset_20260916`、`agent_toolset_multimodal_20260825`、`mcp_toolset`、`custom`。

**configs** `object[]` | 工具配置列表

`tools.configs`

按工具名称设置工具的启用状态和权限策略。

**name** `string` | 工具名称

`tools.configs.name`

工具配置对应的工具名称。

**enabled** `boolean` | 是否启用

`tools.configs.enabled`

是否启用此工具。

**models** `object[]` | 工具模型列表

`tools.configs.models`

图片生成或视频生成工具实际绑定模型列表。

**id** `string` | 模型或接入点 ID

`tools.configs.models.id`

该工具绑定的模型 ID 或推理接入点 ID。

**default** `boolean` | 是否为默认模型

`tools.configs.models.default`

是否为该工具的默认模型。

**name** `string` | 模型名称

`tools.configs.models.name`

服务端根据模型 ID 或推理接入点 ID 返回的模型名称。

**version** `string` | 模型版本

`tools.configs.models.version`

服务端根据模型 ID 或推理接入点 ID 返回的模型版本。

**permission_policy** `object` | 权限策略

`tools.configs.permission_policy`

该工具使用的权限策略。

**type** `string` | 策略类型

`tools.configs.permission_policy.type`

工具调用许可策略。

* `always_allow`：表示总是允许调用。
* `always_ask`：表示每次使用前需要确认。

**default_config** `object` | 默认工具配置

`tools.default_config`

未在 `configs` 中单独配置的工具所使用的默认启用状态和权限策略。

**enabled** `boolean` | 默认是否启用

`tools.default_config.enabled`

是否默认启用未在 `configs` 中单独配置的工具。

* `true`：表示默认启用。
* `false`：表示默认禁用。

**permission_policy** `object` | 默认权限策略

`tools.default_config.permission_policy`

未在 `configs` 中单独配置的工具所使用的默认权限策略。

**type** `string` | 策略类型

`tools.default_config.permission_policy.type`

工具调用许可策略。

* `always_allow`：表示总是允许调用。
* `always_ask`：表示每次使用前需要确认。

**description** `string` | 自定义工具描述

`tools.description`

说明自定义工具的功能和适用场景，供模型判断何时调用该工具。

**input_schema** `object` | 输入参数定义

`tools.input_schema`

返回 Agent 中保存的自定义工具输入参数 JSON Schema。

**properties** `object` | 参数属性定义

`tools.input_schema.properties`

返回 Agent 中保存的 JSON Schema 属性映射。每个键为参数名，每个值为对应参数的 JSON Schema 子对象。

**required** `string[]` | 必填参数名称列表

`tools.input_schema.required`

返回调用自定义工具时必须提供的参数名称列表。

**type** `string` | Schema 类型

`tools.input_schema.type`

返回 JSON Schema 的顶层类型，固定为 `object`。

**mcp_server_name** `string` | MCP 服务名称

`tools.mcp_server_name`

MCP 工具所属的 MCP 服务名称。

**name** `string` | 自定义工具名称

`tools.name`

自定义工具的名称。


## 代码示例

## 查询智能体详情

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/agents/<AGENT_ID>" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

#### Response

```
{
  "id": "<AGENT_ID>",
  "type": "agent",
  "name": "<AGENT_NAME>",
  "model": {
    "id": "doubao-seed-2-1-pro-260915"
  },
  "system": "你是一个乐于助人的智能助手。",
  "version": 1,
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

agent = client.agents.retrieve("<AGENT_ID>")
print(agent)
```

#### Response

```
{
  "id": "<AGENT_ID>",
  "type": "agent",
  "name": "<AGENT_NAME>",
  "model": {
    "id": "doubao-seed-2-1-pro-260915"
  },
  "system": "你是一个乐于助人的智能助手。",
  "version": 1,
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
import com.volcengine.ark.runtime.models.agent.Agent;
import com.volcengine.ark.runtime.service.ArkService;

public class Main {
    public static void main(String[] args) throws Exception {
        ArkService service = ArkService.builder()
                .apiKey(System.getenv("ARK_API_KEY"))
                .baseUrl("https://ark.cn-beijing.volces.com/api/v3")
                .build();

        Agent agent = service.getAgent("<AGENT_ID>");
        System.out.println(agent);

        service.shutdownExecutor();
    }
}
```

#### Response

```
{
  "id": "<AGENT_ID>",
  "type": "agent",
  "name": "<AGENT_NAME>",
  "model": {
    "id": "doubao-seed-2-1-pro-260915"
  },
  "system": "你是一个乐于助人的智能助手。",
  "version": 1,
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

	agent, err := client.GetAgent(ctx, "<AGENT_ID>")
	if err != nil {
		panic(err)
	}
	fmt.Println(agent)
}
```

#### Response

```
{
  "id": "<AGENT_ID>",
  "type": "agent",
  "name": "<AGENT_NAME>",
  "model": {
    "id": "doubao-seed-2-1-pro-260915"
  },
  "system": "你是一个乐于助人的智能助手。",
  "version": 1,
  "created_at": "2026-07-15T08:00:00Z",
  "updated_at": "2026-07-15T08:00:00Z"
}
```
