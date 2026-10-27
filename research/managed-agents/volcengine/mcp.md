---
source: https://ark.volcengine.com/region:cn-beijing/docs/mcp
fetched: 2026-10-24
title: MCP
---

# MCP

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

MCP（Model Context Protocol）用于把第三方系统的工具与数据源接入 Agent。通过 MCP，Agent 可以访问外部服务暴露出来的标准化工具，例如代码托管、项目协作、知识库或内部业务系统。

在方舟 Managed Agents 中，MCP 配置分成两层：

* Agent 定义层：声明要连接哪些 MCP Server。
* Session 运行层：通过 Vaults 注入对应凭据，完成鉴权。

这种拆分让 Agent 定义保持可复用，同时避免把终端用户密钥固定地写在 Agent 资源里。

# 在 Agent 上声明 MCP Server

创建 Agent 时，通过 `mcp_servers` 数组声明 MCP Server。每个 Server 需要三个字段：

| 字段 | 说明 |
| --- | --- |
| `type` | MCP Server 的声明方式。当前统一使用 URL 方式声明，值为 `url`。 |
| `name` | MCP Server 名称，最长 255 个字符。省略名称或名称不符合命名规则时，服务端会根据 `url` 生成名称；多个名称冲突时，服务端会为后续名称添加数字后缀，调用方无需保证名称唯一。为保证后续引用稳定，建议主动填写归一化后仍唯一的 `[a-z0-9_-]{1,64}` 小写名称，不依赖服务端生成。 |
| `url` | MCP Server 的访问地址。同一 Agent 中不能配置重复的地址。 |

每个 `mcp_toolset` 都必须通过 `mcp_server_name` 引用一个已声明的 MCP Server。你也可以只声明 MCP Server，暂不添加对应的 `mcp_toolset`；此时该 Server 的工具不会启用。

下面的示例把一个 GitHub MCP Server 挂到 Agent：

**选项：Curl**

```Bash
curl https://ark.cn-beijing.volces.com/api/v3/agents \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "GitHub 助理",
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
        "type": "agent_toolset_20260916"
      },
      {
        "type": "mcp_toolset",
        "mcp_server_name": "github"
      }
    ]
  }'
```

# 控制哪些 MCP 工具可用

`mcp_toolset` 的配置方式与内置工具集一致，也支持 `default_config` 和 `configs`。两类工具在显式提供 `default_config` 但省略 `permission_policy` 时采用不同的运行时默认值：内置工具使用 `always_allow`，MCP 工具使用 `always_ask`。为避免执行行为随工具类型变化，示例应同时显式配置 `enabled` 和 `permission_policy`。

如果某个 MCP Server 暴露的工具很多，建议先整体关闭，再按白名单开启：

**选项：Curl**

```Bash
curl https://ark.cn-beijing.volces.com/api/v3/agents \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "精简 GitHub 助理",
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
        "type": "mcp_toolset",
        "mcp_server_name": "github",
        "default_config": {
          "enabled": false,
          "permission_policy": {
            "type": "always_ask"
          }
        },
        "configs": [
          {
            "name": "list_issues",
            "enabled": true
          },
          {
            "name": "get_issue",
            "enabled": true
          },
          {
            "name": "add_issue_comment",
            "enabled": true
          }
        ]
      }
    ]
  }'
```

如果只需关闭少量 MCP 工具，将 `default_config.enabled` 设为 `true`，显式配置 `default_config.permission_policy`，再在 `configs` 中把对应工具设为 `enabled: false`。完整默认矩阵请参见 [工具权限策略](tool-permission-policy.md)。

# 在 Session 中注入 MCP 凭据

MCP Server 的认证不在 Agent 定义阶段传入，而是在创建 Session 时通过 `vault_ids` 引用 Vaults 中的凭据。这样你可以让同一个 Agent 在不同 Session 中代表不同终端用户访问外部系统。

最简示例如下：

**选项：Curl**

```Bash
curl https://ark.cn-beijing.volces.com/api/v3/sessions \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "agent-...",
    "environment_id": "env-...",
    "vault_ids": ["vlt-..."]
  }'
```

Vaults 的创建方法、`mcp_oauth` / `static_bearer` 等凭据类型，以及多 Vaults 匹配规则，详情请参见 [使用 Vaults 认证](use-vaults-authentication.md)。

# 约束与建议

- 同一个 Agent 中，`mcp_servers.url` 不能重复；`mcp_servers.name` 冲突时，服务端会自动追加数字后缀。
- 每个 `mcp_toolset` 必须引用一个已声明的 MCP Server；只声明 MCP Server 不会启用其工具。
- 不要把终端用户 token 直接写进 Agent 定义；应通过 Vaults 在 Session 级注入。
- 对高风险 MCP 工具，建议配合 [工具权限策略](tool-permission-policy.md) 使用 `always_ask`。

# 相关文档

**[Agent](define-agent.md)**

Agent 是包含基本信息、System Prompt、扩展能力的配置模板。

**[Skills](skills.md)**

Skills 用于给 Agent 补充领域知识、操作流程和最佳实践。

**[Tools](tools.md)**

Tools 决定 Agent 在 Session 中能主动调用哪些执行能力。

**[工具权限策略](tool-permission-policy.md)**

工具权限策略用于控制 Agent 发起工具调用时，是自动执行，还是暂停等待确认。
