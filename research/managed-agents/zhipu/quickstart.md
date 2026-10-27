---
source: https://docs.bigmodel.cn/cn/managed-agents/quickstart
fetched: 2026-10-23
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 快速入门（API）

本指南将带你完成：创建一个 Agent、配置运行环境、启动会话、流式接收响应，并下载产出文件。示例需要 curl、jq 和一个智谱开放平台 API Key，大约 5 分钟。

希望先通过可视化界面跑通任务，见[快速入门（控制台）](console-quickstart.md)。两种方式使用相同的 Agent、环境与会话资源。

## 核心概念

| 概念 | 说明 |
| - | - |
| **Agent** | 模型、系统提示词、工具、MCP 服务器和 Skills 的组合定义 |
| **Environment** | 会话运行环境的声明式配置：软件包与网络策略 |
| **Session** | 在环境中运行的一个 Agent 实例，执行任务并产出结果 |
| **Events** | 你的应用与 Agent 之间交换的消息（用户输入、Agent 回复、工具调用、状态更新） |

## 前置条件

* 一个智谱开放平台账号
* 一个智谱开放平台 API Key

## 配置鉴权

Managed Agents 是标准的 HTTP + SSE 接口，任何语言都可以直接调用。先把智谱开放平台 API Key 和基础地址设置为环境变量：

```bash theme={null}
export ZHIPUAI_API_KEY="your-api-key-here"  # gitleaks:allow
export BASE_URL="https://agent-api.bigmodel.cn/api/agent/managed"
```

> [!TIP]
>
> 所有 Managed Agents 请求都需要携带版本头 **zai-version: 2026-05-26** 和 Beta 头 **zai-beta: managed-agents-2026-09-22**。

## 创建你的第一个会话

**1. 创建 Agent**

创建一个 Agent，定义模型、系统提示词和可用工具：

```bash theme={null}
agent=$(
  curl -sS "$BASE_URL/v1/agents" \
    -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
    -H "zai-version: 2026-05-26" \
    -H "zai-beta: managed-agents-2026-09-22" \
    -H "content-type: application/json" \
    -d @- <<'EOF'
{
  "name": "Coding Assistant",
  "model": "glm-5.3",
  "system": "You are a helpful coding assistant. Write clean, well-documented code.",
  "tools": [
    {"type": "agent_toolset_20260601"}
  ]
}
EOF
)

AGENT_ID=$(jq -er '.id' <<<"$agent")
echo "Agent ID: $AGENT_ID"
```

**agent\_toolset\_20260601** 这个工具类型会启用全套内置 Agent 工具（bash、文件操作等）。完整列表与逐项配置见 [工具](tools.md)。

记下返回的 **agent.id**，后面每次创建会话都要引用它。

> [!TIP]
>
> 省略 **tools** 不会自动启用内置工具。上面的示例已显式加入 **agent\_toolset\_20260601**。

**2. 创建 Environment**

Environment 定义 Agent 运行所在的沙箱：

```bash theme={null}
environment=$(
  curl -sS "$BASE_URL/v1/environments" \
    -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
    -H "zai-version: 2026-05-26" \
    -H "zai-beta: managed-agents-2026-09-22" \
    -H "content-type: application/json" \
    -d @- <<'EOF'
{
  "name": "quickstart-env",
  "config": {
    "type": "cloud",
    "networking": {"type": "unrestricted"}
  }
}
EOF
)

ENVIRONMENT_ID=$(jq -er '.id' <<<"$environment")
echo "Environment ID: $ENVIRONMENT_ID"
```

记下返回的 **environment.id**。你可以在多个会话中复用同一个 Environment；需要预装软件包或收紧网络策略时，见 [配置运行环境](cloud-environment.md)。

**3. 启动 Session**

创建一个会话，引用上面的 Agent 和 Environment：

```bash theme={null}
session=$(
  curl -sS "$BASE_URL/v1/sessions" \
    -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
    -H "zai-version: 2026-05-26" \
    -H "zai-beta: managed-agents-2026-09-22" \
    -H "content-type: application/json" \
    -d @- <<EOF
{
  "agent": "$AGENT_ID",
  "environment_id": "$ENVIRONMENT_ID",
  "title": "Quickstart session"
}
EOF
)

SESSION_ID=$(jq -er '.id' <<<"$session")
echo "Session ID: $SESSION_ID"
```

**4. 订阅事件并发送消息**

先订阅 SSE，再发消息。流只推送连接建立之后的事件，发消息前未打开流会错过实时进展。

打开一个 SSE 流订阅实时事件（保持这个终端不退出）：

```bash theme={null}
curl -N "$BASE_URL/v1/sessions/$SESSION_ID/events/stream" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22"
```

然后在另一个终端设置相同的 `BASE_URL`、`ZHIPUAI_API_KEY` 和刚返回的 `SESSION_ID`，再发送用户消息事件：

```bash theme={null}
curl -sS "$BASE_URL/v1/sessions/$SESSION_ID/events" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22" \
  -H "content-type: application/json" \
  -d @- <<'EOF'
{
  "events": [
    {
      "type": "user.message",
      "content": [
        {
          "type": "text",
          "text": "Create a Python script that generates the first 20 Fibonacci numbers and saves them to /mnt/session/outputs/fibonacci.txt"
        }
      ]
    }
  ]
}
EOF
```

Agent 会编写一个 Python 脚本、在沙箱里运行它、并把结果写到产出目录。终端 1 里会依次收到类似这些事件：

```text theme={null}
event: agent.message
data: {"type":"agent.message","content":[{"type":"text","text":"I'll create a Python script ..."}], ...}

event: agent.tool_use
data: {"type":"agent.tool_use","name":"write", ...}

event: agent.tool_use
data: {"type":"agent.tool_use","name":"bash", ...}

event: session.status_idle
data: {"type":"session.status_idle", ...}
```

在你的应用代码里，通常只需要处理三类事件：**agent.message**（拼接文本展示给用户）、**agent.tool\_use**（展示 Agent 正在做什么）、**session.status\_idle**（本轮暂停或结束，需检查 stop\_reason）。完整事件类型见 [事件与流式输出](events.md)。

**5. 下载产出文件**

**session.status\_idle** 表示本轮结束。Agent 写入 **/mnt/session/outputs** 的文件会被编目，可用 Files API 列出并下载：

```bash theme={null}
files=$(curl -sS "$BASE_URL/v1/files?scope_id=$SESSION_ID" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22")

FILE_ID=$(jq -er '.data[0].id' <<<"$files")
echo "Output file: $FILE_ID"
```

```bash theme={null}
curl -sS -L "$BASE_URL/v1/files/$FILE_ID/content" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22" \
  -o fibonacci.txt
```

输入材料与产出文件的路径约定见 [文件](files.md)。

## 背后发生了什么

当你发送一个用户事件时，Managed Agents 会：

1. **供给沙箱**：按你的 Environment 配置构建并启动运行环境。
2. **运行 Agent 循环**：模型根据你的消息自主决定使用哪些工具。
3. **执行工具**：文件写入、bash 命令等都在沙箱内执行。
4. **流式推送事件**：Agent 工作过程中你实时收到进展更新。
5. **进入空闲**：Agent 完成本轮工作后发出 **session.status\_idle** 事件，等待你的下一条消息。
6. **取回产出**：写在 **/mnt/session/outputs** 的文件可按会话列出并下载。

会话会保留对话历史。写在 **/mnt/session/outputs** 的文件始终跨轮保留，也可按会话下载。**/workspace** 默认不跨轮保留。详见[创建会话 · 跨轮保留沙箱文件](create-session.md#跨轮保留沙箱文件)。

## 继续扩展

完成第一个任务后再按需增加能力：

* [工具](tools.md)：配置内置工具集与自定义工具，或通过 [MCP](mcp.md) 连接外部服务。
* [Multi Agent](multiagent.md)：委派并综合多个子任务。
* [GitHub Repository](github-repository.md)：让 Agent 处理仓库工作树。
* [Z Agent Builder Skill](builder-skill.md)：下载到本地编码助手，用自然语言构建和调试 Agent。

本页使用新 beta header；旧客户端与旧 Skill 可继续使用旧版，字段变化见[协议版本](protocol-versions.md)。

## 下一步

> **[定义 Agent](agent-setup.md)**
>
> 创建可复用、带版本的 Agent

> **[配置运行环境](cloud-environment.md)**
>
> 自定义软件包与网络策略

> **[工具](tools.md)**
>
> 为 Agent 启用或限制特定工具

> **[事件与流式输出](events.md)**
>
> 处理事件、在执行途中引导 Agent

> **[最佳实践](examples.md)**
>
> 客服、数据分析等常见配法

> **[定时任务](deployments.md)**
>
> 按 cron 计划周期性运行 Agent


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.