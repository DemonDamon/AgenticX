---
source: https://ark.volcengine.com/region:cn-beijing/docs/update-session-api
fetched: 2026-10-24
title: 更新会话标题和标签
---

# 更新会话标题和标签

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`POST https://ark.cn-beijing.volces.com/api/v3/sessions/{session_id}`

修改会话的 `title` 和 `tags`：

- 省略字段时保留原值。
- `title` 传空白字符串时清空标题。
- `tags` 传 `[]` 时清空自定义标签，服务端维护的保留标签不受影响。

根据目标选择接口：

- 只修改标题或标签时，使用本接口。
- 保留同一会话并刷新当前智能体、环境或保管库配置时，使用 [升级会话](upgrade-session-api.md)。
- 需要新会话或更换绑定的智能体、环境时，使用 [创建会话](create-session-api.md)。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**session_id** `string` `必选` | 会话 ID

要更新的会话 ID，格式为 `sesn-` 开头的字符串。

### Body 参数

**tags** `object[]` | 标签列表

更新后的会话标签列表，最多 20 项。省略时保留原值，传 `[]` 时清空自定义标签，传非空数组时整体替换自定义标签；服务端维护的保留标签不受影响。

**key** `string` `必选` | 标签键

`tags.key`

标签的键，用于标识分类维度。

**value** `string` | 标签值

`tags.value`

用于记录该标签分类的具体内容。

**title** `string` | 会话标题

新的会话标题，最长 255 个字符。省略时保留原值；传入去除首尾空白后为空的字符串时清空标题

## 响应参数

**agent** `object` | 智能体信息

创建会话时保存的智能体配置快照，包含该会话实际使用的模型、系统提示词、工具、MCP 服务和技能等配置。后续更新智能体不会影响该会话中的快照。

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

会话当前使用的基础 Agent 类型。

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

会话当前使用的 MCP 服务配置列表。

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

会话当前使用的模型配置。

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

会话当前使用的多智能体配置。

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

会话当前使用的 Skill 配置列表。

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

会话当前使用的工具配置列表。

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

会话实际使用的 Environment ID。

**id** `string` | 会话 ID

会话唯一标识符，格式为 `sesn-xxxxx`。

**status** `string` | 会话状态

会话运行状态。可选值：`idle`、`running`、`terminated`、`rescheduling`、`initializing`、`failed`、`upgrading`。

**type** `string` | 对象类型

对象类型，固定为`session`

**updated_at** `string` | 更新时间

会话信息最后更新的时间，采用 RFC 3339 格式。

**archived_at** `string` | 归档时间

会话归档的时间，采用 RFC 3339 格式。会话未归档时，服务端不返回该字段。

**environment** `object` | 环境信息

当前会话实际使用的环境配置。后续修改原环境不会自动改变该会话。

**created_at** `string` | 创建时间

`environment.created_at`

环境创建完成的时间，采用 RFC 3339 格式。

**id** `string` | 环境 ID

`environment.id`

环境唯一标识符

**name** `string` | 环境名称

`environment.name`

环境名称，用于在环境列表和会话配置中区分该环境。

**type** `string` | 对象类型

`environment.type`

会话环境快照类型。`environment` 表示直接使用基础 Environment；`environment_with_overrides` 表示当前会话使用了环境配置覆写。

**updated_at** `string` | 更新时间

`environment.updated_at`

环境配置最后更新的时间，采用 RFC 3339 格式。

**config** `object` | 环境配置

`environment.config`

环境运行配置，包含运行类型、网络策略、依赖包与环境变量

**type** `string` | 环境类型

`environment.config.type`

会话运行环境类型：`cloud` 表示平台托管环境，`self_hosted` 表示用户自托管环境。

**env** `object` | 环境变量

`environment.config.env`

会话运行环境中的环境变量键值对

**networking** `object` | 出网策略

`environment.config.networking`

容器出网策略配置

**type** `string` | 出网策略类型

`environment.config.networking.type`

会话当前使用的出网策略。`unrestricted` 表示不限制出网目标。

**packages** `object` | 依赖包配置

`environment.config.packages`

启动时预装的依赖包配置

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

会话运行环境启动时执行的初始化脚本；留空或未设置表示不执行脚本

**tos** `object` | 产物存储配置

`environment.config.tos`

智能体产物持久化存储配置。为空表示未配置用户 Bucket，产物落到方舟公共 TOS

**bucket** `string` | TOS 桶

`environment.config.tos.bucket`

会话环境快照中保存的用户 TOS 存储桶名称。

**prefix** `string` | 对象前缀

`environment.config.tos.prefix`

会话环境快照中保存的对象存储目录前缀。

**description** `string` | 环境描述

`environment.description`

环境描述，用于说明环境的用途、网络策略、依赖包等配置

**metadata** `object` | 自定义元数据

`environment.metadata`

用户自定义元数据

**overridden_fields** `string[]` | 覆写字段

`environment.overridden_fields`

当前会话相对基础 Environment 实际覆写的 `config` 子字段名称列表。仅在 *type* 为 `environment_with_overrides` 且存在覆写字段时返回。

**scope** `string` | 作用域

`environment.scope`

环境作用域：`organization` 表示组织内共享；`account` 表示账号内可见。

**resources** `object[]` | 资源列表

更新后会话当前挂载到运行环境的资源列表。

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

当前完整标签数组，每项包含 `key` 和可选的 `value`。

**key** `string` | 标签键

`tags.key`

标签的键，用于标识分类维度。

**value** `string` | 标签值

`tags.value`

用于记录该标签分类的具体内容。

**title** `string` | 会话标题

会话标题，用于快速识别和检索

**vault_ids** `string[] / null` | 保管库 ID 列表

会话可访问的保管库 ID 数组


## 代码示例

## 更新会话

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/sessions/<SESSION_ID>" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d @- <<'EOF'
{
  "title": "Q3 规划头脑风暴（已归档）",
  "tags": [
    {"key": "team", "value": "agent-infra"},
    {"key": "state", "value": "archived"}
  ]
}
EOF
```

#### Response

```
{
  "id": "<SESSION_ID>",
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
  "title": "Q3 规划头脑风暴（已归档）",
  "vault_ids": [],
  "resources": [],
  "status": "idle",
  "created_at": "2026-07-15T08:30:12.000Z",
  "updated_at": "2026-07-15T10:00:00.000Z",
  "tags": [
    {"key": "team", "value": "agent-infra"},
    {"key": "state", "value": "archived"}
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

session = client.sessions.update(
    "<SESSION_ID>",
    title="Q3 规划头脑风暴（已归档）",
    tags=[
        {"key": "team", "value": "agent-infra"},
        {"key": "state", "value": "archived"},
    ],
)
print(session)
```

#### Response

```
{
  "id": "<SESSION_ID>",
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
  "title": "Q3 规划头脑风暴（已归档）",
  "vault_ids": [],
  "resources": [],
  "status": "idle",
  "created_at": "2026-07-15T08:30:12.000Z",
  "updated_at": "2026-07-15T10:00:00.000Z",
  "tags": [
    {"key": "team", "value": "agent-infra"},
    {"key": "state", "value": "archived"}
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
import com.volcengine.ark.runtime.models.session.Session;
import com.volcengine.ark.runtime.models.session.Tag;
import com.volcengine.ark.runtime.models.session.UpdateSessionRequest;
import com.volcengine.ark.runtime.service.ArkService;
import java.util.Arrays;

public class Main {
    public static void main(String[] args) throws Exception {
        ArkService service = ArkService.builder()
                .apiKey(System.getenv("ARK_API_KEY"))
                .baseUrl("https://ark.cn-beijing.volces.com/api/v3")
                .build();

        Session session = service.updateSession(
                "<SESSION_ID>",
                UpdateSessionRequest.builder()
                        .title("Q3 规划头脑风暴（已归档）")
                        .tags(Arrays.asList(
                                Tag.builder().key("team").value("agent-infra").build(),
                                Tag.builder().key("state").value("archived").build()))
                        .build());
        System.out.println(session);

        service.shutdownExecutor();
    }
}
```

#### Response

```
{
  "id": "<SESSION_ID>",
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
  "title": "Q3 规划头脑风暴（已归档）",
  "vault_ids": [],
  "resources": [],
  "status": "idle",
  "created_at": "2026-07-15T08:30:12.000Z",
  "updated_at": "2026-07-15T10:00:00.000Z",
  "tags": [
    {"key": "team", "value": "agent-infra"},
    {"key": "state", "value": "archived"}
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
	sessionmodel "github.com/volcengine/ark-runtime-go/arkruntime/model/session"
)

func main() {
	ctx := context.Background()
    client := arkruntime.NewClientWithApiKey(
		os.Getenv("ARK_API_KEY"),
        arkruntime.WithBaseUrl("https://ark.cn-beijing.volces.com/api/v3"),
	)

	s, err := client.UpdateSession(ctx, "<SESSION_ID>", &sessionmodel.UpdateSessionRequest{
		Title: sessionmodel.NewOptString("Q3 规划头脑风暴（已归档）"),
		Tags: []sessionmodel.Tag{
			{Key: "team", Value: sessionmodel.NewOptString("agent-infra")},
			{Key: "state", Value: sessionmodel.NewOptString("archived")},
		},
	})
	if err != nil {
		panic(err)
	}
	fmt.Println(s)
}
```

#### Response

```
{
  "id": "<SESSION_ID>",
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
  "title": "Q3 规划头脑风暴（已归档）",
  "vault_ids": [],
  "resources": [],
  "status": "idle",
  "created_at": "2026-07-15T08:30:12.000Z",
  "updated_at": "2026-07-15T10:00:00.000Z",
  "tags": [
    {"key": "team", "value": "agent-infra"},
    {"key": "state", "value": "archived"}
  ]
}
```
