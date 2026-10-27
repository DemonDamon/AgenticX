---
source: https://docs.bigmodel.cn/cn/managed-agents/overview
fetched: 2026-10-23
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 概述

Z Managed Agents 提供云端托管的 Agent 运行环境，帮助开发者降低构建 Agent Runtime、执行环境和任务编排的复杂度。通过控制台或 API 定义并启动 Agent 会话，即可让 Agent 在云端调用工具、处理文件、执行命令，并持续完成复杂任务。

> [!NOTE]
>
> API 与控制台均已全量开放。推荐使用本地 Agent 搭配 [API](quickstart.md) 与 [Z Agent Builder Skill](builder-skill.md) 构建和迭代云端 Agent，控制台用于查询运行情况和调试。

## 基本概念

Managed Agents 围绕四个概念构建：

> **[Agent](agent-setup.md)**
>
> 模型、系统提示词、工具、MCP 服务器和 Skills 的组合定义，创建一次后可在多个会话中通过 ID 引用

> **[Environment](cloud-environment.md)**
>
> 声明式的运行环境配置：预装的软件包、网络访问策略等，决定会话沙箱长什么样

> **[Session](create-session.md)**
>
> 在某个环境中运行的一个 Agent 实例，执行具体任务并产出结果

> **[Events](events.md)**
>
> 你的应用与 Agent 之间交换的消息（用户输入、Agent 回复、工具调用与结果、状态更新）

Agent 与 Environment 是可复用定义；Session 是一次实际运行。你的应用通过事件与会话交互，工具则在该会话的沙箱里执行。

## 适用场景

Managed Agents 最适合具备以下特征的工作负载：

* **长时间执行**：需要连续运行数分钟到数小时、包含多轮工具调用的任务
* **云端基础设施**：需要预装软件包、可控网络访问的安全沙箱
* **最小化基建投入**：不想自建 Agent 循环、沙箱和工具执行层
* **有状态会话**：跨多轮交互保持对话历史
* **定时执行**：通过定时部署按 cron 计划周期性运行 Agent

## 工作方式

**1. 创建 Agent**

定义模型、系统提示词、工具、MCP 服务器与 Skills。Agent 创建一次，跨会话复用。详见 [定义 Agent](agent-setup.md)。

**2. 创建 Environment**

声明沙箱的软件包与网络策略，平台负责构建与预热。详见 [配置运行环境](cloud-environment.md)。

**3. 启动 Session**

引用 Agent 与 Environment 创建会话。详见 [创建会话](create-session.md)。

**4. 流式接收并发送消息**

先订阅 SSE，再把用户消息作为事件发送；Agent 自主调用工具并实时回传。事件历史在服务端持久化，可随时完整拉取。详见 [事件与流式输出](events.md)。

**5. 引导或打断**

在执行途中追加用户事件引导方向，或发送 user.interrupt 停止当前工作。

## 与模型 API 的差异

模型 API 提供单轮推理：发送消息、接收回复。若要让模型持续执行任务，调用方还需自行实现循环调度、上下文管理、工具执行与运行环境。Managed Agents 将这些能力纳入平台，对外以会话和事件交互：下发任务后，Agent 在云沙箱中自主运行，过程通过 SSE 回传。

短问答、低延迟对话，或不依赖沙箱与长任务状态时，直接调用模型 API 更合适。

### 平台托管的能力

<table>
  <colgroup>
    <col />

    <col />

    <col />
  </colgroup>

  <thead>
    <tr>
      <th>能力</th>
      <th>直接调用模型 API</th>
      <th>Managed Agents</th>
    </tr>
  </thead>

  <tbody>
    <tr>
      <td>**Agent 循环**</td>
      <td>自行解析 tool\_use、执行工具，再将结果回传模型，直至任务结束</td>
      <td>平台驱动循环；一轮结束后发出 session.status\_idle</td>
    </tr>

    <tr>
      <td>**上下文**</td>
      <td>客户端维护 history，每轮回传完整对话</td>
      <td>事件在服务端持久化；客户端只发送新事件并订阅增量</td>
    </tr>

    <tr>
      <td>**代码与文件**</td>
      <td>自行准备计算资源，并处理扩缩容与回收</td>
      <td>每个会话配备云沙箱，bash 与文件读写开箱即用，会话结束即释放</td>
    </tr>

    <tr>
      <td>**密钥**</td>
      <td>Token 容易进入提示词或进程环境</td>
      <td>凭据写入 Vault，用于 MCP、自定义工具、普通 HTTPS 等出站请求的鉴权；响应不回显，沙箱无法读取原文</td>
    </tr>

    <tr>
      <td>**落库加密**</td>
      <td>对话与工具 I/O 以明文写入自建存储</td>
      <td>可选按客户密钥加密业务事件后落库</td>
    </tr>

    <tr>
      <td>**跨会话状态**</td>
      <td>自行实现记忆与定时调度</td>
      <td>Memory 可挂载到多个会话并审计变更；定时任务按 cron 自动创建新会话</td>
    </tr>

    <tr>
      <td>**用量**</td>
      <td>自行从模型响应里累加</td>
      <td>平台记录每次模型调用及整个会话的 Token 用量，可通过事件或会话详情查询</td>
    </tr>
  </tbody>
</table>

### 仍由调用方定义

* **角色与能力**：模型、系统提示词、Skills 写在 Agent 定义中，跨会话复用。
* **工具边界**：启用哪些内置工具、连接哪些 MCP、是否要求 always\_ask 人工审批。
* **自定义工具**：以 JSON Schema 声明；Agent 发起调用后，由你的应用执行并回传结果。适合接订单、工单等业务系统，见[工具](tools.md#自定义工具)。
* **过程干预**：执行中可追加用户事件引导方向，或发送 user.interrupt，主动停止当前模型响应和运行中的命令。

客服、数据分析等常见配法见[最佳实践](examples.md)。

## 内置工具

Managed Agents 为 Agent 提供一组内置工具：

* **Bash**：在沙箱内执行 shell 命令
* **文件操作**：在沙箱内读取、写入、编辑和检索文件
* **MCP 服务器**：连接外部工具提供方，扩展 Agent 能力
* **自定义工具**：由你的客户端执行的工具，Agent 发起调用、你的应用返回结果

完整列表与配置方式见 [工具](tools.md)。

> [!TIP]
>
> 省略 **tools** 不会自动启用内置工具。需要沙箱操作时，创建 Agent 请显式加入 **agent\_toolset\_20260601**。

## 计费

> [!NOTE]
>
> Managed Agents 按开放平台 API 按量计费，暂不支持使用 Coding Plan 套餐额度。

> [!TIP]
>
> 计费规则在 Beta 期间可能调整，请以开放平台公告与账单为准。

* **模型用量**：按会话实际调用的模型（目前支持 **glm-5.3**、**glm-5.3-flash**、**glm-5.3-flashx**），走开放平台 API 按量计费，价格与同名模型的推理价一致。见 [模型价格](https://bigmodel.cn/pricing)。
* **沙箱与运行环境**：限时免费至 2026 年 10 月 31 日。后续计费规则以平台公告为准。
* **MCP**：接入自有 MCP 服务器的用量以开放平台公告为准。可在 [MCP 市场](https://bigmodel.cn/console/marketplace/index/mcp) 查看可用服务。
* **Web Search / Web Fetch**：工具调用费用限时免费至 2026 年 10 月 31 日，之后按调用收费；模型 token 费用仍产生，单价以正式公告为准。

## API 接入

开始使用前，你需要：

1. 一个智谱开放平台 API Key（在智谱开放平台控制台创建）
2. 在所有请求上携带版本头 **zai-version: 2026-05-26** 与 Beta 头 **zai-beta: managed-agents-2026-09-22**

API 基础地址（路径以 `/v1` 开头，例如 `/v1/agents`）：

```text theme={null}
https://agent-api.bigmodel.cn/api/agent/managed
```

Managed Agents 在设计上是有状态的：会话长时间运行、可在暂停后恢复，对话历史与产出保存在服务端。你对这些数据保有控制权：可以随时通过 API 归档会话，也可以单独删除上传的文件。

## 反馈与交流

欢迎扫码加入交流群，反馈使用问题与建议。

> **Managed Agents 交流群**
>
> 飞书扫码入群
>
> * 获取产品进展
> * 反馈使用问题
> * 与研发团队交流
>
> ![飞书交流群二维码](assets/178851492256820260904-173316.jpg)

## 按任务选择能力

| 要完成的工作 | 从哪里开始 |
| - | - |
| 用自然语言创建、修改或迁移云端 Agent | [Z Agent Builder](builder-skill.md) |
| 连接业务系统与外部服务 | [连接 MCP](mcp.md) |
| 并行处理独立任务 | [Multi Agent](multiagent.md) |
| 调试子 Agent 与完整事件 | [会话线程](threads.md) |
| 读写 GitHub 仓库工作树 | [访问 GitHub 仓库](github-repository.md) |

新文档使用 managed-agents-2026-09-22，旧协议仍兼容，见[协议版本](protocol-versions.md)。

## 下一步

> **[快速入门（API）](quickstart.md)**
>
> 用 curl 跑通第一个会话

> **[快速入门（控制台）](console-quickstart.md)**
>
> 描述任务并运行第一个 Agent

> **[最佳实践](examples.md)**
>
> 客服、数据分析等常见配法

> **[评测与自迭代](evaluation.md)**
>
> 批量验证表现，比较优化前后结果

> **[API 参考](api-reference.md)**
>
> 端点与错误码速查


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.