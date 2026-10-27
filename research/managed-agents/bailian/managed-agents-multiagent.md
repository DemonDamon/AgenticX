---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/managed-agents-multiagent
fetched: 2026-10-23
title: 多智能体协作
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 多智能体协作

> 通过 coordinator 编队，让一个协调者智能体编排多个成员智能体协同完成任务。

<meta property="og:title" content="多智能体协作" />

## 多智能体协作

多智能体协作让一个 **coordinator（协调者）** 智能体编排一组成员智能体。不配置 `multiagent` 或编队为空时，智能体按单智能体运行。

## 编队配置

在创建或更新 Agent 时通过 `multiagent` 字段配置编队。

| **字段**   | **说明**                      |
| -------- | --------------------------- |
| `type`   | 协作拓扑类型，当前仅支持 `coordinator`。 |
| `agents` | 编队条目列表，1-20 个。传空数组表示清空编队。   |

`agents` 中每个条目的字段：

| **字段**    | **说明**                                                     |
| --------- | ---------------------------------------------------------- |
| `type`    | 条目类型：`agent`（引用另一个 Agent）或 `self`（coordinator 自身，编队中最多一个）。 |
| `id`      | 被引用的智能体 ID，`type=agent` 时必填（最长 64 字符）；`type=self` 时不可传。    |
| `version` | 被引用的智能体版本号，`type=agent` 时可选（>=1，不传取最新）；`type=self` 时不可传。   |

<Note>
  传空数组 `"agents": []` 表示清空编队，智能体回退为单智能体运行。
</Note>

## 配置示例

下面创建一个含 coordinator 编队的智能体：编队包含 coordinator 自身（`self`）以及一个被引用的成员智能体（`agent`）。完整参数与响应字段详见[创建 Agent API](api/agent-create.md)。

<CodeGroup>
  ```bash
  curl -X POST "https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio/agents" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "name": "my-coordinator",
      "model": {"id": "qwen3.8-max"},
      "multiagent": {
        "type": "coordinator",
        "agents": [
          {"type": "self"},
          {"type": "agent", "id": "agent_researcher", "version": 3}
        ]
      }
    }'
  ```

  ```python
  agent = client.agents.create(
      name="my-coordinator",
      model="qwen3.8-max",
      multiagent={
          "type": "coordinator",
          "agents": [
              {"type": "self"},
              {"type": "agent", "id": "agent_researcher", "version": 3},
          ],
      },
  )
  print(agent.id)
  ```

  ```java
  Agent agent = client.agents().create(AgentCreateParam.builder()
      .name("my-coordinator")
      .model("qwen3.8-max")
      .multiagent(MultiAgentConfig.builder()
          .type("coordinator")
          .agents(List.of(
              RosterEntry.builder().type("self").build(),
              RosterEntry.builder().type("agent").id("agent_researcher").version(3L).build()))
          .build())
      .build());
  System.out.println(agent.getId());
  ```
</CodeGroup>

## 下一步

- [定义 Agent](managed-agents-agent-definition.md)：在智能体上配置编队。
- [发起会话](managed-agents-session-event.md)：用配好编队的智能体发起会话。
