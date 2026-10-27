---
source: https://ark.volcengine.com/region:cn-beijing/docs/upgrade-session-api
fetched: 2026-10-24
title: 升级会话
---

# 升级会话

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`POST https://ark.cn-beijing.volces.com/api/v3/sessions/{session_id}/upgrades`

保留同一会话并刷新其当前使用的智能体、环境或保管库配置。升级会保留原会话 ID 和已有会话内容，不能换绑其他智能体、环境或保管库。

会话必须满足以下条件才能升级：

- 当前状态为 `idle`。
- 上一轮以 `end_turn` 结束。
- 当前没有其他升级请求。

请求受理后，会话状态变为 `upgrading`。请轮询 [查询会话详情](get-session-api.md)，等待状态恢复为 `idle` 后再继续发送事件。

根据目标选择接口：

- 保留同一会话并刷新当前智能体、环境或保管库配置时，使用本接口。
- 只修改标题或标签时，使用 [更新会话标题和标签](update-session-api.md)。
- 需要新会话或更换绑定的智能体、环境时，使用 [创建会话](create-session-api.md)。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**session_id** `string` `必选` | 会话 ID

要升级的会话 ID，形如 `sesn-...`。

### Body 参数

**agent** `object` | 智能体配置

会话升级后使用的智能体配置。`id` 必须与当前会话的智能体 ID 相同，形如 `agent-...`。

**id** `string` `必选` | 智能体 ID

`agent.id`

智能体 ID，形如 `agent-...`；必须与当前会话的智能体 ID 一致。

**type** `string` `必选` | 对象类型

`agent.type`

固定为 `agent_with_upgrades`。

**display_name** `string` | 显示名称

`agent.display_name`

升级后使用的智能体展示名称。省略时保留当前值。

**mcp_servers** `object[]` | 升级后使用的 MCP 服务列表

`agent.mcp_servers`

省略时保留当前配置，传入 `[]` 时清空，传入非空数组时整体替换。

**name** `string` `必选` | MCP 服务名称

`agent.mcp_servers.name`

MCP 服务名称，供 `tools[].mcp_server_name` 引用。

**type** `string` `必选` | MCP 接入方式

`agent.mcp_servers.type`

MCP 服务接入方式，固定为 `url`。

**url** `string` `必选` | MCP 服务地址

`agent.mcp_servers.url`

MCP 服务访问地址。同一智能体内不能配置重复的地址。

**model** `object` | 会话升级后使用的模型配置

`agent.model`

支持切换模型或推理接入点，以及调整运行参数和自定义模型服务配置；省略子字段时保留当前值。

**base_url** `string` | 模型服务地址

`agent.model.base_url`

非方舟模型服务的 OpenAI 或 Anthropic 兼容 API 地址。使用方舟模型服务时省略。

**headers** `object` | 自定义请求头

`agent.model.headers`

调用非方舟模型服务时附加的 HTTP 请求头，以字符串键值对形式传入。

**id** `string` | 模型或接入点 ID

`agent.model.id`

目标模型 ID 或推理接入点 ID，例如 `doubao-seed-2-0-pro-260215` 或 `ep-20260907123456-abcd1`。

目标模型或推理接入点必须属于当前项目，并支持用于智能体。以下情况返回 400：

- ID 为空。
- 资源不可用、元信息缺失或不属于当前项目。
- 目标模型不支持用于智能体。

目标模型未开通时返回 403 `ModelNotOpen`。

变更 `id` 时，服务端会重新校验模型参数。未指定的参数继续使用升级前的值。

**input_modalities** `string[]` | 输入模态

`agent.model.input_modalities`

非方舟模型服务支持的输入模态列表，例如 `text`、`image` 或 `video`。

**protocol** `string` | 调用协议

`agent.model.protocol`

模型调用协议。

- `ark_responses`：方舟 Responses 协议。
- `openai_chat_completions`：OpenAI Chat Completions 兼容协议。
- `openai_responses`：OpenAI Responses 兼容协议。
- `anthropic_messages`：Anthropic Messages 兼容协议。

**provider** `string` | 模型服务提供方

`agent.model.provider`

模型服务提供方。切换为非方舟模型服务时，需要同时提供与该服务匹配的 `protocol` 和 `base_url`。

**reasoning_effort** `string` | 推理努力程度

`agent.model.reasoning_effort`

升级后模型使用的推理努力程度。

**service_tier** `string` | 服务档位

`agent.model.service_tier`

升级后模型调用使用的推理服务档位。

**speed** `string` | 推理速度

`agent.model.speed`

模型推理速度档位。省略时保留当前值。可选值：`standard`、`fast`。

**thinking** `string` | 思考配置

`agent.model.thinking`

升级后模型使用的思考模式配置。

**token_limits** `object` | Token 限制

`agent.model.token_limits`

非方舟模型服务使用的 Token 长度限制。使用方舟模型服务时不能传入。

**context_window** `integer` | 上下文窗口

`agent.model.token_limits.context_window`

模型上下文窗口可容纳的最大 Token 数。

**max_input_token_length** `integer` | 最大输入长度

`agent.model.token_limits.max_input_token_length`

单次模型调用允许的最大输入 Token 数。

**max_output_token_length** `integer` | 最大输出长度

`agent.model.token_limits.max_output_token_length`

单次模型调用允许的最大输出 Token 数。

**multiagent** `object` | 升级后使用的多 Agent 配置

`agent.multiagent`

省略时保留当前配置；提供时整体替换，`agents` 传入 `[]` 时清空成员智能体列表。

**agents** `object[]` `必选` | 成员智能体

`agent.multiagent.agents`

成员智能体列表，最多 20 项。传入 `[]` 时清空当前成员列表。

**type** `string` `必选` | 成员来源

`agent.multiagent.agents.type`

成员来源。`agent` 表示引用当前账号和项目中的已有 Agent；`self` 表示复用当前主 Agent。

**id** `string` | 智能体 ID

`agent.multiagent.agents.id`

成员智能体 ID。当 `type` 为 `agent` 时必填；当 `type` 为 `self` 时省略。

**version** `integer` | 智能体版本

`agent.multiagent.agents.version`

成员智能体版本号，仅当 `type` 为 `agent` 时生效。省略时使用最新版本。

**type** `string` `必选` | 协作模式

`agent.multiagent.type`

多 Agent 协作模式，固定为 `coordinator`。

**skills** `object[]` | 升级后使用的 Skill 列表

`agent.skills`

省略时保留当前配置，传入 `[]` 时清空，传入非空数组时整体替换。

**type** `string` `必选` | Skill 来源

`agent.skills.type`

Skill 来源。

- `ark`：方舟预置 Skill。
- `skill_hub`：来自 Skill Hub 的公共 Skill。
- `custom`：当前账号通过 Skills API 创建的自定义 Skill。

**skill_id** `string` | Skill ID

`agent.skills.skill_id`

要绑定的 Skill ID。

**version** `string` | Skill 版本

`agent.skills.version`

要绑定的 Skill 版本号。省略时使用该 Skill 的最新版本。

**system** `string` | 升级后使用的系统提示词

`agent.system`

省略时保留当前值。

**tools** `object[]` | 升级后使用的工具列表

`agent.tools`

省略时保留当前配置，传入 `[]` 时清空，传入非空数组时整体替换。

**type** `string` `必选` | 工具类型

`agent.tools.type`

工具类型。

- `agent_toolset_20260916`：使用方舟内置的基础工具集。
- `agent_toolset_multimodal_20260825`：使用多模态生成与搜索工具。
- `mcp_toolset`：使用指定 MCP 服务提供的工具。
- `custom`：使用由客户端执行的自定义工具。
可选值：`agent_toolset_20260401`、`agent_toolset_20260701`、`agent_toolset_20260916`、`agent_toolset_multimodal_20260825`、`mcp_toolset`、`custom`。

**configs** `object[]` | 工具配置列表

`agent.tools.configs`

按工具名称设置工具的启用状态、权限策略和工具模型。

**name** `string` `必选` | 工具名称

`agent.tools.configs.name`

工具配置对应的工具名称。

**enabled** `boolean` | 是否启用

`agent.tools.configs.enabled`

是否启用此工具。

**models** `object[]` | 工具模型列表

`agent.tools.configs.models`

图片生成或视频生成工具使用的模型 ID 或推理接入点 ID 列表。目标模型必须已在当前项目中开通，并支持对应工具。

> **说明**
>
> 最多填写 10 项，且同一工具配置内的模型 ID 或推理接入点 ID 不能重复。配置多项时，必须且只能将一项的 `default` 设置为 `true`。

**id** `string` `必选` | 模型或接入点 ID

`agent.tools.configs.models.id`

图片生成或视频生成工具调用的模型 ID 或推理接入点 ID。

**default** `boolean` `默认值 false` | 是否为默认模型

`agent.tools.configs.models.default`

是否作为该工具的默认模型。配置多项时，必须且只能将一项设置为 `true`。

**permission_policy** `object` | 权限策略

`agent.tools.configs.permission_policy`

该工具使用的调用许可策略。

**type** `string` `必选` | 策略类型

`agent.tools.configs.permission_policy.type`

策略类型，`always_allow` 表示允许直接调用，`always_ask` 表示每次调用前需要用户确认。

**default_config** `object` | 默认工具配置

`agent.tools.default_config`

未在 `configs` 中单独配置的工具所使用的默认启用状态和权限策略。

**enabled** `boolean` | 是否启用

`agent.tools.default_config.enabled`

未单独配置的工具是否默认启用。

**permission_policy** `object` | 权限策略

`agent.tools.default_config.permission_policy`

未单独配置的工具使用的调用许可策略。

**type** `string` `必选` | 策略类型

`agent.tools.default_config.permission_policy.type`

策略类型，`always_allow` 表示允许直接调用，`always_ask` 表示每次调用前需要用户确认。

**description** `string` | 自定义工具描述

`agent.tools.description`

说明自定义工具的功能和适用场景，供模型判断何时调用该工具。

**input_schema** `object` | 输入参数定义

`agent.tools.input_schema`

定义自定义工具的输入参数及其约束。

**properties** `object` | 参数属性定义

`agent.tools.input_schema.properties`

自定义工具输入参数的 JSON Schema `properties` 对象。键为参数名，值为对应参数的 JSON Schema 子对象。

**required** `string[]` | 必填参数名称列表

`agent.tools.input_schema.required`

自定义工具输入中必填的参数名称列表。每个名称必须与 `properties` 中定义的参数名称一致。

**type** `string` `默认值 object` | Schema 类型

`agent.tools.input_schema.type`

JSON Schema 的顶层类型，仅支持 `object`。

**mcp_server_name** `string` | MCP 服务名称

`agent.tools.mcp_server_name`

`mcp_toolset` 工具引用的 MCP 服务名称，必须与 `mcp_servers[].name` 一致。

**name** `string` | 自定义工具名称

`agent.tools.name`

> **说明**
>
> `type` 为 `custom` 时必填。只能包含字母、数字、下划线和连字符，且同一 Agent 内不能重复。

**version** `integer` | 版本号

`agent.version`

目标智能体版本号。与创建会话不同，省略或传入 `0` 表示继续使用当前会话的智能体配置，不会自动切换到最新版本。

- 如需切换，请显式提供正整数版本号。
- 指定版本时，先使用该版本保存的配置，再应用本次请求中提供的同名字段。

**environment** `object` | 环境配置

当前会话所用环境的引用，用于刷新该环境的最新配置。`id` 用于确认要刷新的环境，必须与会话当前绑定的环境 ID 相同。

**id** `string` `必选` | 环境 ID

`environment.id`

环境 ID，形如 `env-...`；必须与当前会话的环境 ID 一致。

**type** `string` `必选` | 对象类型

`environment.type`

固定为 `environment_with_upgrades`。

**config** `object` | 会话运行环境的配置变更

`environment.config`

云端环境支持追加依赖包、合并环境变量和替换初始化脚本；自托管环境不接受这些运行时字段。

**env** `object` | 要追加或更新的环境变量，以字符串键值对形式传入

`environment.config.env`

服务端与当前配置合并，同名变量使用本次请求中的值。

**packages** `object` | 要追加或更新的依赖包

`environment.config.packages`

服务端按包名与当前配置合并：同名包使用本次请求中的版本，新包追加到现有列表。

**apt** `string[]` | APT 软件包

`environment.config.packages.apt`

apt 依赖。

**cargo** `string[]` | Cargo 包

`environment.config.packages.cargo`

cargo 依赖。

**gem** `string[]` | Ruby Gem 包

`environment.config.packages.gem`

gem 依赖。

**go** `string[]` | Go 模块

`environment.config.packages.go`

go module 依赖。

**npm** `string[]` | npm 包

`environment.config.packages.npm`

npm 依赖。

**pip** `string[]` | Python 包

`environment.config.packages.pip`

pip 依赖。

**type** `string` | 配置类型

`environment.config.packages.type`

固定为 `packages`。

**setup_script** `string` | 升级后使用的初始化脚本

`environment.config.setup_script`

省略时保留当前值，传入空字符串时清空。

**vault_ids** `string[]` | 保管库 ID 列表

当前会话绑定的保管库 ID 列表，用于重新加载这些保管库中的凭证配置，不会改变会话与保管库的绑定关系。

传入的 ID 集合必须与当前绑定一致，不考虑顺序和重复项。

省略该字段表示保持现有绑定不变。传入 `[]` 仅适用于当前会话未绑定 Vault 的情况。

## 响应参数

**agent** `object` | 智能体配置

会话升级后的智能体配置。请求中包含 `agent` 时返回刷新后的配置；未包含 `agent` 时返回升级前沿用的配置。

**created_at** `string` | 创建时间

`agent.created_at`

智能体创建完成的时间，采用 RFC 3339 格式。

**id** `string` | 智能体 ID

`agent.id`

会话当前使用的智能体 ID。

**name** `string` | 智能体名称

`agent.name`

会话当前使用的智能体名称。

**type** `string` | 对象类型

`agent.type`

对象类型，固定为 `agent`。

**updated_at** `string` | 更新时间

`agent.updated_at`

智能体配置最后更新的时间，采用 RFC 3339 格式。

**version** `integer` | 版本号

`agent.version`

会话当前使用的智能体版本号。

**base_agent** `string` | 基础智能体类型

`agent.base_agent`

当前配置使用的基础 Agent 类型。

- `ark_agent_preview`：通用 Agent。
- `ultra_vision_agent_preview`：Seedance Managed Agent。

**description** `string` | 智能体说明

`agent.description`

会话当前使用的智能体说明。

**display_name** `string` | 显示名称

`agent.display_name`

会话当前使用的智能体显示名称。

**mcp_servers** `object[]` | MCP 服务列表

`agent.mcp_servers`

当前 Session 使用的 MCP server 配置列表。

**name** `string` | MCP 服务名称

`agent.mcp_servers.name`

MCP 服务名称，供 `tools[].mcp_server_name` 引用。

**type** `string` | MCP 接入方式

`agent.mcp_servers.type`

MCP 服务接入方式，固定为 `url`。

**url** `string` | MCP 服务地址

`agent.mcp_servers.url`

会话创建时冻结的 MCP 服务访问地址。

**metadata** `object` | 自定义元数据

`agent.metadata`

创建智能体时设置的自定义键值对，服务端不定义固定子字段。

**model** `object` | 模型配置

`agent.model`

当前 Session 实际使用的模型配置。

**id** `string` | 模型或接入点 ID

`agent.model.id`

会话当前使用的模型 ID 或推理接入点 ID。

**protocol** `string` | 调用协议

`agent.model.protocol`

会话模型调用使用的协议：

- `ark_responses`：方舟 Responses 协议。
- `openai_chat_completions`：OpenAI Chat Completions 兼容协议。
- `openai_responses`：OpenAI Responses 兼容协议。
- `anthropic_messages`：Anthropic Messages 兼容协议。

**reasoning_effort** `string` | 推理投入档位

`agent.model.reasoning_effort`

会话当前使用的推理投入档位。

**service_tier** `string` | 推理服务档位

`agent.model.service_tier`

会话当前使用的推理服务档位。

**speed** `string` | 推理速度

`agent.model.speed`

模型推理速度档位。

**thinking** `string` | 思考模式

`agent.model.thinking`

会话当前使用的思考模式。

**multiagent** `object` | 多智能体配置

`agent.multiagent`

当前 Session 使用的多 Agent 配置。

**agents** `object[]` | 成员智能体

`agent.multiagent.agents`

会话创建时冻结的成员智能体列表。

**type** `string` | 引用类型

`agent.multiagent.agents.type`

成员引用类型：

- `agent`：引用其他智能体。
- `self`：引用当前智能体。

**description** `string` | 智能体说明

`agent.multiagent.agents.description`

会话创建时冻结的成员智能体说明。

**display_name** `string` | 显示名称

`agent.multiagent.agents.display_name`

会话创建时冻结的成员智能体显示名称。

**id** `string` | 智能体 ID

`agent.multiagent.agents.id`

成员智能体的 ID；当 `type` 为 `self` 时，返回当前智能体的 ID。

**mcp_servers** `object[]` | MCP 服务列表

`agent.multiagent.agents.mcp_servers`

会话创建时冻结的成员智能体 MCP 服务配置列表。

**name** `string` | MCP 服务名称

`agent.multiagent.agents.mcp_servers.name`

MCP 服务名称，供 `tools[].mcp_server_name` 引用。

**type** `string` | MCP 接入方式

`agent.multiagent.agents.mcp_servers.type`

MCP 服务接入方式，固定为 `url`。

**url** `string` | MCP 服务地址

`agent.multiagent.agents.mcp_servers.url`

会话创建时冻结的 MCP 服务访问地址。

**model** `object` | 模型配置

`agent.multiagent.agents.model`

会话创建时冻结的成员智能体模型配置。

**id** `string` | 模型或接入点 ID

`agent.multiagent.agents.model.id`

成员智能体使用的模型 ID 或推理接入点 ID。

**speed** `string` | 推理速度

`agent.multiagent.agents.model.speed`

成员智能体使用的模型推理速度档位。

**name** `string` | 智能体名称

`agent.multiagent.agents.name`

会话创建时冻结的成员智能体名称。

**skills** `object[]` | Skill 列表

`agent.multiagent.agents.skills`

会话创建时冻结的成员智能体 Skill 配置列表。

**type** `string` | Skill 类型

`agent.multiagent.agents.skills.type`

Skill 来源类型：

- `ark`：方舟平台预置 Skill。
- `skill_hub`：Skill Hub 中的公共 Skill。
- `custom`：当前账号创建的自定义 Skill。

**display_name** `string` | Skill 名称

`agent.multiagent.agents.skills.display_name`

会话创建时记录的 Skill 展示名称。

**skill_id** `string` | Skill ID

`agent.multiagent.agents.skills.skill_id`

会话使用的 Skill ID。

**use_latest** `boolean` | 使用最新版本

`agent.multiagent.agents.skills.use_latest`

是否在创建会话时选择该 Skill 的最新版本。`true` 表示选择当时的最新版本，`false` 表示使用 `version` 指定的版本。

**version** `string` | Skill 版本

`agent.multiagent.agents.skills.version`

会话创建时冻结的 Skill 版本号。

**system** `string` | 系统提示词

`agent.multiagent.agents.system`

会话创建时冻结的成员智能体系统提示词。

**tools** `object[]` | 工具列表

`agent.multiagent.agents.tools`

会话创建时冻结的成员智能体工具配置列表。

**type** `string` | 工具类型

`agent.multiagent.agents.tools.type`

工具类型：

- `agent_toolset_20260916`：当前版本的方舟内置工具集。
- `agent_toolset_multimodal_20260825`：使用 `image_generate`、`video_generate`、`visual_search`、`general_search`、`compose_video` 和 `todo_write` 工具。
- `mcp_toolset`：指定 MCP 服务提供的工具集。
- `custom`：由客户端执行的自定义工具。
可选值：`agent_toolset_20260916`、`agent_toolset_20260701`、`agent_toolset_multimodal_20260825`、`mcp_toolset`、`custom`。

**configs** `object[]` | 工具配置

`agent.multiagent.agents.tools.configs`

会话创建时冻结的逐项工具配置。

**name** `string` | 工具名称

`agent.multiagent.agents.tools.configs.name`

会话快照中记录的工具名称。

**enabled** `boolean` | 是否启用

`agent.multiagent.agents.tools.configs.enabled`

工具是否启用。

**models** `object[]` | 工具模型列表

`agent.multiagent.agents.tools.configs.models`

会话快照中记录的图片生成或视频生成工具模型 ID 或推理接入点 ID 列表。

**id** `string` | 模型或接入点 ID

`agent.multiagent.agents.tools.configs.models.id`

该工具绑定的模型 ID 或推理接入点 ID。

**default** `boolean` | 是否为默认模型

`agent.multiagent.agents.tools.configs.models.default`

是否为该工具的默认模型。

**name** `string` | 模型名称

`agent.multiagent.agents.tools.configs.models.name`

服务端根据模型 ID 或推理接入点 ID 返回的模型名称。

**version** `string` | 模型版本

`agent.multiagent.agents.tools.configs.models.version`

服务端根据模型 ID 或推理接入点 ID 返回的模型版本。

**permission_policy** `object` | 权限策略

`agent.multiagent.agents.tools.configs.permission_policy`

工具使用的调用许可策略。

**type** `string` | 策略类型

`agent.multiagent.agents.tools.configs.permission_policy.type`

策略类型，`always_allow` 表示允许直接调用，`always_ask` 表示每次调用前需要用户确认。

**default_config** `object` | 默认工具配置

`agent.multiagent.agents.tools.default_config`

未在 `configs` 中单独列出的工具所使用的默认配置。

**enabled** `boolean` | 是否启用

`agent.multiagent.agents.tools.default_config.enabled`

未单独配置的工具是否默认启用。

**permission_policy** `object` | 权限策略

`agent.multiagent.agents.tools.default_config.permission_policy`

未单独配置的工具使用的调用许可策略。

**type** `string` | 策略类型

`agent.multiagent.agents.tools.default_config.permission_policy.type`

策略类型，`always_allow` 表示允许直接调用，`always_ask` 表示每次调用前需要用户确认。

**description** `string` | 自定义工具说明

`agent.multiagent.agents.tools.description`

会话创建时冻结的自定义工具说明，用于记录工具的功能和适用场景。

**input_schema** `object` | 输入参数定义

`agent.multiagent.agents.tools.input_schema`

返回 Session 的 Agent 快照中记录的自定义工具输入参数 JSON Schema。

**properties** `object` | 参数属性定义

`agent.multiagent.agents.tools.input_schema.properties`

返回 Session 的 Agent 快照中记录的 JSON Schema 属性映射。每个键为参数名，每个值为对应参数的 JSON Schema 子对象。

**required** `string[]` | 必填参数名称列表

`agent.multiagent.agents.tools.input_schema.required`

返回调用自定义工具时必须提供的参数名称列表。

**type** `string` | Schema 类型

`agent.multiagent.agents.tools.input_schema.type`

返回 JSON Schema 的顶层类型，固定为 `object`。

**mcp_server_name** `string` | MCP 服务名称

`agent.multiagent.agents.tools.mcp_server_name`

会话中 `mcp_toolset` 引用的 MCP 服务名称。

**name** `string` | 自定义工具名称

`agent.multiagent.agents.tools.name`

会话创建时冻结的自定义工具名称。

**version** `integer` | 版本号

`agent.multiagent.agents.version`

会话创建时冻结的成员智能体版本号。

**type** `string` | 协作模式

`agent.multiagent.type`

多智能体协作模式，固定为 `coordinator`。

**skills** `object[]` | Skill 列表

`agent.skills`

当前 Session 使用的 Skill 配置列表。

**type** `string` | Skill 类型

`agent.skills.type`

Skill 来源类型：

- `ark`：方舟平台预置 Skill。
- `skill_hub`：Skill Hub 中的公共 Skill。
- `custom`：当前账号创建的自定义 Skill。

**display_name** `string` | Skill 名称

`agent.skills.display_name`

会话创建时记录的 Skill 展示名称。

**skill_id** `string` | Skill ID

`agent.skills.skill_id`

会话使用的 Skill ID。

**use_latest** `boolean` | 使用最新版本

`agent.skills.use_latest`

是否在创建会话时选择该 Skill 的最新版本。`true` 表示选择当时的最新版本，`false` 表示使用 `version` 指定的版本。

**version** `string` | Skill 版本

`agent.skills.version`

会话创建时冻结的 Skill 版本号。

**system** `string` | 系统提示词

`agent.system`

会话当前使用的系统提示词。

**tools** `object[]` | 工具列表

`agent.tools`

当前 Session 使用的工具配置列表，字段结构与 Agent 对象中的 `tools` 一致。

**type** `string` | 工具类型

`agent.tools.type`

工具类型：

- `agent_toolset_20260916`：当前版本的方舟内置工具集。
- `agent_toolset_multimodal_20260825`：使用 `image_generate`、`video_generate`、`visual_search`、`general_search`、`compose_video` 和 `todo_write` 工具。
- `mcp_toolset`：指定 MCP 服务提供的工具集。
- `custom`：由客户端执行的自定义工具。
可选值：`agent_toolset_20260916`、`agent_toolset_20260701`、`agent_toolset_multimodal_20260825`、`mcp_toolset`、`custom`。

**configs** `object[]` | 工具配置

`agent.tools.configs`

会话创建时冻结的逐项工具配置。

**name** `string` | 工具名称

`agent.tools.configs.name`

会话快照中记录的工具名称。

**enabled** `boolean` | 是否启用

`agent.tools.configs.enabled`

工具是否启用。

**models** `object[]` | 工具模型列表

`agent.tools.configs.models`

会话快照中记录的图片生成或视频生成工具模型 ID 或推理接入点 ID 列表。

**id** `string` | 模型或接入点 ID

`agent.tools.configs.models.id`

该工具绑定的模型 ID 或推理接入点 ID。

**default** `boolean` | 是否为默认模型

`agent.tools.configs.models.default`

是否为该工具的默认模型。

**name** `string` | 模型名称

`agent.tools.configs.models.name`

服务端根据模型 ID 或推理接入点 ID 返回的模型名称。

**version** `string` | 模型版本

`agent.tools.configs.models.version`

服务端根据模型 ID 或推理接入点 ID 返回的模型版本。

**permission_policy** `object` | 权限策略

`agent.tools.configs.permission_policy`

工具使用的调用许可策略。

**type** `string` | 策略类型

`agent.tools.configs.permission_policy.type`

策略类型，`always_allow` 表示允许直接调用，`always_ask` 表示每次调用前需要用户确认。

**default_config** `object` | 默认工具配置

`agent.tools.default_config`

未在 `configs` 中单独列出的工具所使用的默认配置。

**enabled** `boolean` | 是否启用

`agent.tools.default_config.enabled`

未单独配置的工具是否默认启用。

**permission_policy** `object` | 权限策略

`agent.tools.default_config.permission_policy`

未单独配置的工具使用的调用许可策略。

**type** `string` | 策略类型

`agent.tools.default_config.permission_policy.type`

策略类型，`always_allow` 表示允许直接调用，`always_ask` 表示每次调用前需要用户确认。

**description** `string` | 自定义工具说明

`agent.tools.description`

会话创建时冻结的自定义工具说明，用于记录工具的功能和适用场景。

**input_schema** `object` | 输入参数定义

`agent.tools.input_schema`

返回 Session 的 Agent 快照中记录的自定义工具输入参数 JSON Schema。

**properties** `object` | 参数属性定义

`agent.tools.input_schema.properties`

返回 Session 的 Agent 快照中记录的 JSON Schema 属性映射。每个键为参数名，每个值为对应参数的 JSON Schema 子对象。

**required** `string[]` | 必填参数名称列表

`agent.tools.input_schema.required`

返回调用自定义工具时必须提供的参数名称列表。

**type** `string` | Schema 类型

`agent.tools.input_schema.type`

返回 JSON Schema 的顶层类型，固定为 `object`。

**mcp_server_name** `string` | MCP 服务名称

`agent.tools.mcp_server_name`

会话中 `mcp_toolset` 引用的 MCP 服务名称。

**name** `string` | 自定义工具名称

`agent.tools.name`

会话创建时冻结的自定义工具名称。

**created_at** `string` | 创建时间

会话创建完成的时间，采用 RFC 3339 格式。

**environment_id** `string` | 环境 ID

升级后会话实际使用的 Environment ID。

**id** `string` | 会话 ID

会话 ID，形如 `sesn-...`，与请求中的 `session_id` 相同。

**status** `string` | 会话状态

会话运行状态。请求受理后返回 `upgrading`；等待状态恢复为 `idle` 后再继续发送事件。取值：`idle` / `running` / `terminated` / `rescheduling` / `initializing` / `failed` / `upgrading`。

**type** `string` | 对象类型

固定为 `session`。

**updated_at** `string` | 更新时间

会话信息最后更新的时间，采用 RFC 3339 格式。

**archived_at** `string` | 归档时间

会话归档的时间，采用 RFC 3339 格式。会话未归档时，服务端不返回该字段。

**environment** `object` | 环境配置

当前会话实际使用的环境配置。后续修改原环境不会自动改变该会话。

**created_at** `string` | 创建时间

`environment.created_at`

环境创建完成的时间，采用 RFC 3339 格式。

**id** `string` | 环境 ID

`environment.id`

会话当前使用的 Environment ID。

**name** `string` | 环境名称

`environment.name`

会话当前使用的环境名称。

**type** `string` | 对象类型

`environment.type`

会话环境快照类型。`environment` 表示直接使用基础 Environment；`environment_with_overrides` 表示当前会话使用了环境配置覆写。

**updated_at** `string` | 更新时间

`environment.updated_at`

环境配置最后更新的时间，采用 RFC 3339 格式。

**config** `object` | 环境配置

`environment.config`

当前会话使用的环境配置。

**type** `string` | 环境类型

`environment.config.type`

运行环境类型。可选值：`cloud`、`self_hosted`。

**env** `object` | 环境变量

`environment.config.env`

会话运行环境中的环境变量键值对。

**networking** `object` | 出网策略

`environment.config.networking`

容器出网策略。

**type** `string` | 出网策略类型

`environment.config.networking.type`

会话当前使用的出网策略。`unrestricted` 表示不限制出网目标。

**packages** `object` | 依赖包配置

`environment.config.packages`

启动时预装的依赖包。

**apt** `string[]` | apt 包

`environment.config.packages.apt`

会话环境启动时通过 apt 预装的系统包列表。

**cargo** `string[]` | Cargo 包

`environment.config.packages.cargo`

会话环境启动时通过 Cargo 预装的 Rust crate 列表。

**gem** `string[]` | gem 包

`environment.config.packages.gem`

会话环境启动时通过 RubyGems 预装的 Ruby 包列表。

**go** `string[]` | Go 模块

`environment.config.packages.go`

会话环境启动时通过 Go 工具链预装的模块依赖列表。

**npm** `string[]` | npm 包

`environment.config.packages.npm`

会话环境启动时通过 npm 预装的 Node.js 包列表。

**pip** `string[]` | pip 包

`environment.config.packages.pip`

会话环境启动时通过 pip 预装的 Python 包列表。

**type** `string` | 配置类型

`environment.config.packages.type`

依赖包配置的类型标识，固定为 `packages`。

**setup_script** `string` | 启动脚本

`environment.config.setup_script`

会话运行环境启动时执行的初始化脚本。

**tos** `object` | 产物存储配置

`environment.config.tos`

Environment outputs 的 TOS 存储配置。

**bucket** `string` | TOS 桶

`environment.config.tos.bucket`

会话环境快照中保存的用户 TOS 存储桶名称。

**prefix** `string` | 对象前缀

`environment.config.tos.prefix`

会话环境快照中保存的对象存储目录前缀。

**description** `string` | 环境说明

`environment.description`

会话当前使用的环境说明。

**metadata** `object` | 自定义元数据

`environment.metadata`

用户自定义元数据。

**overridden_fields** `string[]` | 覆写字段

`environment.overridden_fields`

当前会话相对基础 Environment 实际覆写的 `config` 子字段名称列表。仅在 *type* 为 `environment_with_overrides` 且存在覆写字段时返回。

**scope** `string` | 环境作用域

`environment.scope`

环境配置的可见范围：`organization` 表示组织内共享，`account` 表示账号内可见。

**resources** `object[]` | 资源列表

升级后会话当前挂载到运行环境的资源列表。

文件资源 `object`

通过 Files API 上传并挂载到会话的文件。

**created_at** `string` | 挂载时间

`resources.created_at`

资源挂载到会话的时间，采用 RFC 3339 格式。

**id** `string` | 资源 ID

`resources.id`

会话资源 ID。

**type** `string` | 资源类型

`resources.type`

资源类型，固定为 `file`。

**updated_at** `string` | 更新时间

`resources.updated_at`

会话资源信息最后更新的时间，采用 RFC 3339 格式。

**access** `string` | 访问权限

`resources.access`

文件访问权限，固定为 `read_only`。

**file_id** `string` | 文件 ID

`resources.file_id`

当前可用的文件 ID。

**mount_path** `string` | 挂载路径

`resources.mount_path`

文件在会话运行环境中的完整挂载路径。

记忆库资源 `object`

挂载到会话的记忆库。

**created_at** `string` | 挂载时间

`resources.created_at`

资源挂载到会话的时间，采用 RFC 3339 格式。

**id** `string` | 资源 ID

`resources.id`

会话资源 ID。

**type** `string` | 资源类型

`resources.type`

资源类型，固定为 `memory_store`。

**updated_at** `string` | 更新时间

`resources.updated_at`

会话资源信息最后更新的时间，采用 RFC 3339 格式。

**access** `string` | 访问权限

`resources.access`

会话对记忆库的访问权限。

- `read_only`：智能体只能读取记忆库。

- `read_write`：智能体可以读取和修改记忆库。

**instructions** `string` | 使用指导

`resources.instructions`

会话当前用于该记忆库的使用指导。

**memory_store_id** `string` | 记忆库 ID

`resources.memory_store_id`

挂载到会话的记忆库 ID。

TOS 资源 `object`

挂载到会话的 TOS 对象目录。

**created_at** `string` | 挂载时间

`resources.created_at`

资源挂载到会话的时间，采用 RFC 3339 格式。

**id** `string` | 资源 ID

`resources.id`

会话资源 ID。

**type** `string` | 资源类型

`resources.type`

资源类型，固定为 `tos`。

**updated_at** `string` | 更新时间

`resources.updated_at`

会话资源信息最后更新的时间，采用 RFC 3339 格式。

**access** `string` | 访问权限

`resources.access`

会话对 TOS 目录的访问权限。可选值：`read_only`、`read_write`。

**mount_path** `string` | 挂载路径

`resources.mount_path`

TOS 目录在会话运行环境中的挂载路径。创建会话时未指定挂载路径，则不返回该字段。

**tos_bucket** `string` | TOS 存储桶

`resources.tos_bucket`

TOS 挂载源所在的存储桶名称。

**tos_key** `string` | TOS 目录前缀

`resources.tos_key`

TOS 中已挂载目录的对象前缀。

**tos_region** `string` | TOS 地域

`resources.tos_region`

TOS 挂载源所在地域的 Region ID。

**scene** `string` | 会话场景

会话场景标记。

- `default`：普通会话。
- `dreams`：用于 Dream 记忆整理任务的会话。

**tags** `object[]` | 标签列表

会话标签，用于业务侧检索与分组。

**key** `string` | 标签键

`tags.key`

标签键，用于分类和检索

**value** `string` | 标签值

`tags.value`

用于记录该标签分类的具体内容。

**title** `string` | 会话标题

升级后的会话标题，用于识别和检索该会话。

**vault_ids** `string[] / null` | 保管库 ID 列表

升级后会话可访问的保管库 ID 列表。智能体可在运行过程中使用其中的凭证。


## 代码示例

## 升级会话

### cURL


#### Request

```bash
curl -sS --fail-with-body \
  "https://ark.cn-beijing.volces.com/api/v3/sessions/<SESSION_ID>/upgrades" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d @- <<'EOF'
{
  "agent": {
    "type": "agent_with_upgrades",
    "id": "<AGENT_ID>",
    "version": 2,
    "display_name": "数据分析助手（快速分析）",
    "system": "你是一个数据分析助手。优先给出结论、关键指标和异常项。"
  }
}
EOF
```

#### Response

```
{
  "id": "<SESSION_ID>",
  "type": "session",
  "status": "upgrading",
  "environment_id": "<ENVIRONMENT_ID>",
  "agent": {
    "id": "<AGENT_ID>",
    "type": "agent",
    "name": "数据分析助手",
    "display_name": "数据分析助手（快速分析）",
    "version": 2,
    "system": "你是一个数据分析助手。优先给出结论、关键指标和异常项。",
    "created_at": "2026-10-19T08:00:00Z",
    "updated_at": "2026-10-19T08:40:00Z"
  },
  "created_at": "2026-10-19T08:30:00Z",
  "updated_at": "2026-10-19T08:40:00Z"
}
```

### Python


#### Request

```python
import json
import os

from arkruntime import Ark

client = Ark(
    api_key=os.environ["ARK_API_KEY"],
    base_url="https://ark.cn-beijing.volces.com/api/v3",
)

result = client.post(
    "/sessions/<SESSION_ID>/upgrades",
    cast_to=object,
    body={
        "agent": {
            "type": "agent_with_upgrades",
            "id": "<AGENT_ID>",
            "version": 2,
            "display_name": "数据分析助手（快速分析）",
            "system": "你是一个数据分析助手。优先给出结论、关键指标和异常项。"
        }
    },
)
print(json.dumps(result, ensure_ascii=False, indent=2))
```

#### Response

```
{
  "id": "<SESSION_ID>",
  "type": "session",
  "status": "upgrading",
  "environment_id": "<ENVIRONMENT_ID>",
  "agent": {
    "id": "<AGENT_ID>",
    "type": "agent",
    "name": "数据分析助手",
    "display_name": "数据分析助手（快速分析）",
    "version": 2,
    "system": "你是一个数据分析助手。优先给出结论、关键指标和异常项。",
    "created_at": "2026-10-19T08:00:00Z",
    "updated_at": "2026-10-19T08:40:00Z"
  },
  "created_at": "2026-10-19T08:30:00Z",
  "updated_at": "2026-10-19T08:40:00Z"
}
```
