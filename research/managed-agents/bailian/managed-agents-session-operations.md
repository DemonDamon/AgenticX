---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/managed-agents-session-operations
fetched: 2026-10-23
title: 管理会话
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 管理会话

> 会话创建后，可通过状态机、工具调用审批和中断机制控制执行流程，并在任务完成后归档或删除。

<meta property="og:title" content="管理会话" />

## 状态机 <span id="h-state" />

会话状态显示在页面顶部。下表给出每个状态的触发条件、下一状态与可执行的操作：

| **状态**                                                                | **触发条件**                                                   | **下一状态**                                                           | **可执行操作**                                                      |
| --------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------- |
| `idle`（可交互：`stop_reason` 为 `null` / `end_turn` / `retries_exhausted`） | 会话刚创建（`null`）、一轮处理结束（`end_turn`）或重试耗尽（`retries_exhausted`） | 收到消息 → `running`；归档或删除 → `terminated`                              | 发送消息、挂载文件、归档、删除                                                |
| `idle`（`stop_reason=requires_action`）                                 | 触发 `always_ask` 工具审批，等待裁决                                  | 收齐裁决 → `running`；`interrupt` → 结束本批审批                              | 提交审批（`tool_approval_response`）、中断（`interrupt`）；**不能**用普通消息直接继续 |
| `running`                                                             | 收到消息，智能体开始处理                                               | 完成 → `idle`；触发审批 → `idle`（`requires_action`）；不可恢复错误 → `terminated` | 中断                                                             |
| `terminated`                                                          | 归档、删除，或不可恢复错误                                              | 终态，不可恢复                                                            | 查看事件历史；新建会话继续                                                  |

会话处于 `idle` 时，`session_status` 事件（及 `GET /sessions/{session_id}`）携带 `stop_reason` 说明原因。`stop_reason` 仅在会话状态为 `idle` 时用于判断交互状态：刚创建且尚无结束原因时为 `null`，其余取 `end_turn`、`retries_exhausted` 或 `requires_action`。`running` 时为 `null`；`terminated` 是终态，客户端不应依赖或解释其 `stop_reason`。客户端应按下表把四种 `idle` 投影映射到界面操作，判断可交互性时以「是否为 `requires_action`」为准，而非仅看 `idle`：

| `stop_reason`       | 含义                                                                | 可发送普通消息                                            | 审批 / 中断               |
| ------------------- | ----------------------------------------------------------------- | -------------------------------------------------- | --------------------- |
| `null`              | 会话刚创建、尚未处理                                                        | 允许                                                 | 无待审批                  |
| `end_turn`          | 模型主动结束本轮                                                          | 允许                                                 | 无待审批                  |
| `retries_exhausted` | 重试耗尽，本轮结束                                                         | 允许                                                 | 无待审批                  |
| `requires_action`   | 存在待裁决的 `always_ask` 审批，携带 `pending_batch_id` / `pending_call_ids` | **禁止**（单独发送会得到 `pending_tool_approval_unresolved`） | 提交审批 / 发送 `interrupt` |

- **可交互 `idle`（`null` / `end_turn` / `retries_exhausted`）**：均不存在审批屏障，可直接发送普通消息开始新一轮。
- **`requires_action`**：只能提交审批或发送 `interrupt`；逐条裁决后仍为该状态，`pending_call_ids` 缩减为剩余项，全部收齐后才回到 `running`。此时单独发送普通消息不会继续处理，会得到 `pending_tool_approval_unresolved`；`interrupt` + 普通 `message` 的合法组合按[会话事件流](managed-agents-event-stream.md#工具审批)定义处理。

<Warning>
  按状态驱动界面时，请以 `stop_reason` 而非仅 `idle` 判断可交互性：只有 `requires_action` 禁用普通消息、启用审批/中断；其余可交互 `idle`（`null` / `end_turn` / `retries_exhausted`）均放行新一轮消息。切勿把 `retries_exhausted` 当作永久禁聊。
</Warning>

会话运行期间可通过 API 动态挂载、查询与卸载文件资源，详见[运行时挂载资源 API](api/session-resource-create.md)。

## 会话级配置 <span id="h-session-config" />

会话运行期间可通过[更新 Session API](api/session-update.md) 修改会话级智能体配置（`agent` patch：系统提示词、工具、MCP Server、技能）与会话级 MCP 请求头（`mcp_configs`）。修改只作用于本会话快照，不生成智能体新版本。

`agent` patch 的子字段语义：省略保留已有覆盖；`null` 删除该字段覆盖并重新继承智能体源配置；空数组明确覆盖为空；空字符串（仅 `system`）明确使用空提示词。

## 工具调用 <span id="h-tool-call" />

智能体根据系统提示词和当前消息自主决定何时调用哪个工具。全部工具（内置、MCP、技能）均在会话绑定的运行环境中执行，调用过程通过事件面板实时可见。

### 调用流程 <span id="h-tc-flow" />

1. 智能体决策：模型输出工具调用指令，事件面板显示**工具调用**事件，含工具名与参数。
2. 审批分支：
   - `always_allow` 工具：直接进入执行，不阻塞。
   - `always_ask` 工具：产生 `tool_approval_request`，会话进入 `idle`（`stop_reason=requires_action`）等待裁决。同批全部裁决收齐后，获批（`allow`）调用才执行；仅提交部分裁决时会话保持 `requires_action`，本批任何 `always_ask` 工具都不执行。`deny` 的调用不执行，返回 `is_error` 为 `true` 的工具输出，`deny_message` 作为错误内容回传给模型。审批仅覆盖 `always_ask` 集合，`always_allow` 工具可能在审批完成前先执行。
3. 执行：在沙箱中运行工具，输出回传给模型。
4. 回复或继续：模型基于工具输出决定回复或发起下一次工具调用。

## 归档与删除 <span id="h-lifecycle" />

会话支持归档和删除两种操作：

- **归档**：状态变为 `terminated`（终态），事件历史保留可查。适用于已完成的会话。
- **删除**：硬删除，会话元数据、事件历史、内部拷贝的资源全部清除，不可恢复。如需保留事件历史请改用归档。

通过 API 归档会话，详见[归档 Session API](api/session-archive.md)。

<CodeGroup>
  ```bash
  curl -X POST "https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio/sessions/sesn_xxx/archive" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```

  ```python
  client.sessions.archive("sesn_xxx")
  ```

  ```java
  client.sessions().archive("sesn_xxx");
  ```
</CodeGroup>

通过 API 删除会话：

<CodeGroup>
  ```bash
  curl -X DELETE "https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio/sessions/sesn_xxx" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```

  ```python
  client.sessions.delete("sesn_xxx")
  ```

  ```java
  client.sessions().delete("sesn_xxx");
  ```
</CodeGroup>

## 下一步

- [会话事件流（SSE）](managed-agents-event-stream.md)：了解全部事件类型与 SSE 订阅。
- [定义 Agent](managed-agents-agent-definition.md)：调整智能体的模型、提示词与工具集。
- [云端托管环境](managed-agents-cloud-hosting.md)：配置工具调用的执行沙箱。
