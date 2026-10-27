---
source: https://ark.volcengine.com/region:cn-beijing/docs/tool-permission-policy
fetched: 2026-10-24
title: 工具权限策略
---

# 工具权限策略

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

工具权限策略用于控制 Agent 发起工具调用时，是自动执行，还是暂停等待确认。

当前权限策略只作用于服务端执行的工具：

- 内置工具集 `agent_toolset_20260916`
- 多模态工具集 `agent_toolset_multimodal_20260825`
- MCP 工具集 `mcp_toolset`

## 权限策略类型

| 策略 | 说明 |
| --- | --- |
| `always_allow` | 工具调用自动执行，不需要人工确认。 |
| `always_ask` | 工具调用前暂停，等待确认后再继续。 |

权限策略的默认值取决于是否提供整个 `default_config`：

| 配置 | 内置工具集 | MCP 工具集 |
| --- | --- | --- |
| 省略整个 `default_config` | 服务端保存 `enabled=true` 和 `always_allow`。 | 服务端保存 `enabled=true` 和 `always_allow`。 |
| 提供 `default_config`，但省略 `permission_policy` | 运行时使用 `always_allow`。 | 运行时使用 `always_ask`。 |
| 显式配置 `permission_policy` | 使用配置的策略。 | 使用配置的策略。 |

为了让 Agent 回显和运行时行为可直接核对，建议始终显式配置 `default_config.enabled` 和 `default_config.permission_policy`。

## 为整个工具集设置权限策略

你可以在 `default_config.permission_policy` 中为整个工具集配置统一策略。

下面的示例把内置工具集的默认策略改成 `always_ask`：

**选项：Curl**

```Bash
curl https://ark.cn-beijing.volces.com/api/v3/agents \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "谨慎执行 Agent",
    "model": {
      "id": "doubao-seed-2-1-pro-260628"
    },
    "tools": [
      {
        "type": "agent_toolset_20260916",
        "default_config": {
          "enabled": true,
          "permission_policy": {
            "type": "always_ask"
          }
        }
      }
    ]
  }'
```

不要只传 `default_config.enabled` 而省略 `permission_policy`。内置工具和 MCP 工具对空策略采用不同的运行时默认值。

## 为单个工具覆盖权限策略

除了为整个工具集设置默认策略外，你还可以在 `configs` 中对单个工具做更细粒度的覆盖。

下面的示例保留内置工具集默认自动执行，但要求 `bash` 每次执行前都先确认：

**选项：Curl**

```Bash
curl https://ark.cn-beijing.volces.com/api/v3/agents \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "命令审慎 Agent",
    "model": {
      "id": "doubao-seed-2-1-pro-260628"
    },
    "tools": [
      {
        "type": "agent_toolset_20260916",
        "default_config": {
          "enabled": true,
          "permission_policy": {
            "type": "always_allow"
          }
        },
        "configs": [
          {
            "name": "bash",
            "enabled": true,
            "permission_policy": {
              "type": "always_ask"
            }
          }
        ]
      }
    ]
  }'
```

这种覆盖关系适合把大部分低风险工具保持自动执行，只对高风险工具额外加一道确认。

## 为 MCP 工具集设置权限策略

下面的示例将可信 MCP Server 的工具集显式设置为 `always_allow`，便于直接核对自动执行范围：

**选项：Curl**

```Bash
curl https://ark.cn-beijing.volces.com/api/v3/agents \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "GitHub 协作 Agent",
    "model": {
      "id": "doubao-seed-2-1-pro-260628"
    },
    "mcp_servers": [
      {
        "type": "url",
        "name": "github",
        "url": "https://mcp.example.com/github"
      }
    ],
    "tools": [
      {
        "type": "agent_toolset_20260916",
        "default_config": {
          "enabled": true,
          "permission_policy": {
            "type": "always_allow"
          }
        }
      },
      {
        "type": "mcp_toolset",
        "mcp_server_name": "github",
        "default_config": {
          "enabled": true,
          "permission_policy": {
            "type": "always_allow"
          }
        }
      }
    ]
  }'
```

> **注意**
>
> 只有在确认 MCP Server 及其暴露工具都可信时，才将策略显式设置为 `always_allow`。如果 MCP Server 后续新增工具，工具集级的自动放行策略也会作用于新增工具。

## 使用建议

- 对只读工具，可以优先考虑 `always_allow`。
- 对会修改文件、执行命令或访问外部系统的工具，建议优先考虑 `always_ask`。
- 对 MCP 工具，建议先按最小权限原则收敛 `configs`，再决定是否自动放行。

工具集配置以及 `user.tool_confirmation` 对应的运行时事件流，详见 [Tools](tools.md)。如果你要管理 MCP Server 及其工具，详情请参见 [MCP](mcp.md)。

## 相关文档

**[Agent](define-agent.md)**

Agent 是包含基本信息、System Prompt、扩展能力的配置模板。

**[Skills](skills.md)**

Skills 用于给 Agent 补充领域知识、操作流程和最佳实践。

**[MCP](mcp.md)**

MCP（Model Context Protocol）用于把第三方系统的工具与数据源接入 Agent。

**[Tools](tools.md)**

Tools 决定 Agent 在 Session 中能主动调用哪些执行能力。
