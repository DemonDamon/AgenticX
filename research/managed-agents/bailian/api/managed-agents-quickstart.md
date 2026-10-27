---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/managed-agents-quickstart
fetched: 2026-10-23
title: 快速开始
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 快速开始

> 五分钟跑通 Managed Agents 全链路：创建 Agent 与 Environment、开启 Session、提交任务并流式接收执行结果。

<meta property="og:title" content="快速开始" />

## 前提 <span id="h-qs-prereq" />

1. 已开通阿里云百炼并创建 API Key（`sk-xxx`），已获取工作空间 ID（`ws_xxxxxxxxxxxx`），详见[API 总览与认证](managed-agents-api-overview.md)。
2. 将 API Key 与 Endpoint 导出为环境变量，后续示例直接引用：

```bash
export DASHSCOPE_API_KEY="sk-xxx"
export AGENTSTUDIO_URL="https://ws_xxxxxxxxxxxx.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio"
```

## 调用流程 <span id="h-qs-flow" />

一次完整的任务执行分五步：

1. <strong>创建 Agent</strong>：定义模型与系统提示词，得到 `agent_xxx`。Agent 通常只创建一次并长期复用。
2. <strong>创建 Environment</strong>：定义运行环境，得到 `env_xxx`。Environment 通常只创建一次并长期复用。
3. <strong>创建 Session</strong>：绑定 Agent 与 Environment，得到 `sesn_xxx`。
4. <strong>发送 Event</strong>：向 Session 提交任务指令，触发 Agent 进入 `running`。
5. <strong>订阅 SSE</strong>：以事件流方式接收执行结果，直至 Session 回到 `idle`。

## 安装 SDK <span id="h-qs-install" />

使用 Python 或 Java SDK 前，请先安装对应的 DashScope 包。Managed Agents 模块要求 Python SDK v1.26.2 及以上、Java SDK v2.22.24 及以上。若已安装旧版本，请重新执行安装命令以升级。

会话级智能体配置覆盖（`agent` 对象与 patch）和会话级 MCP 请求头（`mcp_configs`）需要 Python SDK v1.27.7 及以上、Java SDK v2.23.2 及以上；直接调用 REST 接口不受此限制，版本要求详见[API 总览与认证](managed-agents-api-overview.md)。

<CodeGroup dropdown>
  ```python
  pip install dashscope
  ```

  ```java
  <dependency>
      <groupId>com.alibaba</groupId>
      <artifactId>dashscope-sdk-java</artifactId>
  </dependency>
  ```
</CodeGroup>

## 端到端示例 <span id="h-qs-example" />

下例创建一个代码生成 Agent，开启 Session 后提交一个编码任务并流式接收执行结果。

<CodeGroup dropdown>
  ```bash expandable
  ## 1. 创建 Agent
  AGENT_ID=$(curl -s -X POST "$AGENTSTUDIO_URL/agents" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "name": "quickstart-coder",
      "model": {"id": "qwen-plus"},
      "system": "你是一位 Python 专家。用户提交编码任务后，直接输出简洁、可运行的 Python 代码。"
    }' | jq -r '.id')
  echo "Agent: $AGENT_ID"

  ## 2. 创建 Environment
  ENV_ID=$(curl -s -X POST "$AGENTSTUDIO_URL/environments" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"name": "quickstart-env", "config": {"type": "cloud"}}' | jq -r '.id')
  echo "Environment: $ENV_ID"

  ## 3. 创建 Session
  SESSION_ID=$(curl -s -X POST "$AGENTSTUDIO_URL/sessions" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"agent\": {\"type\": \"agent\", \"id\": \"$AGENT_ID\"}, \"environment_id\": \"$ENV_ID\"}" | jq -r '.id')
  echo "Session: $SESSION_ID"

  ## 4. 提交任务
  curl -X POST "$AGENTSTUDIO_URL/sessions/$SESSION_ID/events" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "input": [
        {"role": "user", "type": "message",
         "content": [{"type": "text", "text": "写一个 Python 函数，接收一个整数列表并返回去重后的有序列表。"}]}
      ]
    }'

  ## 5. 订阅 SSE 事件流，接收执行结果
  curl -N "$AGENTSTUDIO_URL/sessions/$SESSION_ID/events/stream" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Accept: text/event-stream"
  ```

  ```python expandable
  import os
  from dashscope.agentstudio import Client, user_message

  client = Client(
      api_key=os.environ["DASHSCOPE_API_KEY"],
      workspace="ws_xxxxxxxxxxxx",
      region="cn-beijing",
  )

  # 1. 创建 Agent
  agent = client.agents.create(
      name="quickstart-coder",
      model="qwen-plus",
      system_prompt="你是一位 Python 专家。用户提交编码任务后，直接输出简洁、可运行的 Python 代码。",
  )

  # 2. 创建 Environment
  env = client.environments.create(name="quickstart-env", config={"type": "cloud"})

  # 3. 创建 Session
  session = client.sessions.create(agent={"type": "agent", "id": agent.id}, environment_id=env.id)
  print(f"Agent: {agent.id}, Environment: {env.id}, Session: {session.id}")

  # 4. 提交任务
  client.sessions.events.send(
      session.id, events=[user_message("写一个 Python 函数，接收一个整数列表并返回去重后的有序列表。")]
  )

  # 5. 流式接收执行结果
  with client.sessions.events.stream(session.id) as stream:
      for event in stream:
          print(event, flush=True)
          if event.session_status in ("idle", "terminated"):
              break
  ```

  ```java expandable
  import com.alibaba.dashscope.agentstudio.*;
  import com.alibaba.dashscope.agentstudio.model.*;
  import com.alibaba.dashscope.agentstudio.param.*;
  import java.util.Collections;

  // 1. 创建客户端（自动读取 DASHSCOPE_API_KEY 环境变量）
  AgentStudioClient client = AgentStudioClient.builder()
      .workspace("ws_xxxxxxxxxxxx")
      .build();

  // 2. 创建 Agent
  Agent agent = client.agents().create(AgentCreateParam.builder()
      .name("quickstart-coder")
      .model("qwen-plus")
      .instructions("你是一位 Python 专家。用户提交编码任务后，直接输出简洁、可运行的 Python 代码。")
      .build());

  // 3. 创建 Environment
  Environment env = client.environments().create(EnvironmentCreateParam.builder()
      .name("quickstart-env")
      .config(Map.of("type", "cloud"))
      .build());

  // 4. 创建 Session
  Session session = client.sessions().create(SessionCreateParam.builder()
      .agentId(agent.getId())
      .environmentId(env.getId())
      .build());
  System.out.println("Agent: " + agent.getId() + ", Environment: " + env.getId() + ", Session: " + session.getId());

  // 5. 提交任务并流式接收执行结果
  try (AgentStudioEventStream stream = client.sessions().events().stream(session.getId())) {
      client.sessions().events().send(session.getId(),
          Collections.singletonList(ClientEvents.userMessage("写一个 Python 函数，接收一个整数列表并返回去重后的有序列表。")));
      for (Message event : stream) {
          System.out.print(event);
      }
  }
  ```
</CodeGroup>
