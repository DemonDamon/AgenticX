---
source: https://ark.volcengine.com/region:cn-beijing/docs/list-agents-api
fetched: 2026-10-24
title: 查询智能体列表
---

# 查询智能体列表

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`GET https://ark.cn-beijing.volces.com/api/v3/agents`

分页查询当前账号下的智能体。支持按创建时间、名称和展示名称筛选，结果按创建时间从新到旧排列。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Query 参数

> 在 URL Query String 中传入。

**created_at_gte** `string` | 创建时间下界

按创建时间筛选，返回创建时间大于等于该值的智能体。使用 ISO 8601 格式。

**created_at_lte** `string` | 创建时间上界

按创建时间筛选，返回创建时间小于等于该值的智能体。使用 ISO 8601 格式。

**display_name** `string` | 展示名称

按智能体展示名称模糊匹配。与其他筛选参数同时传入时，返回同时满足所有条件的智能体。

**limit** `integer` `默认值 20` | 每页数量

每页返回的数量。

**取值范围**：`[1, 100]`

**name** `string` | 智能体名称

按智能体名称模糊匹配。与其他筛选参数同时传入时，返回同时满足所有条件的智能体。

**page** `string` | 下一页标识

下一页标识。

* 首次请求时省略。
* 后续请求将上一页响应中的 `next_page` 原样传入。
* 该值不是页码，请勿解析或修改。
* 连续翻页时，应保持其他筛选参数不变。

## 响应参数

**data** `object[]` | 智能体列表

当前页返回的智能体列表；无命中时返回空数组`[]`

**created_at** `string` | 创建时间

`data.created_at`

智能体创建时间，采用 RFC 3339 格式。

**id** `string` | 智能体 ID

`data.id`

智能体唯一标识，以 `agent-` 开头。创建会话或管理智能体时，需要使用该值。

**name** `string` | 智能体名称

`data.name`

用于识别和管理智能体的名称。

**type** `string` | 对象类型

`data.type`

返回对象的类型，表示该对象为智能体。

取值固定为 `agent`。

**updated_at** `string` | 更新时间

`data.updated_at`

智能体最后更新时间，采用 RFC 3339 格式。

**version** `integer` | 版本号

`data.version`

智能体配置版本号。

**base_agent** `string` | 基础 Agent 类型

`data.base_agent`

智能体创建时确定的基础 Agent 类型。  Seedance Managed Agent 返回 `ultra_vision_agent_preview`。 
可选值：`ark_agent_preview`、`ultra_vision_agent_preview`。

**description** `string` | 智能体描述

`data.description`

智能体的用途、能力范围和适用场景。

**display_name** `string` | 展示名称

`data.display_name`

智能体的展示名称。

**mcp_servers** `object[]` | MCP 服务列表

`data.mcp_servers`

智能体已配置的 MCP 服务列表。

**name** `string` | MCP 服务名称

`data.mcp_servers.name`

用于标识 MCP 服务的名称。

**type** `string` | 接入方式

`data.mcp_servers.type`

MCP 服务的接入方式。

取值固定为 `url`。

**url** `string` | 服务地址

`data.mcp_servers.url`

MCP 服务的访问地址。

**metadata** `object` | 自定义元数据

`data.metadata`

智能体的自定义键值对元数据。

**model** `object` | 模型配置

`data.model`

智能体使用的模型配置。

**id** `string` | 模型或接入点 ID

`data.model.id`

智能体调用的模型 ID 或推理接入点 ID。例如模型 ID `doubao-seed-2-1-pro-260628`，或推理接入点 ID `ep-20260907123456-abcd1`。

**reasoning_effort** `string` | 推理投入档位

`data.model.reasoning_effort`

模型在深度思考时使用的推理投入档位。可选值：`none`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`。

**service_tier** `string` | 推理服务档位

`data.model.service_tier`

模型调用使用的推理服务档位。可选值：`auto`、`default`、`fast`。

**speed** `string` | 推理速度档位

`data.model.speed`

模型使用的推理速度档位。可选值：`standard`、`fast`。

**thinking** `string` | 深度思考

`data.model.thinking`

模型的深度思考模式。`auto` 表示由模型决定是否启用深度思考。取值：`enabled` / `disabled` / `auto`。

**multiagent** `object` | 多智能体配置

`data.multiagent`

智能体与子智能体之间的协作配置。

**agents** `object[]` | 子智能体列表

`data.multiagent.agents`

参与协作的子智能体列表。

**type** `string` | 子智能体来源

`data.multiagent.agents.type`

子智能体的来源。`agent` 表示引用已存在的智能体；`self` 表示复用当前智能体配置作为子智能体参与协作。

**id** `string` | 智能体 ID

`data.multiagent.agents.id`

被引用智能体的 ID。

**version** `integer` | 智能体版本

`data.multiagent.agents.version`

被引用智能体的版本号。

**type** `string` | 协作模式

`data.multiagent.type`

多智能体协作模式，取值固定为 `coordinator`。当前智能体负责分配任务并汇总子智能体的结果。

**skills** `object[]` | 技能列表

`data.skills`

智能体已绑定的技能列表。

**type** `string` | 技能来源

`data.skills.type`

技能来源。

- `ark`：方舟预置技能。
- `skill_hub`：来自 SkillHub 的公共技能。
- `custom`：当前账号通过 Skills API 创建的自定义技能。

**skill_id** `string` | 技能 ID

`data.skills.skill_id`

绑定到智能体的技能 ID。

**version** `string` | 技能版本

`data.skills.version`

绑定到智能体的技能版本号。

**system** `string` | 系统提示词

`data.system`

您为智能体配置并保存的系统提示词，用于定义智能体的角色和行为要求。

**tags** `object[]` | 标签列表

`data.tags`

智能体的标签列表。

**key** `string` | 标签键

`data.tags.key`

标签键，用于分类和检索。

**value** `string` | 标签值

`data.tags.value`

标签对应的值。

**tools** `object[]` | 工具列表

`data.tools`

您为智能体配置的工具列表。

**type** `string` | 工具类型

`data.tools.type`

工具类型。

- `agent_toolset_20260916`：使用方舟内置的 `bash`、`edit`、`read`、`write`、`glob`、`grep`、`web_fetch` 和 `web_search` 工具。
- `agent_toolset_multimodal_20260825`：使用 `image_generate`、`video_generate`、`visual_search`、`general_search`、`compose_video` 和 `todo_write` 工具。
- `mcp_toolset`：使用指定 MCP 服务提供的工具。
- `custom`：使用由客户端执行的自定义工具。
可选值：`agent_toolset_20260401`、`agent_toolset_20260701`、`agent_toolset_20260916`、`agent_toolset_multimodal_20260825`、`mcp_toolset`、`custom`。

**configs** `object[]` | 工具配置列表

`data.tools.configs`

按工具名称设置工具的启用状态和权限策略。

**name** `string` | 工具名称

`data.tools.configs.name`

工具配置对应的工具名称。

**enabled** `boolean` | 是否启用

`data.tools.configs.enabled`

是否启用此工具。

**models** `object[]` | 工具模型列表

`data.tools.configs.models`

图片生成或视频生成工具实际绑定模型列表。

**id** `string` | 模型或接入点 ID

`data.tools.configs.models.id`

该工具绑定的模型 ID 或推理接入点 ID。

**default** `boolean` | 是否为默认模型

`data.tools.configs.models.default`

是否为该工具的默认模型。

**name** `string` | 模型名称

`data.tools.configs.models.name`

服务端根据模型 ID 或推理接入点 ID 返回的模型名称。

**version** `string` | 模型版本

`data.tools.configs.models.version`

服务端根据模型 ID 或推理接入点 ID 返回的模型版本。

**permission_policy** `object` | 权限策略

`data.tools.configs.permission_policy`

该工具使用的权限策略。

**type** `string` | 策略类型

`data.tools.configs.permission_policy.type`

工具调用许可策略。

* `always_allow`：表示总是允许调用。
* `always_ask`：表示每次使用前需要确认。

**default_config** `object` | 默认工具配置

`data.tools.default_config`

未在 `configs` 中单独配置的工具所使用的默认启用状态和权限策略。

**enabled** `boolean` | 默认是否启用

`data.tools.default_config.enabled`

是否默认启用未在 `configs` 中单独配置的工具。

* `true`：表示默认启用。
* `false`：表示默认禁用。

**permission_policy** `object` | 默认权限策略

`data.tools.default_config.permission_policy`

未在 `configs` 中单独配置的工具所使用的默认权限策略。

**type** `string` | 策略类型

`data.tools.default_config.permission_policy.type`

工具调用许可策略。

* `always_allow`：表示总是允许调用。
* `always_ask`：表示每次使用前需要确认。

**description** `string` | 自定义工具描述

`data.tools.description`

说明自定义工具的功能和适用场景，供模型判断何时调用该工具。

**input_schema** `object` | 输入参数定义

`data.tools.input_schema`

返回 Agent 中保存的自定义工具输入参数 JSON Schema。

**properties** `object` | 参数属性定义

`data.tools.input_schema.properties`

返回 Agent 中保存的 JSON Schema 属性映射。每个键为参数名，每个值为对应参数的 JSON Schema 子对象。

**required** `string[]` | 必填参数名称列表

`data.tools.input_schema.required`

返回调用自定义工具时必须提供的参数名称列表。

**type** `string` | Schema 类型

`data.tools.input_schema.type`

返回 JSON Schema 的顶层类型，固定为 `object`。

**mcp_server_name** `string` | MCP 服务名称

`data.tools.mcp_server_name`

MCP 工具所属的 MCP 服务名称。

**name** `string` | 自定义工具名称

`data.tools.name`

自定义工具的名称。

**next_page** `string` | 下一页标识

下一页标识。将该值原样作为下一次请求的 `page` 参数；已到最后一页时不返回该字段。


## 代码示例

## 查询智能体列表

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/agents?limit=20" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

#### Response

```
{
  "data": [
    {
      "id": "agent-20260715083012-a3f7b",
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
  ]
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

page = client.agents.list(limit=20)
print(page)
```

#### Response

```
{
  "data": [
    {
      "id": "agent-20260715083012-a3f7b",
      "type": "agent",
      "name": "<AGENT_NAME>",
      "model": {"id": "doubao-seed-2-1-pro-260915"},
      "system": "你是一个乐于助人的智能助手。",
      "version": 1,
      "created_at": "2026-07-15T08:00:00Z",
      "updated_at": "2026-07-15T08:00:00Z"
    }
  ]
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
import com.volcengine.ark.runtime.models.agent.ListAgentsResponse;
import com.volcengine.ark.runtime.service.ArkService;

public class Main {
    public static void main(String[] args) throws Exception {
        ArkService service = ArkService.builder()
                .apiKey(System.getenv("ARK_API_KEY"))
                .baseUrl("https://ark.cn-beijing.volces.com/api/v3")
                .build();

        ListAgentsResponse page = service.listAgents(20, null, null, null);
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
      "id": "agent-20260715083012-a3f7b",
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
  ]
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
	agentmodel "github.com/volcengine/ark-runtime-go/arkruntime/model/agent"
)

func main() {
	ctx := context.Background()
    client := arkruntime.NewClientWithApiKey(
		os.Getenv("ARK_API_KEY"),
        arkruntime.WithBaseUrl("https://ark.cn-beijing.volces.com/api/v3"),
	)

	resp, err := client.ListAgents(ctx, &agentmodel.AgentsListParams{
		Limit: agentmodel.NewOptInt32(20),
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
      "id": "agent-20260715083012-a3f7b",
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
  ]
}
```
