---
source: https://docs.bigmodel.cn/cn/managed-agents/permission-policies
fetched: 2026-10-23
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 工具权限

权限策略（permission policy）控制服务端执行的工具——内置工具集与 MCP 工具集——是自动执行，还是先暂停等待你的批准。自定义工具由你的应用自己执行、自己把关，不受权限策略约束。

## 控制台操作

在 **Agent 定义** 的工具区域，为工具集或具体工具选择允许、每次询问或拒绝策略，保存为新版本。MCP 工具可分别设置权限。

运行中出现确认请求时，在会话详情检查工具名称、参数和授权范围后允许或拒绝。选择“每次询问”的工具可能使任务停在 `requires_action`；定时任务等无人值守场景应提前确定可自动执行的权限范围。详见[会话调试](session-debugging.md)。

## 权限策略类型

| 策略 | 行为 |
| - | - |
| **always\_allow** | 工具自动执行，无需确认。 |
| **always\_ask** | 会话暂停，等待你批准后才执行。事件流程见下文「响应确认请求」。 |

内置工具集（agent\_toolset\_20260601）与 MCP 工具集（mcp\_toolset）的默认策略都是 **always\_allow**。只有显式配置了 **always\_ask** 的调用才会停下来等待审批；平台不提供「记住本次决定」或「只询问一次」这类中间形态。

权限策略控制的是「已启用的工具何时执行」。要把某个工具从 Agent 中彻底移除，应改用 **enabled: false** 禁用它，见[工具](tools.md)。

## 为工具集设置策略

权限策略写在 Agent 的 **tools** 配置里，可以在创建 Agent 时设置，也可以之后通过更新 Agent 修改。同一份工具配置有三个入口，字段与默认值完全相同：

* **创建 Agent**：POST /v1/agents 的 tools\[]。
* **更新 Agent**：POST /v1/agents/:agentId 的 tools\[]；产生新版本，只影响之后创建的会话。
* **创建会话时覆盖**：POST /v1/sessions 的 agent.tools\[]；整体替换 Agent 版本中的工具配置，会话创建后冻结。

正在运行的会话保持创建时的工具配置不变，更新只对之后创建的会话生效。

### 内置工具集的权限

用 **default\_config.permission\_policy** 为集合内所有工具设置统一策略：

```bash theme={null}
agent=$(curl -sS "$BASE_URL/v1/agents" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22" \
  -H "content-type: application/json" \
  -d '{
    "name": "Coding Assistant",
    "model": "glm-5.3",
    "tools": [
      {
        "type": "agent_toolset_20260601",
        "default_config": {
          "permission_policy": {"type": "always_ask"}
        }
      }
    ]
  }')
```

更常见的做法是只对高风险工具收紧。下面的配置放行只读操作、对可变更沙箱状态的工具要求审批：

```json theme={null}
{
  "type": "agent_toolset_20260601",
  "configs": [
    { "name": "bash", "permission_policy": {"type": "always_ask"} },
    { "name": "write", "permission_policy": {"type": "always_ask"} },
    { "name": "edit", "permission_policy": {"type": "always_ask"} }
  ]
}
```

### MCP 工具集的权限

MCP 工具的策略配置方式相同，**configs\[].name** 用服务器上报的原始工具名：

```json theme={null}
{
  "type": "mcp_toolset",
  "mcp_server_name": "github",
  "default_config": { "permission_policy": {"type": "always_ask"} },
  "configs": [
    { "name": "get_issue", "permission_policy": {"type": "always_allow"} },
    { "name": "list_issues", "permission_policy": {"type": "always_allow"} }
  ]
}
```

继承规则：**configs\[].permission\_policy** 省略或为 null 时继承 **default\_config.permission\_policy**；后者省略时取协议默认 **always\_allow**。

> [!TIP]
>
> **always\_ask** 要有人通过事件接口批准。定时部署可以绑定带 always\_ask 的 Agent，但触发后会停在 **requires\_action**，直到你补发 **user.tool\_confirmation**。无人值守的 cron 请用 **always\_allow**。

## 响应确认请求

当 Agent 调用一个策略为 **always\_ask** 的工具时：

1. 会话发出 **agent.tool\_use** 或 **agent.mcp\_tool\_use** 事件。
2. 会话暂停，发出 **session.status\_idle** 事件，其 **stop\_reason.type** 为 **requires\_action**，等待审批的事件 ID 列在 **stop\_reason.event\_ids** 数组中。会话会无限期等待你的响应。
3. 为每个待审批事件发送一条 **user.tool\_confirmation** 事件：**tool\_use\_id** 填对应工具调用事件的 ID，**result** 填 **"allow"** 或 **"deny"**，拒绝时可用 **deny\_message** 说明原因（仅允许与 deny 搭配）。一次 events 请求可以携带多条确认。
4. 所有待审批事件都被处理后，会话回到 running。被允许的工具执行；被拒绝的工具不执行，Agent 会收到一条「调用被拒绝」的工具结果，其中包含你的 deny\_message。

```bash theme={null}
curl -sS "$BASE_URL/v1/sessions/$SESSION_ID/events" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22" \
  -H "content-type: application/json" \
  -d '{
    "events": [
      {
        "type": "user.tool_confirmation",
        "tool_use_id": "sevt_tool_01J...",
        "result": "allow"
      }
    ]
  }'
```

```bash theme={null}
curl -sS "$BASE_URL/v1/sessions/$SESSION_ID/events" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22" \
  -H "content-type: application/json" \
  -d '{
    "events": [
      {
        "type": "user.tool_confirmation",
        "tool_use_id": "sevt_tool_01J...",
        "result": "deny",
        "deny_message": "请改用只读查询，不要执行 shell 命令。"
      }
    ]
  }'
```

注意：**tool\_use\_id** 必须精确等于当前 **requires\_action.event\_ids** 中某个工具调用事件的 ID；对不在等待中的事件发确认会被拒绝。同一批 events 里，同一个待审批事件只能出现一条确认。

## 自定义工具

权限策略不适用于自定义工具。Agent 调用自定义工具时，你的应用收到 **agent.custom\_tool\_use** 事件，是否执行完全由你决定，执行后回发 **user.custom\_tool\_result**。完整流程见[事件与流式输出](events.md)。

## Multi Agent 与 Web 工具

Web Search/Fetch 与其他内置工具使用相同 always\_allow/always\_ask 策略；需要禁用应设 enabled:false。顾问和委派工具不是普通可配置工具项。

审批是线程级等待。子线程的阻塞调用会显示在主流，平台按 tool\_use\_id 定位原线程；它等待时其他线程仍可运行，主线程普通消息也可继续。只有主线程自己在 requires\_action 时，普通 user.message 才被该等待门拒绝。

会话 idle 时可整体更新 agent.tools/agent.mcp\_servers，见[管理会话](session-operations.md)。更新 Agent 本身仍只改变之后引用的新版本。

## 下一步

> **[Skills](skills.md)**
>
> 为 Agent 挂载可复用的领域知识

> **[事件与流式输出](events.md)**
>
> 发送事件、流式接收、在执行途中打断或转向

> **[本页对应 OpenAPI](api-reference.md#agents)**
>
> Agent：tools 上的 permission\_policy


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.