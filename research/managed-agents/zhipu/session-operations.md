---
source: https://docs.bigmodel.cn/cn/managed-agents/session-operations
fetched: 2026-10-23
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 管理会话

本页涵盖会话的日常运维操作：查看状态、更新配置、检索、列表、归档与删除。发送事件与流式接收见[事件与流式输出](events.md)。

在控制台可通过 **Managed Agents → 会话** 查看与筛选会话，打开详情检查执行过程。界面操作见[在控制台查看与调试会话](session-debugging.md)，下文说明状态和 API 管理方式。

## 会话状态

| 状态 | 含义 |
| - | - |
| **idle** | 等待输入。刚创建、或 Agent 完成本轮工作后处于此状态；发送新事件即可继续。 |
| **running** | Agent 正在执行。可追加消息，或发送 user.interrupt 主动停止当前模型响应和运行中的命令；等待 session.status\_idle 确认收尾完成。 |
| **rescheduling** | 平台正在重新调度会话的沙箱（恢复或迁移），随后自动回到执行。 |
| **terminated** | 会话已终止，不再接受交互（例如所引用的 Environment 被归档后触发的准入终止）。 |

archived\_at 记录归档时间；归档成功时 Session 会终止并只读，见下文。

## 更新会话

**POST /v1/sessions/:sessionId** 支持更新四类内容，规则不同：

| 字段 | 规则 |
| - | - |
| **title** | 任意状态可更新；null 清空。 |
| **metadata** | 任意状态可更新；键级合并，限制与创建相同（16 键、key ≤64、value ≤512）。 |
| **agent.tools** | 仅 **idle** 状态可更新（否则 409 session\_not\_idle）；整体替换。要结束当前工作，可先发 user.interrupt，再等待会话回到 idle。 |
| **agent.mcp\_servers** | 仅 idle 状态可更新；整体替换，与 agent.tools 的 mcp\_toolset 引用保持一致。 |

**model**、**system**、**skills**、**vault\_ids**、**environment\_id** 不支持会话中更新——它们在创建时冻结。已归档会话的任何更新返回 409 session\_archived；空请求体返回 400。不要把 GET 会话对象原样 POST：更新时只提交上表字段；改 **agent** 时只传 **tools** / **mcp\_servers**。

```bash theme={null}
curl -sS "$BASE_URL/v1/sessions/$SESSION_ID" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22" \
  -H "content-type: application/json" \
  -d '{
    "agent": {
      "tools": [
        {
          "type": "agent_toolset_20260601",
          "configs": [{"name": "bash", "permission_policy": {"type": "always_ask"}}]
        }
      ]
    }
  }'
```

## 获取会话

```bash theme={null}
curl -sS "$BASE_URL/v1/sessions/$SESSION_ID" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22"
```

响应中值得关注的运行时字段：**status**（当前真实状态）、**usage**（累计 input / output / cache\_read token）、**resources**（挂载的 Memory Store 与 File，含实际 mount\_path）、**agent**（解析后的配置快照）。

## 列出会话

**GET /v1/sessions** 支持丰富的过滤条件：

```bash theme={null}
curl -sS "$BASE_URL/v1/sessions?agent_id=$AGENT_ID&statuses[]=running&limit=20" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22"
```

| 参数 | 说明 |
| - | - |
| **agent\_id** / **agent\_version** | 按 Agent 过滤；agent\_version 必须与 agent\_id 同用。 |
| **memory\_store\_id** | 按挂载的 Memory Store 过滤。 |
| **statuses\[]** | 可重复传入的状态过滤，如 statuses\[]=idle\&statuses\[]=running。 |
| **created\_at\[gt]** / **\[gte]** / **\[lt]** / **\[lte]** | 按创建时间过滤，值为 RFC 3339。例如 `created_at[gte]=2026-01-01T00:00:00Z`。四个参数可组合。 |
| **include\_archived** | 默认 false；true 时包含已归档会话。 |
| **limit** / **order** / **page** | 分页：limit 默认 20，order 默认 desc；用响应中的 next\_page 游标向后翻页、prev\_page 游标向前翻页。 |

## 归档会话

归档把会话标记为已完成并使其只读。会话必须处于非 running 状态；若正在执行，可发送 user.interrupt，并等待会话回到 idle 后再归档：

```bash theme={null}
curl -sS -X POST "$BASE_URL/v1/sessions/$SESSION_ID/archive" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22"
```

注意与其他资源不同：**对已归档会话重复归档返回 409 session\_archived**（不是幂等成功）。另外，非 API 创建的会话（例如 IM 渠道会话，公共列表不展示这类记录）不可归档，返回 409 operation\_not\_supported。

## 删除会话

删除会永久移除会话及其事件历史，不可恢复：

```bash theme={null}
curl -sS -X DELETE "$BASE_URL/v1/sessions/$SESSION_ID" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22"
```

```json theme={null}
{ "id": "sess_xxxxxxxxxxxx", "type": "session_deleted" }
```

规则：running 状态不可删除（409）；可先发送 interrupt，并等待回到 idle。已归档会话允许删除；非 API 创建的会话不可删除。会话挂载的 File 与 Memory Store 是独立资源，不随会话删除。

## 线程聚合与用量

Session 的状态聚合各线程：任一 running/rescheduling 即为 running，全部 terminated 时为 terminated，其余为 idle。不要看到某个 child idle 就宣称整项任务完成。详细状态、Thread usage/stats 与归档接口见[会话线程](threads.md)。

Session usage 是累计 token 与 server\_tool\_use 快照；web\_search\_requests 计搜索请求，web\_fetch\_requests 当前恒 0。Advisor 消耗按自身模型计入总量。Thread 尚未运行时 stats/usage 可为 null，不跟踪的费用字段会省略；没有数据不等于零账单。

同一 Session 更新主线程 tools/MCP 时，self 副本使用主线程当前覆盖配置，引用成员仍用自己的配置。归档/删除前先确认所有线程已收尾；只中断主线程不代表子线程都已停止。

## 下一步

> **[事件与流式输出](events.md)**
>
> 发送事件、打断、恢复空闲会话

> **[文件](files.md)**
>
> 列出并下载会话产出文件

> **[本页对应 OpenAPI](api-reference.md#sessions)**
>
> Session：获取、更新、归档、删除


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.