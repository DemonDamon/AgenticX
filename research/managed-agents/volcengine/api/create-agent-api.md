---
source: https://ark.volcengine.com/region:cn-beijing/docs/create-agent-api
fetched: 2026-10-24
title: 创建智能体
---

# 创建智能体

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`POST https://ark.cn-beijing.volces.com/api/v3/agents`

创建一个可复用、可版本化的托管智能体。创建成功后返回智能体 ID，可用于创建会话。单个账号最多可创建 1000 个 Agent。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Body 参数

**model** `object` `必选` | 模型配置

智能体使用的模型配置。

* 各运行参数的支持范围和默认行为以所选模型为准。
* 传入模型不支持的取值时，服务端返回 400 `InvalidParameter`。
* 创建 Seedance Managed Agent 时，需满足以下模型要求：
  * 必须填写 `model.id`。可用模型以控制台的 Seedance Managed Agent 创建页面为准；本文不固定具体模型 ID。
  * 所选模型必须支持 Managed Agent 推理和 `reasoning_effort: high`。`reasoning_effort` 省略时，服务端自动补齐为 `high`；填写其他值时，服务端返回 400 `InvalidParameter`。
* 详情请参见 [模型支持的参数列表](../model-parameter-support.md)。

> **注意**
>
> 所填模型 ID 或推理接入点 ID 对应的模型请从 Managed Agents 控制台提供的模型中选择，或参见 [模型支持的参数列表](../model-parameter-support.md)。使用推理接入点 ID 时，该接入点必须属于当前项目；否则，服务端返回 400 `InvalidParameter`。

**id** `string` `必选` | 模型或接入点 ID

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

模型使用的推理速度档位。

**thinking** `string` | 深度思考

`model.thinking`

模型的深度思考模式。`auto` 表示由模型决定是否启用深度思考。取值：`enabled` / `disabled` / `auto`。

**name** `string` `必选` | 智能体名称

智能体名称，用于识别和管理创建的智能体，长度为 1～256 个字符。

**base_agent** `string` `默认值 ark_agent_preview` | 基础 Agent 类型

基础 Agent 类型。

* `ark_agent_preview`：创建通用 Agent。
* `ultra_vision_agent_preview`：创建 Seedance Managed Agent。

该字段在创建后不能修改。  已创建的通用 Agent 不能直接变更为 Seedance Managed Agent，需要重新创建 Seedance Managed Agent。 

> **注意**
>
> 设置为 `ultra_vision_agent_preview` 前，需要开通 Seedance Managed Agent 使用权限。

**description** `string` | 智能体描述

智能体描述，说明智能体的用途和能力，最大 2048 字符。

**display_name** `string` | 展示名称

智能体展示名称，最多 256 个字符。省略或传空字符串时，响应中不返回该字段。

**mcp_servers** `object[]` | MCP 服务配置

配置给智能体使用的 MCP 服务列表，最多 20 项。

**type** `string` `必选` | 接入方式

`mcp_servers.type`

MCP 服务的接入方式。

取值固定为 `url`。

**url** `string` `必选` | 服务地址

`mcp_servers.url`

MCP 服务的访问地址。同一智能体内不能配置重复的 MCP 服务地址。

**name** `string` | MCP 服务名称

`mcp_servers.name`

MCP 服务名称，最长 255 个字符，用于在当前 Agent 中识别该服务；配置 MCP 工具集时，`tools[].mcp_server_name` 必须填写此名称。

* 省略名称或名称不符合命名规则时，服务端根据 `url` 生成名称。
* 服务端会将符合命名规则的名称转换为小写。
* 多个名称冲突时，服务端为后续名称添加数字后缀。

**metadata** `object` | 自定义元数据

用户自定义元数据，键值对形式，最多支持 16 个键；key 长度不超过 64 字符，value 长度不超过 512 字符。

**multiagent** `object` | 多智能体配置

多智能体协作配置，最多支持 20 个子智能体。

**agents** `object[]` `必选` | 子智能体列表

`multiagent.agents`

参与协作的子智能体列表。

**type** `string` `必选` | 子智能体来源

`multiagent.agents.type`

子智能体的来源。`agent` 表示引用已存在的智能体；`self` 表示复用当前智能体配置作为子智能体参与协作，但不会复用当前智能体的子智能体。

**id** `string` | 智能体 ID

`multiagent.agents.id`

被引用智能体的 ID。`type` 为 `agent` 时，用于指定参与协作的已有智能体，必须填写；`type` 为 `self` 时，当前智能体使用自身配置参与协作，不填写该字段。

**version** `integer` | 智能体版本

`multiagent.agents.version`

被引用智能体的版本号。省略时使用最新版本。

**type** `string` `必选` | 协作模式

`multiagent.type`

多智能体协作模式，取值固定为 `coordinator`。当前智能体负责分配任务并汇总子智能体的结果。

**skills** `object[]` | 技能配置

绑定到智能体的技能列表，最多支持 50 个技能。未指定技能版本时，使用该技能的最新版本。

**skill_id** `string` `必选` | 技能 ID

`skills.skill_id`

要绑定到智能体的技能 ID。

**type** `string` `必选` | 技能来源

`skills.type`

技能来源。

- `ark`：方舟预置技能。
- `skill_hub`：来自 SkillHub 的公共技能。
- `custom`：当前账号通过 Skills API 创建的自定义技能。

**version** `string` | 技能版本

`skills.version`

要绑定的技能版本号。省略时使用该技能的最新版本。

**system** `string` | 系统提示词

系统提示词，定义智能体的角色和行为规则，最大 100000 字符。

 创建 Seedance Managed Agent 时，该字段用于定义视觉创作任务中的角色、工作方式和输出要求。 

**tags** `object[]` | 标签列表

用户自定义标签列表，最多填写 50 项。同一请求内，标签键不能重复。

**key** `string` `必选` | 标签键

`tags.key`

标签键，用于分类和检索，长度为 1～128 个字符，且不能以 `volc:` 或 `maas:` 开头。

**value** `string` | 标签值

`tags.value`

标签对应的值，最长 256 个字符。

**tools** `object[]` | 工具配置

配置给智能体使用的工具列表，最多支持 128 个工具。

* 内置工具集和 MCP 工具可通过 `configs` 和 `default_config` 设置启用状态及权限策略。
* MCP 工具通过 `mcp_server_name` 关联 `mcp_servers[].name`。
* 自定义工具需填写名称、功能描述和输入参数定义。
* 创建 Seedance Managed Agent 时，必须同时配置基础工具集和多模态工具集。基础工具集使用 `agent_toolset_20260916`；多模态工具集使用 `agent_toolset_multimodal_20260825`。
* 多模态工具集中必须启用 `image_generate`、`visual_search`、`general_search` 和 `compose_video`；`video_generate` 可按需启用。
* 启用 `general_search` 时，必须关闭基础工具集中的 `web_search`。

**type** `string` `必选` | 工具类型

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

**name** `string` `必选` | 工具名称

`tools.configs.name`

工具配置对应的工具名称。

**enabled** `boolean` | 是否启用

`tools.configs.enabled`

是否启用此工具。

**models** `object[]` | 工具模型列表

`tools.configs.models`

图片生成或视频生成工具使用的模型 ID 或推理接入点 ID 列表。省略时，服务端为已启用的生成工具绑定平台默认模型，并在响应中返回实际绑定结果。

> **说明**
>
> 最多填写 10 项，且同一工具配置内的 ID 不能重复。配置多项时，必须且只能将一项的 `default` 设置为 `true`。

**id** `string` `必选` | 模型或接入点 ID

`tools.configs.models.id`

图片生成或视频生成工具调用的模型 ID 或推理接入点 ID。

> **注意**
>
> 所填模型 ID 或推理接入点 ID 对应的模型必须支持当前图片生成或视频生成工具。使用推理接入点 ID 时，该接入点必须属于当前项目；否则，服务端返回 400 `InvalidParameter`。

**default** `boolean` `默认值 false` | 是否为默认模型

`tools.configs.models.default`

是否作为该工具的默认模型。配置多个模型或接入点时，必须且只能将一项设置为 `true`。

**permission_policy** `object` | 权限策略

`tools.configs.permission_policy`

该工具使用的权限策略。

**type** `string` `必选` | 策略类型

`tools.configs.permission_policy.type`

工具调用许可策略。

* `always_allow`：表示总是允许调用。
* `always_ask`：表示每次使用前需要确认。

**default_config** `object` | 默认工具配置

`tools.default_config`

未在 `configs` 中单独配置的工具所使用的默认启用状态和权限策略。

**enabled** `boolean` | 是否启用

`tools.default_config.enabled`

是否默认启用未在 `configs` 中单独配置的工具。

* `true`：表示默认启用。
* `false`：表示默认禁用。

**permission_policy** `object` | 权限策略

`tools.default_config.permission_policy`

未在 `configs` 中单独配置的工具所使用的默认权限策略。

**type** `string` `必选` | 策略类型

`tools.default_config.permission_policy.type`

工具调用许可策略。

* `always_allow`：表示总是允许调用。
* `always_ask`：表示每次使用前需要确认。

**description** `string` | 自定义工具描述

`tools.description`

说明自定义工具的功能和适用场景，供模型判断何时调用该工具。

> **说明**
>
> `type` 为 `custom` 时必填，长度为 1～10000 个字符。

**input_schema** `object` | 输入参数定义

`tools.input_schema`

定义自定义工具的输入参数及其约束。

> **注意**
>
> * 创建 Agent 时，服务端会确认 `input_schema.type` 为 `object`，并确认 `input_schema.properties` 是 JSON 对象，但不会逐项检查其中的属性定义。
> * 运行 Session 时，服务端会检查完整的 `input_schema` 是否为合法 JSON Schema。创建 Agent 成功不代表该 Schema 一定可以正常运行。
> * 模型生成的工具调用参数只会校验是否为合法 JSON。执行自定义工具前，你的应用应按 `input_schema` 再次校验参数。

**properties** `object` | 参数属性定义

`tools.input_schema.properties`

自定义工具输入参数的 JSON Schema 属性映射。键为参数名，值为对应参数的 JSON Schema 子对象。请确保每个属性定义均符合 JSON Schema。

常用关键字包括：

* `type`：参数类型，如 `string`、`number`、`integer`、`boolean`、`array` 或 `object`。
* `description`：参数的用途说明，供模型理解并生成参数。
* `enum`：参数允许使用的值。
* `items`：数组元素的 JSON Schema。
* `properties`、`required`：对象的子字段及必填字段。
* `minimum`、`maximum`：数值参数的取值范围。

示例：

```JSON
{ "city": { "type": "string", "description": "城市名称" }, "hours": { "type": "integer", "description": "预报时长，单位为小时", "minimum": 1, "maximum": 72 } }
```

**required** `string[]` | 必填参数名称列表

`tools.input_schema.required`

自定义工具输入中必填的参数名称列表。列表中的每个名称必须与 `properties` 中定义的参数名称一致。

**type** `string` `默认值 object` | Schema 类型

`tools.input_schema.type`

指定 JSON Schema 的顶层类型，仅支持 `object`。

**mcp_server_name** `string` | MCP 服务名称

`tools.mcp_server_name`

MCP 工具所属的 MCP 服务名称。

**name** `string` | 自定义工具名称

`tools.name`

自定义工具的名称。

> **说明**
>
> `type` 为 `custom` 时必填。长度为 1～128 个字符，只能包含字母、数字、下划线和连字符，且同一 Agent 内的自定义工具名称不能重复。

## 响应参数

**created_at** `string` | 创建时间

智能体创建时间，采用 ISO 8601 格式。

**id** `string` | 智能体 ID

智能体唯一标识，以 `agent-` 开头。查询、更新或删除智能体，以及创建会话时，需要使用该值。

**name** `string` | 智能体名称

用于识别和管理智能体的名称。

**type** `string` | 对象类型

返回对象的类型，表示该对象为智能体。

取值固定为 `agent`。

**updated_at** `string` | 更新时间

智能体最后更新时间，采用 ISO 8601 格式。

**version** `integer` | 版本号

本次创建的智能体版本号。

**base_agent** `string` | 基础 Agent 类型

智能体使用的基础 Agent 类型。  Seedance Managed Agent 返回 `ultra_vision_agent_preview`。 
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

模型使用的推理速度档位。

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

智能体的标签列表。

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

工具类型。各取值含义如下：

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

服务端返回的图片生成或视频生成工具实际绑定模型列表。

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

**enabled** `boolean` | 是否启用

`tools.default_config.enabled`

是否默认启用未在 `configs` 中单独配置的工具。

* `true`：表示默认启用。
* `false`：表示默认禁用。

**permission_policy** `object` | 权限策略

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

## 创建智能体

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/agents" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d @- <<'EOF'
{
  "name": "<AGENT_NAME>",
  "model": {
    "id": "doubao-seed-2-1-pro-260915"
  },
  "system": "你是一个乐于助人的智能助手。"
}
EOF
```

#### Response

```
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

agent = client.agents.create(
    name="<AGENT_NAME>",
    model={"id": "doubao-seed-2-1-pro-260915"},
    system="你是一个乐于助人的智能助手。",
)
print(agent)
```

#### Response

```
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
import com.volcengine.ark.runtime.models.agent.CreateAgentRequest;
import com.volcengine.ark.runtime.models.agent.ModelConfig;
import com.volcengine.ark.runtime.service.ArkService;

public class Main {
    public static void main(String[] args) throws Exception {
        ArkService service = ArkService.builder()
                .apiKey(System.getenv("ARK_API_KEY"))
                .baseUrl("https://ark.cn-beijing.volces.com/api/v3")
                .build();

        Agent agent = service.createAgent(
                CreateAgentRequest.builder()
                        .name("<AGENT_NAME>")
                        .model(ModelConfig.builder().id("doubao-seed-2-1-pro-260915").build())
                        .system("你是一个乐于助人的智能助手。")
                        .build());
        System.out.println(agent);

        service.shutdownExecutor();
    }
}
```

#### Response

```
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

	agent, err := client.CreateAgent(ctx, &agentmodel.CreateAgentRequest{
		Name:   "<AGENT_NAME>",
		Model:  agentmodel.ModelConfig{ID: "doubao-seed-2-1-pro-260915"},
		System: agentmodel.NewOptString("你是一个乐于助人的智能助手。"),
	})
	if err != nil {
		panic(err)
	}
	fmt.Println(agent)
}
```

#### Response

```
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
```
