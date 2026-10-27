---
source: https://ark.volcengine.com/region:cn-beijing/docs/list-sessions-api
fetched: 2026-10-24
title: 查询会话列表
---

# 查询会话列表

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`GET https://ark.cn-beijing.volces.com/api/v3/sessions`

分页查询当前账号下的会话列表，支持按智能体、状态、标签和创建时间过滤。每条结果包含该会话当前可见的智能体、环境、资源和标签信息。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Query 参数

> 在 URL Query String 中传入。

**agent_id** `string` | 智能体 ID

按智能体 ID 过滤，只返回指定智能体的会话

**created_at_gt** `string` | 创建时间下界(不含)

创建时间大于此值（ISO 8601），不含边界

**created_at_gte** `string` | 创建时间下界(含)

创建时间大于等于此值（ISO 8601），含边界

**created_at_lt** `string` | 创建时间上界(不含)

创建时间小于此值（ISO 8601），不含边界

**created_at_lte** `string` | 创建时间上界(含)

创建时间小于等于此值（ISO 8601），含边界

**limit** `integer` `默认值 20` | 每页数量

单页返回的会话数量。

**取值范围**：`[1, 100]`

**memory_store_id** `string` | 记忆库 ID

按已挂载的记忆库筛选，仅返回资源列表中包含指定 `memory_store_id` 的会话。

**order** `string` `默认值 desc` | 排序方向

排序方向。`asc` 表示按创建时间升序，`desc` 表示按创建时间降序。

**page** `string` | 下一页标识

下一页标识。首次请求时省略；后续将上一次响应的 `next_page` 原样传入，并保持 `order` 与过滤条件不变。

**scene** `string` | 会话场景

按会话场景标记过滤。省略或传空值时不过滤。

常用值为 `default` 和 `dreams`。传入其他值不会报错，但会返回空列表。

**status** `string[]` | 会话状态

按会话运行状态过滤。可重复传入该参数；服务端返回匹配任一状态的会话。可选值：`idle`、`running`、`terminated`、`rescheduling`、`initializing`、`failed`、`upgrading`。

**tags** `object[]` | 标签过滤

按标签过滤，格式为 `tags[<KEY>]=<VALUE>`，例如 `tags[team]=agent-infra`。多个不同标签之间取交集；值为空时仅按标签键匹配。

**key** `string` `必选` | 标签键

`tags.key`

标签键，用于分类和检索

**value** `string` | 标签值

`tags.value`

用于记录该标签分类的具体内容。

## 响应参数

**data** `object[]` | 会话列表

匹配查询条件的会话列表，按 `order` 指定的方向排序。默认按创建时间降序返回，即最新创建的会话在前；无匹配结果时返回空数组 `[]`。

**agent** `object` | 智能体信息

`data.agent`

会话创建时保存的智能体配置快照。后续更新智能体不会影响该会话中的快照。

**created_at** `string` | 创建时间

`data.agent.created_at`

智能体创建完成的时间，采用 RFC 3339 格式。

**id** `string` | 智能体 ID

`data.agent.id`

智能体唯一标识符

**name** `string` | 智能体名称

`data.agent.name`

智能体名称，用于用户识别和管理

**type** `string` | 对象类型

`data.agent.type`

对象类型，固定为`agent`

**updated_at** `string` | 更新时间

`data.agent.updated_at`

智能体配置最后更新的时间，采用 RFC 3339 格式。

**version** `integer` | 版本号

`data.agent.version`

会话创建时冻结的智能体版本号。

**base_agent** `string` | 基础智能体类型

`data.agent.base_agent`

会话当前使用的基础 Agent 类型。

- `ark_agent_preview`：通用 Agent。
- `ultra_vision_agent_preview`：Seedance Managed Agent。

**description** `string` | 智能体描述

`data.agent.description`

智能体描述，用于说明智能体的用途、能力范围、适用场景等

**display_name** `string` | 显示名称

`data.agent.display_name`

会话当前使用的智能体显示名称。

**mcp_servers** `object[]` | MCP 服务列表

`data.agent.mcp_servers`

已配置的 MCP 服务列表

**name** `string` | MCP 服务名称

`data.agent.mcp_servers.name`

MCP 服务名称，供 `tools[].mcp_server_name` 引用。

**type** `string` | MCP 接入方式

`data.agent.mcp_servers.type`

MCP 服务接入方式，固定为 `url`。

**url** `string` | MCP 服务地址

`data.agent.mcp_servers.url`

会话创建时冻结的 MCP 服务访问地址。

**metadata** `object` | 自定义元数据

`data.agent.metadata`

创建智能体时设置的自定义键值对，服务端不定义固定子字段。

**model** `object` | 模型配置

`data.agent.model`

智能体使用的模型配置，包含模型或推理接入点 ID 与推理速度档位。

**id** `string` | 模型或接入点 ID

`data.agent.model.id`

智能体调用的模型 ID 或推理接入点 ID。例如模型 ID `doubao-seed-2-1-pro-260628`，或推理接入点 ID `ep-20260907123456-abcd1`。

**protocol** `string` | 调用协议

`data.agent.model.protocol`

会话模型调用使用的协议：

- `ark_responses`：方舟 Responses 协议。
- `openai_chat_completions`：OpenAI Chat Completions 兼容协议。
- `openai_responses`：OpenAI Responses 兼容协议。
- `anthropic_messages`：Anthropic Messages 兼容协议。

**reasoning_effort** `string` | 推理投入档位

`data.agent.model.reasoning_effort`

会话当前使用的推理投入档位。

**service_tier** `string` | 推理服务档位

`data.agent.model.service_tier`

会话当前使用的推理服务档位。

**speed** `string` `默认值 standard` | 推理速度

`data.agent.model.speed`

推理速度模式。可选值：`standard`、`fast`。

**thinking** `string` | 思考模式

`data.agent.model.thinking`

会话当前使用的思考模式。

**multiagent** `object` | 多智能体配置

`data.agent.multiagent`

会话当前使用的多智能体配置。

**agents** `object[]` | 成员智能体

`data.agent.multiagent.agents`

会话创建时冻结的成员智能体列表。

**type** `string` | 引用类型

`data.agent.multiagent.agents.type`

成员引用类型：

- `agent`：引用其他智能体。
- `self`：引用当前智能体。

**description** `string` | 智能体说明

`data.agent.multiagent.agents.description`

会话创建时冻结的成员智能体说明。

**display_name** `string` | 显示名称

`data.agent.multiagent.agents.display_name`

会话创建时冻结的成员智能体显示名称。

**id** `string` | 智能体 ID

`data.agent.multiagent.agents.id`

成员智能体的 ID；当 `type` 为 `self` 时，返回当前智能体的 ID。

**mcp_servers** `object[]` | MCP 服务列表

`data.agent.multiagent.agents.mcp_servers`

会话创建时冻结的成员智能体 MCP 服务配置列表。

**name** `string` | MCP 服务名称

`data.agent.multiagent.agents.mcp_servers.name`

MCP 服务名称，供 `tools[].mcp_server_name` 引用。

**type** `string` | MCP 接入方式

`data.agent.multiagent.agents.mcp_servers.type`

MCP 服务接入方式，固定为 `url`。

**url** `string` | MCP 服务地址

`data.agent.multiagent.agents.mcp_servers.url`

会话创建时冻结的 MCP 服务访问地址。

**model** `object` | 模型配置

`data.agent.multiagent.agents.model`

会话创建时冻结的成员智能体模型配置。

**id** `string` | 模型或接入点 ID

`data.agent.multiagent.agents.model.id`

成员智能体使用的模型 ID 或推理接入点 ID。

**speed** `string` | 推理速度

`data.agent.multiagent.agents.model.speed`

成员智能体使用的模型推理速度档位。

**name** `string` | 智能体名称

`data.agent.multiagent.agents.name`

会话创建时冻结的成员智能体名称。

**skills** `object[]` | Skill 列表

`data.agent.multiagent.agents.skills`

会话创建时冻结的成员智能体 Skill 配置列表。

**type** `string` | Skill 类型

`data.agent.multiagent.agents.skills.type`

Skill 来源类型：

- `ark`：方舟平台预置 Skill。
- `skill_hub`：Skill Hub 中的公共 Skill。
- `custom`：当前账号创建的自定义 Skill。

**display_name** `string` | Skill 名称

`data.agent.multiagent.agents.skills.display_name`

会话创建时记录的 Skill 展示名称。

**skill_id** `string` | Skill ID

`data.agent.multiagent.agents.skills.skill_id`

会话使用的 Skill ID。

**use_latest** `boolean` | 使用最新版本

`data.agent.multiagent.agents.skills.use_latest`

是否在创建会话时选择该 Skill 的最新版本。`true` 表示选择当时的最新版本，`false` 表示使用 `version` 指定的版本。

**version** `string` | Skill 版本

`data.agent.multiagent.agents.skills.version`

会话创建时冻结的 Skill 版本号。

**system** `string` | 系统提示词

`data.agent.multiagent.agents.system`

会话创建时冻结的成员智能体系统提示词。

**tools** `object[]` | 工具列表

`data.agent.multiagent.agents.tools`

会话创建时冻结的成员智能体工具配置列表。

**type** `string` | 工具类型

`data.agent.multiagent.agents.tools.type`

工具类型：

- `agent_toolset_20260916`：当前版本的方舟内置工具集。
- `agent_toolset_multimodal_20260825`：使用 `image_generate`、`video_generate`、`visual_search`、`general_search`、`compose_video` 和 `todo_write` 工具。
- `mcp_toolset`：指定 MCP 服务提供的工具集。
- `custom`：由客户端执行的自定义工具。
可选值：`agent_toolset_20260916`、`agent_toolset_20260701`、`agent_toolset_multimodal_20260825`、`mcp_toolset`、`custom`。

**configs** `object[]` | 工具配置

`data.agent.multiagent.agents.tools.configs`

会话创建时冻结的逐项工具配置。

**name** `string` | 工具名称

`data.agent.multiagent.agents.tools.configs.name`

会话快照中记录的工具名称。

**enabled** `boolean` | 是否启用

`data.agent.multiagent.agents.tools.configs.enabled`

工具是否启用。

**models** `object[]` | 工具模型列表

`data.agent.multiagent.agents.tools.configs.models`

会话快照中记录的图片生成或视频生成工具模型 ID 或推理接入点 ID 列表。

**id** `string` | 模型或接入点 ID

`data.agent.multiagent.agents.tools.configs.models.id`

该工具绑定的模型 ID 或推理接入点 ID。

**default** `boolean` | 是否为默认模型

`data.agent.multiagent.agents.tools.configs.models.default`

是否为该工具的默认模型。

**name** `string` | 模型名称

`data.agent.multiagent.agents.tools.configs.models.name`

服务端根据模型 ID 或推理接入点 ID 返回的模型名称。

**version** `string` | 模型版本

`data.agent.multiagent.agents.tools.configs.models.version`

服务端根据模型 ID 或推理接入点 ID 返回的模型版本。

**permission_policy** `object` | 权限策略

`data.agent.multiagent.agents.tools.configs.permission_policy`

工具使用的调用许可策略。

**type** `string` | 策略类型

`data.agent.multiagent.agents.tools.configs.permission_policy.type`

策略类型，`always_allow` 表示允许直接调用，`always_ask` 表示每次调用前需要用户确认。

**default_config** `object` | 默认工具配置

`data.agent.multiagent.agents.tools.default_config`

未在 `configs` 中单独列出的工具所使用的默认配置。

**enabled** `boolean` | 是否启用

`data.agent.multiagent.agents.tools.default_config.enabled`

未单独配置的工具是否默认启用。

**permission_policy** `object` | 权限策略

`data.agent.multiagent.agents.tools.default_config.permission_policy`

未单独配置的工具使用的调用许可策略。

**type** `string` | 策略类型

`data.agent.multiagent.agents.tools.default_config.permission_policy.type`

策略类型，`always_allow` 表示允许直接调用，`always_ask` 表示每次调用前需要用户确认。

**description** `string` | 自定义工具说明

`data.agent.multiagent.agents.tools.description`

会话创建时冻结的自定义工具说明，用于记录工具的功能和适用场景。

**input_schema** `object` | 输入参数定义

`data.agent.multiagent.agents.tools.input_schema`

返回 Session 的 Agent 快照中记录的自定义工具输入参数 JSON Schema。

**properties** `object` | 参数属性定义

`data.agent.multiagent.agents.tools.input_schema.properties`

返回 Session 的 Agent 快照中记录的 JSON Schema 属性映射。每个键为参数名，每个值为对应参数的 JSON Schema 子对象。

**required** `string[]` | 必填参数名称列表

`data.agent.multiagent.agents.tools.input_schema.required`

返回调用自定义工具时必须提供的参数名称列表。

**type** `string` | Schema 类型

`data.agent.multiagent.agents.tools.input_schema.type`

返回 JSON Schema 的顶层类型，固定为 `object`。

**mcp_server_name** `string` | MCP 服务名称

`data.agent.multiagent.agents.tools.mcp_server_name`

会话中 `mcp_toolset` 引用的 MCP 服务名称。

**name** `string` | 自定义工具名称

`data.agent.multiagent.agents.tools.name`

会话创建时冻结的自定义工具名称。

**version** `integer` | 版本号

`data.agent.multiagent.agents.version`

会话创建时冻结的成员智能体版本号。

**type** `string` | 协作模式

`data.agent.multiagent.type`

多智能体协作模式，固定为 `coordinator`。

**skills** `object[]` | 技能列表

`data.agent.skills`

会话创建时冻结的 Skill 配置列表。

**type** `string` | Skill 类型

`data.agent.skills.type`

Skill 来源类型：

- `ark`：方舟平台预置 Skill。
- `skill_hub`：Skill Hub 中的公共 Skill。
- `custom`：当前账号创建的自定义 Skill。

**display_name** `string` | Skill 名称

`data.agent.skills.display_name`

会话创建时记录的 Skill 展示名称。

**skill_id** `string` | Skill ID

`data.agent.skills.skill_id`

会话使用的 Skill ID。

**use_latest** `boolean` | 使用最新版本

`data.agent.skills.use_latest`

是否在创建会话时选择该 Skill 的最新版本。`true` 表示选择当时的最新版本，`false` 表示使用 `version` 指定的版本。

**version** `string` | Skill 版本

`data.agent.skills.version`

会话创建时冻结的 Skill 版本号。

**system** `string` | 系统提示词

`data.agent.system`

系统提示词，定义智能体的角色和行为规则

**tools** `object[]` | 工具列表

`data.agent.tools`

已配置的工具列表

**type** `string` | 工具类型

`data.agent.tools.type`

工具类型：

- `agent_toolset_20260916`：当前版本的方舟内置工具集。
- `agent_toolset_multimodal_20260825`：使用 `image_generate`、`video_generate`、`visual_search`、`general_search`、`compose_video` 和 `todo_write` 工具。
- `mcp_toolset`：指定 MCP 服务提供的工具集。
- `custom`：由客户端执行的自定义工具。
可选值：`agent_toolset_20260916`、`agent_toolset_20260701`、`agent_toolset_multimodal_20260825`、`mcp_toolset`、`custom`。

**configs** `object[]` | 工具配置

`data.agent.tools.configs`

会话创建时冻结的逐项工具配置。

**name** `string` | 工具名称

`data.agent.tools.configs.name`

会话快照中记录的工具名称。

**enabled** `boolean` | 是否启用

`data.agent.tools.configs.enabled`

工具是否启用。

**models** `object[]` | 工具模型列表

`data.agent.tools.configs.models`

会话快照中记录的图片生成或视频生成工具模型 ID 或推理接入点 ID 列表。

**id** `string` | 模型或接入点 ID

`data.agent.tools.configs.models.id`

该工具绑定的模型 ID 或推理接入点 ID。

**default** `boolean` | 是否为默认模型

`data.agent.tools.configs.models.default`

是否为该工具的默认模型。

**name** `string` | 模型名称

`data.agent.tools.configs.models.name`

服务端根据模型 ID 或推理接入点 ID 返回的模型名称。

**version** `string` | 模型版本

`data.agent.tools.configs.models.version`

服务端根据模型 ID 或推理接入点 ID 返回的模型版本。

**permission_policy** `object` | 权限策略

`data.agent.tools.configs.permission_policy`

工具使用的调用许可策略。

**type** `string` | 策略类型

`data.agent.tools.configs.permission_policy.type`

策略类型，`always_allow` 表示允许直接调用，`always_ask` 表示每次调用前需要用户确认。

**default_config** `object` | 默认工具配置

`data.agent.tools.default_config`

未在 `configs` 中单独列出的工具所使用的默认配置。

**enabled** `boolean` | 是否启用

`data.agent.tools.default_config.enabled`

未单独配置的工具是否默认启用。

**permission_policy** `object` | 权限策略

`data.agent.tools.default_config.permission_policy`

未单独配置的工具使用的调用许可策略。

**type** `string` | 策略类型

`data.agent.tools.default_config.permission_policy.type`

策略类型，`always_allow` 表示允许直接调用，`always_ask` 表示每次调用前需要用户确认。

**description** `string` | 自定义工具说明

`data.agent.tools.description`

会话创建时冻结的自定义工具说明，用于记录工具的功能和适用场景。

**input_schema** `object` | 输入参数定义

`data.agent.tools.input_schema`

返回 Session 的 Agent 快照中记录的自定义工具输入参数 JSON Schema。

**properties** `object` | 参数属性定义

`data.agent.tools.input_schema.properties`

返回 Session 的 Agent 快照中记录的 JSON Schema 属性映射。每个键为参数名，每个值为对应参数的 JSON Schema 子对象。

**required** `string[]` | 必填参数名称列表

`data.agent.tools.input_schema.required`

返回调用自定义工具时必须提供的参数名称列表。

**type** `string` | Schema 类型

`data.agent.tools.input_schema.type`

返回 JSON Schema 的顶层类型，固定为 `object`。

**mcp_server_name** `string` | MCP 服务名称

`data.agent.tools.mcp_server_name`

会话中 `mcp_toolset` 引用的 MCP 服务名称。

**name** `string` | 自定义工具名称

`data.agent.tools.name`

会话创建时冻结的自定义工具名称。

**created_at** `string` | 创建时间

`data.created_at`

会话创建完成的时间，采用 RFC 3339 格式。

**environment_id** `string` | 环境 ID

`data.environment_id`

会话实际使用的 Environment ID。

**id** `string` | 会话 ID

`data.id`

会话唯一标识符，格式为 `sesn-xxxxx`。

**status** `string` | 会话状态

`data.status`

会话运行状态。可选值：`idle`、`running`、`terminated`、`rescheduling`、`initializing`、`failed`、`upgrading`。

**type** `string` | 对象类型

`data.type`

对象类型，固定为`session`

**updated_at** `string` | 更新时间

`data.updated_at`

会话信息最后更新的时间，采用 RFC 3339 格式。

**archived_at** `string` | 归档时间

`data.archived_at`

会话归档的时间，采用 RFC 3339 格式。会话未归档时，服务端不返回该字段。

**environment** `object` | 环境信息

`data.environment`

会话实际使用的环境配置快照。后续修改原 Environment 不会改变该快照。

**created_at** `string` | 创建时间

`data.environment.created_at`

环境创建完成的时间，采用 RFC 3339 格式。

**id** `string` | 环境 ID

`data.environment.id`

环境唯一标识符

**name** `string` | 环境名称

`data.environment.name`

环境名称，用于在环境列表和会话配置中区分该环境。

**type** `string` | 对象类型

`data.environment.type`

会话环境快照类型。`environment` 表示直接使用基础 Environment；`environment_with_overrides` 表示当前会话使用了环境配置覆写。

**updated_at** `string` | 更新时间

`data.environment.updated_at`

环境配置最后更新的时间，采用 RFC 3339 格式。

**config** `object` | 环境配置

`data.environment.config`

环境运行配置，包含运行类型、网络策略、依赖包与环境变量

**type** `string` | 环境类型

`data.environment.config.type`

运行环境类型：`cloud` 表示平台托管环境，`self_hosted` 表示用户自托管环境。

**env** `object` | 环境变量

`data.environment.config.env`

会话运行环境中的环境变量键值对

**networking** `object` | 出网策略

`data.environment.config.networking`

容器出网策略配置

**type** `string` | 出网策略类型

`data.environment.config.networking.type`

会话当前使用的出网策略。`unrestricted` 表示不限制出网目标。

**packages** `object` | 依赖包配置

`data.environment.config.packages`

启动时预装的依赖包配置

**apt** `string[]` | apt 包

`data.environment.config.packages.apt`

会话环境启动时通过 apt 预装的系统包列表。

**cargo** `string[]` | Cargo 包

`data.environment.config.packages.cargo`

会话环境启动时通过 Cargo 预装的 Rust crate 列表。

**gem** `string[]` | gem 包

`data.environment.config.packages.gem`

会话环境启动时通过 RubyGems 预装的 Ruby 包列表。

**go** `string[]` | Go 模块

`data.environment.config.packages.go`

会话环境启动时通过 Go 工具链预装的模块依赖列表。

**npm** `string[]` | npm 包

`data.environment.config.packages.npm`

会话环境启动时通过 npm 预装的 Node.js 包列表。

**pip** `string[]` | pip 包

`data.environment.config.packages.pip`

会话环境启动时通过 pip 预装的 Python 包列表。

**type** `string` | 配置类型

`data.environment.config.packages.type`

依赖包配置的类型标识，固定为 `packages`。

**setup_script** `string` | 启动脚本

`data.environment.config.setup_script`

会话运行环境启动时执行的初始化脚本；留空或未设置表示不执行任何脚本

**tos** `object` | 产物存储配置

`data.environment.config.tos`

智能体产物持久化存储配置。为空表示未配置用户 Bucket，产物落到方舟公共 TOS

**bucket** `string` | TOS 桶

`data.environment.config.tos.bucket`

会话环境快照中保存的用户 TOS 存储桶名称。

**prefix** `string` | 对象前缀

`data.environment.config.tos.prefix`

会话环境快照中保存的对象存储目录前缀。

**description** `string` | 环境描述

`data.environment.description`

环境描述，用于说明环境的用途、网络策略、依赖包等配置

**metadata** `object` | 自定义元数据

`data.environment.metadata`

用户自定义元数据

**overridden_fields** `string[]` | 覆写字段

`data.environment.overridden_fields`

当前会话相对基础 Environment 实际覆写的 `config` 子字段名称列表。仅在 *type* 为 `environment_with_overrides` 且存在覆写字段时返回。

**scope** `string` | 作用域

`data.environment.scope`

环境作用域：`organization` 表示组织内共享；`account` 表示账号内可见。

**resources** `object[]` | 资源列表

`data.resources`

会话当前挂载到运行环境的资源列表。

文件资源 `object`

通过 Files API 上传并挂载到会话的文件。

**created_at** `string` | 挂载时间

`data.resources.created_at`

资源挂载到会话的时间，采用 RFC 3339 格式。

**id** `string` | 资源 ID

`data.resources.id`

会话资源 ID。

**type** `string` | 资源类型

`data.resources.type`

资源类型，固定为 `file`。

**updated_at** `string` | 更新时间

`data.resources.updated_at`

会话资源信息最后更新的时间，采用 RFC 3339 格式。

**access** `string` | 访问权限

`data.resources.access`

文件访问权限，固定为 `read_only`。

**file_id** `string` | 文件 ID

`data.resources.file_id`

当前可用的文件 ID。

**mount_path** `string` | 挂载路径

`data.resources.mount_path`

文件在会话运行环境中的完整挂载路径。

记忆库资源 `object`

挂载到会话的记忆库。

**created_at** `string` | 挂载时间

`data.resources.created_at`

资源挂载到会话的时间，采用 RFC 3339 格式。

**id** `string` | 资源 ID

`data.resources.id`

会话资源 ID。

**type** `string` | 资源类型

`data.resources.type`

资源类型，固定为 `memory_store`。

**updated_at** `string` | 更新时间

`data.resources.updated_at`

会话资源信息最后更新的时间，采用 RFC 3339 格式。

**access** `string` | 访问权限

`data.resources.access`

会话对记忆库的访问权限。

- `read_only`：智能体只能读取记忆库。

- `read_write`：智能体可以读取和修改记忆库。

**instructions** `string` | 使用指导

`data.resources.instructions`

会话当前用于该记忆库的使用指导。

**memory_store_id** `string` | 记忆库 ID

`data.resources.memory_store_id`

挂载到会话的记忆库 ID。

TOS 资源 `object`

挂载到会话的 TOS 对象目录。

**created_at** `string` | 挂载时间

`data.resources.created_at`

资源挂载到会话的时间，采用 RFC 3339 格式。

**id** `string` | 资源 ID

`data.resources.id`

会话资源 ID。

**type** `string` | 资源类型

`data.resources.type`

资源类型，固定为 `tos`。

**updated_at** `string` | 更新时间

`data.resources.updated_at`

会话资源信息最后更新的时间，采用 RFC 3339 格式。

**access** `string` | 访问权限

`data.resources.access`

会话对 TOS 目录的访问权限。可选值：`read_only`、`read_write`。

**mount_path** `string` | 挂载路径

`data.resources.mount_path`

TOS 目录在会话运行环境中的挂载路径。创建会话时未指定挂载路径，则不返回该字段。

**tos_bucket** `string` | TOS 存储桶

`data.resources.tos_bucket`

TOS 挂载源所在的存储桶名称。

**tos_key** `string` | TOS 目录前缀

`data.resources.tos_key`

TOS 中已挂载目录的对象前缀。

**tos_region** `string` | TOS 地域

`data.resources.tos_region`

TOS 挂载源所在地域的 Region ID。

**scene** `string` | 会话场景

`data.scene`

会话场景标记。

- `default`：普通会话。
- `dreams`：用于 Dream 记忆整理任务的会话。

**tags** `object[]` | 标签列表

`data.tags`

会话标签列表，每项包含 `key` 和可选的 `value`。

**key** `string` | 标签键

`data.tags.key`

标签键，用于分类和检索

**value** `string` | 标签值

`data.tags.value`

用于记录该标签分类的具体内容。

**title** `string` | 会话标题

`data.title`

会话标题，便于用户在会话列表中识别

**vault_ids** `string[] / null` | 保管库 ID 列表

`data.vault_ids`

会话绑定的保管库 ID 列表，智能体可访问其中的凭据

**next_page** `string` | 下一页标识

服务端返回的下一页标识。客户端无需解析，将此值原样作为下一次请求的 `page` 参数即可继续翻页；未返回此字段时表示已到最后一页。


## 代码示例

## 查询会话列表

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/sessions?limit=20&order=desc&status=idle" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

#### Response

```
{
  "data": [
    {
      "id": "sesn-20260715083012-a3f7b",
      "type": "session",
      "agent": {
        "id": "<AGENT_ID>",
        "type": "agent",
        "name": "<AGENT_NAME>",
        "version": 1,
        "created_at": "2026-07-15T08:00:00Z",
        "updated_at": "2026-07-15T08:00:00Z"
      },
      "environment_id": "<ENVIRONMENT_ID>",
      "title": "Q3 规划头脑风暴",
      "status": "idle",
      "created_at": "2026-07-15T08:30:12.000Z",
      "updated_at": "2026-07-15T09:00:00.000Z",
      "tags": [
        {"key": "team", "value": "agent-infra"}
      ]
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

page = client.sessions.list(
    limit=20,
    order="desc",
    status=["idle"],
)
print(page)
```

#### Response

```
{
  "data": [
    {
      "id": "sesn-20260715083012-a3f7b",
      "type": "session",
      "agent": {
        "id": "<AGENT_ID>",
        "type": "agent",
        "name": "<AGENT_NAME>",
        "version": 1,
        "created_at": "2026-07-15T08:00:00Z",
        "updated_at": "2026-07-15T08:00:00Z"
      },
      "environment_id": "<ENVIRONMENT_ID>",
      "title": "Q3 规划头脑风暴",
      "status": "idle",
      "created_at": "2026-07-15T08:30:12.000Z",
      "updated_at": "2026-07-15T09:00:00.000Z",
      "tags": [
        {"key": "team", "value": "agent-infra"}
      ]
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
import com.volcengine.ark.runtime.models.session.ListSessionsResponse;
import com.volcengine.ark.runtime.service.ArkService;
import java.util.Collections;

public class Main {
    public static void main(String[] args) throws Exception {
        ArkService service = ArkService.builder()
                .apiKey(System.getenv("ARK_API_KEY"))
                .baseUrl("https://ark.cn-beijing.volces.com/api/v3")
                .build();

        ListSessionsResponse page = service.listSessions(
                null, null, null, null, null, null, 20, null, "desc", null,
                Collections.singletonList("idle"));
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
      "id": "sesn-20260715083012-a3f7b",
      "type": "session",
      "agent": {
        "id": "<AGENT_ID>",
        "type": "agent",
        "name": "<AGENT_NAME>",
        "version": 1,
        "created_at": "2026-07-15T08:00:00Z",
        "updated_at": "2026-07-15T08:00:00Z"
      },
      "environment_id": "<ENVIRONMENT_ID>",
      "title": "Q3 规划头脑风暴",
      "status": "idle",
      "created_at": "2026-07-15T08:30:12.000Z",
      "updated_at": "2026-07-15T09:00:00.000Z",
      "tags": [
        {"key": "team", "value": "agent-infra"}
      ]
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
	sessionmodel "github.com/volcengine/ark-runtime-go/arkruntime/model/session"
)

func main() {
	ctx := context.Background()
    client := arkruntime.NewClientWithApiKey(
		os.Getenv("ARK_API_KEY"),
        arkruntime.WithBaseUrl("https://ark.cn-beijing.volces.com/api/v3"),
	)

	resp, err := client.ListSessions(ctx, &sessionmodel.SessionsListParams{
		Limit:  sessionmodel.NewOptInt32(20),
		Order:  sessionmodel.NewOptListSessionsOrder(sessionmodel.ListSessionsOrderDesc),
		Status: []sessionmodel.SessionStatus{sessionmodel.SessionStatusIdle},
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
      "id": "sesn-20260715083012-a3f7b",
      "type": "session",
      "agent": {
        "id": "<AGENT_ID>",
        "type": "agent",
        "name": "<AGENT_NAME>",
        "version": 1,
        "created_at": "2026-07-15T08:00:00Z",
        "updated_at": "2026-07-15T08:00:00Z"
      },
      "environment_id": "<ENVIRONMENT_ID>",
      "title": "Q3 规划头脑风暴",
      "status": "idle",
      "created_at": "2026-07-15T08:30:12.000Z",
      "updated_at": "2026-07-15T09:00:00.000Z",
      "tags": [
        {"key": "team", "value": "agent-infra"}
      ]
    }
  ],
  "next_page": "page_xxxxxxxx"
}
```
