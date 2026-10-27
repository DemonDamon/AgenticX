---
source: https://ark.volcengine.com/region:cn-beijing/docs/managed-agents
fetched: 2026-10-24
title: Managed Agents CLI
---

# Managed Agents

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

ARK Managed Agents：Agent / Skill / Env / Session / File / Memory Store / Vault 的完整生命周期，以及围绕会话的高频快捷工作流。

- `agent` 域管八大资源类型：控制面（Agent/Skill/Env 定义）走 ForTop/OpenTOP，数据面（Session 运行时、文件）直联；
- 快捷工作流按生命周期分工：`+new-agent` / `+iterate` 建与改，`+new` 起会话，`+tail` / `+debug` / `+export` 观察与导出；
- 典型链路：`agent create` → `env create` → `session create` → `session events send/stream`。

<span id="debug-command"></span>
## +debug

诊断某个托管智能体会话（事件、错误与执行状态，按 session-id）

```Bash
arkcli +debug <session-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--limit` | int | 最多检查的最近事件数 |
| `--session-thread-id` | string | 按会话 thread id 过滤事件 |

<span id="export-command"></span>
## +export

把托管智能体会话诊断信息导出为本地归档

```Bash
arkcli +export <session-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--output` | string | 输出 .tar.gz 路径 |
| `--limit` | int | 最多导出的事件数 |
| `--session-thread-id` | string | 按会话 thread id 过滤事件 |

<span id="iterate-command"></span>
## +iterate

更新托管智能体、新建一个会话，然后可选进入对话

```Bash
arkcli +iterate <agent-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--env-id` | string | 新会话使用的环境 ID；默认取最新环境（--environment-id 的别名） |
| `--environment-id` | string | 新会话使用的环境 ID；默认取最新环境 |
| `--title` | string | 新会话标题 |
| `--resource` | string | 新会话的 Resources 数组 |
| `--tos-path` | string | 要挂载的 TOS 目录，例如 tos://bucket/prefix/ |
| `--vault-id` | string_slice | 新会话的 Vault id；逗号分隔或重复传入 |
| `--vault-ids` | string_slice | 新会话的 Vault id；逗号分隔或重复传入 |
| `--tags` | string | 会话 tags 映射或 tag 数组 |
| `--agent-overrides` | string | AgentWithOverrides 对象；行内 JSON/YAML 或 @file |
| `--environment-overrides` | string | EnvironmentWithOverrides 对象；行内 JSON/YAML 或 @file |
| `--message` | string | 创建会话后发送一条消息，空闲后退出 |
| `--session-thread-id` | string | 首条消息 / REPL 的目标会话 thread id |
| `--no-event-deltas` | bool | 不请求 PRD 的 event_start/event_delta 帧，只使用完整事件 |
| `--raw` | bool | 对话时打印原始 NDJSON 流事件 |
| `--no-chat` | bool | 只更新 Agent 并创建 Session，不进入 chat/REPL |
| `--diff` | bool | 预览 update/session/chat 的请求内容，不改变远端状态 |
| `--file` | string | JSON/YAML 格式 UpdateAgentRequest 载荷的路径。传 - 或省略 --file 表示从 stdin 读取 |
| `--version` | int | 可选的 Agent 当前版本；省略或为 0 时从 GetAgent 自动读取，正数用于显式并发版本检查 |
| `--name` | string | Agent 名称 |
| `--display-name` | string | Agent 展示名 |
| `--model` | string | 模型 ID 或包含 id/provider/speed/thinking/reasoning_effort/service_tier 的对象 |
| `--speed` | string | 兼容保留的模型 speed 参数 |
| `--thinking` | string | 模型思考模式 |
| `--reasoning-effort` | string | 模型推理强度 |
| `--service-tier` | string | 模型服务等级 |
| `--description` | string | 智能体描述 |
| `--system` | string | System 提示词，或用 @file 从磁盘读取 |
| `--tool` | string_slice | 替换工具列表；可重复或直接传数组，用 [] 清空 |
| `--mcp-server` | string_slice | 替换 MCP server 列表；可重复传入或直接传数组，传 [] 表示清空 |
| `--skill` | string_slice | 替换技能列表；可重复或直接传数组，用 [] 清空 |
| `--multiagent` | string | 多 Agent 配置对象 |
| `--metadata` | string | 元数据补丁 map 对象；值为 null 表示删除该键 |

<span id="domain-new"></span>
## +new

ARK Managed Agent 运行时命令：新建 Agent 会话（`+new session`）、创建新 Agent 定义（`+new-agent`）、迭代已有 Agent（`+iterate`）。

- 面向“让 Agent 跑起来”的任务入口：定义、会话、迭代一条链路；
- 底层资源仍归 `agent` 域管理，本域提供的是面向任务的快捷工作流。

<span id="new-session-command"></span>
### +new session

新建一个托管智能体会话，然后进入对话

```Bash
arkcli +new session [agent-id]
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--agent-id` | string | 用于新建对话会话的智能体 ID |
| `--agent-version` | int | 新建对话会话使用的智能体版本 |
| `--env-id` | string | 新建对话会话使用的环境 ID（--environment-id 的别名） |
| `--environment-id` | string | 新建对话会话使用的环境 ID |
| `--title` | string | 新会话标题 |
| `--resource` | string | 新会话的 Resources 数组 |
| `--tos-path` | string | 要挂载的 TOS 目录，例如 tos://bucket/prefix/ |
| `--vault-id` | string_slice | 新会话的 Vault id；逗号分隔或重复传入 |
| `--vault-ids` | string_slice | 新会话的 Vault id；逗号分隔或重复传入 |
| `--tags` | string | 新会话的 tags 映射或 tag 数组 |
| `--agent-overrides` | string | AgentWithOverrides 对象；行内 JSON/YAML 或 @file |
| `--environment-overrides` | string | EnvironmentWithOverrides 对象；行内 JSON/YAML 或 @file |
| `--message` | string | 发送一条消息，会话回到空闲后退出 |
| `--session-thread-id` | string | 目标会话 thread id |
| `--no-event-deltas` | bool | 不请求 PRD 的 event_start/event_delta 帧，只使用完整事件 |
| `--max-event-chars` | int | 美化后事件文本最多显示的字符数；默认 2000，0 表示不限制 |
| `--raw` | bool | 打印原始 NDJSON 流事件 |

<span id="new-agent-command"></span>
## +new-agent

用结构化字段创建托管智能体，可选择 fork 已有的智能体

```Bash
arkcli +new-agent
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--fork` | string | 在应用覆盖项之前要复制的已有智能体 ID |
| `--from` | string | --fork 的别名 |
| `--no-echo` | bool | 跳过最后的 GetAgent 回显，只打印 CreateAgent 响应 |
| `--file` | string | JSON/YAML 格式 CreateAgentRequest 载荷的路径。传 - 或省略 --file 表示从 stdin 读取 |
| `--name` | string | Agent 名称 |
| `--display-name` | string | Agent 展示名 |
| `--base-agent` | string | 基础智能体 ID |
| `--model` | string | 模型 ID 或包含 id/provider/speed/thinking/reasoning_effort/service_tier 的对象 |
| `--speed` | string | 兼容保留的模型 speed 参数 |
| `--thinking` | string | 模型思考模式 |
| `--reasoning-effort` | string | 模型推理强度 |
| `--service-tier` | string | 模型服务等级 |
| `--description` | string | 智能体描述 |
| `--system` | string | System 提示词，或用 @file 从磁盘读取 |
| `--tool` | string_slice | 完整替换 Tools 数组。省略时 arkcli 发送默认的 agent_toolset_20260701；传 [] 可关闭默认值 |
| `--mcp-server` | string_slice | MCP server 对象；可重复传入或直接传数组 |
| `--skill` | string_slice | Skill 对象；可重复传入或传数组。裸 skill-xxx ID 作为 custom TOP skill 且省略 Version 表示使用最新版；s-xxx SkillHub ID 必须传显式对象 |
| `--skill-zip` | string_slice | 通过 CreateSkill 上传并作为自定义技能挂载的本地技能 zip 包；可重复 |
| `--multiagent` | string | 多 Agent 配置对象 |
| `--metadata` | string | 元数据 map 对象 |
| `--tags` | string | Tags 映射或 tag 数组 |
| `--show-system` | bool | 在表格输出中展示完整 System 提示词 |
| `--yes` | bool | 在交互终端下跳过 [y/N] 模型开通确认。非交互模式除非设置 ARKCLI_ALLOW_HEADLESS_ACTIVATION=1，否则拒绝开通。 |

<span id="tail-command"></span>
## +tail

持续跟踪托管智能体会话事件

```Bash
arkcli +tail <session-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--after` | string | 游标：取该事件 ID 之后的数据 |
| `--before` | string | 游标：取该事件 ID 之前的数据 |
| `--since` | string | 游标/时间下界 |
| `--created-after` | string | 事件 created_at 下界（RFC3339） |
| `--created-before` | string | 事件 created_at 上界（RFC3339） |
| `--type` | string_slice | 事件类型过滤；可重复或用逗号分隔 |
| `--session-thread-id` | string | 按会话 thread id 过滤 |
| `--no-event-deltas` | bool | 不请求 PRD 的 event_start/event_delta 帧，只使用完整事件 |
| `--max-event-chars` | int | 美化后事件文本最多显示的字符数；默认 2000，0 表示不限制 |
| `--order` | string | 排序方向：asc \| desc |
| `--raw` | bool | 打印原始 NDJSON 事件，而不是人类可读的 tail 视图 |

<span id="domain-agent"></span>
## agent

ARK Managed Agents 全生命周期管理：Agent、Skill、环境（Env）、会话（Session）、文件（File）、记忆库（Memory Store）、凭证保险库（Vault / MCP OAuth）八大资源类型。

- **控制面**（Agent/Skill/Env 定义）优先走 ForTop/OpenTOP，**数据面**（Session 运行时、文件上传下载）直联对应服务，CLI 自动分流；
- 典型链路：`agent create` 建定义 → `env create` 准备运行环境 → `session create` 起会话 → `session events send/stream` 驱动执行；
- `session compact/upgrade`、`env work stats` 等命令负责长会话压缩、热升级与算力用量审计；
- `vault credentials` 与 `vault oauth-flow` 管理敏感凭证，避免明文出现在命令行历史里。

<span id="agent-mcp-login-command"></span>
### agent +mcp-login

创建 Vault MCP OAuth 流程：打开授权链接并等待回调

```Bash
arkcli agent +mcp-login
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--vault-id` | string（必填） | Vault id |
| `--display-name` | string | 凭证显示名 |
| `--name` | string | --display-name 的别名 |
| `--mcp-server-url` | string（必填） | MCP server URL |
| `--callback-host` | string | 本地回调监听地址（默认 127.0.0.1） |
| `--callback-port` | int | 本地回调监听端口；0 表示自动选择 |
| `--callback-path` | string | 本地回调 HTTP 路径（默认 /callback） |
| `--timeout` | string | 等待回调的最长时间，例如 5m 或 300s（默认 5m0s） |
| `--source` | string | 流程来源标记（默认 arkcli-mcp-login） |
| `--client-id` | string | 自定义 MCP/provider 覆盖模式下的 OAuth client id |
| `--client-secret` | string | OAuth client secret，或用 @file 从磁盘读取 |
| `--no-open` | bool | 不自动打开浏览器，改为打印授权 URL |

<span id="agent-activate-command"></span>
### agent activate

开通 Managed Agent 服务（账号级计费能力操作，仅火山版；已开通时直接返回状态，不重复开通）

```Bash
arkcli agent activate
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--yes` | bool | 在交互终端下跳过 [y/N] 开通确认。非交互模式除非设置 ARKCLI_ALLOW_HEADLESS_ACTIVATION=1，否则拒绝开通 |

<span id="agent-agent-create-command"></span>
### agent agent create

创建托管智能体定义（名称、模型、系统提示词、技能、工具）

```Bash
arkcli agent agent create
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 格式 CreateAgentRequest 载荷的路径。传 - 或省略 --file 表示从 stdin 读取 |
| `--name` | string | Agent 名称 |
| `--display-name` | string | Agent 展示名 |
| `--base-agent` | string | 基础智能体 ID |
| `--model` | string | 模型 ID 或包含 id/provider/speed/thinking/reasoning_effort/service_tier 的对象 |
| `--speed` | string | 兼容保留的模型 speed 参数 |
| `--thinking` | string | 模型思考模式 |
| `--reasoning-effort` | string | 模型推理强度 |
| `--service-tier` | string | 模型服务等级 |
| `--description` | string | 智能体描述 |
| `--system` | string | System 提示词，或用 @file 从磁盘读取 |
| `--tool` | string_slice | 完整替换 Tools 数组。省略时 arkcli 发送默认的 agent_toolset_20260701；传 [] 可关闭默认值 |
| `--mcp-server` | string_slice | MCP server 对象；可重复传入或直接传数组 |
| `--skill` | string_slice | Skill 对象；可重复传入或传数组。裸 skill-xxx ID 作为 custom TOP skill 且省略 Version 表示使用最新版；s-xxx SkillHub ID 必须传显式对象 |
| `--skill-zip` | string_slice | 通过 CreateSkill 上传并作为自定义技能挂载的本地技能 zip 包；可重复 |
| `--multiagent` | string | 多 Agent 配置对象 |
| `--metadata` | string | 元数据 map 对象 |
| `--tags` | string | Tags 映射或 tag 数组 |
| `--show-system` | bool | 在表格输出中展示完整 System 提示词 |
| `--yes` | bool | 在交互终端下跳过 [y/N] 模型开通确认。非交互模式除非设置 ARKCLI_ALLOW_HEADLESS_ACTIVATION=1，否则拒绝开通。 |

<span id="agent-agent-delete-command"></span>
### agent agent delete

删除托管智能体并级联删除其会话（需确认，或用 --yes 跳过）

```Bash
arkcli agent agent delete <agent-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--yes` | bool | 硬删除及级联删除会话时跳过交互确认 |

<span id="agent-agent-get-command"></span>
### agent agent get

查看托管智能体定义（配置、版本、已绑定技能；--show-system 展示完整系统提示词）

```Bash
arkcli agent agent get <agent-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--version` | int | Agent 版本 |
| `--show-system` | bool | 在表格输出中展示完整 System 提示词 |

<span id="agent-agent-list-command"></span>
### agent agent list

按条件（名称、ID、时间范围）分页列出托管智能体

```Bash
arkcli agent agent list
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--created-at-gte` | string | 按创建时间下界过滤（RFC3339） |
| `--created-at-lte` | string | 按创建时间上界过滤（RFC3339） |
| `--limit` | int | 分页大小 |
| `--page` | string | 分页游标 / 页码 |
| `--id` | string | 按智能体 ID 过滤 |
| `--ids` | string_slice | 按智能体 ID 过滤，逗号分隔或重复传入 |
| `--name` | string | 按 Agent 名称过滤 |
| `--display-name` | string | 按 Agent 展示名过滤 |
| `--sort-by` | string | 排序字段 |
| `--sort-order` | string | 排序方向：Asc \| Desc |
| `--show-system` | bool | 在表格输出中展示完整 System 提示词 |

<span id="agent-agent-update-command"></span>
### agent agent update

更新托管智能体定义（名称、模型、技能；--file 接受 JSON/YAML 载荷）

```Bash
arkcli agent agent update <agent-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 格式 UpdateAgentRequest 载荷的路径。传 - 或省略 --file 表示从 stdin 读取 |
| `--version` | int | 可选的 Agent 当前版本；省略或为 0 时从 GetAgent 自动读取，正数用于显式并发版本检查 |
| `--name` | string | Agent 名称 |
| `--display-name` | string | Agent 展示名 |
| `--model` | string | 模型 ID 或包含 id/provider/speed/thinking/reasoning_effort/service_tier 的对象 |
| `--speed` | string | 兼容保留的模型 speed 参数 |
| `--thinking` | string | 模型思考模式 |
| `--reasoning-effort` | string | 模型推理强度 |
| `--service-tier` | string | 模型服务等级 |
| `--description` | string | 智能体描述 |
| `--system` | string | System 提示词，或用 @file 从磁盘读取 |
| `--tool` | string_slice | 替换工具列表；可重复或直接传数组，用 [] 清空 |
| `--mcp-server` | string_slice | 替换 MCP server 列表；可重复传入或直接传数组，传 [] 表示清空 |
| `--skill` | string_slice | 替换技能列表；可重复或直接传数组，用 [] 清空 |
| `--multiagent` | string | 多 Agent 配置对象 |
| `--metadata` | string | 元数据补丁 map 对象；值为 null 表示删除该键 |

<span id="agent-agent-versions-command"></span>
### agent agent versions

列出托管智能体的版本历史

```Bash
arkcli agent agent versions <agent-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--limit` | int | 分页大小 |
| `--page` | string | 分页游标 / 页码 |

<span id="agent-env-create-command"></span>
### agent env create

创建托管智能体环境

```Bash
arkcli agent env create
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 载荷的路径。传 - 或省略 --file 表示从 stdin 读取 |
| `--name` | string | 环境名称 |
| `--description` | string | 环境描述 |
| `--config` | string | 环境配置对象 |
| `--setup-script` | string | 环境初始化脚本，或 @file；写入 Config.SetupScript |
| `--metadata` | string | 元数据 map 对象 |
| `--scope` | string | 环境范围 |
| `--runtime-type` | string | 环境运行方式：cloud \| self_hosted（Config.Type） |

<span id="agent-env-delete-command"></span>
### agent env delete

删除托管智能体环境

```Bash
arkcli agent env delete <environment-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 载荷的路径。传 - 或省略 --file 表示从 stdin 读取 |
| `--yes` | bool | 跳过删除的交互确认 |

<span id="agent-env-get-command"></span>
### agent env get

获取托管智能体环境

```Bash
arkcli agent env get <environment-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 载荷的路径。传 - 或省略 --file 表示从 stdin 读取 |

<span id="agent-env-list-command"></span>
### agent env list

列出托管智能体环境

```Bash
arkcli agent env list
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 载荷的路径。传 - 或省略 --file 表示从 stdin 读取 |
| `--limit` | int | 分页大小 |
| `--page` | string | 分页游标 / 页码 |
| `--id` | string | 按环境 ID 过滤 |
| `--name` | string | 按环境名称过滤 |
| `--sort-by` | string | 排序字段 |
| `--sort-order` | string | 排序方向：Asc \| Desc |

<span id="agent-env-update-command"></span>
### agent env update

更新托管智能体环境

```Bash
arkcli agent env update <environment-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 载荷的路径。传 - 或省略 --file 表示从 stdin 读取 |
| `--name` | string | 环境名称 |
| `--description` | string | 环境描述 |
| `--config` | string | 环境配置对象 |
| `--setup-script` | string | 环境初始化脚本，或 @file；写入 Config.SetupScript |
| `--metadata` | string | 元数据 map 对象 |
| `--scope` | string | 环境范围 |

<span id="agent-env-work-get-command"></span>
### agent env work get

查询自托管 Work Item

```Bash
arkcli agent env work get <environment-id> <work-id>
```

<span id="agent-env-work-list-command"></span>
### agent env work list

列出自托管环境的 Work Items

```Bash
arkcli agent env work list <environment-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--limit` | int | 分页大小 |
| `--page` | string | 分页游标 / 页码 |

<span id="agent-env-work-stats-command"></span>
### agent env work stats

查询自托管环境的队列统计

```Bash
arkcli agent env work stats <environment-id>
```

<span id="agent-env-work-stop-command"></span>
### agent env work stop

请求停止 Work Item

```Bash
arkcli agent env work stop <environment-id> <work-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--force` | bool | 立即将 Work 标记为 stopped；不代表远端 Sandbox 已退出 |
| `--yes` | bool | 确认停止此 Work Item |

<span id="agent-file-delete-command"></span>
### agent file delete

从 ARK Files 存储中删除文件

```Bash
arkcli agent file delete <file-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--yes` | bool | 确认删除 |

<span id="agent-file-get-command"></span>
### agent file get

获取 ARK Files 存储中文件的元数据

```Bash
arkcli agent file get <file-id>
```

<span id="agent-file-list-command"></span>
### agent file list

列出已上传到 ARK Files 存储的文件

```Bash
arkcli agent file list
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--limit` | int | 分页大小 |
| `--after` | string | 游标：取该文件 ID 之后的数据 |
| `--order` | string | 排序方向：asc \| desc |
| `--purpose` | string | 文件用途（默认 user_data） |
| `--session-id` | string | 按 managed-agent 会话范围过滤文件 |

<span id="agent-file-upload-command"></span>
### agent file upload

把本地文件或 URL 上传到 ARK Files 存储并返回 file_id

```Bash
arkcli agent file upload
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--path` | string | 以 multipart 字段 file 上传的本地文件路径 |
| `--url` | string | 要注册的 HTTP/HTTPS URL 或 tos:// URI；与 --path 互斥 |
| `--purpose` | string | 文件用途（默认 user_data） |
| `--session-id` | string | 附加 Ark-Agent-Session-Id 头，用于 managed-agent 会话范围的文件 |
| `--tos` | string | TOS 存储对象，例如 '{bucket: b, prefix: arkfiles/}' |
| `--preprocess-configs` | string | 预处理配置对象 |
| `--expire-at` | int | UTC Unix 时间戳（秒） |
| `--wait-active` | bool | 返回前轮询 file get 直到状态变为 active |
| `--wait-timeout` | int | 配合 --wait-active 的最长等待秒数；默认 120 |
| `--wait-interval` | int | 配合 --wait-active 的轮询间隔秒数；默认 2 |

<span id="agent-file-wait-command"></span>
### agent file wait

等待文件进入 active 状态

```Bash
arkcli agent file wait <file-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--wait-timeout` | int | 最长等待秒数；默认 120 |
| `--wait-interval` | int | 轮询间隔秒数；默认 2 |

<span id="agent-memory-store-create-command"></span>
### agent memory-store create

创建记忆库

```Bash
arkcli agent memory-store create
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 载荷的路径。传 - 或省略 --file 表示从 stdin 读取 |
| `--name` | string | Memory Store 名称 |
| `--description` | string | 记忆库描述 |

<span id="agent-memory-store-creators-command"></span>
### agent memory-store creators

列出记忆库创建者

```Bash
arkcli agent memory-store creators
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 载荷的路径。传 - 或省略 --file 表示从 stdin 读取 |

<span id="agent-memory-store-delete-command"></span>
### agent memory-store delete

删除记忆库

```Bash
arkcli agent memory-store delete <store-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 载荷的路径。传 - 或省略 --file 表示从 stdin 读取 |
| `--yes` | bool | 跳过删除的交互确认 |

<span id="agent-memory-store-get-command"></span>
### agent memory-store get

获取记忆库

```Bash
arkcli agent memory-store get <store-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 载荷的路径。传 - 或省略 --file 表示从 stdin 读取 |

<span id="agent-memory-store-list-command"></span>
### agent memory-store list

列出记忆库

```Bash
arkcli agent memory-store list
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 载荷的路径。传 - 或省略 --file 表示从 stdin 读取 |
| `--limit` | int | 分页大小 |
| `--page` | string | 分页游标 / 页码 |
| `--name` | string | 按 Memory Store 名称过滤 |
| `--created-by` | string_slice | 创建者用户 ID，逗号分隔或重复传入 |

<span id="agent-memory-store-memories-batch-create-command"></span>
### agent memory-store memories batch-create

批量创建记忆

```Bash
arkcli agent memory-store memories batch-create <store-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 载荷的路径。传 - 或省略 --file 表示从 stdin 读取 |
| `--items` | string | 记忆条目数组 |

<span id="agent-memory-store-memories-create-command"></span>
### agent memory-store memories create

创建记忆

```Bash
arkcli agent memory-store memories create <store-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 载荷的路径。传 - 或省略 --file 表示从 stdin 读取 |
| `--path` | string | Memory 路径 |
| `--content` | string | 记忆内容，或用 @file 从磁盘读取 |

<span id="agent-memory-store-memories-delete-command"></span>
### agent memory-store memories delete

删除记忆

```Bash
arkcli agent memory-store memories delete <store-id> [memory-id]
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 载荷的路径。传 - 或省略 --file 表示从 stdin 读取 |
| `--yes` | bool | 跳过删除的交互确认 |
| `--memory-id` | string | 记忆 ID |

<span id="agent-memory-store-memories-get-command"></span>
### agent memory-store memories get

获取记忆

```Bash
arkcli agent memory-store memories get <store-id> [memory-id]
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 载荷的路径。传 - 或省略 --file 表示从 stdin 读取 |
| `--memory-id` | string | 记忆 ID |
| `--view` | string | Memory 视图：basic \| full |

<span id="agent-memory-store-memories-list-command"></span>
### agent memory-store memories list

列出记忆库中的记忆

```Bash
arkcli agent memory-store memories list <store-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 载荷的路径。传 - 或省略 --file 表示从 stdin 读取 |
| `--limit` | int | 分页大小 |
| `--page` | string | 分页游标 / 页码 |
| `--path-prefix` | string | Memory 路径前缀（默认 /） |
| `--updated-after` | string | 过滤在该时间之后更新的 Memory（RFC3339） |
| `--depth` | int | 列表深度 |

<span id="agent-memory-store-memories-update-command"></span>
### agent memory-store memories update

更新记忆

```Bash
arkcli agent memory-store memories update <store-id> [memory-id]
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 载荷的路径。传 - 或省略 --file 表示从 stdin 读取 |
| `--memory-id` | string | 记忆 ID |
| `--path` | string | Memory 路径 |
| `--content` | string | 记忆内容，或用 @file 从磁盘读取 |
| `--content-sha256` | string | 用于乐观锁的当前内容 sha256 期望值 |

<span id="agent-memory-store-update-command"></span>
### agent memory-store update

更新记忆库

```Bash
arkcli agent memory-store update <store-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 载荷的路径。传 - 或省略 --file 表示从 stdin 读取 |
| `--name` | string | Memory Store 名称 |
| `--description` | string | 记忆库描述 |

<span id="agent-model-config-command"></span>
### agent model config

查询基础模型运行参数的支持值与默认值

```Bash
arkcli agent model config <foundation-model-name>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--provider` | string | 查询模型 metadata 使用的 provider（不切换账号或产品）（默认 ark） |
| `--key` | string_slice | Metadata key，可重复或逗号分隔；省略时查询全部配置 |

<span id="agent-model-list-command"></span>
### agent model list

列出可作为托管智能体底座的基础模型

```Bash
arkcli agent model list
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--usage` | string | 模型用途：agent（主模型，默认）或 tool（工具模型） |
| `--query` | string | 用于补充/排序 ArkModels managed-agent 白名单的用户意图或关键词 |
| `--name` | string | 按模型名称子串过滤 |
| `--refresh-cache` | bool | 同步刷新全版本 ArkModels 缓存；失败冷却期内不重试；query 模式同时刷新搜索缓存 |
| `--include-all` | bool | 不按所选用途过滤支持性，返回所有模型并标注能力 |
| `--primary-only` | bool | 从完整模型列表中只保留主版本 |

<span id="agent-session-compact-command"></span>
### agent session compact

压缩空闲 Managed Agent Session 的当前上下文

```Bash
arkcli agent session compact <session-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--instructions` | string | 可选压缩指令，或 @file |
| `--session-thread-id` | string | 目标 Session Thread ID |
| `--timeout` | int | 完成超时秒数；默认 120 |
| `--poll` | bool | 轮询事件列表，不建立 SSE 流 |
| `--raw` | bool | 输出原始 NDJSON 事件 |

<span id="agent-session-create-command"></span>
### agent session create

创建托管智能体会话

```Bash
arkcli agent session create
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 载荷的路径。传 - 或省略 --file 表示从 stdin 读取 |
| `--agent-id` | string | 智能体 ID |
| `--agent-version` | int | 智能体版本 |
| `--agent` | string | 已解析的智能体对象；设置后覆盖 --agent-id/--agent-version |
| `--env-id` | string | 环境 ID（--environment-id 的别名） |
| `--environment-id` | string | 环境 ID |
| `--title` | string | 会话标题 |
| `--resource` | string | Resources 数组 |
| `--tos-path` | string | 要挂载的 TOS 目录，例如 tos://bucket/prefix/；会追加一个 type=tos 资源 |
| `--vault-id` | string_slice | Vault id；逗号分隔或重复传入 |
| `--vault-ids` | string_slice | Vault id，逗号分隔或重复传入 |
| `--tags` | string | Tags 映射或 tag 数组 |
| `--agent-overrides` | string | AgentWithOverrides 对象；行内 JSON/YAML 或 @file |
| `--environment-overrides` | string | EnvironmentWithOverrides 对象；行内 JSON/YAML 或 @file |

<span id="agent-session-delete-command"></span>
### agent session delete

删除托管智能体会话

```Bash
arkcli agent session delete <session-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 载荷的路径。传 - 或省略 --file 表示从 stdin 读取 |
| `--yes` | bool | 跳过删除的交互确认 |

<span id="agent-session-events-list-command"></span>
### agent session events list

列出托管智能体会话事件

```Bash
arkcli agent session events list <session-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 请求体的路径。传 - 或省略 --file 表示从 stdin 读取 |
| `--limit` | int | 分页大小 |
| `--page` | string | 分页游标 / 页码 |
| `--after` | string | 游标：取该事件 ID 之后的数据 |
| `--before` | string | 游标：取该事件 ID 之前的数据 |
| `--since` | string | 游标/时间下界 |
| `--created-after` | string | 事件 created_at 下界（RFC3339） |
| `--created-before` | string | 事件 created_at 上界（RFC3339） |
| `--type` | string_slice | 事件类型过滤；可重复或用逗号分隔 |
| `--session-thread-id` | string | 按会话 thread id 过滤 |
| `--order` | string | 排序方向：asc \| desc |

<span id="agent-session-events-send-command"></span>
### agent session events send

发送托管智能体会话事件

```Bash
arkcli agent session events send <session-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 请求体的路径。传 - 或省略 --file 表示从 stdin 读取 |
| `--events` | string | 事件数组；多个事件按顺序串行发送（非原子） |
| `--event` | string | 单个事件对象 |
| `--type` | string | 单个事件类型，例如 user.message |
| `--text` | string | user.message 的文本 |
| `--content` | string | 内容字符串，或用 @file 从磁盘读取 |
| `--image` | string_slice | 图片文件 ID 或 @本地路径；可重复或逗号分隔 |
| `--document` | string_slice | 文档 / PDF 文件 ID 或 @本地路径；可重复或逗号分隔 |
| `--purpose` | string | 本地 --image/--document 上传的文件用途（默认 user_data） |
| `--wait-timeout` | int | 本地上传、--stream/--wait 初始阶段或 --poll 的秒数；默认 120 |
| `--wait-interval` | int | 本地多模态上传的轮询间隔秒数；默认 2 |
| `--session-thread-id` | string | 目标会话 thread id |
| `--no-event-deltas` | bool | 不请求 PRD 的 event_start/event_delta 帧，只使用完整事件 |
| `--max-event-chars` | int | 美化后事件文本最多显示的字符数；默认 2000，0 表示不限制 |
| `--stream` | bool | 发送后打开 SSE 事件流并等待到终态；超时则回退到事件列表轮询 |
| `--wait` | bool | --stream 的兼容别名；除非显式指定 --stream，大请求体可能立即返回 |
| `--wait-fallback-timeout` | int | 流超时后继续轮询的秒数；默认 120 |
| `--poll` | bool | 发送后改为轮询事件列表直到终态，而不是开流；适合大请求或长耗时请求 |
| `--poll-interval` | int | 配合 --poll 的轮询间隔秒数；默认 2 |
| `--raw` | bool | 配合 --stream、--wait 或 --poll 时，打印原始 NDJSON 事件而不是人类可读行 |
| `--tool-use-id` | string | user.tool_confirmation 的 tool use id |
| `--custom-tool-use-id` | string | user.custom_tool_result 的自定义工具调用 ID |
| `--result` | string | 结果值，例如 allow \| deny |

<span id="agent-session-events-stream-command"></span>
### agent session events stream

流式订阅托管智能体会话事件

```Bash
arkcli agent session events stream <session-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--after` | string | 游标：取该事件 ID 之后的数据 |
| `--before` | string | 游标：取该事件 ID 之前的数据 |
| `--since` | string | 游标/时间下界 |
| `--created-after` | string | 事件 created_at 下界（RFC3339） |
| `--created-before` | string | 事件 created_at 上界（RFC3339） |
| `--type` | string_slice | 事件类型过滤；可重复或用逗号分隔 |
| `--session-thread-id` | string | 按会话 thread id 过滤 |
| `--no-event-deltas` | bool | 不请求 PRD 的 event_start/event_delta 帧，只使用完整事件 |
| `--max-event-chars` | int | 美化后事件文本最多显示的字符数；默认 2000，0 表示不限制 |
| `--order` | string | 排序方向：asc \| desc |

<span id="agent-session-get-command"></span>
### agent session get

获取托管智能体会话

```Bash
arkcli agent session get <session-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 载荷的路径。传 - 或省略 --file 表示从 stdin 读取 |

<span id="agent-session-list-command"></span>
### agent session list

列出托管智能体会话

```Bash
arkcli agent session list
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 载荷的路径。传 - 或省略 --file 表示从 stdin 读取 |
| `--limit` | int | 分页大小 |
| `--page` | int | 页码 |
| `--agent-id` | string | 按智能体 ID 过滤 |
| `--agent-version` | int | 按智能体版本过滤 |
| `--environment-id` | string | 按环境 ID 过滤 |
| `--memory-store-id` | string | 按记忆库 ID 过滤 |
| `--start` | string | 按会话开始时间下界过滤（RFC3339） |
| `--end` | string | 按会话开始 / 更新时间上界过滤（RFC3339） |
| `--order` | string | 排序方向：asc \| desc |
| `--status` | string_slice | 按会话状态过滤；可重复或用逗号分隔 |
| `--tags` | string | Tags 映射或 tag 数组过滤条件 |

<span id="agent-session-resources-add-command"></span>
### agent session resources add

为托管智能体会话添加资源

```Bash
arkcli agent session resources add <session-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 请求体的路径。传 - 或省略 --file 表示从 stdin 读取 |
| `--path` | string | 本地文件路径：上传后等待其变为 active，再挂载为文件资源 |
| `--file-id` | string | Files API 文件 ID。可用 `arkcli agent file upload` 或 `arkcli agent file list` 获取。 |
| `--type` | string | 资源类型：file |
| `--mount-path` | string | 追加到后端托管的 /mnt/session/uploads/ 前缀之后的路径 |
| `--purpose` | string | 使用 --path 时的文件上传用途（默认 user_data） |
| `--tos` | string | 使用 --path 上传文件时的 TOS 存储对象 |
| `--preprocess-configs` | string | 使用 --path 上传文件时的预处理配置对象 |
| `--expire-at` | int | 使用 --path 上传文件时的 UTC Unix 时间戳（秒） |
| `--wait-timeout` | int | 本地文件激活的最长秒数；配合 --wait 时也限制 Agent 响应等待（默认 120） |
| `--wait-interval` | int | 轮询间隔秒数；默认 2 |

<span id="agent-session-resources-delete-command"></span>
### agent session resources delete

删除托管智能体会话资源

```Bash
arkcli agent session resources delete <session-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--yes` | bool | 跳过删除的交互确认 |
| `--resource-id` | string | Session 资源 id |

<span id="agent-session-resources-get-command"></span>
### agent session resources get

查看挂载到托管智能体会话的单个资源

```Bash
arkcli agent session resources get <session-id> [resource-id]
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--resource-id` | string | Session 资源 id |
| `--file-id` | string | 按 file_id 匹配文件资源 |
| `--mount-path` | string | 按 mount_path 匹配文件资源 |

<span id="agent-session-resources-list-command"></span>
### agent session resources list

列出挂载到托管智能体会话的资源

```Bash
arkcli agent session resources list <session-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 请求体的路径。传 - 或省略 --file 表示从 stdin 读取 |

<span id="agent-session-resources-update-command"></span>
### agent session resources update

更新托管智能体会话资源

```Bash
arkcli agent session resources update <session-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--resource-id` | string | Session 资源 id |
| `--authorization-token` | string | github_repository 资源的新授权 token |

<span id="agent-session-threads-get-command"></span>
### agent session threads get

获取托管智能体会话线程

```Bash
arkcli agent session threads get <session-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 请求体的路径。传 - 或省略 --file 表示从 stdin 读取 |
| `--session-thread-id` | string | 会话 thread id |

<span id="agent-session-threads-list-command"></span>
### agent session threads list

列出托管智能体会话线程

```Bash
arkcli agent session threads list <session-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 请求体的路径。传 - 或省略 --file 表示从 stdin 读取 |
| `--limit` | int | 分页大小 |
| `--page` | string | 分页游标 / 页码 |

<span id="agent-session-update-command"></span>
### agent session update

更新托管智能体会话

```Bash
arkcli agent session update <session-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 载荷的路径。传 - 或省略 --file 表示从 stdin 读取 |
| `--title` | string | 会话标题 |
| `--tag` | string | Tags 补丁映射对象（服务端按合并语义处理） |
| `--tags` | string | Tags 映射或 tag 数组 |
| `--agent` | string | 智能体补丁对象；仅用于 tools/mcp_servers |

<span id="agent-session-upgrade-command"></span>
### agent session upgrade

升级已有 Session 的运行配置（返回受理结果，不代表升级完成）

```Bash
arkcli agent session upgrade <session-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | 升级请求 JSON/YAML 文件（snake_case）；显式 flags 覆盖对应字段 |
| `--agent` | string | Agent 升级对象（snake_case）；inline JSON/YAML 或 @file |
| `--environment` | string | Environment 升级对象（snake_case）；inline JSON/YAML 或 @file |
| `--agent-version` | int | 加载指定 Agent 版本；不传或 0 表示保留当前快照 |
| `--model` | string | 模型 ID 或模型升级对象（snake_case JSON/YAML 或 @file） |
| `--speed` | string | 兼容保留的模型 speed 参数 |
| `--thinking` | string | 模型思考模式 |
| `--reasoning-effort` | string | 模型推理强度 |
| `--service-tier` | string | 模型服务等级 |
| `--vault-ids` | string | 已绑定 Vault ID 的 JSON/YAML 数组或 @file；仅刷新，不改变绑定集合 |
| `--initial-events` | string | 初始事件数组（JSON/YAML 或 @file）；可选，[] 表示不追加事件 |
| `--compact` | bool | 附带升级用 /compact 事件；false 显式设置 initial_events 为 [] |

<span id="agent-skill-create-command"></span>
### agent skill create

上传本地技能 zip 包并创建自定义托管智能体技能

```Bash
arkcli agent skill create
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--zip` | string（必填） | 本地技能 zip 包路径 |
| `--display-title` | string | 所上传技能的显示标题 |
| `--protection-enabled` | bool | 为新建 Skill 启用内容保护 |

<span id="agent-skill-delete-command"></span>
### agent skill delete

删除自定义托管智能体技能（需先删除该技能的全部版本）

```Bash
arkcli agent skill delete <skill-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--yes` | bool | 确认永久删除 |
| `--version` | string | 只删除该技能版本；省略则删除整个技能（要求无剩余版本） |

<span id="agent-skill-download-command"></span>
### agent skill download

下载自定义托管智能体技能的某个版本归档

```Bash
arkcli agent skill download <skill-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--version` | string | 技能语义版本；默认取最新版本 |
| `--output` | string | 本地输出 zip 路径；默认 <skill-id>-v<version>.zip |

<span id="agent-skill-get-command"></span>
### agent skill get

通过 TOP GetSkill 获取自定义或 Ark 托管智能体技能

```Bash
arkcli agent skill get <skill-id>
```

<span id="agent-skill-github-import-command"></span>
### agent skill github import

扫描并导入 GitHub 公共仓库中的 Skills

```Bash
arkcli agent skill github import <repository-input>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--path` | string_slice | 仓库内 Skill 相对路径；可重复传入 |
| `--all` | bool | 导入全部有效候选 |
| `--selected` | string | 通过 @file 传入 Path 和可选 ProtectionEnabled 选择数组 |
| `--protection-enabled` | bool | 为新建 Skill 启用内容保护 |

<span id="agent-skill-github-scan-command"></span>
### agent skill github scan

扫描 GitHub 公共仓库中的 Skills

```Bash
arkcli agent skill github scan <repository-input>
```

<span id="agent-skill-list-command"></span>
### agent skill list

列出 SkillHub market 或 TOP custom/ark Managed Agent skills

```Bash
arkcli agent skill list
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--source` | string | Skill 来源：market \| custom \| ark \| all；all 返回 custom 与 ark 联合视图 |
| `--limit` | int | 分页大小（--page-size 的别名） |
| `--page` | string | 页码（--page-number 的别名） |
| `--page-number` | int | 页码 |
| `--page-size` | int | 每页条数 |
| `--query` | string | 搜索关键词 |
| `--id` | string | 按技能 ID 过滤 |
| `--ids` | string_slice | 按 ID 过滤自定义技能；可重复或逗号分隔 |
| `--name` | string | 按技能名称过滤 |
| `--display-title` | string | 按 Skill 展示标题过滤 |
| `--skill-space-id` | string | 按技能空间 id 过滤 |
| `--keywords` | string | 按关键词过滤 |
| `--source-type` | string | 按来源类型过滤 |
| `--status` | string_slice | 按状态过滤；可重复或用逗号分隔 |
| `--sharing` | bool | 按可见性过滤市场技能；true=社区，false=自定义 |
| `--sort-by` | string | TOP ListSkills 的自定义技能排序字段 |
| `--sort-order` | string | TOP ListSkills 的自定义技能排序方向 |
| `--create-time-gte` | string | TOP ListSkills 的自定义技能创建时间下界 |
| `--create-time-lte` | string | TOP ListSkills 的自定义技能创建时间上界 |

<span id="agent-skill-search-command"></span>
### agent skill search

按用户查询搜索 skills，并输出 Agent skill refs

```Bash
arkcli agent skill search <query>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--limit` | int | 分页大小 |
| `--page` | string | 分页游标 / 页码 |
| `--source` | string | Skill 来源：market \| custom \| ark \| all；all 返回 custom 与 ark 联合视图 |
| `--private` | bool | 只搜索私有技能 |
| `--type` | string | 输出 refs 使用的 Agent skill 类型：custom \| skill_hub |

<span id="agent-skill-set-protection-command"></span>
### agent skill set-protection

开启或关闭自定义 Managed Agent Skill 的内容保护

```Bash
arkcli agent skill set-protection <skill-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--enabled` | bool（必填） | 内容保护状态 |

<span id="agent-skill-update-command"></span>
### agent skill update

为已有的自定义托管智能体技能上传新版本

```Bash
arkcli agent skill update <skill-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--zip` | string（必填） | 新的本地技能 zip 包路径 |
| `--display-title` | string | 技能新版本的显示标题 |

<span id="agent-skill-versions-command"></span>
### agent skill versions

列出自定义或 Ark 托管智能体技能的版本

```Bash
arkcli agent skill versions <skill-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--limit` | int | 分页大小 |
| `--page` | string | 分页游标 |

<span id="agent-vault-create-command"></span>
### agent vault create

创建凭证库（Vault）

```Bash
arkcli agent vault create
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 载荷的路径。传 - 或省略 --file 表示从 stdin 读取 |
| `--display-name` | string | 凭证库显示名 |
| `--metadata` | string | 元数据 map 对象 |

<span id="agent-vault-credentials-create-command"></span>
### agent vault credentials create

在凭证库中创建凭证

```Bash
arkcli agent vault credentials create <vault-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 载荷的路径。传 - 或省略 --file 表示从 stdin 读取 |
| `--display-name` | string | 凭证显示名 |
| `--auth` | string | 凭证认证对象 |
| `--auth-type` | string | 认证类型：environment_variable \| static_bearer \| mcp_oauth |
| `--mcp-server-url` | string | bearer/OAuth 凭证使用的 MCP server URL |
| `--token` | string | Bearer token 或环境变量值；可用 @file 读取本地文件 |
| `--access-token` | string | 当前 OAuth access token；用 @file 从本地文件读取 |
| `--secret-name` | string | environment_variable 认证用的环境变量名 |
| `--secret-value` | string | 环境变量值；可用 @file 读取本地文件 |
| `--networking-type` | string | 环境网络类型：limited \| unrestricted |
| `--allowed-host` | string_slice | 受限环境下允许访问的主机；可重复或逗号分隔 |
| `--client-id` | string | OAuth 刷新的 client id |
| `--client-secret` | string | OAuth 刷新的 client secret；建议用 @file |
| `--refresh-token` | string | OAuth refresh token；可用 @file |
| `--token-endpoint` | string | OAuth token endpoint |
| `--resource` | string | OAuth resource |
| `--scope` | string | OAuth scope |
| `--metadata` | string | 元数据 map 对象 |

<span id="agent-vault-credentials-delete-command"></span>
### agent vault credentials delete

删除凭证

```Bash
arkcli agent vault credentials delete <vault-id> <credential-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 载荷的路径。传 - 或省略 --file 表示从 stdin 读取 |
| `--yes` | bool | 跳过删除的交互确认 |

<span id="agent-vault-credentials-get-command"></span>
### agent vault credentials get

获取凭证

```Bash
arkcli agent vault credentials get <vault-id> <credential-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 载荷的路径。传 - 或省略 --file 表示从 stdin 读取 |

<span id="agent-vault-credentials-list-command"></span>
### agent vault credentials list

列出凭证库中的凭证

```Bash
arkcli agent vault credentials list <vault-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 载荷的路径。传 - 或省略 --file 表示从 stdin 读取 |
| `--limit` | int | 分页大小 |
| `--page` | string | 分页游标 / 页码 |
| `--id` | string | 按凭证 ID 过滤 |
| `--name` | string | 按凭证名称过滤 |

<span id="agent-vault-credentials-update-command"></span>
### agent vault credentials update

更新凭证

```Bash
arkcli agent vault credentials update <vault-id> <credential-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 载荷的路径。传 - 或省略 --file 表示从 stdin 读取 |
| `--display-name` | string | 凭证显示名 |
| `--auth` | string | 凭证认证对象 |
| `--auth-type` | string | 认证类型：environment_variable \| static_bearer \| mcp_oauth |
| `--mcp-server-url` | string | bearer/OAuth 凭证使用的 MCP server URL |
| `--token` | string | Bearer token 或环境变量值；可用 @file 读取本地文件 |
| `--access-token` | string | 当前 OAuth access token；用 @file 从本地文件读取 |
| `--secret-name` | string | environment_variable 认证用的环境变量名 |
| `--secret-value` | string | 环境变量值；可用 @file 读取本地文件 |
| `--networking-type` | string | 环境网络类型：limited \| unrestricted |
| `--allowed-host` | string_slice | 受限环境下允许访问的主机；可重复或逗号分隔 |
| `--client-id` | string | OAuth 刷新的 client id |
| `--client-secret` | string | OAuth 刷新的 client secret；建议用 @file |
| `--refresh-token` | string | OAuth refresh token；可用 @file |
| `--token-endpoint` | string | OAuth token endpoint |
| `--resource` | string | OAuth resource |
| `--scope` | string | OAuth scope |
| `--metadata` | string | 元数据 map 对象 |

<span id="agent-vault-delete-command"></span>
### agent vault delete

删除凭证库（Vault）

```Bash
arkcli agent vault delete <vault-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 载荷的路径。传 - 或省略 --file 表示从 stdin 读取 |
| `--yes` | bool | 跳过删除的交互确认 |

<span id="agent-vault-get-command"></span>
### agent vault get

获取凭证库（Vault）

```Bash
arkcli agent vault get <vault-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 载荷的路径。传 - 或省略 --file 表示从 stdin 读取 |

<span id="agent-vault-list-command"></span>
### agent vault list

列出凭证库（Vault）

```Bash
arkcli agent vault list
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 载荷的路径。传 - 或省略 --file 表示从 stdin 读取 |
| `--limit` | int | 分页大小 |
| `--page` | string | 分页游标 / 页码 |
| `--id` | string | 按凭证库 ID 过滤 |
| `--name` | string | 按 Vault 名称过滤 |

<span id="agent-vault-oauth-flow-create-command"></span>
### agent vault oauth-flow create

创建 Vault MCP OAuth 流程并返回授权链接

```Bash
arkcli agent vault oauth-flow create
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 载荷的路径。传 - 或省略 --file 表示从 stdin 读取 |
| `--vault-id` | string | Vault id |
| `--display-name` | string | 凭证显示名 |
| `--mcp-server-url` | string | MCP server URL |
| `--redirect-url` | string | OAuth 回调的业务成功跳转 URL |
| `--source` | string | 流程来源标记，例如 arkcli-mcp-login |
| `--client-id` | string | 自定义 MCP/provider 覆盖模式下的 OAuth client id |
| `--client-secret` | string | OAuth client secret，或用 @file 从磁盘读取 |

<span id="agent-vault-oauth-provider-list-command"></span>
### agent vault oauth-provider list

列出可用于 Agent MCP server 与凭证库的已注册 MCP provider

```Bash
arkcli agent vault oauth-provider list
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 载荷的路径。传 - 或省略 --file 表示从 stdin 读取 |
| `--limit` | int | 分页大小 |
| `--page-token` | string | 下一页 token |

<span id="agent-vault-update-command"></span>
### agent vault update

更新凭证库（Vault）

```Bash
arkcli agent vault update <vault-id>
```

| Flag | 类型 | 说明 |
| --- | --- | --- |
| `--file` | string | JSON/YAML 载荷的路径。传 - 或省略 --file 表示从 stdin 读取 |
| `--display-name` | string | 凭证库显示名 |
| `--metadata` | string | 元数据 map 对象 |
