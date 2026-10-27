---
source: https://docs.bigmodel.cn/cn/managed-agents/deployments
fetched: 2026-10-23
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 定时任务

Deployment 把 Agent 变成一个可以按计划自动运行的任务：绑定 cron 调度与初始指令，每次触发时平台自动创建一个新会话执行。适合日报生成、数据巡检、定期同步这类无人值守的工作。没有 cron 的 Deployment 也可以只用于手动触发（manual-only）。

## 控制台操作

进入 **Managed Agents → 定时任务**，创建任务，选择 Agent 版本、环境、初始消息与运行资源，设置 Cron 和时区。保存前检查下一次执行时间是否符合预期。

进入详情查看运行记录，打开对应 Session 检查回答、工具与产物。需要先验证时可手动触发；暂停用于停止后续调度，恢复后按配置继续。修改配置或归档前，先核对其对后续运行的影响；任务被触发不等于业务执行成功。

## 创建 Deployment

```bash theme={null}
deployment=$(curl -sS "$BASE_URL/v1/deployments" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22" \
  -H "content-type: application/json" \
  -d @- <<EOF
{
  "name": "Daily report",
  "agent": "$AGENT_ID",
  "environment_id": "$ENVIRONMENT_ID",
  "schedule": {
    "type": "cron",
    "expression": "0 9 * * 1-5",
    "timezone": "Asia/Shanghai"
  },
  "initial_events": [
    {
      "type": "user.message",
      "content": [
        { "type": "text", "text": "生成昨日销售日报，保存到 /mnt/session/outputs/report.md" }
      ]
    }
  ]
}
EOF
)

DEPLOYMENT_ID=$(jq -r '.id' <<< "$deployment")
```

### 字段说明

| 字段 | 必填 | 说明 |
| - | - | - |
| name | 是 | 非空名称 |
| agent | 是 | Agent ID 字符串（创建/更新时固定最新版本），或对象形态固定版本 / 带 override：`{"type": "agent", "id": "...", "version": 3}` |
| environment\_id | 是 | 运行环境；须为自有且未归档的 Environment。Deployment 只保存引用，每次触发按环境当前配置固化进新会话；环境被归档或删除后，下一次触发失败 |
| schedule | 否 | `{"type": "cron", "expression", "timezone"}`；省略则为 manual-only。expression 为 5 段 cron 且须存在未来触发点，相邻触发默认间隔 ≥5 分钟；timezone 当前仅支持 Asia/Shanghai（默认） |
| initial\_events | 是 | 非空的 user.message 列表，内容块支持 text / image（不支持 document）；image 接受 base64、url 或 file 来源，且 Agent 模型须支持图片输入，见[图片输入](events.md#图片输入)。每次触发都以这组事件启动新会话 |
| resources | 否 | 与会话相同：file ≤500 个 + memory\_store ≤8 个 |
| vault\_ids | 否 | MCP / 环境变量凭据引用 |
| description / metadata | 否 | 用途说明与自定义元数据（≤16 个 string 键值） |

图片使用 URL 或 File ID 来源时，每次触发都会重新解析：URL 内容变化会影响后续运行，File 被删除或不可访问时后续运行会失败。需要固定图片内容时，可使用 base64 来源。

如果 Agent 配置或本次 override 挂载了 Skill，tools 必须同时包含 **agent\_toolset\_20260601**，否则创建或更新返回 400。

响应中的 **agent.version** 是创建时固定（pin）下来的真实版本号。**schedule.upcoming\_runs\_at** 最多返回接下来 5 个计划时间，下次触发取第一项；manual-only 时 **schedule** 为 null。

> [!TIP]
>
> 部署触发时通常没有客户端在线。自定义工具和 **always\_ask** 不会被接口拒绝，但没人回结果或批准时，会话会停在 **requires\_action**。无人值守的定时任务应只用内置工具和 **always\_allow** 的 MCP，凭据走 **vault\_ids**。

## 记忆让定时任务有连续性

每次触发都是全新会话，默认不共享任何状态。挂载 read\_write 的 Memory Store 后，Agent 可以记住上次运行处理到哪里：

```json theme={null}
{
  "resources": [
    {
      "type": "memory_store",
      "memory_store_id": "memstore_xxxxxxxx",
      "access": "read_write",
      "instructions": "运行结束时把本次处理的截止位置写入 /state/checkpoint.md"
    }
  ]
}
```

## 查看运行记录

每次触发（定时或手动）产生一条 DeploymentRun，记录触发上下文与创建的会话：

```bash theme={null}
curl -sS "$BASE_URL/v1/deployment_runs?deployment_id=$DEPLOYMENT_ID" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22"
```

Run 的关键字段：**trigger\_context**（type 为 schedule 或 manual，schedule 触发含 scheduled\_at）、**session\_id**（该次运行创建的会话；刚返回时可能为 null，通常数秒后填上）、**error**（异步失败摘要，成功为 null）、**agent**（本次运行实际使用的 Agent 版本）。列表支持 **deployment\_id**、**has\_error**、**trigger\_type**、**created\_at\[gte]** / **created\_at\[lte]** 过滤，limit 默认 50。单条详情用 **GET /v1/deployment\_runs/:runId**。

**session\_id** 出现后，用 **GET /v1/sessions/:id/events** 查看执行过程，用 `GET /v1/files?scope_id=<session_id>` 下载产出。

## 手动触发

```bash theme={null}
curl -sS -X POST "$BASE_URL/v1/deployments/$DEPLOYMENT_ID/run" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22"
```

手动运行直接插入一条 run，不影响后续定时计划；暂停期间也允许手动触发。适合调试 initial\_events 与验证产出，无需等到下一个调度点。

## 暂停、恢复与归档

| 操作 | 语义 |
| - | - |
| POST /v1/deployments/:id/pause | 停止后续定时触发；手动 run 仍允许 |
| POST /v1/deployments/:id/unpause | 以当前时间为锚重算 **schedule.upcoming\_runs\_at**；暂停期间漏掉的触发不会补跑 |
| POST /v1/deployments/:id | 更新 name / schedule / initial\_events 等；改 schedule 同样以当下为锚重算 |
| POST /v1/deployments/:id/archive | 终态且幂等；归档后不再触发、不可手动 run（409），历史 run 仍可查询 |

列表 **GET /v1/deployments** 支持 **agent\_id**、**status**（active / paused）、**created\_at\[gte]** / **created\_at\[lte]**、**include\_archived** 过滤。

## 版本、计费与运行成功

Deployment 固定创建或更新时解析出的 Agent 版本，字符串 ID 也一样。之后更新 Agent 不会自动影响现有 Deployment，需显式更新 Deployment 的 agent。Environment 每次触发按当时配置固定到新 Session。

创建 Deployment 要有可计费 API Key；定时执行使用创建或最近一次带 key 更新时保存的计费来源。手动 run 带 key 时使用本次 key，不带时沿用 Deployment；两者都没有时返回 401。费用按开放平台 API 的实际用量计算，见[计费说明](overview.md#计费)。

Run 成功表示 Session 与输入已成功建立，不表示 Agent 业务任务结束。拿到 session\_id 后继续跟踪事件、idle stop\_reason 和产物。新协议下 Skill latest 在每次触发时固定；已删除 Skill 会让后续触发失败。

可绑定Multi Agent 或 Web 工具；无人接续的 custom/always\_ask 会等待。Web 调用仍受限速和费用规则约束。Deployment 当前不接受 github\_repository resource。

## 下一步

> **[记忆](memory-stores.md)**
>
> 让跨运行状态可持久

> **[事件与流式输出](events.md)**
>
> 分析每次运行的执行过程

> **[文件](files.md)**
>
> 下载运行产出

> **[本页对应 OpenAPI](api-reference.md#deployments)**
>
> Deployment 与 Deployment Run


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.