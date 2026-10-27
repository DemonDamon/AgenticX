---
source: https://docs.bigmodel.cn/cn/managed-agents/create-session
fetched: 2026-10-23
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 创建会话

Session 是一次实际运行的载体：它把一个 Agent 放进一个 Environment，通过事件与你的应用交互。会话可以持续数小时、跨多轮交互。对话历史和 **/mnt/session/outputs** 会跨轮保留；要跨轮保留 **/workspace** 须开启 checkpoint，见下文。

希望通过界面选择 Agent、版本、环境和资源，可在 **Managed Agents → 会话** 新建会话。运行后的检查方法见[在控制台查看与调试会话](session-debugging.md)；下文说明 API 用法。

## 创建一个会话

最小请求只需要 **agent** 和 **environment\_id** 两个字段：

```bash theme={null}
session=$(curl -sS "$BASE_URL/v1/sessions" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22" \
  -H "content-type: application/json" \
  -d @- <<EOF
{
  "agent": "$AGENT_ID",
  "environment_id": "$ENVIRONMENT_ID",
  "title": "Data analysis session"
}
EOF
)

SESSION_ID=$(jq -r '.id' <<< "$session")
```

> [!TIP]
>
> 会话事件加密：创建时加 **x-events-encrypted: true**，对话和工具 I/O 按客户密钥加密落库。开关创建后不能改。完整说明见 [会话事件数据加密](events.md#会话事件数据加密)。

请求字段：

| 字段 | 说明 |
| - | - |
| **agent** | 必填。Agent ID 字符串（等价于固定最新版本），或对象形态用于钉版本 / 覆盖配置，见下文。 |
| **environment\_id** | 必填。运行环境 ID（env\_ 前缀），必须引用你自己的、未归档的 Environment。创建时环境配置被固化为会话快照。 |
| **title** | 可选。标题，最大 256 字符。 |
| **metadata** | 可选。最多 16 个 string 键值（key ≤64、value ≤512 字符）。 |
| **initial\_events** | 可选。最多 50 条初始 user.message 事件，见下文。 |
| **resources** | 可选。挂载 Memory Store、File 与 GitHub Repository Resource，file ≤500、memory\_store ≤8；还可声明 github\_repository，见[文件](files.md)与[记忆](memory-stores.md)。 |
| **vault\_ids** | 可选。最多 20 个不重复的 active Vault ID，顺序即凭据匹配优先级，见[凭据管理](vaults.md)。 |

响应是完整的 Session 对象。**agent** 字段回显解析后的配置快照（钉住的版本 ⊕ 会话级覆盖），**status** 初始为 **idle**：

```json theme={null}
{
  "id": "sess_xxxxxxxxxxxx",
  "type": "session",
  "agent": {
    "id": "agent_xxxxxxxxxxxx",
    "type": "agent",
    "name": "Coding Assistant",
    "model": { "id": "glm-5.3", "effort": {"type":"max"}, "speed": "standard" },
    "tools": [{"type":"agent_toolset_20260601"}],
    "version": 3
  },
  "environment_id": "env_xxxxxxxxxxxx",
  "status": "idle",
  "title": "Data analysis session",
  "metadata": {},
  "resources": [],
  "vault_ids": [],
  "budget": null,
  "usage": {
    "input_tokens": 0,
    "output_tokens": 0,
    "cache_read_input_tokens": 0
  },
  "archived_at": null,
  "created_at": "2026-08-28T08:00:00.000Z",
  "updated_at": "2026-08-28T08:00:00.000Z"
}
```

> [!NOTE]
>
> 响应中的 **budget** 字段当前恒为 **null**：平台暂不支持会话级消费上限，用量请通过 **usage** 字段与账单侧监控。

## 跨轮保留沙箱文件

**/mnt/session/outputs** 始终跨轮保留。Agent 运行过程中生成、要交给你的文件产物写到这里，再用 Files API 按会话下载。

**/workspace** 默认不跨轮保留：第一轮写的文件，第二轮再读会找不到。只有要保留沙箱系统盘时，才需要在创建会话时开启 checkpoint。

| 内容 | 跨轮是否保留 |
| - | - |
| 对话历史（事件） | 始终保留 |
| **/mnt/session/outputs** | 始终保留，并编目为可下载的 Session File |
| **/workspace**、**/tmp**、运行期安装的软件包 | 默认不保留。加 **x-checkpoint: true** 后随系统盘快照跨轮保留 |

要跨轮保留沙箱系统盘，创建会话时加请求头：

```bash theme={null}
session=$(curl -sS "$BASE_URL/v1/sessions" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22" \
  -H "x-checkpoint: true" \
  -H "x-checkpoint-ttl: 30" \
  -H "content-type: application/json" \
  -d @- <<EOF
{
  "agent": "$AGENT_ID",
  "environment_id": "$ENVIRONMENT_ID",
  "title": "Data analysis session"
}
EOF
)
```

* **x-checkpoint**：仅创建会话时可用。精确小写 `true` / `false`；未声明时按资源和 Agent 列表 推导，普通无状态会话默认关闭。
* **x-checkpoint-ttl**：可选，保留天数，取值 1–30，缺省 30。通常需显式 **x-checkpoint: true**；有仓库资源且默认已开启时也可单独设置 TTL。

需要交给调用方下载的文件产物，写到 **/mnt/session/outputs** 即可，不必开 checkpoint。详见[文件](files.md)。

> [!NOTE]
>
> 开启后，平台会在成功执行结束时尝试保存快照，下一轮优先从最近一次成功快照恢复；失败轮不更新快照；合作式 interrupt 收尾也可能保存最新磁盘。快照的创建或恢复受账号配额和底层服务可用性影响，失败时会回退到新的沙箱，因此不应作为唯一的持久存储。需要可靠下载的产物仍写入 /mnt/session/outputs。
>
> Checkpoint 只保留磁盘，不保留正在运行的进程和内存状态。

## 用初始事件预置会话

创建时通过 **initial\_events** 预置最多 50 条 **user.message**，适合把既有上下文或任务说明一次性带入。只要 initial\_events 非空，会话创建成功后会自动开始执行，无需再发送同一条任务：

```bash theme={null}
curl -sS "$BASE_URL/v1/sessions" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22" \
  -H "content-type: application/json" \
  -d @- <<EOF
{
  "agent": "$AGENT_ID",
  "environment_id": "$ENVIRONMENT_ID",
  "initial_events": [
    {
      "type": "user.message",
      "content": [
        {"type": "text", "text": "项目背景：我们在分析 2026 年 Q2 的销售数据。"}
      ]
    }
  ]
}
EOF
```

内容块约束：每条事件的 content 非空，类型为 **text** 或 **image**（初始事件不支持 document）。image 接受 `source.type` 为 `base64`、`url` 或 `file`，且生效模型须支持图片输入，例如 **glm-5.3-flash** 或 **glm-5.3-flashx**；字段、图片数量与大小限制见[图片输入](events.md#图片输入)。

> [!TIP]
>
> SSE 是 live-only，而创建响应返回前执行可能已经开始。使用 initial\_events 启动任务时，创建后立即连接 SSE，并用历史事件接口补齐连接前发生的事件。

## 为会话覆盖 Agent 配置

**agent** 的对象形态可以钉住特定版本，或在不改动 Agent 的前提下为单个会话覆盖配置：

```json theme={null}
{
  "agent": { "type": "agent", "id": "agent_xxxxxxxxxxxx", "version": 3 },
  "environment_id": "env_xxxxxxxxxxxx"
}
```

```json theme={null}
{
  "agent": {
    "type": "agent_with_overrides",
    "id": "agent_xxxxxxxxxxxx",
    "system": "You are a code reviewer. Only review, never modify files.",
    "tools": [
      {
        "type": "agent_toolset_20260601",
        "default_config": { "enabled": false },
        "configs": [
          { "name": "read", "enabled": true },
          { "name": "grep", "enabled": true }
        ]
      }
    ]
  },
  "environment_id": "env_xxxxxxxxxxxx"
}
```

覆盖语义：

* 可覆盖 **model**、**system**、**tools**、**mcp\_servers**、**skills**；每个字段都是**整体替换**（非深合并）。
* 覆盖只作用于本会话，Agent 本身不变；会话创建后覆盖即冻结。
* 覆盖含 **mcp\_toolset** 时须与 **agent.mcp\_servers** 一起提供，保证引用一致。
* 钉不存在的 **version** 返回 400，并在错误信息中提示当前最新版本。

## 通过 Vault 提供 MCP 鉴权

如果 Agent 声明了需要鉴权的 MCP 服务器，创建会话时传 **vault\_ids** 引用凭据集合。凭据按服务器 URL 匹配，详见[连接 MCP](mcp.md)与[凭据管理](vaults.md)。

## 启动会话

会话创建后处于 **idle** 状态，尚未供给沙箱。先打开事件流，再发消息——SSE 只转发连接建立后的实时事件，发完再订流会错过本轮进展。

典型的启动顺序：

1. 打开 SSE 事件流：**GET /v1/sessions/:id/events/stream**（保持连接）。
2. 发送第一条 **user.message** 事件：**POST /v1/sessions/:id/events**。
3. 会话进入 **running**：平台按环境快照供给沙箱、挂载资源与 Skill、启动 Agent 循环。
4. Agent 完成本轮工作后回到 **idle**（事件 **session.status\_idle**），等待你的下一条消息。

发送消息与处理事件的完整说明见[事件与流式输出](events.md)。

## Multi Agent、仓库与 Skill 固定

引用 coordinator 即创建Multi Agent Session；创建接口不接受 multiagent override。每个 Session 有 primary thread，子线程运行时按需产生，详见[会话线程](threads.md)。

声明 github\_repository 时，仓库工作树进入 /workspace，详见[访问 GitHub 仓库](github-repository.md)。multiagent 会话与仓库会话默认尽量启用 checkpoint；显式 x-checkpoint:false 优先。若只依赖 Agent 列表 推导，单独发送 x-checkpoint-ttl 仍会返回 400，需同时声明 true。快照受配额影响，失败会降级，不替代 Files/Memory。

新协议创建时会将主 Agent 和委派成员的 Skill latest 解析成具体版本；旧协议创建的会话仍按每次启动解析。Session 已固定的 Skill 不因目录摘牌立即消失，见[Skills](skills.md)。

initial\_events 非空会立即触发执行，需使用带计费资格的 API Key。默认先建空 Session、建立 SSE、再发任务，减少漏接首轮事件。

## 下一步

> **[管理会话](session-operations.md)**
>
> 查询、更新、归档与删除会话

> **[事件与流式输出](events.md)**
>
> 事件类型、SSE、打断与引导

> **[文件](files.md)**
>
> 向会话挂载输入文件

> **[记忆](memory-stores.md)**
>
> 跨会话保留长期记忆

> **[本页对应 OpenAPI](api-reference.md#sessions)**
>
> Session：创建、列出、更新、事件


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.