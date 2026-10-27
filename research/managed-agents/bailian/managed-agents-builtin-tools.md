---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/managed-agents-builtin-tools
fetched: 2026-10-23
title: Agent 工具配置
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Agent 工具配置

> Managed Agents 提供 9 个内置工具，覆盖命令执行、文件操作、网络访问与产出物标记，全部在会话绑定的运行环境中执行。

<meta property="og:title" content="Agent 工具配置" />

## 工具列表 <span id="h-bt-overview" />

在智能体编辑页的**工具**区按需勾选。勾选的工具对该智能体的全部会话生效。

| **工具**           | **作用**                     | **典型用途**                    |
| ---------------- | -------------------------- | --------------------------- |
| `bash`           | 在沙箱中执行 shell 命令            | 运行脚本、安装包、调用 CLI             |
| `write`          | 写入文件                       | 生成报告、保存中间结果                 |
| `read`           | 读取文件内容                     | 查看挂载的 CSV、日志、配置文件           |
| `edit`           | 按字符串替换修改文件                 | 小范围改动比全量写入更安全               |
| `glob`           | 按模式查找文件                    | 定位目标文件，例如 `*.csv`           |
| `grep`           | 在文件中搜索文本                   | 日志排查、关键词定位                  |
| `web_search`     | 搜索互联网信息，返回相关网页的标题、链接和内容摘要  | 查询实时资讯与时效性信息（如天气、新闻）、检索外部资料 |
| `web_fetch`      | 读取指定网页地址的正文内容，转换为文本        | 结合搜索结果深入阅读网页、提取页面正文         |
| `mark_artifacts` | 标记智能体产出的结果文件，返回其 `file_id` | 供业务侧按需下载或展示最终交付物            |

<Note>
  `web_search` 与 `web_fetch` 单独计费：`web_search` 按调用次数计费（0.03 元/次）；`web_fetch` 限时免费，后续收费计划以控制台展示为准。计费口径详见[计费说明](managed-agents-billing.md)。
</Note>

## 执行机制 <span id="h-bt-exec" />

全部内置工具在会话绑定的[运行环境](managed-agents-environment.md)中执行，工具产生的文件、安装的依赖在该会话生命周期内持久保留。

智能体根据系统提示词和当前消息自主决定调用哪个工具，调用过程通过事件面板实时可见。

## 审批策略

在智能体编辑页的**工具**区展开某个工具，可单独设置该工具的**审批策略**，控制其被调用前是否需要人工确认：

| **策略** | **行为**                   |
| ------ | ------------------------ |
| 总是允许   | 默认值。智能体调用该工具时直接执行，不打断流程  |
| 每次询问   | 每次调用前暂停，等待用户在会话中确认后才继续执行 |

对高风险工具（如 `bash`）设为**每次询问**，可在保留自动化能力的同时，对敏感操作保留人工闸门。当工具被设为每次询问时，智能体在会话中调用它会先暂停并等待确认。通过 API 集成时，如何在事件流中接收审批请求并回应，详见[会话事件流](managed-agents-event-stream.md#工具审批)。

### 审批的适用范围

工具审批仅支持主智能体，不支持在子智能体中使用。

<Warning>
  **客户端工具**（`function` / `custom` 等）不参与这套审批机制，其执行由客户端自行控制。
</Warning>

此外，**会话在创建时锁定当时的 Agent 版本**。修改 Agent 的审批策略不会追溯影响已存在的会话，需**新建会话**才会使用新配置。

### 通过 API 配置审批策略

除控制台外，审批策略也可在创建 / 更新 Agent 时通过 `tools` 字段声明。在 `builtin_toolkit` 项的 `default_config` 中设置工具包默认策略，并可在 `configs[]` 中对单个工具单独覆盖：

```json
{
  "tools": [
    {
      "type": "builtin_toolkit",
      "default_config": {
        "enabled": true,
        "permission_policy": {"type": "always_allow"}
      },
      "configs": [
        {
          "name": "bash",
          "enabled": true,
          "permission_policy": {"type": "always_ask"}
        }
      ]
    }
  ]
}
```

配置规则：

- `permission_policy` **只接受对象形态** `{"type": "always_allow"}` 或 `{"type": "always_ask"}`，不能传字符串，否则返回参数错误。
- `configs[]` 中单个工具的策略**覆盖** `default_config` 的同名配置；某工具未在 `configs[]` 指定时，沿用 `default_config`。
- MCP 工具的审批策略配置在 `tools[]` 中 `type` 为 `mcp_toolkit` 的项的 `default_config` / `configs` 字段，**不在** `mcp_servers[]` 中设置。
- 全部省略时，默认策略为 `always_allow`。

字段完整定义详见 [Agent API](api/agent-api.md)。

## 下一步

- [定义 Agent](managed-agents-agent-definition.md)：在智能体编辑页勾选需要的工具。
- [Agent MCP](managed-agents-mcp.md)：通过 MCP 协议接入更多外部工具。
- [发起会话](managed-agents-session-event.md)：在会话中观察工具调用过程。
