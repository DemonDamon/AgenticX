---
source: https://ark.volcengine.com/region:cn-beijing/docs/self-hosted-environment-overview
fetched: 2026-10-24
title: 自托管环境概述
---

# 自托管环境概述

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

本文介绍方舟 Managed Agents 自托管环境（Self-hosted Environment）的适用场景、工作原理和能力边界，帮助你判断是否应该选择自托管环境。

## 什么是自托管环境

自托管环境将 Agent 的工具执行、文件系统和网络放在企业自己的基础设施，而方舟继续托管模型推理、Agent 编排、Session 管理与事件流。

在当前工具体系中，迁移到企业 Worker 的执行能力是主 Agent 的 `bash`、`read`、`write`、`edit`、`glob` 和 `grep`。Web、MCP、多模态工具和自定义工具的执行方不随 Environment 类型变化。

**方舟负责**：
- 模型推理与 Agent 编排
- Session 生命周期管理
- 事件流持久化与实时推送
- Work Queue 的生成与调度

**企业负责**：
- 部署 Worker 进程，轮询并执行 Work Item
- 提供 Sandbox 执行环境（容器、VM 或物理机）
- 管理企业侧工具使用的文件系统、网络策略和内部资源访问
- 控制镜像、计算资源和审计

自托管环境继续使用方舟托管的 Agent 编排、Session 生命周期和事件协议，但执行面能力与云环境不同。自托管 Session 不支持通过 `resources` 挂载 Files、Memory Store 或 TOS 对象，也不能通过 Environment 配置依赖包、环境变量、网络策略和产物存储。相关输入、运行时配置与产物转存需要由企业在 Worker 与 Sandbox 中自行准备和管理。

## 适用场景

以下场景适合使用自托管环境：

- **敏感代码或文件不能进入平台云沙箱**：数据合规要求企业代码、密钥或内部文件不离开企业控制范围。
- **Agent 需要访问企业内网 API、数据库或代码仓库**：工具调用需要访问仅在企业内网可达的服务，无法通过公网暴露。
- **企业需要控制镜像、网络策略和计算资源**：对 Agent 执行环境有定制化要求，需要指定操作系统、预装工具或网络白名单。
- **企业已有容器、Kubernetes 或 MicroVM 基础设施**：希望复用现有集群调度、监控和日志体系。

## 不适用场景

以下场景不建议使用自托管环境：

- **希望零运维、按需自动拉起 Sandbox**：云环境由方舟全托管，无需企业部署和维护 Worker。
- **不具备安全隔离工具执行的能力**：自托管环境要求企业自行实现 Sandbox 隔离，否则 Agent 可能越权访问主机资源。
- **仅需调用少量外部业务函数**：如果工具只是调用企业已有的 HTTP API，优先考虑 [Custom Tool](tools.md) 或 [MCP](mcp.md)，无需部署 Worker。

## 与云环境的区别

| 维度 | 云环境 | 自托管环境 |
| --- | --- | --- |
| 主 Agent 的 Bash 和文件工具 | 方舟云沙箱执行 | 企业 Worker 在企业 Sandbox 中执行 |
| Web、MCP 和多模态工具 | 方舟侧执行 | 方舟侧执行 |
| 自定义工具 | 业务应用执行 | 业务应用执行 |
| Sandbox 生命周期 | 方舟管理 | 企业管理 |
| 企业 Sandbox 的文件与网络 | 不适用 | 企业策略仅约束 Worker 执行的工具 |
| 依赖包与环境变量 | 通过 Environment 配置 | 企业自行管理 |
| Session 资源 | 可以通过 `resources` 挂载 Files、Memory Store 或 TOS 对象 | 不支持通过 `resources` 挂载；输入文件由企业执行面准备 |
| 产物存储 | 可以通过 `config.tos` 配置 | 不支持通过 `config.tos` 配置；产物持久化与转存由企业执行面负责 |
| Worker | 不需要 | 需要部署 |
| 工具调用结果 | 进入方舟控制面 | 进入方舟控制面 |
| 运维责任 | 方舟为主 | 企业负责执行面 |

## 工作原理

方舟控制面与企业执行面的协作流程如下：

1. 业务应用通过 Session API 创建 Session 并发送用户消息。
2. 方舟控制面完成模型推理，生成工具调用并写入 Work Queue。
3. 企业 Worker 轮询 Environment 的 Work Queue，领取 Work Item。
4. 主 Agent 调用 `bash`、`read`、`write`、`edit`、`glob` 或 `grep` 时，Worker 在企业 Sandbox 中执行并回传结果。
5. 主 Agent 调用 Web、MCP 或多模态工具时，方舟完成执行；Agent 调用自定义工具时，业务应用完成执行。
6. 工具结果进入方舟控制面，驱动下一轮推理。
7. 任务结束后，Worker 清理执行环境，继续轮询下一个 Work Item。

> **说明**
>
> 工具调用和工具结果会经过方舟控制面，Agent 编排和模型推理仍在方舟侧完成。自托管只改变主 Agent 的 Bash 和文件工具的执行位置，不改变 Web、MCP、多模态和自定义工具的执行方。详情请参见 [自托管环境安全说明](self-hosted-environment-security.md)。

## 核心对象

| 对象 | 说明 |
| --- | --- |
| **Environment** | Agent 运行时配置，`type` 为 `self_hosted` 时表示自托管环境。定义执行位置，不包含依赖包、环境变量和网络策略配置 |
| **Worker** | 企业部署的进程，负责轮询 Work Queue、维持心跳，并执行主 Agent 的 Bash 和文件工具 |
| **Work Item** | 方舟为每个需要工具执行的 Session 生成的任务项，包含 Session 执行所需信息 |
| **Session** | 在 Environment 中运行的 Agent 实例，用于执行具体任务。Work ID 与 Session ID 一致 |
| **Events** | 应用与 Agent 之间交换的原子消息，涵盖用户消息、工具调用、工具结果与状态更新 |

## 一次任务如何运行

以下是一次完整自托管任务的执行流程：

1. 业务应用创建绑定自托管 Environment 的 Session。
2. 业务应用发送 `user.message` 事件。
3. 方舟控制面为本次执行生成 Work Item，写入 Environment 的 Work Queue。
4. Worker 通过长轮询（Poll）领取 Work Item 并 Ack 确认。
5. Worker 维持心跳（Heartbeat），保持租约有效。
6. Worker 订阅 Session Events，消费主 Agent 的 Bash 和文件工具调用，并在企业 Sandbox 中执行。
7. 方舟执行 Web、MCP 和多模态工具；业务应用执行自定义工具。
8. 各执行方回传工具结果，驱动下一轮推理。
9. 重复步骤 6-8，直到 Session 进入 `idle` 或终态。
10. Worker 完成 Work Item，清理执行环境。

## 数据与责任边界

自托管环境只改变部分工具的执行位置，模型推理和事件处理仍在方舟控制面。以下是关键数据流向：

| 数据 | 是否进入方舟控制面 | 是否留在企业环境 | 说明 |
| --- | --- | --- | --- |
| 用户消息 | 是 | 可选保留 | 业务应用发送的消息会持久化在方舟事件流中 |
| 工具调用参数 | 是 | 部分 | Worker 只接收主 Agent 的 Bash 和文件工具调用 |
| 工具结果 | 是 | 可保留 | 企业 Worker、业务应用或方舟返回的结果会驱动下一轮推理 |
| 企业文件原件 | 默认不上传 | 是 | 文件读取结果可能包含文件内容，回传前应按数据策略过滤 |
| 命令执行进程 | 否 | 是 | Bash 等命令由企业主机执行 |
| 网络请求 | 取决于工具类型 | 按工具类型决定 | Bash 发起的请求由企业控制；Web、MCP 和多模态工具的请求由方舟侧发起 |

> **注意**
>
> 自托管不等于所有业务数据均留在企业环境。工具调用和工具结果会经过方舟控制面；Web、MCP 和多模态工具也由方舟侧执行。需要限制数据出域时，关闭不符合数据边界要求的工具，并在 Worker 或业务应用侧过滤工具结果中的敏感信息。详情请参见 [自托管环境安全说明](self-hosted-environment-security.md)。

## 支持的 Worker 能力

- Ark Runtime SDK（Go、Python、Java），支持出站长轮询（Poll）领取 Work Item
- 常驻 Worker 模式（`EnvironmentWorker`），适用于长期运行的 Worker 主机
- 每 Session 独立 Sandbox 模式（`HandleItem`），适用于 Kubernetes 每 Session 一个 Pod
- 心跳续租（Heartbeat），默认 TTL 300 秒
- 未认领 Work 回收（Reclaim）：`reclaim_older_than_ms` 是认领超时阈值，单位为毫秒。Worker 拉取 Work 后超过该时间仍未认领时，其他 Worker 可再次获取该 Work。

> **注意**
>
> 该参数只用于设置未认领 Work 的认领超时阈值。Work 被认领后，不受该参数影响。Worker 心跳中断时，服务端会在租约到期并经过 60 秒宽限期后将 Work 状态更新为 `stopped`，当前不会将该 Work 自动分配给其他 Worker。

## 下一步

- [配置并运行自托管环境](configure-self-hosted-environment.md)：选择 Go、Python 或 Java SDK 启动 Worker，并完成一次 Session 工具执行
- [自托管环境安全说明](self-hosted-environment-security.md)：了解信任边界、凭证管理和 Sandbox 隔离
