---
source: https://ark.volcengine.com/region:cn-beijing/docs/self-hosted-environment-security
fetched: 2026-10-24
title: 自托管环境安全说明
---

# 自托管环境安全说明

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

本文介绍自托管环境（Self-hosted Environment）的安全责任模型、数据边界和最佳实践，帮助企业安全、平台和运维人员完成部署前安全评审。

## 安全责任模型

自托管环境采用**共享责任模型**：方舟负责控制面安全，企业负责执行面安全。

| 范围 | 方舟责任 | 企业责任 |
| --- | --- | --- |
| 模型推理与 Agent 编排 | 提供平台能力，保障推理链路安全 | 配置和使用 |
| Work Queue 与事件流 | 服务端鉴权、传输加密、持久化 | 安全保存凭证 |
| Worker 与 Sandbox | 不负责企业侧运行环境 | 部署、隔离、监控和运维 |
| 企业网络与内部系统 | 不管理 | 配置访问权限，实施最小权限 |
| 企业侧工具 | 下发主 Agent 的 Bash 和文件工具调用，接收执行结果 | 在 Worker 侧限制文件、命令、进程和网络权限 |
| 方舟侧工具 | 执行 Web、MCP 和多模态工具 | 按数据边界要求选择和配置工具 |
| 自定义工具 | 提供调用和结果事件 | 在业务应用侧执行并限制实际权限 |
| 凭证管理 | 校验调用方提供的方舟 API Key | 为业务应用和 Worker 分配、保存、轮换和吊销 API Key |

## 信任边界

自托管环境的信任边界位于方舟控制面与企业执行面之间：

- **方舟控制面**：托管模型推理、Agent 编排、Session 管理和事件流。Tool Call 和 Tool Result 会经过控制面。
- **企业 Worker**：部署在企业基础设施，轮询 Work Queue，并在企业 Sandbox 中执行主 Agent 的 `bash`、`read`、`write`、`edit`、`glob` 和 `grep`。
- **企业 Sandbox**：每个 Session 应使用独立的执行环境（容器、VM 或物理机上的隔离目录）。
- **方舟侧工具**：Web、MCP 和多模态工具由方舟侧执行，不受企业 Sandbox 的文件和网络策略约束。

> **注意**
>
> 自托管不等于所有业务数据均留在企业环境。工具调用和工具结果会经过方舟控制面；Web、MCP 和多模态工具也由方舟侧执行。需要限制数据出域时，关闭不符合数据边界要求的工具，并在 Worker 或业务应用侧过滤工具结果中的敏感信息。

## 数据如何流动

| 数据 | 是否进入方舟控制面 | 是否留在企业环境 | 说明 |
| --- | --- | --- | --- |
| 用户消息 | 是 | 可选保留 | 业务应用发送的消息会持久化在方舟事件流中 |
| 企业侧工具调用参数 | 是 | Worker 接收 | Worker 只接收主 Agent 的 Bash 和文件工具调用 |
| 方舟侧工具调用参数 | 是 | 默认不进入企业 Sandbox | Web、MCP 和多模态工具由方舟侧执行 |
| 工具结果 | 是 | 可保留 | 企业 Worker、业务应用或方舟返回的结果会驱动下一轮推理 |
| 企业文件内容 | 默认不上传 | 是 | 文件读写在企业 Sandbox 本地完成 |
| 命令执行进程 | 否 | 是 | Bash 等命令由企业主机执行 |
| 网络请求 | 取决于工具类型 | 按工具类型决定 | Bash 发起的请求受企业策略约束；Web、MCP 和多模态工具的请求由方舟侧发起 |

## 凭证安全

### 凭证分离

业务应用和 Worker 当前都使用标准方舟 API Key。为缩小单个凭证的暴露面，建议分别分配独立 API Key：

| 凭证类型 | 用途 | 持有者 | 权限范围 |
| --- | --- | --- | --- |
| 业务应用 API Key | 创建 Session、发送消息、订阅事件 | 业务应用 | 取决于 API Key 所属账号、项目和凭证策略 |
| Worker API Key | 轮询和处理 Work Item | Worker 主机 | 取决于 API Key 所属账号、项目和凭证策略，不会自动限制为单个 Environment |

> **警告**
>
> Worker API Key 不是 Environment 专用凭证。`MA_ENVIRONMENT_ID` 只用于定位 Work Queue，不会缩小 API Key 的授权范围。API Key 泄露后，攻击者可能访问该凭证有权操作的其他方舟资源。不要把任何 API Key 放入 Agent 工作目录、工具进程环境或日志。

### 凭证保存

- 将业务应用和 Worker 使用的 API Key 分别保存到企业 Secret Manager（如 Kubernetes Secret、HashiCorp Vault 或等效服务）
- 不将 API Key 写入代码仓库、Docker 镜像、启动脚本正文、`/workspace` 目录或日志文件
- 为不同部署环境或 Worker 集群分配独立 API Key，便于单独轮换、吊销和审计
- 日志中只保留凭证尾号（如 `...a1b2`），不输出完整凭证

### 凭证轮换与吊销

- 按企业凭证策略定期轮换 Worker API Key
- 凭证泄露或人员离职时，立即吊销已有 API Key 并生成新 Key
- 轮换时先使用新 API Key 启动 Worker，确认在线后再吊销旧 Key 并停止旧 Worker

## Sandbox 隔离

每个 Session 应使用独立的执行环境，防止跨 Session 数据泄露和权限越界。

### 基本要求

- 每个 Session 使用独立的工作目录或 Sandbox
- 使用非 root 用户运行 Worker 和 Agent 工具
- 限制 CPU、内存、进程数和执行时间
- 不挂载以下目录到 Sandbox：
  - Docker Socket（`/var/run/docker.sock`）
  - 宿主机根目录（`/`）
  - 凭证目录（如 `/etc/ark/`、`~/.aws/`）
  - 其他 Session 的工作目录

### 常驻 Worker 模式

如果使用常驻 Worker（`EnvironmentWorker`），确保 Worker 的根工作目录只用于 Agent 执行，并让 SDK 为每个 Session 创建独立子目录。需要扩容时，优先启动多个 Worker 进程或 Pod，并为每个实例设置独立的 `MA_WORKER_ID`。

不要让多个 Worker 共享同一个 Session 工作目录，也不要把凭证目录、宿主机系统目录或其他业务目录作为 Worker 工作目录。

### 每 Session 独立 Sandbox 模式

推荐使用 Kubernetes 每 Session 一个 Pod，每个 Pod 拥有独立的文件系统、网络命名空间和资源限制。

## 文件系统安全

Agent 通过 Bash 和文件工具访问企业文件系统，必须限制其可访问范围：

- 限制 Agent 可读写的根目录（如 `/workspace`），禁止访问 `/etc`、`/proc`、`/sys` 等系统目录
- 防止路径穿越：校验文件路径不包含 `..` 或符号链接逃逸
- 限制文件类型和数量，防止 Agent 写入大量文件耗尽磁盘
- 自定义文件工具应重复执行路径校验，确保路径在允许范围内
- 任务结束后清理 Session 的临时数据

## 网络安全

自托管 Worker 仅需主动出站访问方舟 API，无需开放入站端口：

- Worker 主机只需出站 HTTPS 访问 `https://ark.cn-beijing.volces.com/api/v3`
- 如果主 Agent 需要通过 Bash 访问企业内网服务，配置最小权限的域名或地址白名单
- 防止 Bash 通过代理或隧道访问未授权网络
- 不把数据库管理凭证直接暴露给 Agent 的工具调用

> **注意**
>
> 企业网络策略只约束 Worker 和 Sandbox 发起的请求。`web_fetch`、`web_search`、MCP 和多模态工具由方舟侧执行，不会使用企业 Sandbox 的网络出口。评审数据出域风险时，需要单独检查这些工具的输入、凭据和结果。

## 工具执行安全

Worker 在企业侧执行主 Agent 的 `bash`、`read`、`write`、`edit`、`glob` 和 `grep`，建议实施以下控制：

- 校验工具名称和输入参数 Schema，拒绝未定义的 Tool Call
- 对高风险工具（如数据库写入、生产环境部署）增加人工审批或二次确认
- Worker 按 Tool Call ID 持久化执行状态和结果；重复收到同一调用时直接复用结果，不再次执行工具
- 区分只读操作与写操作，对写操作实施更严格的权限控制
- 限制 Shell 命令：禁止 `sudo`、`chmod 777`、`rm -rf /` 等危险命令
- 清除包含凭证的环境变量后再执行 Agent 工具

> **注意**
>
> - 服务端幂等边界：服务端对 Tool Result 的幂等处理只作用于结果回传，不能阻止 Worker 再次执行本地工具。Worker 要在执行前保存 Tool Call ID 和“执行中”状态，执行完成后保存结果；收到重复调用时，直接复用已有结果。
> - 执行状态未知：如果 Worker 在工具已经执行、结果尚未保存时退出，恢复后无法确认发送邮件、写入数据库等副作用是否已经发生。不要自动重试这类调用，应把状态标记为未知，交由业务侧核对。
> - 执行账本持久化：执行账本要放在 Worker 重启后仍能读取的存储中。Go SDK 的 `EnvironmentWorker` 会把账本写入 Worker 工作目录，因此该目录也要持久化。使用其他 SDK 或自定义 Worker 时，先确认当前版本是否提供等价机制；如果没有，需要自行实现。

## 日志与审计

### 建议记录

- Worker 启动、停止、异常退出
- Work Item 的 Poll、Ack、Heartbeat、Complete
- Tool Call 的名称、参数、执行时间和结果状态
- 鉴权失败事件
- 凭证轮换和吊销操作

日志中应关联以下标识，便于跨系统追踪：

- `session_id`：Session 标识
- `work_id`：Work Item 标识（与 Session ID 一致）
- `environment_id`：Environment 标识
- `request_id`：方舟 API 请求标识

### 禁止记录

- 完整凭证内容（只记录尾号）
- 用户消息的完整文本（如包含敏感信息）
- Tool Result 中的敏感数据（如数据库查询结果、内部 API 响应）

## Worker 失联与 Work 回收

### Heartbeat 机制

Worker 通过 Heartbeat 维持已认领 Work Item 的租约。默认 TTL 为 300 秒，Worker 应在 TTL 过期前续租。心跳中断时，Work 会在最近一次成功心跳的租约到期并经过 60 秒宽限期后进入 `stopped`。

Work 进入 `stopped` 后，服务端当前不会自动将该 Work 分配给其他 Worker。原 Worker 恢复后，应先查询 Work 状态。Work 已停止时，应终止本地任务并释放资源。

### 回收未认领 Work

`reclaim_older_than_ms` 是 Work 的认领超时阈值，单位为毫秒。调用 Poll 接口时，使用该参数设置 Work 被拉取后等待认领的时间。Worker 需要在该时间内调用认领 Work 接口；超时仍未认领时，该 Work 保持 `queued`，其他 Worker 可以再次获取。

> **注意**
>
> 已认领的 Work 不受 `reclaim_older_than_ms` 影响。Worker 心跳中断后，服务端不会根据该参数将 Work 分配给其他 Worker。Worker 应检查每次 Heartbeat 响应中的 `lease_extended`；该字段为 `false` 时，立即停止执行。

### 迟到 Tool Result

Work Item 进入 `stopped` 状态后，发送新的 Tool Result 会使 Work Item 重新进入 `queued` 状态，并继续驱动 Session。该行为由新的 Session 事件触发，不属于 Reclaim，也不是 Worker 失联后的自动接管。Session 进入 `terminated` 状态后不再接受 Tool Result，请求返回 403 `OperationDenied.SessionTerminated`。

## 上线前安全检查

部署自托管环境前，对照下表确认安全控制，并根据原因评估不满足项的风险。

| 检查项 | 原因 |
| --- | --- |
| 业务应用与 Worker 分别使用独立 API Key | 支持独立轮换、吊销和审计，避免 Worker 凭据变更同时影响业务应用。 |
| 将 Worker API Key 的账号和项目权限纳入安全评审 | `MA_ENVIRONMENT_ID` 只定位 Work Queue，不会把 API Key 的权限限制到单个 Environment。 |
| 将 API Key 保存在 Secret Manager | 防止凭证进入代码仓库、镜像、工作目录或日志。 |
| 每个 Session 使用独立的工作目录或 Sandbox | 防止不同 Session 读取或覆盖彼此的数据。 |
| 使用非 root 用户运行 Worker 和 Agent 工具 | 降低工具进程访问宿主机系统资源的风险。 |
| 将文件系统访问限制在允许范围内，并校验路径 | 防止路径穿越或符号链接逃逸导致 Agent 访问工作目录之外的文件。 |
| 为网络访问配置最小权限，且不开放入站端口 | 限制 Agent 访问未授权网络，并减少 Worker 主机的暴露面。 |
| 评审 Web、MCP 和多模态工具的数据边界 | 这些工具由方舟侧执行，不受企业 Sandbox 的网络和文件策略约束。 |
| 按工具 Schema 校验名称和输入参数 | 防止未定义或格式异常的 Tool Call 进入企业执行环境。 |
| 为高风险工具增加审批或二次确认 | 防止 Agent 未经确认执行数据库写入、生产部署等高风险操作。 |
| 持久化 Worker 执行账本，按 Tool Call ID 复用结果 | Worker 重试或重复收到调用时，不再执行发送消息、写入数据库等有副作用的操作。 |
| 对日志进行脱敏 | 防止日志泄露完整凭证、用户消息或 Tool Result 中的敏感数据。 |
| Worker 收到停止信号后优雅退出并清理资源 | 避免本地任务在 Work 已停止后继续运行，并及时释放进程、文件和网络资源。 |
| 演练 Worker 失联停止和未认领 Work 回收 | 验证异常情况下的 Work 状态与文档描述一致，避免误将已认领 Work 当作可自动接管的任务。 |

## 安全边界

使用自托管环境时，需要明确以下安全边界：

- 方舟控制面不校验企业 Sandbox 的隔离程度，隔离责任完全在企业侧
- 方舟不监控企业 Worker 主机的安全状态（如系统漏洞、异常进程）
- 企业 Sandbox 的文件和网络策略不约束方舟侧执行的 Web、MCP 和多模态工具
- Tool Permission 等待期间，Worker 需持续维持 Heartbeat 等待用户审批
- 不支持企业自定义的审计日志格式和投递目标
