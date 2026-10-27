---
source: https://ark.volcengine.com/region:cn-beijing/docs/create-session-api
fetched: 2026-10-24
title: 创建会话
---

# 创建会话

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`POST https://ark.cn-beijing.volces.com/api/v3/sessions`

创建会话并绑定指定的智能体与环境。创建时可为本次会话覆写智能体或 Environment 的部分配置。创建成功后，可使用返回的会话 ID 发送事件、查询状态、升级配置或删除会话。

调用前需先准备智能体和环境。如需挂载文件、记忆库或凭证，还需先通过对应接口创建资源并取得其 ID。

根据目标选择接口：

- 需要新会话或更换绑定的智能体、环境时，使用本接口。
- 只修改标题或标签时，使用 [更新会话标题和标签](update-session-api.md)。
- 保留同一会话并刷新当前智能体、环境或保管库配置时，使用 [升级会话](upgrade-session-api.md)。

单个智能体默认最多可同时拥有 1000 个活跃会话；达到配额时，创建会话接口返回 HTTP 429 `SessionQuotaExceeded`。实际配额可能因账号配置而不同。

> **说明**
>
> - `resources` 中可通过 `file_id` 挂载 Files API 已上传的文件，`purpose` 为 `agent` 或 `user_data` 的文件均可使用；文件能否直接进入模型上下文，由后续 `user.message` 内容块和模型能力决定。
> - 传入 `agent_with_overrides` 对象可在本次会话中临时调整所引用 Agent 的模型、系统提示词、工具、MCP 服务、技能或多智能体协作配置。覆写不会创建新的 Agent 版本。
> - 传入 `environment` 覆写对象可在本次会话中临时调整所引用 Environment 的部分运行配置。覆写不会修改原 Environment，也不影响其他会话。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Body 参数

**agent** `string / object` `必选` | 智能体标识

指定会话使用的智能体。可直接传入智能体 ID；需要固定智能体版本时，传入智能体引用对象并设置 `id` 和 `version`。

需要为本次会话临时调整 Agent 配置时，传入 `agent_with_overrides` 对象。覆写仅写入会话的智能体快照，不修改基础 Agent。

智能体 ID `string`

直接传入智能体 ID，会话启动时使用该智能体的最新版本。

智能体引用 `object`

智能体引用对象。通过 `id` 指定智能体，通过 `version` 指定会话使用的智能体版本；省略 `version` 时使用最新版本。

**id** `string` `必选` | 智能体 ID

`agent.id`

要用于创建会话的智能体 ID。

**type** `string` `必选` | 引用类型

`agent.type`

引用类型，固定为 `agent`

**version** `integer` | 版本号

`agent.version`

智能体版本号；省略时使用最新版本

智能体配置覆写 `object`

智能体配置覆写对象。以 `id` 指定的智能体版本为基础，覆写仅影响本次会话，不会创建新版本或修改基础 Agent。

* 省略字段时，沿用基础 Agent 的对应配置。
* 传入 `system` 时，替换本次会话中的系统提示词。
* 传入 `model` 时，仅覆写其中已提供的子字段；省略的模型子字段沿用基础 Agent 的配置。
* `tools`、`mcp_servers` 或 `skills` 传入 `[]` 时清空对应列表，传入非空数组时整体替换，不与基础配置合并。
* 传入 `multiagent` 时，整体替换多智能体协作配置；其中 `agents` 传入 `[]` 时清空子智能体列表。

**id** `string` `必选` | 智能体 ID

`agent.id`

基础智能体 ID。缺失或为空时返回 HTTP 400 `MissingParameter`。

**type** `string` `必选` | 覆写类型

`agent.type`

覆写类型，固定为 `agent_with_overrides`

**mcp_servers** `object[]` | MCP 服务列表

`agent.mcp_servers`

本次会话使用的 MCP 服务列表。省略时保留原配置，传入 `[]` 时清空，传入非空数组时整体替换。

**type** `string` `必选` | 接入方式

`agent.mcp_servers.type`

MCP 服务的接入方式。

取值固定为 `url`。

**url** `string` `必选` | 服务地址

`agent.mcp_servers.url`

MCP 服务的访问地址。同一智能体内不能配置重复的 MCP 服务地址。

**name** `string` | MCP 服务名称

`agent.mcp_servers.name`

MCP 服务名称，最长 255 个字符，用于在当前 Agent 中识别该服务；配置 MCP 工具集时，`tools[].mcp_server_name` 必须填写此名称。

* 省略名称或名称不符合命名规则时，服务端根据 `url` 生成名称。
* 服务端会将符合命名规则的名称转换为小写。
* 多个名称冲突时，服务端为后续名称添加数字后缀。

**model** `object` | 模型运行参数覆写

`agent.model`

仅对本次会话生效的模型配置。支持设置 `id`、`speed`、`service_tier`、`thinking` 和 `reasoning_effort`；省略子字段时沿用基础智能体的对应配置。

**id** `string` | 模型 ID 覆写

`agent.model.id`

本次会话使用的模型 ID。省略时沿用基础智能体的模型；指定时仅影响本次会话，不修改基础智能体。

模型必须已在当前项目中开通，并支持用于智能体。模型 ID 无效或不支持用于智能体时返回 HTTP 400；模型未开通时返回 HTTP 403 `ModelNotOpen`。

**reasoning_effort** `string` | 推理投入档位

`agent.model.reasoning_effort`

推理投入档位。省略时沿用基础智能体的配置；传空字符串时使用当前模型的默认配置。

传入不支持的取值时返回 HTTP 400 `InvalidParameter`。各模型支持的取值和默认值，请参见 [模型支持的参数列表](../model-parameter-support.md)。取值：`none` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max`。

**service_tier** `string` | 推理服务档位

`agent.model.service_tier`

推理服务档位。省略时沿用基础智能体的配置；传空字符串时使用当前模型的默认配置。

传入不支持的取值时返回 HTTP 400 `InvalidParameter`。各模型支持的取值和默认值，请参见 [模型支持的参数列表](../model-parameter-support.md)。取值：`auto` / `default` / `fast`。

**speed** `string` | 推理速度

`agent.model.speed`

模型推理速度档位。省略时沿用基础智能体的配置；传空字符串时使用模型服务的默认配置。

并非所有模型都支持 `fast`，传入不支持的取值时返回 HTTP 400 `InvalidParameter`。取值：`standard` / `fast`。

**thinking** `string` | 思考模式

`agent.model.thinking`

思考模式。`auto` 表示由模型判断是否启用思考；省略时沿用基础智能体的配置；传空字符串时使用当前模型的默认配置。

传入不支持的取值时返回 HTTP 400 `InvalidParameter`。各模型支持的取值和默认值，请参见 [模型支持的参数列表](../model-parameter-support.md)。取值：`enabled` / `disabled` / `auto`。

**multiagent** `object` | 多智能体配置

`agent.multiagent`

本次会话使用的多智能体协作配置。省略时保留基础 Agent 的配置；提供时整体替换，`agents` 传入 `[]` 时清空子智能体列表。

**agents** `object[]` `必选` | 子智能体列表

`agent.multiagent.agents`

子智能体列表，最多 20 项。传入 `[]` 时清空基础 Agent 的子智能体列表。

**type** `string` `必选` | 子智能体来源

`agent.multiagent.agents.type`

子智能体来源。`agent` 表示引用当前账号和项目中的已有 Agent；`self` 表示复用当前主 Agent 的配置。

**id** `string` | 子智能体 ID

`agent.multiagent.agents.id`

子智能体 ID。当 `type` 为 `agent` 时必填；当 `type` 为 `self` 时省略。

**version** `integer` | 子智能体版本

`agent.multiagent.agents.version`

子智能体版本号，仅当 `type` 为 `agent` 时生效。省略时使用该子智能体的最新版本。

**type** `string` `必选` | 协作模式

`agent.multiagent.type`

多智能体协作模式，固定为 `coordinator`。当前智能体负责任务分配并汇总子智能体的结果。

**skills** `object[]` | 技能列表

`agent.skills`

本次会话使用的技能列表。省略时保留原配置，传入 `[]` 时清空，传入非空数组时整体替换。

**skill_id** `string` `必选` | 技能 ID

`agent.skills.skill_id`

要绑定到智能体的技能 ID。

**type** `string` `必选` | 技能来源

`agent.skills.type`

技能来源。

- `ark`：方舟预置技能。
- `skill_hub`：来自 SkillHub 的公共技能。
- `custom`：当前账号通过 Skills API 创建的自定义技能。

**version** `string` | 技能版本

`agent.skills.version`

要绑定的技能版本号。省略时使用该技能的最新版本。

**system** `string` | 系统提示词覆写

`agent.system`

本次会话使用的系统提示词。省略时沿用基础智能体的配置。

**tools** `object[]` | 工具列表

`agent.tools`

本次会话使用的工具列表。省略时保留原配置，传入 `[]` 时清空，传入非空数组时整体替换。

**type** `string` `必选` | 工具类型

`agent.tools.type`

工具类型。

- `agent_toolset_20260916`：使用方舟内置的 `bash`、`edit`、`read`、`write`、`glob`、`grep`、`web_fetch` 和 `web_search` 工具。
- `agent_toolset_multimodal_20260825`：使用 `image_generate`、`video_generate`、`visual_search`、`general_search`、`compose_video` 和 `todo_write` 工具。
- `mcp_toolset`：使用指定 MCP 服务提供的工具。
- `custom`：使用由客户端执行的自定义工具。
可选值：`agent_toolset_20260401`、`agent_toolset_20260701`、`agent_toolset_20260916`、`agent_toolset_multimodal_20260825`、`mcp_toolset`、`custom`。

**configs** `object[]` | 工具配置列表

`agent.tools.configs`

按工具名称设置工具的启用状态和权限策略。

**name** `string` `必选` | 工具名称

`agent.tools.configs.name`

工具配置对应的工具名称。

**enabled** `boolean` | 是否启用

`agent.tools.configs.enabled`

是否启用此工具。

**models** `object[]` | 工具模型列表

`agent.tools.configs.models`

图片生成或视频生成工具使用的模型 ID 或推理接入点 ID 列表。

> **说明**
>
> 最多填写 10 项，且同一工具配置内的模型 ID 或推理接入点 ID 不能重复。配置多项时，必须且只能将一项的 `default` 设置为 `true`。

**id** `string` `必选` | 模型或接入点 ID

`agent.tools.configs.models.id`

图片生成或视频生成工具调用的模型 ID 或推理接入点 ID。

**default** `boolean` `默认值 false` | 是否为默认模型

`agent.tools.configs.models.default`

是否作为该工具的默认模型。配置多个模型或推理接入点时，必须且只能将一项设置为 `true`。

**permission_policy** `object` | 权限策略

`agent.tools.configs.permission_policy`

该工具使用的权限策略。

**type** `string` `必选` | 策略类型

`agent.tools.configs.permission_policy.type`

工具调用许可策略。

* `always_allow`：表示总是允许调用。
* `always_ask`：表示每次使用前需要确认。

**default_config** `object` | 默认工具配置

`agent.tools.default_config`

未在 `configs` 中单独配置的工具所使用的默认启用状态和权限策略。

**enabled** `boolean` | 是否启用

`agent.tools.default_config.enabled`

是否默认启用未在 `configs` 中单独配置的工具。

* `true`：表示默认启用。
* `false`：表示默认禁用。

**permission_policy** `object` | 权限策略

`agent.tools.default_config.permission_policy`

未在 `configs` 中单独配置的工具所使用的默认权限策略。

**type** `string` `必选` | 策略类型

`agent.tools.default_config.permission_policy.type`

工具调用许可策略。

* `always_allow`：表示总是允许调用。
* `always_ask`：表示每次使用前需要确认。

**description** `string` | 自定义工具描述

`agent.tools.description`

说明自定义工具的功能和适用场景，供模型判断何时调用该工具。

> **说明**
>
> `type` 为 `custom` 时必填，长度为 1～10000 个字符。

**input_schema** `object` | 输入参数定义

`agent.tools.input_schema`

定义自定义工具的输入参数及其约束。

> **注意**
>
> * 创建 Agent 时，服务端会确认 `input_schema.type` 为 `object`，并确认 `input_schema.properties` 是 JSON 对象，但不会逐项检查其中的属性定义。
> * 运行 Session 时，服务端会检查完整的 `input_schema` 是否为合法 JSON Schema。创建 Agent 成功不代表该 Schema 一定可以正常运行。
> * 模型生成的工具调用参数只会校验是否为合法 JSON。执行自定义工具前，你的应用应按 `input_schema` 再次校验参数。

**properties** `object` | 参数属性定义

`agent.tools.input_schema.properties`

自定义工具输入参数的 JSON Schema `properties` 对象。键为参数名，值为对应参数的 JSON Schema 子对象。

**required** `string[]` | 必填参数名称列表

`agent.tools.input_schema.required`

自定义工具输入中必填的参数名称列表。列表中的每个名称必须与 `properties` 中定义的参数名称一致。

**type** `string` `默认值 object` | Schema 类型

`agent.tools.input_schema.type`

指定 JSON Schema 的顶层类型，仅支持 `object`。

**mcp_server_name** `string` | MCP 服务名称

`agent.tools.mcp_server_name`

MCP 工具所属的 MCP 服务名称。

**name** `string` | 自定义工具名称

`agent.tools.name`

自定义工具的名称。

> **说明**
>
> `type` 为 `custom` 时必填。长度为 1～128 个字符，只能包含字母、数字、下划线和连字符，且同一 Agent 内的自定义工具名称不能重复。

**version** `integer` | 版本号

`agent.version`

基础智能体版本号。省略时使用最新版本；指定版本时，以该版本保存的配置为基础应用本次覆写。

**environment_id** `string` | 环境 ID

直接使用已创建的 Environment 运行会话时，填写该 Environment 的 ID。需要为本次会话临时调整已开放的运行配置时，改用 `environment`。

**environment** `object` | 环境覆写

需要为本次会话临时调整已有 Environment 的运行配置时，使用该对象。

> **说明**
>
> 通过 `id` 指定基础 Environment。配置仅对本次会话生效，不修改原 Environment。若同时提供 `environment_id`，两者的环境 ID 必须相同。

**id** `string` `必选` | 环境 ID

`environment.id`

要作为本次配置覆写基础的 Environment ID。

**type** `string` `必选` | 对象类型

`environment.type`

对象类型，固定为 `environment_with_overrides`

**config** `object` | 覆写后的运行配置

`environment.config`

本次会话使用的 Environment 运行配置覆写；省略时沿用原 Environment 的配置。

**type** `string` `必选` | 环境类型

`environment.config.type`

运行环境类型：`cloud` 表示平台托管的云端运行环境，`self_hosted` 表示用户自托管环境。覆写时必须与基础 Environment 保持一致。

**env** `object` | 环境变量

`environment.config.env`

本次 Session 使用的环境变量，以变量名和变量值组成的字符串键值对形式传入。

> **说明**
>
> * 省略 *env* 时沿用基础 Environment 的环境变量；传入对象时整体替换；传入空对象 `{}` 时清空全部环境变量。
> * 最多包含 64 个键值对，所有键和值合计不超过 32 KiB。键不能为空且不能包含 `=` 或 NUL 字符，值不能包含 NUL 字符。

**packages** `object` | 依赖包配置

`environment.config.packages`

本次 Session 启动时预装的依赖包。

> **说明**
>
> * 省略 *packages* 时沿用基础 Environment 的依赖包配置；传入对象时整体替换；传入空对象 `{}` 时清空全部依赖包配置。
> * 每个依赖包名称去除首尾空白后不能为空，不能包含 NUL 字符，也不能以连字符开头。

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

**setup_script** `string` | 初始化脚本

`environment.config.setup_script`

本次 Session 启动时执行的初始化脚本。

> **说明**
>
> 省略 *setup_script* 时沿用基础 Environment 的初始化脚本；传入非空字符串时替换原值；传入空字符串 `""` 时清空。

> **注意**
>
> * 脚本以 Bash 在 `/workspace` 目录中执行，内容不能超过 256 KiB（262144 字节）。超过限制时，脚本不会执行，但 Session 仍可能继续运行。
> * 脚本以非零状态码退出时，退出前已完成的文件写入等操作不会自动回滚，Session 仍可能继续运行。创建后应检查脚本准备的依赖、目录或标记文件，不要只根据 Session 状态判断初始化是否成功。

**tos** `object` | 产物存储覆写

`environment.config.tos`

会话级产物存储覆写，`tos` 对象整体生效。

省略 `tos` 时保留基础 Environment 的配置；传入 `{}` 时清空配置并使用默认存储；传入非空对象时，必须同时提供 `bucket` 和 `prefix`。

**bucket** `string` | TOS 桶

`environment.config.tos.bucket`

用户 TOS 存储桶名称。Bucket 必须与当前方舟 API 接入地域一致，否则请求会被拒绝。

**prefix** `string` | 对象前缀

`environment.config.tos.prefix`

智能体产物在用户 Bucket 中的存储目录前缀。

**resources** `object[]` | 初始资源

会话启动时挂载到运行环境的文件、记忆库或 TOS 目录。

> **说明**
>
> 当会话所用 Environment 的 `config.type` 为 `self_hosted` 时，不能传入 `resources`。

文件资源 `object`

通过 Files API 上传并挂载到会话的文件。

**type** `string` `必选` | 资源类型

`resources.type`

资源类型，固定为 `file`。

**file_id** `string` `必选` | 文件 ID

`resources.file_id`

要挂载到会话的文件 ID，通过 Files API 上传文件后获得。

> **说明**
>
> 同一请求中，`file_id` 和最终生效的 `mount_path` 均相同的文件资源视为重复，不能同时挂载。

**mount_path** `string` | 挂载路径

`resources.mount_path`

文件在会话运行环境中的挂载路径。省略或传入空值时，使用文件上传时的原始文件名，最终路径为 `/mnt/session/uploads/<filename>`。

> **说明**
>
> 路径开头的 `/` 会自动移除。路径不得包含 `..`、`.` 路径段、反斜杠、连续的 `//` 或控制字符，也不得以 `/` 结尾。

记忆库资源 `object`

挂载到会话的记忆库。

**type** `string` `必选` | 资源类型

`resources.type`

资源类型，固定为 `memory_store`。

**memory_store_id** `string` `必选` | 记忆库 ID

`resources.memory_store_id`

要挂载到会话的记忆库 ID，由创建记忆库接口返回，形如 `memstore-...`。

> **说明**
>
> - 同一请求中，同一个 `memory_store_id` 只能挂载一次。
> - `memory_store` 类型的资源最多添加 10 项。

**instructions** `string` | 使用指导

`resources.instructions`

会话使用该记忆库时遵循的指导，最多 4096 个字符。

**access** `string` `默认值 read_write` | 访问权限

`resources.access`

会话对记忆库的访问权限：

- `read_only`：智能体可以读取记忆库，但不能写入。
- `read_write`：智能体可以读取和写入记忆库。

TOS 资源 `object`

挂载到会话的 TOS 对象目录。

**type** `string` `必选` | 资源类型

`resources.type`

资源类型，固定为 `tos`。

**tos_bucket** `string` `必选` | TOS 存储桶

`resources.tos_bucket`

待挂载目录所在的 TOS 存储桶名称。

**tos_region** `string` | TOS 地域

`resources.tos_region`

源存储桶所在地域的 Region ID。省略时使用当前服务地域；显式提供时必须与当前服务地域一致。

**tos_key** `string` `必选` | TOS 目录前缀

`resources.tos_key`

TOS 中待挂载目录的对象前缀。

> **说明**
>
> - 前缀必须以 `/` 结尾，不能为 `/` 或以 `/` 开头，也不能包含反斜杠、连续的 `//`、`.` 或 `..` 路径段以及控制字符。
> - 同一请求中，`tos_bucket`、`tos_key` 和 `tos_region` 三项组合相同的 TOS 资源视为重复，不能同时挂载。

**access** `string` `默认值 read_only` | 访问权限

`resources.access`

会话对 TOS 目录的访问权限：

- `read_only`：智能体可以读取目录内容，但不能修改。
- `read_write`：智能体可以读取和修改目录内容。

**mount_path** `string` | 挂载路径

`resources.mount_path`

TOS 目录在会话运行环境中的挂载路径。默认值：`/mnt/session/storage`

**tags** `object[]` | 标签列表

会话关联的标签列表，用于分类检索，最多 20 项。同一请求中的标签键不可重复。

**key** `string` `必选` | 标签键

`tags.key`

标签键，用于分类和检索。必填，最长 128 个字符；支持字母、数字、空格及 `_ . : / = + - @`。

**value** `string` | 标签值

`tags.value`

用于记录该标签分类的具体内容。

**title** `string` | 会话标题

会话标题，便于用户识别和管理，最长 255 个字符

**vault_ids** `string[]` | 保管库 ID 列表

绑定到会话的保管库 ID 列表

**scene** `string` `默认值 default` | 会话场景

会话场景标记。

- `default`：普通会话。
- `dreams`：用于 Dream 记忆整理任务的会话。

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

会话唯一标识符，格式为 `sesn-` 开头的字符串

**status** `string` | 会话状态

会话运行状态。普通创建成功后，初始状态为 `idle`，可继续发送事件。取值：`idle` / `running` / `terminated` / `rescheduling` / `initializing` / `failed` / `upgrading`。

**type** `string` | 对象类型

对象类型，固定为`session`

**updated_at** `string` | 更新时间

会话信息最后更新的时间，采用 RFC 3339 格式。

**archived_at** `string` | 归档时间

会话归档的时间，采用 RFC 3339 格式。会话未归档时，服务端不返回该字段。

**environment** `object` | 环境信息

会话实际使用的环境配置快照。后续修改原 Environment 不会改变该快照。

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

运行环境类型：`cloud` 表示平台托管环境，`self_hosted` 表示用户自托管环境。

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

会话运行环境启动时执行的初始化脚本；留空或未设置表示不执行任何脚本

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

会话创建后实际挂载到运行环境的资源列表。

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

会话关联的标签列表，用于分类检索

**key** `string` | 标签键

`tags.key`

标签键，用于分类和检索。必填，最长 128 个字符；支持字母、数字、空格及 `_ . : / = + - @`。

**value** `string` | 标签值

`tags.value`

用于记录该标签分类的具体内容。

**title** `string` | 会话标题

会话标题，便于用户在会话列表中识别

**vault_ids** `string[] / null` | 保管库 ID 列表

会话可访问的保管库 ID 列表。智能体可在运行过程中使用其中的凭证。


## 代码示例

## 创建会话

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/sessions" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d @- <<'EOF'
{
  "agent": "<AGENT_ID>",
  "environment_id": "<ENVIRONMENT_ID>",
  "title": "Q3 规划头脑风暴",
  "tags": [
    {"key": "team", "value": "agent-infra"},
    {"key": "quarter", "value": "2026Q3"}
  ]
}
EOF
```

#### Response

```
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
  "vault_ids": [],
  "resources": [],
  "status": "idle",
  "created_at": "2026-07-15T08:30:12.000Z",
  "updated_at": "2026-07-15T08:30:12.000Z",
  "tags": [
    {"key": "team", "value": "agent-infra"},
    {"key": "quarter", "value": "2026Q3"}
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

session = client.sessions.create(
    agent="<AGENT_ID>",
    environment_id="<ENVIRONMENT_ID>",
    title="Q3 规划头脑风暴",
    tags=[
        {"key": "team", "value": "agent-infra"},
        {"key": "quarter", "value": "2026Q3"},
    ],
)
print(session)
```

#### Response

```
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
  "vault_ids": [],
  "resources": [],
  "status": "idle",
  "created_at": "2026-07-15T08:30:12.000Z",
  "updated_at": "2026-07-15T08:30:12.000Z",
  "tags": [
    {"key": "team", "value": "agent-infra"},
    {"key": "quarter", "value": "2026Q3"}
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
import com.volcengine.ark.runtime.models.session.AgentIdentifier;
import com.volcengine.ark.runtime.models.session.CreateSessionRequest;
import com.volcengine.ark.runtime.models.session.Session;
import com.volcengine.ark.runtime.models.session.Tag;
import com.volcengine.ark.runtime.service.ArkService;
import java.util.Arrays;

public class Main {
    public static void main(String[] args) throws Exception {
        ArkService service = ArkService.builder()
                .apiKey(System.getenv("ARK_API_KEY"))
                .baseUrl("https://ark.cn-beijing.volces.com/api/v3")
                .build();

        Session session = service.createSession(
                CreateSessionRequest.builder()
                        .agent(AgentIdentifier.ofString("<AGENT_ID>"))
                        .environmentId("<ENVIRONMENT_ID>")
                        .title("Q3 规划头脑风暴")
                        .tags(Arrays.asList(
                                Tag.builder().key("team").value("agent-infra").build(),
                                Tag.builder().key("quarter").value("2026Q3").build()))
                        .build());
        System.out.println(session);

        service.shutdownExecutor();
    }
}
```

#### Response

```
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
  "vault_ids": [],
  "resources": [],
  "status": "idle",
  "created_at": "2026-07-15T08:30:12.000Z",
  "updated_at": "2026-07-15T08:30:12.000Z",
  "tags": [
    {"key": "team", "value": "agent-infra"},
    {"key": "quarter", "value": "2026Q3"}
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

	s, err := client.CreateSession(ctx, &sessionmodel.CreateSessionRequest{
		Agent:         sessionmodel.NewStringAgentIdentifier("<AGENT_ID>"),
		EnvironmentID: sessionmodel.NewOptString("<ENVIRONMENT_ID>"),
		Title:         sessionmodel.NewOptString("Q3 规划头脑风暴"),
		Tags: []sessionmodel.Tag{
			{Key: "team", Value: sessionmodel.NewOptString("agent-infra")},
			{Key: "quarter", Value: sessionmodel.NewOptString("2026Q3")},
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
  "vault_ids": [],
  "resources": [],
  "status": "idle",
  "created_at": "2026-07-15T08:30:12.000Z",
  "updated_at": "2026-07-15T08:30:12.000Z",
  "tags": [
    {"key": "team", "value": "agent-infra"},
    {"key": "quarter", "value": "2026Q3"}
  ]
}
```
