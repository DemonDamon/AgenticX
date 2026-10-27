---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/cli/managed-agent
fetched: 2026-10-23
title: Managed Agent CLI
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Managed Agent

> 阿里云百炼 CLI 管理 Managed Agent 生命周期、项目、会话、状态及全部 AgentStudio 资源的命令速查。

<meta property="og:title" content="Managed Agent" />

在终端管理 Managed Agent 全生命周期：以基础设施即代码方式部署 Agent、初始化与构建本地项目、管理会话与状态，以及直接操作 AgentStudio 中的 Agents、Environments、Skills、Vaults、Deployments、Sessions 和 Files。 按资源提供查询、创建和运行等操作。Agent、Environment、Skill、Vault 和 Deployment 等创建命令支持通过参数生成资源声明，通过 `--yes` 确认后写入配置并创建资源。

<Note>
  Managed Agent 相关能力目前仅对中国站（aliyun.com）账号开放。
</Note>

<Tip>
  任意命令追加 `--help` 可查看完整参数说明，例如 `bl managed-agent apply --help`。本文命令明细以 bl 2.2.1 为基准核实。
</Tip>

在各功能页也可查看对应用法，见 [Managed Agent 快速开始](../managed-agents-quick-start.md)。

## 全局参数 <span id="h-cli-flags" />

以下参数对所有 `bl managed-agent` 子命令可用，各命令明细中不再重复列出。需要 API Key 鉴权的命令还额外支持 `--api-key` 和 `--base-url`。

<Accordion title="展开查看全部全局参数">
| 参数                    | 类型     | 说明                                                                                         |
| --------------------- | ------ | ------------------------------------------------------------------------------------------ |
| `--output <format>`   | string | 输出格式：`text`、`json`                                                                         |
| `--timeout <seconds>` | number | 请求超时时间（秒）                                                                                  |
| `--quiet`             | switch | 隐藏非必要输出                                                                                    |
| `--verbose`           | switch | 打印 HTTP 请求和响应详情                                                                            |
| `--dry-run`           | switch | 仅预览，不实际执行                                                                                  |
| `--config <name>`     | string | 为当前命令使用指定配置 Profile                                                                        |
| `--help`              | switch | 显示帮助信息                                                                                     |
| `--api-key <key>`     | string | API Key；凭证按 `--api-key` > `DASHSCOPE_API_KEY` 环境变量 > `bl auth login`（当前激活的配置 Profile）的顺序解析 |
| `--base-url <url>`    | string | API Base URL                                                                               |
</Accordion>

## 生命周期

### bl managed-agent init

创建 agents.yaml 模板。无需鉴权。

**语法**

```bash
bl managed-agent init [--agent-name <name>] [--file <path>] [--force]
```

| 参数                    | 类型     | 必填 | 说明                          |
| --------------------- | ------ | -- | --------------------------- |
| `--agent-name <name>` | string | 否  | 第一个 Agent 的名称（默认：assistant） |
| `--file <path>`       | string | 否  | 输出配置路径（默认：agents.yaml）      |
| `--force`             | switch | 否  | 覆盖已有配置文件                    |

**示例**：创建 agents.yaml 模板文件

```bash
bl managed-agent init --agent-name assistant
```

### bl managed-agent validate

离线验证 agents.yaml 配置。无需鉴权。

**语法**

```bash
bl managed-agent validate [--file <path>]
```

| 参数              | 类型     | 必填 | 说明                     |
| --------------- | ------ | -- | ---------------------- |
| `--file <path>` | string | 否  | 配置文件路径（默认：agents.yaml） |

**示例**：离线验证 agents.yaml 配置文件

```bash
bl managed-agent validate --file agents.yaml
```

### bl managed-agent plan

显示将应用到 Agent 基础设施的变更。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent plan [--file <path>] [--no-refresh] [--refresh-only]
```

| 参数               | 类型     | 必填 | 说明                     |
| ---------------- | ------ | -- | ---------------------- |
| `--file <path>`  | string | 否  | 配置文件路径（默认：agents.yaml） |
| `--no-refresh`   | switch | 否  | 规划前跳过从远端刷新状态           |
| `--refresh-only` | switch | 否  | 刷新状态并显示漂移，不规划远端变更      |

**示例**：预览将应用的变更计划

```bash
bl managed-agent plan --no-refresh
```

- \--no-refresh 和 --dry-run 基于本地配置与 State 离线规划：不发送远端请求、不写入 State，也不检查 Provider Key。

### bl managed-agent apply

应用规划的变更，创建、更新或删除 Agent 资源。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent apply [--file <path>] [--concurrency <n>]
```

| 参数                  | 类型     | 必填 | 说明                     |
| ------------------- | ------ | -- | ---------------------- |
| `--file <path>`     | string | 否  | 配置文件路径（默认：agents.yaml） |
| `--no-refresh`      | switch | 否  | 规划前跳过从远端刷新状态           |
| `--concurrency <n>` | number | 否  | 最大并行应用资源数（默认：6，最多：10）  |
| `--yes`             | switch | 否  | 确认执行此高风险操作             |

<Warning>
  该操作会应用当前计划，可能创建、更新或删除远端托管 Agent 资源。
</Warning>

**示例**：确认执行配置变更并创建或更新资源

```bash
bl managed-agent apply --yes
```

### bl managed-agent destroy

销毁 State 中跟踪的全部托管 Agent 资源。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent destroy [--file <path>] [--cascade]
```

| 参数              | 类型     | 必填 | 说明                          |
| --------------- | ------ | -- | --------------------------- |
| `--file <path>` | string | 否  | 配置文件路径（默认：agents.yaml）      |
| `--cascade`     | switch | 否  | 自动删除依赖资源（例如引用某个环境的 Session） |
| `--yes`         | switch | 否  | 确认执行此高风险操作                  |

<Warning>
  该操作会删除 State 中跟踪的全部托管 Agent 资源；--cascade 还可能删除依赖资源。
</Warning>

**示例**：确认执行销毁所有托管 Agent 资源

```bash
bl managed-agent destroy --yes
```

## 本地资源状态

### bl managed-agent state list

列出 Agent State 中跟踪的资源。无需鉴权。

**语法**

```bash
bl managed-agent state list [--file <path>]
```

| 参数              | 类型     | 必填 | 说明                     |
| --------------- | ------ | -- | ---------------------- |
| `--file <path>` | string | 否  | 配置文件路径（默认：agents.yaml） |

**示例**：列出 State 中跟踪的资源列表

```bash
bl managed-agent state list --file agents.yaml
```

### bl managed-agent state show

显示 Agent State 中资源的详情。无需鉴权。

**语法**

```bash
bl managed-agent state show --address <provider.type.name> [--file <path>]
```

| 参数                               | 类型     | 必填 | 说明                     |
| -------------------------------- | ------ | -- | ---------------------- |
| `--address <provider.type.name>` | string | 是  | 资源 State 地址            |
| `--file <path>`                  | string | 否  | 配置文件路径（默认：agents.yaml） |

**示例**：显示指定资源的详细状态信息

```bash
bl managed-agent state show --address bailian.agent.assistant
```

### bl managed-agent state import

将已有远端资源导入 Agent State。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent state import --address <bailian.type.name> --remote-id <id> [--resource-version <n>] [--file <path>]
```

| 参数                              | 类型     | 必填 | 说明                     |
| ------------------------------- | ------ | -- | ---------------------- |
| `--address <bailian.type.name>` | string | 是  | 资源 State 地址            |
| `--remote-id <id>`              | string | 是  | 要导入的已有远端资源 ID          |
| `--resource-version <n>`        | number | 否  | 资源版本（用于 Agent 等带版本的资源） |
| `--file <path>`                 | string | 否  | 配置文件路径（默认：agents.yaml） |

**示例**：将远端资源导入 State 管理

```bash
bl managed-agent state import --address bailian.agent.assistant --remote-id agent-abc123
```

### bl managed-agent state rm

从 State 中移除资源，但不销毁远端资源。无需鉴权。

**语法**

```bash
bl managed-agent state rm --address <provider.type.name> [--file <path>]
```

| 参数                               | 类型     | 必填 | 说明                     |
| -------------------------------- | ------ | -- | ---------------------- |
| `--address <provider.type.name>` | string | 是  | 资源 State 地址            |
| `--file <path>`                  | string | 否  | 配置文件路径（默认：agents.yaml） |
| `--yes`                          | switch | 否  | 确认执行此高风险操作             |

<Warning>
  该操作会从本地 State 中移除资源但不会删除远端资源，此项目将不再跟踪该资源。
</Warning>

**示例**：确认执行从 State 移除资源

```bash
bl managed-agent state rm --address bailian.agent.assistant --yes
```

## 会话预览

### bl managed-agent playground

为 agents.yaml 中的 Agent 启动会话预览。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent playground [--file <path>] [--agent <id>] [--port <n>] [--no-open]
```

| 参数              | 类型     | 必填 | 说明                             |
| --------------- | ------ | -- | ------------------------------ |
| `--file <path>` | string | 否  | 配置文件路径（默认：agents.yaml）         |
| `--port <n>`    | number | 否  | 本地端口（默认：4848）                  |
| `--no-open`     | switch | 否  | 不自动打开浏览器                       |
| `--agent <id>`  | string | 否  | 要预览的 Agent（项目包含多个 Agent 时需要指定） |

**示例**：为指定 Agent 启动会话预览

```bash
bl managed-agent playground --agent assistant
```

- 会话预览需要 Node.js 22+，并继续使用 agents.yaml；目录 Workbench 位于 managed-agent project workbench。

## 项目初始化

### bl managed-agent project init

创建目录项目，或转换当前 agents.yaml。无需鉴权。

**语法**

```bash
bl managed-agent project init [--project <directory>]
```

| 参数                      | 类型     | 必填 | 说明                                 |
| ----------------------- | ------ | -- | ---------------------------------- |
| `--project <directory>` | string | 否  | 目录项目根路径（默认：当前目录下的 ./managed-agent） |

**示例**：初始化目录式 Agent 项目结构

```bash
bl managed-agent project init --project ./my-agent
```

- 不传 --project 时创建 managed-agent/ 子目录；后续项目操作请先进入该目录。使用 --project . 可在当前目录初始化或转换 agents.yaml；不会覆盖已有项目文件。
- 新项目在四类资源目录的 \_examples/ 下生成配置示例，不写入 agent.json 引用，也不参与 Build/Publish。需要使用时，将示例复制到 \_examples/ 外，再配置 Agent 引用。

## 项目校验

### bl managed-agent project validate

校验目录式 Agent 项目。无需鉴权。

**语法**

```bash
bl managed-agent project validate [--project <directory>]
```

| 参数                      | 类型     | 必填 | 说明               |
| ----------------------- | ------ | -- | ---------------- |
| `--project <directory>` | string | 否  | 目录项目根路径（默认：当前目录） |

**示例**：校验目录式 Agent 项目的配置

```bash
bl managed-agent project validate --project ./my-agent
```

## 项目构建

### bl managed-agent project build

整理目录源文件并生成不可变的发布 Build。无需鉴权。

**语法**

```bash
bl managed-agent project build [--project <directory>]
```

| 参数                      | 类型     | 必填 | 说明               |
| ----------------------- | ------ | -- | ---------------- |
| `--project <directory>` | string | 否  | 目录项目根路径（默认：当前目录） |

**示例**：预览项目构建过程

```bash
bl managed-agent project build --dry-run
```

- Build 无需确认即可写入本地项目文件，包括推断的资源关联及将 Vault 明文密钥移入 .env。使用 --dry-run 可只预览不写入。Publish 变更远端资源前仍需显式确认。

## 项目发布

### bl managed-agent project publish

发布当前目录项目 Build 并记录版本。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent project publish [--project <directory>] [--no-refresh] [--concurrency <n>]
```

| 参数                      | 类型     | 必填 | 说明               |
| ----------------------- | ------ | -- | ---------------- |
| `--project <directory>` | string | 否  | 目录项目根路径（默认：当前目录） |
| `--no-refresh`          | switch | 否  | 规划前跳过远端刷新        |
| `--concurrency <n>`     | number | 否  | 最大并行资源操作数        |
| `--yes`                 | switch | 否  | 确认执行此高风险操作       |

<Warning>
  该操作会发布当前目录项目 Build，可能创建、更新或删除远端托管 Agent 资源。
</Warning>

**示例**：确认执行项目发布

```bash
bl managed-agent project publish --yes
```

## 项目工作台

### bl managed-agent project workbench

启动目录项目 Workbench。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent project workbench [--project <directory>] [--port <n>] [--no-open]
```

| 参数                      | 类型     | 必填 | 说明               |
| ----------------------- | ------ | -- | ---------------- |
| `--project <directory>` | string | 否  | 目录项目根路径（默认：当前目录） |
| `--port <n>`            | number | 否  | 本地端口（默认：4848）    |
| `--no-open`             | switch | 否  | 不自动打开浏览器         |

**示例**：启动项目工作台并禁用自动打开

```bash
bl managed-agent project workbench --project ./my-agent --no-open
```

## 项目版本

### bl managed-agent project version list

列出目录项目版本。无需鉴权。

**语法**

```bash
bl managed-agent project version list [--project <directory>] [--limit <n>] [--cursor <cursor>]
```

| 参数                      | 类型     | 必填 | 说明               |
| ----------------------- | ------ | -- | ---------------- |
| `--project <directory>` | string | 否  | 目录项目根路径（默认：当前目录） |
| `--limit <n>`           | number | 否  | 最多返回的版本数         |
| `--cursor <cursor>`     | string | 否  | 分页游标             |

**示例**：列出最近 20 个版本并输出 JSON

```bash
bl managed-agent project version list --limit 20 --output json
```

### bl managed-agent project version enable

启用目录项目版本管理。无需鉴权。

**语法**

```bash
bl managed-agent project version enable [--project <directory>]
```

| 参数                      | 类型     | 必填 | 说明               |
| ----------------------- | ------ | -- | ---------------- |
| `--project <directory>` | string | 否  | 目录项目根路径（默认：当前目录） |

**示例**：启用指定项目的版本管理

```bash
bl managed-agent project version enable --project ./my-agent
```

### bl managed-agent project version disable

关闭目录项目版本管理。无需鉴权。

**语法**

```bash
bl managed-agent project version disable [--project <directory>]
```

| 参数                      | 类型     | 必填 | 说明               |
| ----------------------- | ------ | -- | ---------------- |
| `--project <directory>` | string | 否  | 目录项目根路径（默认：当前目录） |

**示例**：关闭指定项目的版本管理

```bash
bl managed-agent project version disable --project ./my-agent
```

### bl managed-agent project version status

显示目录项目版本状态。无需鉴权。

**语法**

```bash
bl managed-agent project version status [--project <directory>]
```

| 参数                      | 类型     | 必填 | 说明               |
| ----------------------- | ------ | -- | ---------------- |
| `--project <directory>` | string | 否  | 目录项目根路径（默认：当前目录） |

**示例**：查询项目版本状态并输出 JSON

```bash
bl managed-agent project version status --project ./my-agent --output json
```

### bl managed-agent project version preview

预览目录项目历史版本。无需鉴权。

**语法**

```bash
bl managed-agent project version preview --version-id <full-version> [--project <directory>]
```

| 参数                            | 类型     | 必填 | 说明               |
| ----------------------------- | ------ | -- | ---------------- |
| `--project <directory>`       | string | 否  | 目录项目根路径（默认：当前目录） |
| `--version-id <full-version>` | string | 是  | 完整的项目版本 ID       |

**示例**：预览指定完整版本的历史内容

```bash
bl managed-agent project version preview --version-id <full-version>
```

### bl managed-agent project version restore

将历史版本恢复到项目工作目录。无需鉴权。

**语法**

```bash
bl managed-agent project version restore --version-id <full-version> [--project <directory>]
```

| 参数                            | 类型     | 必填 | 说明               |
| ----------------------------- | ------ | -- | ---------------- |
| `--project <directory>`       | string | 否  | 目录项目根路径（默认：当前目录） |
| `--version-id <full-version>` | string | 是  | 完整的项目版本 ID       |
| `--yes`                       | switch | 否  | 确认执行此高风险操作       |

<Warning>
  该操作会将完整目录源文件恢复到工作区；版本历史和远端 State 不会移动。
</Warning>

**示例**：恢复指定完整版本到工作目录

```bash
bl managed-agent project version restore --version-id <full-version>
```

## Agent

### bl managed-agent agent create

通过隔离的 YAML Apply 声明并创建一个托管 Agent。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent agent create --name <name> --model <model> --instructions <text|path> [--description <text>] [--skill <id>...] [--type custom|official] [--skill-dir <path>...] [--tool <name>...] [--file <path>] [--yes]
```

| 参数                            | 类型         | 必填     | 说明                                      |
| ----------------------------- | ---------- | ------ | --------------------------------------- |
| `--name <name>`               | string     | 是      | 远端 Agent 显示名称；YAML key 将自动生成            |
| `--model <model>`             | string     | 是      | 模型 ID                                   |
| `--instructions <text\        | path>`     | string | 是                                       | 内联指令，或以 ./、../、/ 开头的文件路径     |
| `--description <text>`        | string     | 否      | Agent 描述                                |
| `--skill <id>`                | array      | 否      | 已存在的远端 Skill ID（可重复）                    |
| `--skill-dir <path>`          | array      | 否      | 通过同一次定向创建声明、上传并绑定的本地 Skill 目录或 ZIP（可重复） |
| `--type <custom\              | official>` | string | 否                                       | 应用于所有 --skill 的类型（默认：custom） |
| `--tool <name>`               | array      | 否      | 内置工具名称（可重复）                             |
| `--file <path>`               | string     | 否      | 配置文件路径（默认：agents.yaml）                  |
| `--yes`                       | switch     | 否      | 写入 YAML 并执行定向远端创建                       |

**示例**：创建名为 assistant 的托管 Agent 并配置模型和指令

```bash
bl managed-agent agent create --name assistant --model qwen3.8-max --instructions "You are helpful."
```

- 不带 --yes 时预览自动生成的 YAML key 和定向计划；--dry-run 完全离线。无关资源不会刷新或检测 Drift。
- \--skill 会把外部 Skill 引用直接写入 Agent 声明。--type 默认为 custom；平台 Skill 使用 --type official。这些 Skill 不通过顶层 skills 资源管理。
- \--skill-dir 接收本地 Skill 目录或 ZIP，将其写为顶层 custom Skill 声明，并把生成的 YAML key 写入 Agent 的 skills 列表；Skill 与 Agent 按依赖顺序一并创建。--type 只作用于 --skill ID。

### bl managed-agent agent list

列出托管 Agent。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent agent list [--limit <n>] [--page <cursor>] [--all] [--include-archived] [--file <path>]
```

| 参数                   | 类型     | 必填 | 说明                     |
| -------------------- | ------ | -- | ---------------------- |
| `--file <path>`      | string | 否  | 配置文件路径（默认：agents.yaml） |
| `--limit <n>`        | number | 否  | 单页数量（1-100）            |
| `--page <cursor>`    | string | 否  | 上一次请求返回的不透明分页 Cursor   |
| `--all`              | switch | 否  | 跟随不透明 Cursor 获取全部分页    |
| `--include-archived` | switch | 否  | 包含已归档资源                |

**示例**：列出最多 50 个托管 Agent

```bash
bl managed-agent agent list --limit 50
```

### bl managed-agent agent get

获取托管 Agent 详情。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent agent get --agent-id <id> [--agent-version <n>] [--file <path>]
```

| 参数                    | 类型     | 必填 | 说明                     |
| --------------------- | ------ | -- | ---------------------- |
| `--file <path>`       | string | 否  | 配置文件路径（默认：agents.yaml） |
| `--agent-id <id>`     | string | 是  | Agent ID               |
| `--agent-version <n>` | number | 否  | 指定 Agent 版本            |

**示例**：获取指定 Agent 的详细信息

```bash
bl managed-agent agent get --agent-id agent_abc
```

### bl managed-agent agent search

搜索托管 Agent。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent agent search --query <text> [--limit <n>] [--page-limit <n>] [--include-archived]
```

| 参数                   | 类型     | 必填 | 说明                       |
| -------------------- | ------ | -- | ------------------------ |
| `--file <path>`      | string | 否  | 配置文件路径（默认：agents.yaml）   |
| `--limit <n>`        | number | 否  | 单页数量（1-100）              |
| `--query <text>`     | string | 是  | 在 ID、名称和描述中进行不区分大小写的文本搜索 |
| `--page-limit <n>`   | number | 否  | 客户端搜索最多扫描的页数（默认：10）      |
| `--include-archived` | switch | 否  | 包含已归档资源                  |

**示例**：预览匹配查询条件的托管 Agent

```bash
bl managed-agent agent search --query assistant
```

### bl managed-agent agent versions

列出托管 Agent 版本。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent agent versions --agent-id <id> [--limit <n>] [--page <cursor>] [--all]
```

| 参数                | 类型     | 必填 | 说明                     |
| ----------------- | ------ | -- | ---------------------- |
| `--file <path>`   | string | 否  | 配置文件路径（默认：agents.yaml） |
| `--limit <n>`     | number | 否  | 单页数量（1-100）            |
| `--page <cursor>` | string | 否  | 上一次请求返回的不透明分页 Cursor   |
| `--all`           | switch | 否  | 跟随不透明 Cursor 获取全部分页    |
| `--agent-id <id>` | string | 是  | Agent ID               |

**示例**：预览指定 Agent 的版本列表

```bash
bl managed-agent agent versions --agent-id agent_abc
```

## Environment

### bl managed-agent environment list

列出托管 Agent 环境。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent environment list [--limit <n>] [--page <cursor>] [--all] [--include-archived]
```

| 参数                   | 类型     | 必填 | 说明                     |
| -------------------- | ------ | -- | ---------------------- |
| `--file <path>`      | string | 否  | 配置文件路径（默认：agents.yaml） |
| `--limit <n>`        | number | 否  | 单页数量（1-100）            |
| `--page <cursor>`    | string | 否  | 上一次请求返回的不透明分页 Cursor   |
| `--all`              | switch | 否  | 跟随不透明 Cursor 获取全部分页    |
| `--include-archived` | switch | 否  | 包含已归档资源                |

**示例**：预览全部托管 Agent 环境的 JSON 输出

```bash
bl managed-agent environment list --all --output json
```

### bl managed-agent environment get

获取托管 Agent 环境详情。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent environment get --environment-id <id>
```

| 参数                      | 类型     | 必填 | 说明                     |
| ----------------------- | ------ | -- | ---------------------- |
| `--file <path>`         | string | 否  | 配置文件路径（默认：agents.yaml） |
| `--environment-id <id>` | string | 是  | Environment ID         |

**示例**：预览指定环境的详情信息

```bash
bl managed-agent environment get --environment-id env_abc
```

### bl managed-agent environment search

搜索托管 Agent 环境。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent environment search --query <text> [--limit <n>] [--page-limit <n>] [--include-archived]
```

| 参数                   | 类型     | 必填 | 说明                       |
| -------------------- | ------ | -- | ------------------------ |
| `--file <path>`      | string | 否  | 配置文件路径（默认：agents.yaml）   |
| `--limit <n>`        | number | 否  | 单页数量（1-100）              |
| `--query <text>`     | string | 是  | 在 ID、名称和描述中进行不区分大小写的文本搜索 |
| `--page-limit <n>`   | number | 否  | 客户端搜索最多扫描的页数（默认：10）      |
| `--include-archived` | switch | 否  | 包含已归档资源                  |

**示例**：预览匹配查询条件的托管 Agent 环境

```bash
bl managed-agent environment search --query sandbox
```

### bl managed-agent environment create

通过定向 YAML Apply 声明并创建一个托管 Agent Environment。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent environment create --name <name> [--description <text>] [--metadata <key=value>...] [--apt <package>...] [--pip <package>...] [--npm <package>...] [--cargo <package>...] [--gem <package>...] [--go <package>...] [--file <path>] [--yes]
```

| 参数                       | 类型     | 必填 | 说明                                 |
| ------------------------ | ------ | -- | ---------------------------------- |
| `--name <name>`          | string | 是  | 远端 Environment 显示名称；YAML key 将自动生成 |
| `--description <text>`   | string | 否  | Environment 描述                     |
| `--metadata <key=value>` | array  | 否  | Metadata 条目（可重复）                   |
| `--apt <package>`        | array  | 否  | APT 软件包（可重复）                       |
| `--pip <package>`        | array  | 否  | pip 软件包（可重复）                       |
| `--npm <package>`        | array  | 否  | npm 软件包（可重复）                       |
| `--cargo <package>`      | array  | 否  | Cargo 软件包（可重复）                     |
| `--gem <package>`        | array  | 否  | Ruby gem 软件包（可重复）                  |
| `--go <package>`         | array  | 否  | Go 软件包（可重复）                        |
| `--file <path>`          | string | 否  | 配置文件路径（默认：agents.yaml）             |
| `--yes`                  | switch | 否  | 写入 YAML 并执行定向远端创建                  |

**示例**：确认执行创建名为 Development 的环境

```bash
bl managed-agent environment create --name Development
```

- 创建使用 unrestricted 网络的 cloud Environment。不带 --yes 时仅预览自动生成的 YAML key 和定向计划。

## Skill

### bl managed-agent skill list

列出托管 Agent Skill。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent skill list [--source custom|official|all] [--limit <n>] [--page <cursor>] [--all]
```

| 参数                  | 类型     | 必填 | 说明                                      |
| ------------------- | ------ | -- | --------------------------------------- |
| `--file <path>`     | string | 否  | 配置文件路径（默认：agents.yaml）                  |
| `--limit <n>`       | number | 否  | 单页数量（1-100）                             |
| `--page <cursor>`   | string | 否  | 上一次请求返回的不透明分页 Cursor                    |
| `--all`             | switch | 否  | 跟随不透明 Cursor 获取全部分页                     |
| `--source <source>` | string | 否  | Skill Catalog：custom（默认）、official 或 all |

**示例**：预览官方来源的托管 Agent Skill 列表

```bash
bl managed-agent skill list --source official
```

- \--source all 默认合并两个 Catalog 的各一页，传入 --all 时获取全部分页；该模式不接受 --page。

### bl managed-agent skill get

获取托管 Agent Skill 详情。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent skill get --skill-id <id>
```

| 参数                | 类型     | 必填 | 说明                     |
| ----------------- | ------ | -- | ---------------------- |
| `--file <path>`   | string | 否  | 配置文件路径（默认：agents.yaml） |
| `--skill-id <id>` | string | 是  | Skill ID               |

**示例**：预览指定 Skill 的详情信息

```bash
bl managed-agent skill get --skill-id skill_abc
```

### bl managed-agent skill search

搜索托管 Agent Skill。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent skill search --query <text> [--source custom|official|all] [--limit <n>] [--page-limit <n>]
```

| 参数                  | 类型     | 必填 | 说明                                      |
| ------------------- | ------ | -- | --------------------------------------- |
| `--file <path>`     | string | 否  | 配置文件路径（默认：agents.yaml）                  |
| `--limit <n>`       | number | 否  | 单页数量（1-100）                             |
| `--query <text>`    | string | 是  | 在 ID、名称和描述中进行不区分大小写的文本搜索                |
| `--page-limit <n>`  | number | 否  | 客户端搜索最多扫描的页数（默认：10）                     |
| `--source <source>` | string | 否  | Skill Catalog：custom（默认）、official 或 all |

**示例**：预览匹配查询条件的官方 Skill

```bash
bl managed-agent skill search --query browser --source official
```

### bl managed-agent skill create

从本地来源声明并创建一个自定义托管 Agent Skill。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent skill create --source <directory|zip|SKILL.md> [--file <path>] [--yes]
```

| 参数                                    | 类型     | 必填         | 说明                              |
| ------------------------------------- | ------ | ---------- | ------------------------------- |
| `--source <directory\                 | zip\   | SKILL.md>` | string                          | 是 | 本地 Skill 目录、ZIP 压缩包或单个 SKILL.md |
| `--file <path>`                       | string | 否          | 配置文件路径（默认：agents.yaml）          |
| `--yes`                               | switch | 否          | 写入 YAML 并通过定向创建上传 Skill         |

**示例**：确认执行从本地路径创建自定义 Skill

```bash
bl managed-agent skill create --source ./skills/code-review
```

- YAML key 从 SKILL.md frontmatter 的 name 生成。远程 URL 仍可手工写入 YAML 后执行全量 Apply。

### bl managed-agent skill versions

列出托管 Agent Skill 版本。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent skill versions --skill-id <id> [--limit <n>] [--page <cursor>] [--all]
```

| 参数                | 类型     | 必填 | 说明                     |
| ----------------- | ------ | -- | ---------------------- |
| `--file <path>`   | string | 否  | 配置文件路径（默认：agents.yaml） |
| `--skill-id <id>` | string | 是  | Skill ID               |
| `--limit <n>`     | number | 否  | 单页数量（1-100）            |
| `--page <cursor>` | string | 否  | 上一次请求返回的不透明分页 Cursor   |
| `--all`           | switch | 否  | 跟随不透明 Cursor 获取全部分页    |

**示例**：预览指定 Skill 的版本列表

```bash
bl managed-agent skill versions --skill-id skill_abc
```

### bl managed-agent skill download

下载托管 Agent Skill 版本。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent skill download --skill-id <id> --skill-version <version> --output-file <path> [--force]
```

| 参数                          | 类型     | 必填 | 说明                     |
| --------------------------- | ------ | -- | ---------------------- |
| `--file <path>`             | string | 否  | 配置文件路径（默认：agents.yaml） |
| `--skill-id <id>`           | string | 是  | Skill ID               |
| `--skill-version <version>` | string | 是  | Skill 版本               |
| `--output-file <path>`      | string | 是  | 目标 ZIP 路径              |
| `--force`                   | switch | 否  | 覆盖已存在的输出文件             |

**示例**：确认执行下载指定版本的 Skill 至本地文件

```bash
bl managed-agent skill download --skill-id skill_abc --skill-version 3 --output-file ./skill.zip
```

## Vault

### bl managed-agent vault list

列出托管 Agent Vault。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent vault list [--limit <n>] [--page <cursor>] [--all] [--include-archived]
```

| 参数                   | 类型     | 必填 | 说明                     |
| -------------------- | ------ | -- | ---------------------- |
| `--file <path>`      | string | 否  | 配置文件路径（默认：agents.yaml） |
| `--limit <n>`        | number | 否  | 单页数量（1-100）            |
| `--page <cursor>`    | string | 否  | 上一次请求返回的不透明分页 Cursor   |
| `--all`              | switch | 否  | 跟随不透明 Cursor 获取全部分页    |
| `--include-archived` | switch | 否  | 包含已归档资源                |

**示例**：预览全部托管 Agent Vault 列表

```bash
bl managed-agent vault list --all --output json
```

### bl managed-agent vault get

获取托管 Agent Vault 详情。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent vault get --vault-id <id>
```

| 参数                | 类型     | 必填 | 说明                     |
| ----------------- | ------ | -- | ---------------------- |
| `--file <path>`   | string | 否  | 配置文件路径（默认：agents.yaml） |
| `--vault-id <id>` | string | 是  | Vault ID               |

**示例**：获取指定 Vault 详情

```bash
bl managed-agent vault get --vault-id vault_abc
```

### bl managed-agent vault search

搜索托管 Agent Vault。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent vault search --query <text> [--limit <n>] [--page-limit <n>] [--include-archived]
```

| 参数                   | 类型     | 必填 | 说明                       |
| -------------------- | ------ | -- | ------------------------ |
| `--file <path>`      | string | 否  | 配置文件路径（默认：agents.yaml）   |
| `--limit <n>`        | number | 否  | 单页数量（1-100）              |
| `--query <text>`     | string | 是  | 在 ID、名称和描述中进行不区分大小写的文本搜索 |
| `--page-limit <n>`   | number | 否  | 客户端搜索最多扫描的页数（默认：10）      |
| `--include-archived` | switch | 否  | 包含已归档资源                  |

**示例**：搜索包含 github 的 Vault

```bash
bl managed-agent vault search --query github
```

### bl managed-agent vault create

通过定向 YAML Apply 声明并创建一个空的托管 Agent Vault。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent vault create --name <name> [--metadata <key=value>...] [--file <path>] [--yes]
```

| 参数                       | 类型     | 必填 | 说明                           |
| ------------------------ | ------ | -- | ---------------------------- |
| `--name <name>`          | string | 是  | 远端 Vault 显示名称；YAML key 将自动生成 |
| `--metadata <key=value>` | array  | 否  | Metadata 条目（可重复）             |
| `--file <path>`          | string | 否  | 配置文件路径（默认：agents.yaml）       |
| `--yes`                  | switch | 否  | 写入 YAML 并执行定向远端创建            |

**示例**：创建名为 Production 的 Vault

```bash
bl managed-agent vault create --name Production
```

- 创建空 Vault；随后使用 `vault credential create` 添加 Secret。

### bl managed-agent vault credential create

在已跟踪 Vault 中追加并创建一个环境变量 Credential。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent vault credential create --vault <yaml-key> --name <name> --secret-name <name> --secret-env <env-name> [--metadata <key=value>...] [--file <path>] [--yes]
```

| 参数                        | 类型     | 必填 | 说明                          |
| ------------------------- | ------ | -- | --------------------------- |
| `--vault <yaml-key>`      | string | 是  | agents.yaml 中已跟踪的 Vault key |
| `--name <name>`           | string | 是  | Credential 显示名称             |
| `--secret-name <name>`    | string | 是  | 提供给 Agent 的环境变量名            |
| `--secret-env <env-name>` | string | 是  | 保存真实 Secret 的本地环境变量名        |
| `--metadata <key=value>`  | array  | 否  | Metadata 条目（可重复）            |
| `--file <path>`           | string | 否  | 配置文件路径（默认：agents.yaml）      |
| `--yes`                   | switch | 否  | 写入 YAML 并创建远端 Credential    |

**示例**：在 production Vault 中创建 API 密钥凭证

```bash
bl managed-agent vault credential create --vault production --name api-token --secret-name API_TOKEN --secret-env PROD_API_TOKEN
```

- \--secret-env 接收环境变量名，不接收 Secret 本身。CLI 会从当前目录向上自动加载最近的 .env，也支持 Shell export 和 CI Secret 注入。
- YAML 只保存 `${ENV_NAME}`。不要提交 .env；后续执行全量 Apply 时仍需提供同名环境变量。

## Deployment

### bl managed-agent deployment list

列出托管 Agent Deployment。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent deployment list [--agent-id <id>] [--status active|paused] [--limit <n>] [--page <cursor>] [--all]
```

| 参数                             | 类型     | 必填 | 说明                     |
| ------------------------------ | ------ | -- | ---------------------- |
| `--file <path>`                | string | 否  | 配置文件路径（默认：agents.yaml） |
| `--limit <n>`                  | number | 否  | 单页数量（1-100）            |
| `--page <cursor>`              | string | 否  | 上一次请求返回的不透明分页 Cursor   |
| `--all`                        | switch | 否  | 跟随不透明 Cursor 获取全部分页    |
| `--agent-id <id>`              | string | 否  | 按 Agent ID 筛选          |
| `--status <status>`            | string | 否  | 按 Deployment 状态筛选      |
| `--include-archived`           | switch | 否  | 包含已归档资源                |
| `--created-at-gte <timestamp>` | string | 否  | 创建时间不早于该时间戳            |
| `--created-at-lte <timestamp>` | string | 否  | 创建时间不晚于该时间戳            |

**示例**：预览全部活跃 Deployment 列表并输出 JSON

```bash
bl managed-agent deployment list --status active --all --output json
```

### bl managed-agent deployment get

获取托管 Agent Deployment 详情。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent deployment get --deployment-id <id>
```

| 参数                     | 类型     | 必填 | 说明                     |
| ---------------------- | ------ | -- | ---------------------- |
| `--file <path>`        | string | 否  | 配置文件路径（默认：agents.yaml） |
| `--deployment-id <id>` | string | 是  | Deployment ID          |

**示例**：获取指定 Deployment 详情

```bash
bl managed-agent deployment get --deployment-id dep_abc
```

### bl managed-agent deployment search

搜索托管 Agent Deployment。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent deployment search --query <text> [--limit <n>] [--page <cursor>] [--all]
```

| 参数                             | 类型     | 必填 | 说明                       |
| ------------------------------ | ------ | -- | ------------------------ |
| `--file <path>`                | string | 否  | 配置文件路径（默认：agents.yaml）   |
| `--limit <n>`                  | number | 否  | 单页数量（1-100）              |
| `--page <cursor>`              | string | 否  | 上一次请求返回的不透明分页 Cursor     |
| `--all`                        | switch | 否  | 跟随不透明 Cursor 获取全部分页      |
| `--query <text>`               | string | 是  | 在 ID、名称和描述中进行不区分大小写的文本搜索 |
| `--agent-id <id>`              | string | 否  | 按 Agent ID 筛选            |
| `--status <status>`            | string | 否  | 按 Deployment 状态筛选        |
| `--include-archived`           | switch | 否  | 包含已归档资源                  |
| `--created-at-gte <timestamp>` | string | 否  | 创建时间不早于该时间戳              |
| `--created-at-lte <timestamp>` | string | 否  | 创建时间不晚于该时间戳              |

**示例**：搜索包含 report 的 Deployment

```bash
bl managed-agent deployment search --query report
```

- Deployment 搜索会把 --query 映射为 Provider 服务端 keyword 参数。

### bl managed-agent deployment create

通过定向 YAML Apply 声明并创建一个托管 Agent Deployment。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent deployment create --name <name> --agent <yaml-key> (--message <text>... | --event <json|@path>...) [--agent-version <number>] [--environment <yaml-key>] [--vault <yaml-key>...] [--resource <json|@path>...] [--schedule <cron> --timezone <timezone>] [--description <text>] [--metadata <key=value>...] [--file <path>] [--yes]
```

| 参数                         | 类型      | 必填    | 说明                                             |
| -------------------------- | ------- | ----- | ---------------------------------------------- |
| `--name <name>`            | string  | 是     | 远端 Deployment 显示名称；YAML key 将自动生成              |
| `--agent <yaml-key>`       | string  | 是     | agents.yaml 中已有的 Agent key                     |
| `--agent-version <number>` | number  | 否     | Agent 版本                                       |
| `--environment <yaml-key>` | string  | 否     | agents.yaml 中已有的 Environment key               |
| `--vault <yaml-key>`       | array   | 否     | agents.yaml 中已有的 Vault key（可重复）                |
| `--message <text>`         | array   | 否     | 初始用户消息（可重复）                                    |
| `--event <json\            | @path>` | array | 否                                              | 初始 user.message 或 system.message JSON（可重复）     |
| `--resource <json\         | @path>` | array | 否                                              | 包含 source 或 file\_id 的 File Resource JSON（可重复） |
| `--schedule <cron>`        | string  | 否     | 五段式 Cron 表达式                                   |
| `--timezone <timezone>`    | string  | 否     | Schedule 的 IANA 时区                             |
| `--description <text>`     | string  | 否     | Deployment 描述                                  |
| `--metadata <key=value>`   | array   | 否     | Metadata 条目（可重复）                               |
| `--file <path>`            | string  | 否     | 配置文件路径（默认：agents.yaml）                         |
| `--yes`                    | switch  | 否     | 写入 YAML 并执行定向远端创建                              |

**示例**：创建名为 Daily 的 Deployment 并指定 Agent 和消息

```bash
bl managed-agent deployment create --name Daily --agent assistant --message "生成报告"
```

- Initial Events 必须包含 1–50 条 user.message/system.message；本期 --resource 仅接受 File Resource。
- 重复使用 --message 或重复使用 --event；两种输入形式不能混用。

### bl managed-agent deployment run

立即运行托管 Agent Deployment。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent deployment run (--deployment <name> | --deployment-id <id>)
```

| 参数                     | 类型     | 必填 | 说明                                   |
| ---------------------- | ------ | -- | ------------------------------------ |
| `--file <path>`        | string | 否  | 配置文件路径（默认：agents.yaml）               |
| `--deployment <name>`  | string | 否  | agents.yaml/State 中的逻辑 Deployment 名称 |
| `--deployment-id <id>` | string | 否  | 直接指定 Deployment ID                   |
| `--yes`                | switch | 否  | 确认执行此高风险操作                           |

<Warning>
  该操作会立即运行指定的托管 Agent Deployment，可能产生用量或触发已配置的动作。
</Warning>

**示例**：预览运行 daily-report Deployment

```bash
bl managed-agent deployment run --deployment daily-report --dry-run
```

### bl managed-agent deployment pause

暂停托管 Agent Deployment。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent deployment pause (--deployment <name> | --deployment-id <id>)
```

| 参数                     | 类型     | 必填 | 说明                                   |
| ---------------------- | ------ | -- | ------------------------------------ |
| `--file <path>`        | string | 否  | 配置文件路径（默认：agents.yaml）               |
| `--deployment <name>`  | string | 否  | agents.yaml/State 中的逻辑 Deployment 名称 |
| `--deployment-id <id>` | string | 否  | 直接指定 Deployment ID                   |
| `--yes`                | switch | 否  | 确认执行此高风险操作                           |

<Warning>
  该操作会暂停指定的托管 Agent Deployment，并停止其定时执行直至恢复。
</Warning>

**示例**：预览暂停 daily-report Deployment

```bash
bl managed-agent deployment pause --deployment daily-report --dry-run
```

### bl managed-agent deployment unpause

恢复托管 Agent Deployment。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent deployment unpause (--deployment <name> | --deployment-id <id>)
```

| 参数                     | 类型     | 必填 | 说明                                   |
| ---------------------- | ------ | -- | ------------------------------------ |
| `--file <path>`        | string | 否  | 配置文件路径（默认：agents.yaml）               |
| `--deployment <name>`  | string | 否  | agents.yaml/State 中的逻辑 Deployment 名称 |
| `--deployment-id <id>` | string | 否  | 直接指定 Deployment ID                   |
| `--yes`                | switch | 否  | 确认执行此高风险操作                           |

<Warning>
  该操作会恢复指定的托管 Agent Deployment，可能重新开始定时执行并产生相关用量。
</Warning>

**示例**：预览恢复 daily-report Deployment

```bash
bl managed-agent deployment unpause --deployment daily-report --dry-run
```

### bl managed-agent deployment runs list

列出托管 Agent Deployment Run。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent deployment runs list --deployment-id <id> [--limit <n>] [--page <cursor>] [--all]
```

| 参数                     | 类型     | 必填 | 说明                     |
| ---------------------- | ------ | -- | ---------------------- |
| `--file <path>`        | string | 否  | 配置文件路径（默认：agents.yaml） |
| `--deployment-id <id>` | string | 是  | Deployment ID          |
| `--limit <n>`          | number | 否  | 单页数量（1-100）            |
| `--page <cursor>`      | string | 否  | 上一次请求返回的不透明分页 Cursor   |
| `--all`                | switch | 否  | 跟随不透明 Cursor 获取全部分页    |

**示例**：列出指定 Deployment ID 的运行记录

```bash
bl managed-agent deployment runs list --deployment-id dep_abc
```

### bl managed-agent deployment runs get

获取托管 Agent Deployment Run 详情。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent deployment runs get --run-id <id>
```

| 参数              | 类型     | 必填 | 说明                     |
| --------------- | ------ | -- | ---------------------- |
| `--file <path>` | string | 否  | 配置文件路径（默认：agents.yaml） |
| `--run-id <id>` | string | 是  | Deployment Run ID      |

**示例**：获取指定 Run ID 的详细信息

```bash
bl managed-agent deployment runs get --run-id run_abc
```

## Session

### bl managed-agent session create

为 Agent 创建新 Session。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent session create [--agent <name>] [--environment <name>] [--title <title>] [--file <path>]
```

| 参数                        | 类型     | 必填 | 说明                             |
| ------------------------- | ------ | -- | ------------------------------ |
| `--file <path>`           | string | 否  | 配置文件路径（默认：agents.yaml）         |
| `--agent <name>`          | string | 否  | Agent 名称（仅配置一个 Agent 时自动识别）    |
| `--environment <name>`    | string | 否  | 覆盖 Agent 声明的环境                 |
| `--vault <name>`          | string | 否  | 覆盖 Agent 声明的 Vault             |
| `--memory-stores <names>` | string | 否  | 覆盖 Agent 的 Memory Store（以逗号分隔） |
| `--title <title>`         | string | 否  | Session 标题                     |

**示例**：创建指定 Agent 的新会话

```bash
bl managed-agent session create --agent assistant
```

### bl managed-agent session run

创建 Session、发送消息并流式输出响应。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent session run --prompt <text> [--agent <name>] [--no-stream] [--file <path>]
```

| 参数                        | 类型     | 必填 | 说明                             |
| ------------------------- | ------ | -- | ------------------------------ |
| `--prompt <text>`         | string | 是  | 要发送的 Prompt                    |
| `--file <path>`           | string | 否  | 配置文件路径（默认：agents.yaml）         |
| `--agent <name>`          | string | 否  | Agent 名称（仅配置一个 Agent 时自动识别）    |
| `--environment <name>`    | string | 否  | 覆盖 Agent 声明的环境                 |
| `--vault <name>`          | string | 否  | 覆盖 Agent 声明的 Vault             |
| `--memory-stores <names>` | string | 否  | 覆盖 Agent 的 Memory Store（以逗号分隔） |
| `--title <title>`         | string | 否  | Session 标题                     |
| `--no-stream`             | switch | 否  | 使用轮询代替 SSE 流式传输                |

**示例**：创建会话并发送提示词流式输出响应

```bash
bl managed-agent session run --prompt "你好"
```

- \--output json 输出一个 Envelope：`{ session_id, provider, agent, events }`。读取 session\_id 后可串联调用 `session send/get/events/delete`。

### bl managed-agent session send

向已有 Session 发送消息并流式输出响应。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent session send --session-id <id> --message <text> [--no-stream] [--file <path>]
```

| 参数                  | 类型     | 必填 | 说明                     |
| ------------------- | ------ | -- | ---------------------- |
| `--session-id <id>` | string | 是  | Session ID             |
| `--message <text>`  | string | 是  | 要发送的消息                 |
| `--file <path>`     | string | 否  | 配置文件路径（默认：agents.yaml） |
| `--no-stream`       | switch | 否  | 使用轮询代替 SSE 流式传输        |

**示例**：向指定会话发送消息并流式输出响应

```bash
bl managed-agent session send --session-id sess_abc123 --message "继续"
```

### bl managed-agent session list

列出 Provider 中的 Session。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent session list [--agent <name>] [--statuses <statuses>] [--limit <n>] [--page <cursor>] [--all]
```

| 参数                             | 类型     | 必填 | 说明                     |
| ------------------------------ | ------ | -- | ---------------------- |
| `--file <path>`                | string | 否  | 配置文件路径（默认：agents.yaml） |
| `--agent <name>`               | string | 否  | 按 Agent 名称筛选           |
| `--all`                        | switch | 否  | 跟随 Cursor 获取全部分页       |
| `--limit <n>`                  | number | 否  | 单页数量（1-100）            |
| `--page <cursor>`              | string | 否  | 上一次请求返回的不透明分页 Cursor   |
| `--statuses <statuses>`        | string | 否  | Session 状态，多个以逗号分隔     |
| `--created-at-gte <timestamp>` | string | 否  | 创建时间不早于该 RFC 3339 时间戳  |
| `--created-at-lte <timestamp>` | string | 否  | 创建时间不晚于该 RFC 3339 时间戳  |

**示例**：列出指定 Agent 名称的会话

```bash
bl managed-agent session list --agent assistant
```

### bl managed-agent session get

获取 Session 详情。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent session get --session-id <id> [--file <path>]
```

| 参数                  | 类型     | 必填 | 说明                     |
| ------------------- | ------ | -- | ---------------------- |
| `--session-id <id>` | string | 是  | Session ID             |
| `--file <path>`     | string | 否  | 配置文件路径（默认：agents.yaml） |

**示例**：获取指定 Session ID 的详情

```bash
bl managed-agent session get --session-id sess_abc123
```

### bl managed-agent session search

搜索托管 Agent Session。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent session search --query <text> [--agent <name>] [--statuses <statuses>] [--limit <n>] [--page-limit <n>]
```

| 参数                             | 类型     | 必填 | 说明                       |
| ------------------------------ | ------ | -- | ------------------------ |
| `--file <path>`                | string | 否  | 配置文件路径（默认：agents.yaml）   |
| `--limit <n>`                  | number | 否  | 单页数量（1-100）              |
| `--query <text>`               | string | 是  | 在 ID、名称和描述中进行不区分大小写的文本搜索 |
| `--page-limit <n>`             | number | 否  | 客户端搜索最多扫描的页数（默认：10）      |
| `--agent <name>`               | string | 否  | 按配置中的 Agent 名称筛选         |
| `--statuses <statuses>`        | string | 否  | Session 状态，多个以逗号分隔       |
| `--created-at-gte <timestamp>` | string | 否  | 创建时间不早于该时间戳              |
| `--created-at-lte <timestamp>` | string | 否  | 创建时间不晚于该时间戳              |

**示例**：搜索包含指定关键词的会话

```bash
bl managed-agent session search --query debug
```

### bl managed-agent session update

更新托管 Agent Session。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent session update --session-id <id> [--title <title>] [--metadata <json|@path>]
```

| 参数                         | 类型      | 必填     | 说明                           |
| -------------------------- | ------- | ------ | ---------------------------- |
| `--file <path>`            | string  | 否      | 配置文件路径（默认：agents.yaml）       |
| `--session-id <id>`        | string  | 是      | Session ID                   |
| `--title <title>`          | string  | 否      | 新的 Session 标题                |
| `--metadata <json\         | @path>` | string | 否                            | 值为字符串的 Metadata JSON 或 @file |

**示例**：更新指定 Session 的标题

```bash
bl managed-agent session update --session-id sess_abc --title 'investigation'
```

### bl managed-agent session archive

归档托管 Agent Session。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent session archive --session-id <id>
```

| 参数                  | 类型     | 必填 | 说明                     |
| ------------------- | ------ | -- | ---------------------- |
| `--file <path>`     | string | 否  | 配置文件路径（默认：agents.yaml） |
| `--session-id <id>` | string | 是  | Session ID             |
| `--yes`             | switch | 否  | 确认执行此高风险操作             |

<Warning>
  该操作会归档指定的远端托管 Agent Session。
</Warning>

**示例**：预览归档指定 Session

```bash
bl managed-agent session archive --session-id sess_abc --dry-run
```

### bl managed-agent session delete

删除 Session。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent session delete --session-id <id> [--file <path>]
```

| 参数                  | 类型     | 必填 | 说明                     |
| ------------------- | ------ | -- | ---------------------- |
| `--session-id <id>` | string | 是  | Session ID             |
| `--file <path>`     | string | 否  | 配置文件路径（默认：agents.yaml） |
| `--yes`             | switch | 否  | 确认执行此高风险操作             |

<Warning>
  该操作会删除指定的远端托管 Agent Session。
</Warning>

**示例**：确认执行删除指定 Session

```bash
bl managed-agent session delete --session-id sess_abc123 --yes
```

### bl managed-agent session event list

列出托管 Agent Session 事件。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent session event list --session-id <id> [--types <types>] [--order asc|desc] [--limit <n>] [--page <cursor>] [--all]
```

| 参数                             | 类型     | 必填 | 说明                     |
| ------------------------------ | ------ | -- | ---------------------- |
| `--file <path>`                | string | 否  | 配置文件路径（默认：agents.yaml） |
| `--session-id <id>`            | string | 是  | Session ID             |
| `--limit <n>`                  | number | 否  | 单页数量（1-100）            |
| `--page <cursor>`              | string | 否  | 上一次请求返回的不透明分页 Cursor   |
| `--all`                        | switch | 否  | 跟随不透明 Cursor 获取全部分页    |
| `--order <order>`              | string | 否  | 事件顺序：asc 或 desc        |
| `--types <types>`              | string | 否  | 原始事件类型，多个以逗号分隔         |
| `--created-at-gte <timestamp>` | string | 否  | 创建时间不早于该时间戳            |
| `--created-at-lte <timestamp>` | string | 否  | 创建时间不晚于该时间戳            |

**示例**：列出指定 Session 的事件

```bash
bl managed-agent session event list --session-id sess_abc
```

- \--types 会在客户端对 Provider 返回的每一页结果进行过滤。

### bl managed-agent session event send

向托管 Agent Session 发送原始事件。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent session event send --session-id <id> --event <json|@path>
```

| 参数                      | 类型      | 必填     | 说明                           |
| ----------------------- | ------- | ------ | ---------------------------- |
| `--file <path>`         | string  | 否      | 配置文件路径（默认：agents.yaml）       |
| `--session-id <id>`     | string  | 是      | Session ID                   |
| `--event <json\         | @path>` | string | 是                            | 原始事件对象/数组 JSON，或 @event.json |

**示例**：向会话发送原始事件

```bash
bl managed-agent session event send --session-id sess_abc --event '{"type":"message","role":"user","content":[{"type":"text","text":"hello"}]}'
```

### bl managed-agent session event stream

流式读取托管 Agent Session 事件。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent session event stream --session-id <id> [--after-id <event-id>]
```

| 参数                      | 类型     | 必填 | 说明                     |
| ----------------------- | ------ | -- | ---------------------- |
| `--file <path>`         | string | 否  | 配置文件路径（默认：agents.yaml） |
| `--session-id <id>`     | string | 是  | Session ID             |
| `--after-id <event-id>` | string | 否  | 从该 Event ID 之后继续       |

**示例**：流式读取会话事件

```bash
bl managed-agent session event stream --session-id sess_abc
```

- 当 Provider 不支持原生事件 Cursor 时，--after-id 会通过分页历史轮询和 Event ID 去重实现续传。

### bl managed-agent session debug

聚合 Session 诊断信息。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent session debug --session-id <id>
```

| 参数                  | 类型     | 必填 | 说明                     |
| ------------------- | ------ | -- | ---------------------- |
| `--file <path>`     | string | 否  | 配置文件路径（默认：agents.yaml） |
| `--session-id <id>` | string | 是  | Session ID             |

**示例**：聚合会话诊断信息

```bash
bl managed-agent session debug --session-id sess_abc
```

### bl managed-agent session export

将 Session 诊断信息导出为 ZIP。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent session export --session-id <id> --output-file <path> [--force]
```

| 参数                     | 类型     | 必填 | 说明                     |
| ---------------------- | ------ | -- | ---------------------- |
| `--file <path>`        | string | 否  | 配置文件路径（默认：agents.yaml） |
| `--session-id <id>`    | string | 是  | Session ID             |
| `--output-file <path>` | string | 是  | 目标 ZIP 路径              |
| `--force`              | switch | 否  | 覆盖已存在的输出文件             |

**示例**：导出会话诊断信息为 ZIP

```bash
bl managed-agent session export --session-id sess_abc --output-file ./session-debug.zip
```

- ZIP 仅包含元数据；不会包含文件正文，凭证类字段会被移除或脱敏。

## File

### bl managed-agent file list

列出托管 Agent 文件。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent file list [--scope-id <id>] [--limit <n>] [--page <cursor>] [--all]
```

| 参数                | 类型     | 必填 | 说明                     |
| ----------------- | ------ | -- | ---------------------- |
| `--file <path>`   | string | 否  | 配置文件路径（默认：agents.yaml） |
| `--limit <n>`     | number | 否  | 单页数量（1-100）            |
| `--page <cursor>` | string | 否  | 上一次请求返回的不透明分页 Cursor   |
| `--all`           | switch | 否  | 跟随不透明 Cursor 获取全部分页    |
| `--scope-id <id>` | string | 否  | 按 Scope ID 筛选          |

**示例**：列出托管文件并输出 JSON

```bash
bl managed-agent file list --scope-id sess_abc --all --output json
```

### bl managed-agent file get

获取托管 Agent 文件元数据。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent file get --file-id <id>
```

| 参数               | 类型     | 必填 | 说明                     |
| ---------------- | ------ | -- | ---------------------- |
| `--file <path>`  | string | 否  | 配置文件路径（默认：agents.yaml） |
| `--file-id <id>` | string | 是  | 远端 File ID             |

**示例**：获取文件元数据

```bash
bl managed-agent file get --file-id file_abc
```

### bl managed-agent file search

搜索托管 Agent 文件。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent file search --query <text> [--scope-id <id>] [--limit <n>] [--page-limit <n>]
```

| 参数                 | 类型     | 必填 | 说明                       |
| ------------------ | ------ | -- | ------------------------ |
| `--file <path>`    | string | 否  | 配置文件路径（默认：agents.yaml）   |
| `--limit <n>`      | number | 否  | 单页数量（1-100）              |
| `--query <text>`   | string | 是  | 在 ID、名称和描述中进行不区分大小写的文本搜索 |
| `--page-limit <n>` | number | 否  | 客户端搜索最多扫描的页数（默认：10）      |
| `--scope-id <id>`  | string | 否  | 按 Scope ID 筛选            |

**示例**：搜索托管文件

```bash
bl managed-agent file search --query report
```

### bl managed-agent file upload

上传托管 Agent 文件。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent file upload --path <path> [--filename <name>] [--mime-type <type>]
```

| 参数                   | 类型     | 必填 | 说明                     |
| -------------------- | ------ | -- | ---------------------- |
| `--file <path>`      | string | 否  | 配置文件路径（默认：agents.yaml） |
| `--path <path>`      | string | 是  | 本地文件路径                 |
| `--filename <name>`  | string | 否  | 覆盖远端文件名                |
| `--mime-type <type>` | string | 否  | 覆盖 MIME 类型             |

**示例**：上传文件

```bash
bl managed-agent file upload --path ./report.pdf
```

### bl managed-agent file download

下载托管 Agent 文件内容。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent file download --file-id <id> --output-file <path> [--force]
```

| 参数                     | 类型     | 必填 | 说明                     |
| ---------------------- | ------ | -- | ---------------------- |
| `--file <path>`        | string | 否  | 配置文件路径（默认：agents.yaml） |
| `--file-id <id>`       | string | 是  | 远端 File ID             |
| `--output-file <path>` | string | 是  | 目标路径                   |
| `--force`              | switch | 否  | 覆盖已存在的输出文件             |

**示例**：下载文件内容

```bash
bl managed-agent file download --file-id file_abc --output-file ./artifact.pdf
```

### bl managed-agent file delete

删除托管 Agent 文件。需要 API Key 鉴权。

**语法**

```bash
bl managed-agent file delete --file-id <id>
```

| 参数               | 类型     | 必填 | 说明                     |
| ---------------- | ------ | -- | ---------------------- |
| `--file <path>`  | string | 否  | 配置文件路径（默认：agents.yaml） |
| `--file-id <id>` | string | 是  | 远端 File ID             |
| `--yes`          | switch | 否  | 确认执行此高风险操作             |

<Warning>
  该操作会永久删除指定的远端托管 Agent 文件。
</Warning>

**示例**：预览删除文件

```bash
bl managed-agent file delete --file-id file_abc --dry-run
```
