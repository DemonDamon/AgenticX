---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/managed-agents-introduction
fetched: 2026-10-23
title: 概述
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 概述

> Managed Agents 是阿里云百炼提供的智能体托管运行时，适用于多步工具调用、代码执行、文件处理等长时运行任务。平台托管会话状态、沙箱环境和工具执行，智能体在独立沙箱中自主执行命令、读写文件、安装依赖并处理数据，事件历史在服务端持久化。

<meta property="og:title" content="概述" />

## 与智能体应用的区别 <span id="702ab4dc4cpy2" />

| **维度** | **智能体应用**      | **Managed Agents**      |
| ------ | -------------- | ----------------------- |
| 运行模式   | 无状态调用，应用侧维护上下文 | 服务端维护会话状态，支持中断与续接       |
| 执行环境   | 共享运行时          | 独立沙箱，云端容器               |
| 事件模型   | 响应级流式输出        | 会话级 SSE 事件流，事件历史持久化     |
| 典型场景   | 问答、对话、轻量任务     | 多步工具调用、代码执行、文件处理等长时运行任务 |

## 核心概念 <span id="6fee184df2uxo" />

| **概念**               | **说明**                                                 |
| -------------------- | ------------------------------------------------------ |
| 智能体（Agent）           | 模型、系统提示词、工具、MCP 服务和 Skill 的组合配置。创建后通过 ID 引用，可在多个会话中复用。 |
| 运行环境（Environment）    | 会话运行的沙箱配置，由阿里云百炼托管的云端容器。                               |
| 会话（Session）          | 智能体在指定环境中的一次运行实例，执行任务并生成输出。                            |
| 事件（Event）            | 应用与智能体之间交换的消息，包括用户消息、工具调用结果和状态变更。                      |
| 记忆库（Memory Store）    | 跨会话持久化的挂载资源，智能体通过文件工具读写，内容跨会话保留。                       |
| 定时任务（Scheduled Task） | 绑定智能体并配置触发方式的资源，定时或手动触发运行，每次触发产生一条运行记录。                |

## 支持的工具 <span id="h2-tools" />

智能体通过以下工具与运行环境交互：

- **命令执行**：在沙箱中运行 shell 命令
- **文件操作**：上传文件挂载到沙箱，或从 URL 下载；支持读取、写入、编辑、查找、搜索
- **记忆**：挂载记忆库，跨会话读写工作笔记
- **MCP 服务**：接入外部工具服务
- **Skill**：挂载预置的工具组合，封装端到端任务流程

## 工作流程 <span id="h2-workflow" />

1. **创建智能体**：配置模型、系统提示词、工具和 MCP 服务。创建后通过 ID 引用。
2. **配置运行环境**：创建云端容器沙箱，按需配置预装包。
3. **发起会话**：创建引用智能体和环境配置的会话实例。
4. **发送事件，接收响应**：发送用户消息，智能体自主执行工具调用，通过 SSE 事件流推送结果。事件历史在服务端持久化。
5. **干预或中断**：在执行过程中发送新事件引导方向，或中断当前任务。

## 适用场景 <span id="h2-scenarios" />

- **长时运行**：任务涉及多步工具调用，持续数分钟到数小时。
- **代码执行**：在沙箱中运行脚本、安装依赖、调试程序。
- **文件处理**：读写、搜索、编辑沙箱内文件。
- **有状态会话**：跨多轮交互保持上下文和文件系统状态。
- **快速开发 / 低运维开销**：专注于 Agent 逻辑，而非从零开始构建和维护代理循环、沙箱编排或工具执行基础设施。

## 下一步

- [快速开始](managed-agents-quick-start.md)：创建第一个智能体并发起会话
- [管理会话与事件](managed-agents-session.md)：创建会话、发送消息与事件流
- [智能体](managed-agents-agent.md)：配置模型、提示词与工具
- [概览](api/managed-agents-api-overview.md)：接口总览、认证与可用 API
- [记忆库](managed-agents-memory-store.md)：跨会话保留智能体的工作笔记
- [定时任务](managed-agents-deployment.md)：定时或手动触发智能体运行
- [CLI](managed-agents-cli.md)：以基础设施即代码方式在终端管理 Agent 与会话
