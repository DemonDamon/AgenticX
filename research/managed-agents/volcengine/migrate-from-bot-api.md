---
source: https://ark.volcengine.com/region:cn-beijing/docs/migrate-from-bot-api
fetched: 2026-10-24
title: 将零代码应用迁移至 Managed Agents
---

# 将零代码应用迁移至 Managed Agents

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

本文介绍如何将应用实验室中通过 Bot API 调用的零代码应用迁移至 **方舟 Managed Agents**。内容覆盖迁移判断、配置映射、资源创建和结果验证，帮助你基于原零代码应用配置重建 Agent 和调用链路。

本文仅适用于已发布、通过 Bot API 调用的零代码应用。其中，单聊应用可以按本文步骤迁移；群聊应用需要先重新设计角色和编排方式，不能直接复用单聊迁移方案。

迁移的核心不是替换一个接口地址，而是把原应用中可复用的配置映射到 Agent，再创建新的 Environment 和 Session 运行资源。

<span id="scenario"></span>
## 场景说明

在存量业务中，你可能已经在应用实验室中创建并发布零代码应用，再通过 Bot API 调用它，完成客服问答、运营助手或内部知识查询等任务。

已发布的存量零代码应用仍可继续通过 Bot API 调用。应用实验室后续会下线新建零代码应用入口，具体时间以后续公告为准；入口下线后，将无法再创建新的零代码应用。存量业务可以根据能力需求安排迁移，无需因新建入口下线立即切换调用链路。

> **注意：迁移限制**
>
> 应用实验室中的存量零代码应用无法自动转换为 Managed Agents。你需要根据原应用的配置重新创建 Agent，并完成调试验证。

随着业务复杂度提升，单次对话接口也会逐渐遇到边界：应用能力类型有限、上下文需要自己维护，复杂任务也缺少沙箱执行环境。

Managed Agents 将 Agent 运行所需的通用能力拆成平台资源。你定义 Agent 行为，选择 Environment 提供执行环境，再通过 Session 发送事件并订阅结果流。这样可以把“调用一个应用”升级为“托管一个可执行、可观测、可扩展的 Agent”。

本文会帮助你完成以下动作：

- 判断一个存量零代码应用适合迁移到 Managed Agents，还是应改用模型 API。
- 将零代码应用中可复用的配置映射为 Agent 配置。
- 创建 Agent 运行所需的 Environment 和 Session。
- 选择控制台或 API 路径重建 Agent。
- 记录 `agent_id`、`environment_id` 和 `session_id`，供业务服务后续调用。
- 用原零代码应用的真实问题集验证迁移后的回答结果和工具调用。

| 环节 | 内容 |
|-|-|
| 输入 | 原零代码应用的名称、描述、模型、系统提示词、能力配置，以及 5 到 10 个真实问题。 |
| 过程 | 将可复用的应用配置映射为 Agent 配置，新建 Environment 和 Session，再发送测试问题并观察事件流。 |
| 输出 | 一个可调试的 Agent，以及业务侧后续调用所需的 `agent_id`、`environment_id` 和 `session_id`。 |
| 观测 | 通过控制台事件时间轴或 Session 事件流查看消息、工具调用、工具结果和 Session 状态。 |

<span id="migration-decision"></span>
## 判断是否需要迁移

先根据应用类型、调用方式和目标能力判断迁移优先级，再准备迁移材料。

| 场景 | 建议 | 原因 |
|-|-|-|
| 只维护已发布零代码应用 | 继续通过 Bot API 调用 | 新建零代码应用入口下线后，已发布的存量应用仍可继续使用。 |
| 简单问答，以及客服、车载助手等多轮对话场景 | 迁移到 Managed Agents | Agent 支持读取和写入 Memory，可以在多轮及跨 Session 对话中持续使用用户偏好和历史信息，更准确地理解用户。 |
| 需要自行控制调用链 | 改用模型 API（Responses API 或 Chat API） | 业务可以自行管理提示词、上下文、工具调用和运行状态。 |
| 需要沙箱执行 | 迁移到 Managed Agents | Environment 可以提供云沙箱或自托管环境，用于执行命令、读写文件和处理数据。 |
| 需要长期记忆 | 迁移到 Managed Agents | 记忆存储（Memory Store）可以保存跨 Session 可复用的偏好、知识和业务上下文。 |
| 需要外部工具或 MCP | 迁移到 Managed Agents | Agent 可以通过内置工具集、MCP、自定义工具或技能扩展能力。 |
| 需要按职责委派复杂任务 | 迁移到 Managed Agents | 多智能体协作（Multi Agent）可以把不同职责拆给多个 Agent，由协调器 Agent 分配任务并汇总结果。 |

判断迁移优先级时，同时对照原零代码应用能力和 Managed Agents 能力。两者并非一一对应，迁移前需要明确哪些配置可以复用，哪些能力需要重新设计。

| 应用能力 | Managed Agents 对应能力 | 迁移建议 |
|-|-|-|
| 应用 ID（Bot ID） | 无直接对应关系 | Bot API 将应用 ID 作为请求体中的 `model`。迁移后不能直接替换该字段：先使用 `agent_id` 和 `environment_id` 创建 Session，再使用 `session_id` 发送和订阅事件。 |
| 应用名称和描述 | Agent 的 `name` 和 `description` | 直接复用，名称需要在当前项目内唯一。 |
| 系统提示词 | Agent 的 `system` | 直接迁移，同时补充 Agent 可使用的工具、数据来源和输出要求。 |
| 推理接入点 | Agent 的 `model.id` 和 `model.speed` | 原推理接入点不能直接复用。选择 Managed Agents 支持的 Model ID，并重新验证模型效果和参数。 |
| 联网内容插件（仅单聊） | 内置 `web_search` 和 `web_fetch` 工具 | 可以迁移联网搜索与网页抓取能力，但内容源、问题改写、引用条数和来源展示等配置不会自动迁移，需要重新配置和验证。 |
| 知识库插件（仅单聊） | 记忆存储、MCP 或自定义工具 | 不支持直接迁移。少量静态参考内容可以整理到记忆存储；需要检索、重排或来源引用时，通过 MCP 或自定义工具接入原知识服务。 |
| 计算器、网页解析插件（仅单聊） | 内置工具、MCP 或自定义工具 | 计算任务可以评估 `bash` 或自定义工具；普通网页抓取可以评估 `web_fetch`。PDF、视频及其他特定解析能力需要单独验证，必要时使用 MCP 或自定义工具。 |
| 群聊场景和角色配置 | 无对应能力 | 应用实验室群聊与 Managed Agents 的多智能体协作能力不对应。Bot API 通过 `metadata.group_chat_config` 等字段传递的群聊配置不能直接迁移；只有业务目标属于任务分工时，才重新设计为多智能体协作。 |
| **Trace 服务** | 控制台事件时间轴与 Session 事件流 | Managed Agents 无需开启应用实验室的 **Trace 服务**。控制台用于可视化调试，Session 事件流用于业务侧订阅消息、工具调用和状态变化。 |

> **注意：群聊迁移限制**
>
> 应用实验室群聊中的角色用于多角色对话，Managed Agents 的多智能体协作能力用于任务委派，两者不对应，不能直接映射。需要保留多角色对话时，重新设计角色选择和消息编排；只有业务目标可以拆分为多个职责明确的任务时，才使用多智能体协作能力。

<span id="prepare-migration"></span>
## 准备迁移材料

确认适合迁移到 Managed Agents 后，再准备以下信息和资源。不要在没有完成能力映射前直接创建 Agent，否则后续容易反复修改模型、工具和知识来源。

- 准备一个已发布、可通过 Bot API 调用的零代码应用，或导出该应用的名称、描述、推理接入点和系统提示词。
- 导出应用的能力配置。
- 准备 5 到 10 个真实问题，用于迁移后的回归测试。
- 开通方舟，并准备可调用 Managed Agents 的 API Key。
- 确认目标 Model ID。本文示例使用 `doubao-seed-2-1-pro-260915`，实际迁移时替换为你的 Model ID。
- 选择知识来源。原应用使用知识库插件时，确认知识内容适合整理为记忆存储中的静态参考资料，还是需要通过 MCP 或自定义工具接入原知识服务。

迁移时会用到以下核心对象：

| 概念 | 说明 |
|-|-|
| **零代码应用** | 本文特指在应用实验室中创建并发布、通过 Bot API 调用的应用。Bot API 请求体中的 `model` 字段填写该应用的 ID（Bot ID）。 |
| **Agent** | Managed Agents 中的行为定义，包含模型、系统提示词、工具、技能、MCP 和多智能体协作配置。 |
| **Environment** | Agent 执行任务时使用的运行环境，可以是云沙箱，也可以是自托管环境。 |
| **Session** | Agent 在指定 Environment 中运行的一次会话，负责保存事件历史、沙箱状态和运行状态。 |
| **Event** | Session 中的输入、输出和状态变化，例如 `user.message`、工具调用事件和 `session.status_idle`。 |
| **记忆存储** | Managed Agents 的文件式长期记忆资源，用来保存跨 Session 可复用的偏好、规范和静态参考内容，不等同于带检索与重排能力的知识库。 |

> **注意：保护 API Key**
>
> 不要把 API Key 写进代码仓库、日志或前端页面。这些位置会扩大明文密钥的可见范围，导致凭据泄露和未授权调用。迁移过程中如果需要多人协作，只共享应用配置和测试问题，不共享明文 API Key。

<span id="migration-flow"></span>
## 迁移操作流程

迁移操作分为控制台和 API 两条路径。先人工验证配置时，选择控制台路径。已经在业务代码中调用 Bot API 时，选择 API 路径。

整体执行顺序如下：

1. 梳理原零代码应用的配置和真实问题集。
2. 判断要继续维护应用、改用模型 API，还是迁移到 Managed Agents。
3. 按能力映射表重建 Agent 配置。
4. 根据运行需求创建或选择一个 Environment。
5. 创建 Session，并把一次输入消息发送为 `user.message` 事件。
6. 订阅事件流，检查 Agent 回复、工具调用和最终状态。
7. 对比原零代码应用和新 Agent 的输出，调整提示词、工具和知识来源。
8. 小流量切换业务调用，确认稳定后再扩大迁移范围。

### 路径一：通过控制台迁移

如果你希望先用可视化方式验证迁移效果，使用 Managed Agents 控制台更合适。

1. 打开 [**Agents** 页面](https://ark.volcengine.com/region:cn-beijing/managed-agents/agents?projectName=default)，创建 Agent。
2. 将原应用的名称、描述和系统提示词填写到 Agent 的对应配置中。
3. 选择 Managed Agents 支持的模型，并按能力映射表重新配置工具、技能、MCP 和知识来源。
4. 创建 Environment，配置 Agent 运行所需的网络、依赖包、环境变量和产物存储。
5. 创建绑定 Agent 与 Environment 的 Session，使用原应用的典型问题完成回归测试。
6. 记录 `agent_id` 和 `environment_id`。业务服务使用这两个 ID 创建 Session，再通过 Session 事件接口发送消息和订阅事件。

> **说明**
>
> 迁移时，先选择 5 到 10 个真实问题做回归集。每次调整系统提示词或工具配置后，用同一批问题测试，能更快判断迁移后的 Agent 是否覆盖原能力。

> **注意：知识库迁移边界**
>
> 不要把应用中依赖检索、重排或来源引用的完整知识库直接写入记忆存储。记忆存储适合保存整理后的静态参考内容；需要保留原知识库检索能力时，通过 MCP 或自定义工具接入知识服务。完成知识问答回归验证前，保留原应用作为兜底。

### 路径二：通过 API 迁移

如果你已经在业务代码中调用 Bot API，建议用 API 方式完成迁移。新的调用链路不是把 Bot ID 替换为 Agent ID，而是从一次 `POST /bots/chat/completions` 调用，改为先创建 Agent 和 Environment，再创建 Session、发送事件并订阅事件流。

| 步骤 | 说明 |
|-|-|
| 1. 创建 Agent | 定义模型、系统提示词以及迁移后需要的工具、技能和 MCP，获得 `agent_id`。 |
| 2. 创建 Environment | 定义云沙箱网络、依赖包和环境变量，获得 `environment_id`。 |
| 3. 创建 Session | 绑定 `agent_id` 与 `environment_id`，获得 `session_id`。 |
| 4. 发送输入事件 | 将原 Bot API 中的输入消息转换为 `user.message` 事件。 |
| 5. 订阅事件流 | 使用 SSE 接收 Agent 回复、工具调用和状态事件。 |

API 迁移时，三个 ID 的传递关系如下：

```text
agent_id + environment_id -> 创建 session -> session_id
session_id + user.message -> 触发 Agent 执行 -> Session 事件流
```

创建 Agent 后，记录返回的 `agent_id`。创建 Environment 后，记录返回的 `environment_id`。创建 Session 后，记录返回的 `session_id`。业务服务后续发送消息和订阅事件，都围绕 `session_id` 执行。

你可以直接复用 [快速入门（代码）](quick-start-code.md) 中的端到端示例：

- 创建 Agent：参考 [创建 Agent](quick-start-code.md#create_agent)。
- 创建环境：参考 [创建环境](quick-start-code.md#create_environment)。
- 创建 Session：参考 [创建 Session](quick-start-code.md#create_session)。
- 发送消息并接收流式响应：参考 [发送消息并接收流式响应](quick-start-code.md#send_message_stream)。

> **注意：上下文迁移限制**
>
> Bot API 的 `messages` 数组不能原样作为 Managed Agents 的长期上下文迁移。Managed Agents 的上下文由 Session 事件维护。迁移时应把固定角色设定写入 Agent 的 `system`，把每次输入作为新的 `user.message` 事件发送。
>
> 不要把 Bot API 中的一轮多消息历史直接拼进 Agent 的系统提示词。这样会把临时对话变成永久规则，后续 Session 可能持续继承错误背景。固定角色、输出格式和工具使用规则写入 `system`；每次真实问题通过 `user.message` 发送。

<span id="verify"></span>
## 验证迁移结果

迁移后，用原应用的真实用例验证以下结果：

- Agent 能按原系统提示词完成基础问答。
- 开启联网能力后，事件流中能看到 `web_search` 或 `web_fetch` 相关工具调用。
- 需要读写文件或运行脚本时，事件流中能看到 `bash`、`read`、`write` 等工具调用。
- 需要知识库能力时，答案能使用记忆存储、MCP 或自定义工具提供的信息。
- 业务侧收到完整的 `agent.message`，随后收到 `stop_reason.type = "end_turn"` 的 `session.status_idle`。

期望看到的事件轨迹如下：

```text
user.message           发送原零代码应用回归问题
agent.message_delta    Agent 开始生成回复
agent.tool_use         调用 web_search、web_fetch、bash、read 或 write
agent.tool_result      返回工具执行结果
agent.message          输出完整回复
session.status_idle    stop_reason.type = end_turn
```

如果 `session.status_idle` 的 `stop_reason.type` 为 `requires_action`，表示 Session 正在等待工具确认或结果，并不表示迁移用例已经执行完成。先处理对应的阻塞事件，再继续等待最终回复。

如果事件流里没有出现预期工具调用，先检查 Agent 的工具配置，再检查系统提示词中是否明确说明了何时调用工具。

<span id="faq"></span>
## 常见问题

### 新建零代码应用入口下线时间

当前尚未公布新建零代码应用入口的下线时间，具体时间以后续公告为准。入口下线后将无法再创建新的零代码应用，已发布的存量应用仍可继续通过 Bot API 调用。

### 继续使用现有零代码应用

可以。已发布的存量零代码应用仍可继续通过 Bot API 调用。对于简单问答，特别是客服、车载助手等多轮对话场景，建议迁移到 Managed Agents，通过 Memory 读写持续使用用户偏好和历史信息；需要自行控制调用链时，可以改用模型 API。

### 迁移后的计费

Managed Agents 与 Bot API 使用同一套方舟账号和 API Key 体系。Managed Agents 会按 Agent 运行过程中的模型 token、Agent 运行时长和工具调用次数计费，详情参见 [Managed Agents 计费](https://ark.volcengine.com/docs/model-pricing#ma_billing)。

### 迁移知识库插件

记忆存储不等同于带检索和重排能力的知识库。应用中的少量静态参考内容可以整理到记忆存储；已有外部知识服务可以通过 MCP 或自定义工具接入。需要保留检索、重排或来源引用能力时，不要直接使用记忆存储替代原知识库插件。

### 迁移联网搜索能力

在 Managed Agents 中，联网搜索是 Agent 可主动调用的工具。迁移时，你需要在 Agent 工具集中启用 `web_search` 和 `web_fetch`，并在系统提示词中说明何时联网、如何使用搜索结果、是否需要标注来源。原联网内容插件中的内容源、问题改写、引用条数和来源展示配置不会自动迁移，需要逐项重新验证。

<span id="next-steps"></span>
## 相关文档

- 通过 [快速入门（控制台）](quick-start-console.md) 创建和调试 Agent。
- 通过 [快速入门（代码）](quick-start-code.md) 将 Agent 接入业务代码。
- 通过 [Tools](tools.md) 配置内置工具集。
- 通过 [持久化记忆](persistent-memory.md) 为 Agent 挂载长期记忆。
- 通过 [编排 Multi Agent](multi-agent.md) 将复杂任务按职责委派给多个 Agent。
