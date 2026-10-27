---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/managed-agents-quick-start
fetched: 2026-10-23
title: 快速开始
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 快速开始

> 通过控制台，按 4 步完成智能体创建、环境配置、会话发起与调用。

<meta property="og:title" content="快速开始" />

## 前置准备 <span id="c5f4bcb4cccgw" />

- 已开通[阿里云百炼](https://bailian.console.aliyun.com/)。
- 当前账号在目标工作空间内具备 Managed Agents 操作权限。

## 步骤 1：配置智能体 <span id="79eb0bf438ymi" />

进入[百炼控制台 > Managed Agents > 快速开始](https://bailian.console.aliyun.com/cn-beijing/managed-agent/quick-start/wizard)，填写智能体的基本信息、模型与工具。页面已预填模板值，按需修改即可。

| **字段**      | **说明**                                                                         |
| ----------- | ------------------------------------------------------------------------------ |
| 名称          | 默认 `Agent_v1`，可自定义                                                             |
| 模型          | 必选。从下拉列表选择，如 `qwen3.7-plus`                                                    |
| 系统提示词       | 定义智能体的角色与行为。已预填通用模板，可根据场景修改                                                    |
| 工具          | 7 个内置工具默认全选：`bash`、`read`、`write`、`edit`、`glob`、`grep`、`mark_artifacts`。按需取消勾选 |
| Skill / MCP | 可选。快速开始阶段可跳过，后续在智能体详情页追加                                                       |

也可通过 API 完成，指定名称、模型和工具（详见[创建 Agent API](api/agent-create.md)）：

<CodeGroup>
  ```bash
  curl -X POST "https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio/agents" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "name": "data-analyst",
      "model": {"id": "qwen3.8-max"},
      "system": "你是数据分析专家，使用 pandas 处理 CSV 文件。",
      "tools": [
        {
          "type": "builtin_toolkit",
          "default_config": {"enabled": true},
          "configs": [
            {"name": "bash", "enabled": true},
            {"name": "read", "enabled": true},
            {"name": "write", "enabled": true}
          ]
        }
      ]
    }'
  ```

  ```python
  agent = client.agents.create(
      name="data-analyst",
      model="qwen3.8-max",
      system_prompt="你是数据分析专家，使用 pandas 处理 CSV 文件。",
      tools=[
          {"type": "builtin_toolkit",
           "default_config": {"enabled": True},
           "configs": [
               {"name": "bash", "enabled": True},
               {"name": "read", "enabled": True},
               {"name": "write", "enabled": True},
            ]}
      ],
  )
  print(agent.id)       # "agent_xxx"
  print(agent.version)  # 1
  ```

  ```java
  Agent agent = client.agents().create(AgentCreateParam.builder()
      .name("data-analyst")
      .model("qwen3.8-max")
      .instructions("你是数据分析专家，使用 pandas 处理 CSV 文件。")
      .build());
  System.out.println(agent.getId());       // "agent_xxx"
  System.out.println(agent.getVersion());  // 1
  ```
</CodeGroup>

填写完成后点击**完成并下一步**，系统创建并保存智能体，随后进入环境配置。

## 步骤 2：配置运行环境 <span id="e319e0e8ee6sr" />

环境定义工具调用的执行沙箱，与智能体独立管理。

| **字段** | **说明**                   |
| ------ | ------------------------ |
| 名称     | 默认 `Agent_v1_Env`，可自定义   |
| 托管类型   | 默认**云端托管**（阿里云百炼托管的沙箱容器） |

也可通过 API 完成，指定沙箱类型与预装包（详见[创建 Environment API](api/environment-create.md)）：

<CodeGroup>
  ```bash
  curl -X POST "https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio/environments" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "name": "data-sandbox",
      "description": "数据分析沙箱",
      "config": {
        "type": "cloud",
        "packages": {
          "apt": ["ffmpeg"],
          "pip": ["pandas", "numpy", "matplotlib"]
        },
        "networking": {"type": "unrestricted"}
      }
    }'
  ```

  ```python
  env = client.environments.create(
      name="data-sandbox",
      config={
          "type": "cloud",
          "networking": {"type": "unrestricted"},
          "packages": {
              "apt": ["ffmpeg"],
              "pip": ["pandas", "numpy", "matplotlib"],
          },
      },
      description="数据分析沙箱",
  )
  ```

  ```java
  Environment env = client.environments().create(EnvironmentCreateParam.builder()
      .name("data-sandbox")
      .description("数据分析沙箱")
      .build());
  ```
</CodeGroup>

<Note>
  API 示例配置了预装包：环境创建后可能需要预热时间，预热完成前步骤 3 的会话创建会被拒绝，详见[环境预热](managed-agents-cloud-hosting.md#h-env-warmup)。
</Note>

点击**完成并下一步**，系统创建并保存环境，随后进入会话配置。

## 步骤 3：确认会话配置 <span id="bf03f3f9704tx" />

页面展示已创建的智能体与环境摘要，并基于两者自动发起会话。

- 确认**智能体**卡片中的名称、模型信息。
- 确认**环境**卡片中的名称、托管类型。
- 如需在沙箱中使用本地文件，点击**上传文件**挂载；否则直接跳过。

也可通过 API 完成，绑定智能体与环境（详见[创建 Session API](api/session-create.md)）：

<CodeGroup>
  ```bash
  curl -X POST "https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio/sessions" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "agent": {"type": "agent", "id": "agent_xxx"},
      "environment_id": "env_xxx",
      "title": "Q3 销售数据分析"
    }'
  ```

  ```python
  session = client.sessions.create(
      agent={"type": "agent", "id": "agent_xxx"},
      environment_id="env_xxx",
      title="Q3 销售数据分析",
  )
  print(session.id, session.status)
  ```

  ```java
  Session session = client.sessions().create(SessionCreateParam.builder()
      .agent(SessionAgent.ofOverride(Map.of("type", "agent", "id", "agent_xxx")))
      .environmentId("env_xxx")
      .title("Q3 销售数据分析")
      .build());
  System.out.println(session.getId() + " " + session.getStatus());
  ```
</CodeGroup>

点击**完成并下一步**，系统绑定智能体与环境、创建并保存会话，随后进入调用页面。

## 步骤 4：开始调用 <span id="h-step4" />

配置完成。页面提供两个标签页：

- **可调用 API**：展示创建事件的 curl 命令，可直接复制到终端执行。
- **预览调试**：在页面内直接与智能体对话，实时查看事件与工具调用过程。左上角下拉框可按事件类型筛选（User、Agent、Tool、Tool\_output、Error、Model、System）。

向会话写入消息触发智能体处理（详见[发送 Event API](api/event-post.md)）：

<CodeGroup>
  ```bash
  curl -X POST "https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio/sessions/sesn_xxx/events" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "input": [
        {
          "role": "user",
          "type": "message",
          "content": [
            {"type": "text", "text": "分析 /mnt/session/uploads/sales.csv 中 Q3 的销售趋势"}
          ]
        }
      ]
    }'
  ```

  ```python
  client.sessions.events.send(
      "sesn_xxx",
      events=[user_message("分析 /mnt/session/uploads/sales.csv 中 Q3 的销售趋势")],
  )
  ```

  ```java
  client.sessions().events().send("sesn_xxx",
      Collections.singletonList(
          ClientEvents.userMessage("分析 /mnt/session/uploads/sales.csv 中 Q3 的销售趋势")));
  ```
</CodeGroup>

通过 SSE 事件流实时接收处理过程与输出（详见[SSE 事件流 API](api/event-sse-stream.md)）：

<CodeGroup>
  ```bash
  curl -N "https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio/sessions/sesn_xxx/events/stream" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Accept: text/event-stream"
  ```

  ```python
  with client.sessions.events.stream("sesn_xxx", timeout=120.0) as stream:
      for event in stream:
          if event.type == "message":
              for block in (event.content or []):
                  if getattr(block, "type", None) == "text":
                      print(block.text, end="", flush=True)
          elif event.type == "session_status":
              if event.session_status in ("idle", "terminated"):
                  break
  ```

  ```java
  try (AgentStudioEventStream stream = client.sessions().events().stream("sesn_xxx", 120_000L)) {
      for (Message event : stream) {
          if ("message".equals(event.getType()) && event.getContent() != null) {
              for (ContentBlock block : event.getContent()) {
                  if (block instanceof ContentBlock.Text)
                      System.out.print(((ContentBlock.Text) block).getText());
              }
          } else if ("session_status".equals(event.getType())) {
              break;
          }
      }
  }
  ```
</CodeGroup>

调试完成后，点击**返回智能体列表**进入管理页面。前三步创建的智能体、环境、会话均已保存，可随时在对应菜单中查看和编辑。

## 下一步

- [管理会话与事件](managed-agents-session.md)：创建会话、发送消息与事件流
- [智能体](managed-agents-agent.md)：配置模型、提示词与工具
- [配置运行环境](managed-agents-cloud-hosting.md)：沙箱类型、预装包与网络策略
- [概览](api/managed-agents-api-overview.md)：在业务代码中集成 Managed Agents
