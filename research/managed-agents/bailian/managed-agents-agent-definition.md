---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/managed-agents-agent-definition
fetched: 2026-10-23
title: 定义 Agent
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 定义 Agent

> 智能体定义模型、系统提示词、工具与扩展能力，每次保存自动产生新版本。

<meta property="og:title" content="定义 Agent" />

## 配置字段 <span id="h-fields" />

在**智能体**页面点击**创建智能体**，或点击已有智能体进入详情页，可配置以下字段：

| **字段**  | **必填** | **可变更** | **说明**                                                                              |
| ------- | ------ | ------- | ----------------------------------------------------------------------------------- |
| 名称      | 是      | 是       | 工作空间内唯一标识，例如"数据分析助手"                                                                |
| 描述      | 否      | 是       | 智能体用途的简要说明，列表与下拉中展示                                                                 |
| 模型      | 是      | 是       | 从下拉选择，当前支持的模型见[可选模型](#h-models)。变更模型会产生新版本                                          |
| 系统提示词   | 否      | 是       | 定义智能体的角色、行为与约束。变更会产生新版本                                                             |
| 工具      | 否      | 是       | 9 个内置工具，按需勾选。详见 [Agent 工具配置](managed-agents-builtin-tools.md)         |
| MCP 服务器 | 否      | 是       | 挂载已开通的 MCP 服务（官方或自定义），其下工具默认全部启用，可按需关闭                                              |
| 技能      | 否      | 是       | 挂载已上传的技能包并锁定版本                                                                      |
| 多智能体    | 否      | 是       | 配置 coordinator 编队，编排多个成员智能体。详见 [多智能体协作](managed-agents-multiagent.md) |
| 元数据     | 否      | 是       | 自定义键值对（对应 API 的 `metadata`），不影响模型行为，可用于标记环境标识、版本号等业务信息                              |

通过 API 创建智能体时，需指定名称与模型，可选配系统提示词和工具集。完整参数与响应字段详见[创建 Agent API](api/agent-create.md)。

<Tip>
  也可通过阿里云百炼 CLI 以基础设施即代码方式管理智能体：`bl managed-agent init` 生成配置模板，`bl managed-agent plan` 预览变更，`bl managed-agent apply` 一键创建。详见[使用 CLI](managed-agents-cli.md)。
</Tip>

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

## 可选模型 <span id="h-models" />

`model.id` 支持智能模式，由平台按档位路由：

| **模式 ID**     | **说明**           |
| ------------- | ---------------- |
| `auto`        | 按任务复杂度自动路由到合适的档位 |
| `performance` | 性能档，高质量模型，速度质量兼顾 |
| `balanced`    | 均衡档，高级推理能力，高质量输出 |
| `economy`     | 经济档，标准推理能力，高性价比  |

同时支持的模型如下：

| **品牌**   | **模型 ID（Model ID）**    | **模型能力**       |
| -------- | ---------------------- | -------------- |
| 千问       | qwen3.8-max            | 推理模型、视觉理解、文本生成 |
| 千问       | qwen3.8-flash          | 推理模型、视觉理解、文本生成 |
| 千问       | qwen3.7-max            | 推理模型、文本生成      |
| 千问       | qwen3.7-plus           | 推理模型、视觉理解、文本生成 |
| 千问       | qwen3.6-plus           | 推理模型、视觉理解、文本生成 |
| 千问       | qwen3.6-flash          | 推理模型、视觉理解、文本生成 |
| DeepSeek | deepseek-v4-pro        | 推理模型、文本生成      |
| DeepSeek | deepseek-v4-flash-0731 | 推理模型、文本生成      |
| 智谱 AI    | glm-5.2                | 推理模型、文本生成      |
| 智谱 AI    | glm-5.1                | 推理模型、文本生成      |
| 月之暗面     | kimi-k3                | 推理模型、视觉理解、文本生成 |

具备视觉理解能力的模型可处理会话中投递的图片与视频，详见[发送 Event](api/event-post.md)。

<Note>
  模型列表持续更新，以控制台创建智能体时的下拉列表为准。
</Note>

## 相关配置

智能体的能力由以下组件共同决定，详细配置参见各自页面：

- [Agent 工具配置](managed-agents-builtin-tools.md)：9 个开箱即用的工具，覆盖命令执行、文件操作与网络访问。
- [Agent MCP](managed-agents-mcp.md)：通过 MCP 协议接入外部工具服务。
- [Agent Skills](managed-agents-skill.md)：挂载预置的工具组合，封装端到端任务流程。
- [多智能体协作](managed-agents-multiagent.md)：通过 coordinator 编队编排多个成员智能体。

## 版本 <span id="h-version" />

每次保存智能体，`version` 自动递增。会话创建时锁定当时的版本，后续编辑不影响已有会话。通过 API 更新时采用全量替换语义——请求体须包含当前 `version` 用于乐观锁校验，缺省字段视为清空。

## 归档与删除 <span id="h-archive" />

智能体只支持归档，不支持删除。在智能体详情页点击**归档**后，智能体默认不再出现在列表中，不可用于新建会话，已有会话不受影响。归档后仍可通过 API 查询（`include_archived=true`）。

通过 API 归档智能体，详见[归档 Agent API](api/agent-archive.md)。

<CodeGroup>
  ```bash
  curl -X POST "https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio/agents/agent_xxx/archive" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```

  ```python
  client.agents.archive("agent_xxx")
  ```

  ```java
  client.agents().archive("agent_xxx");
  ```
</CodeGroup>

## 下一步

- [发起会话](managed-agents-session-event.md)：用配好的智能体发起会话。
- [云端托管环境](managed-agents-cloud-hosting.md)：为工具调用准备沙箱。
