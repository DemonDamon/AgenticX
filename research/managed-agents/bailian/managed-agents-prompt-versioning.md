---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/managed-agents-prompt-versioning
fetched: 2026-10-23
title: 进阶：提示词版本管理与回滚
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 进阶：提示词版本管理与回滚

> Agent 版本机制、标注测试集评测、Session 版本锁定语义与灰度回滚的做法，把提示词从应用代码剥离为服务端可版本化的资源。

<meta property="og:title" content="进阶：提示词版本管理与回滚" />

## 概述 <span id="h-pv-intro" />

本篇介绍 Managed Agents 的 Agent 版本机制、版本灰度与回滚做法，示例统一使用 REST/curl。

核心是把「提示词」从应用代码里剥离出来，变成服务端可版本化的资源，从而独立于代码走评审与晋升流程。涉及的机制：`POST /agents/{id}`（更新即升 version）、Session 与 Agent 版本的绑定关系（**支持显式锁定历史版本**）、以及 `GET /agents/{id}/versions` 列出历史版本。

## 场景 <span id="h-pv-scenario" />

某产品支持系统用大模型把工单路由到正确的团队。PM 希望让更多 API 相关的工单流向平台团队。

在过去，改一句路由提示词要走「PR + CI + 部署」，回滚也是同一套流程。用 Managed Agents 后，提示词存在服务端：每次 `POST /agents/{id}` 都会产生一个新的、不可变的版本；Session 在创建时锁定 Agent 的某个版本快照（默认是最新版，也可显式指定）。若新版本效果下降，回滚就是「发布一个与旧版本等价的新版本」，之后新建的 Session 立刻用上它，无需部署。

学完本篇能够：

- 建一个返回 `version: 1` 的 Agent；
- 对某个版本用标注测试集打分；
- 发布 v2，看到版本号自增；
- **不改 Agent 当前版本，直接锁定历史版本做对比评测**；
- 把出现回归的 Agent 拉回 v1 行为，全程无需部署。

## 环境变量约定 <span id="h-pv-env" />

本篇 curl 示例统一使用以下变量：

```bash
AGENTSTUDIO_URL="https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio"
DASHSCOPE_API_KEY="<你的 DashScope API Key>"  # gitleaks:allow
AGENT_ID="agent_xxx"     # 创建 Agent 后回填
```

鉴权用 `Authorization: Bearer $DASHSCOPE_API_KEY`，一把 Key 覆盖工作空间内全部资源。当前区域仅 `cn-beijing`。模型 ID 用 `qwen3.8-max` / `qwen3.7-max` / `qwen3.7-plus`（本篇用 `qwen3.7-plus`，分类任务足够）。

<Note>
  本篇的 Agent 是纯 LLM 分类器（无工具调用），**不需要 Environment**——Session 不挂 `environment_id` 也能跑。只有要跑 bash / 读写文件的 Agent 才需要沙箱，见[入门：搭一个数据分析 Agent](managed-agents-data-analysis.md)。
</Note>

## 第一步：建 Agent（v1） <span id="h-pv-step1" />

system prompt 让 Agent 把每条工单分类到「团队 + 优先级」，只回一行 JSON：

```bash
curl -X POST "$AGENTSTUDIO_URL/agents" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "ticket-triage",
    "model": { "id": "qwen3.7-plus" },
    "system": "You are a support-ticket triage agent for a usage-billed API product.\nRead the ticket and respond with ONLY a single line of raw JSON (no code fences, no prose):\n{\"team\": \"<billing|auth|api-platform|dashboard>\", \"priority\": \"<P1|P2|P3>\"}\nRoute based on the customer'\''s actual problem, not surface keywords."
  }'
```

响应带 `version: 1`。之后每次 `POST /agents/{id}`（注意：**更新动词是 POST，不是 PATCH——PATCH 返回 405**；body 里 `name` 与当前 `version` 都是必填）都在同一个 `id` 下产生新版本，版本号自增；这个版本号就是后续绑定和回滚的依据。把响应的 `id` 填入 `AGENT_ID`。

## 第二步：加载标注测试集 <span id="h-pv-step2" />

评测 fixture 用下面 4 条工单（每团队 1 条；其中 T3 特意写成「提到 API 用量的账单问题」，为后面制造回归）：

```json
[
  { "id": "T1", "expected": "api-platform",
    "subject": "Error 429 Too Many Requests on POST /v1/chat",
    "body": "Hi, since this morning every request to POST /v1/chat returns HTTP 429 Too Many Requests even though our traffic pattern is unchanged. Did something change on the server side? Our request volume is the same as last week." },
  { "id": "T2", "expected": "auth",
    "subject": "OAuth token expired, cannot refresh",
    "body": "Our integration suddenly stopped working. The access token expired and the refresh call returns invalid_grant. We did not change any credentials on our side. Please help." },
  { "id": "T3", "expected": "billing",
    "subject": "Invoice amount does not match dashboard usage",
    "body": "My latest invoice shows API usage charges of $412 for July, but the usage report on the dashboard only adds up to $380. I checked every day of the month and the numbers do not reconcile. I need a corrected invoice." },
  { "id": "T4", "expected": "dashboard",
    "subject": "Usage chart on the dashboard is blank",
    "body": "When I open the analytics dashboard, the usage chart section renders as an empty white area in both Chrome and Safari. The rest of the dashboard works fine. This started after your latest UI update." }
]
```

这份测试集独立于 Agent，存在自己的评测脚本或数据文件里即可（每项含工单文本 + 期望团队）。

## 第三步：给 v1 打分（建立基线） <span id="h-pv-step3" />

对每条工单跑一遍 v1，得到基线成绩。每条工单的评测流程（下称 triage）如下：

1. 创建一个 Session（`agent` 传 Agent ID）；
2. 发一条 `message` 事件把工单内容送进去；
3. 轮询历史事件，直到 Session 回到 idle；
4. 收集 `assistant` 输出文本，解析出 JSON，与 ground truth 比对；
5. 删除 Session（评测完即删，不留痕）。

### Session 与 Agent 版本的绑定语义（重要） <span id="h-pv-binding" />

`agent` 字段有**两种传法**，决定了 Session 锁定哪个版本：

| `agent` 字段形式                              | 锁定的版本                                        |
| ----------------------------------------- | -------------------------------------------- |
| `"agent_xxx"`（字符串）                        | 创建那一刻的**最新**版本                               |
| `{ "id": "agent_xxx", "version": N }`（对象） | **显式指定的版本 N**；版本不存在则 `404 "Agent not found"` |
| `{ "id": "agent_xxx" }`（对象不带 version）     | 同字符串形式，锁最新                                   |

- Session 在整个生命周期内都使用这份快照，此后即使 Agent 继续升版，这条已存在的 Session 也不受影响；
- 顶层加 `version` 字段（与 `agent` 平级）**无效**——会被忽略，仍锁最新。

由此得出两条实践约定：

- **要评测任意历史版本**，直接传对象形式 `{id, version: N}`，不需要先把它变成「当前最新」（与直觉相反：评测历史版本无需先回滚）；
- **默认生产流量**走字符串形式锁最新版本，因此「生产用哪个版本」=「谁控制 Agent 的最新版本状态」。

### triage 的 REST 实现 <span id="h-pv-triage" />

先创建 Session（`agent` 传 Agent ID 字符串，锁定当前最新版本快照；纯 LLM Agent 无需 `environment_id`）：

```bash
curl -X POST "$AGENTSTUDIO_URL/sessions" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "'"$AGENT_ID"'",
    "title": "triage-eval"
  }'
```

<Note>
  Session 创建**无初始输入字段**（没有 `initial_events`），必须「先建 Session，再发一条 `message` 事件」两步走。
</Note>

拿到响应里的 `SESSION_ID` 后，发工单（把 `Subject: ...` 和正文拼进 text）：

```bash
curl -X POST "$AGENTSTUDIO_URL/sessions/$SESSION_ID/events" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": [
      { "type": "message", "role": "user",
        "content": [ { "type": "text", "text": "Subject: ...\n\n<工单正文>" } ] }
    ]
  }'
```

轮询历史事件，取最后一条，直到 Session 回到 idle：

```bash
curl -s "$AGENTSTUDIO_URL/sessions/$SESSION_ID/events?order=desc&limit=1" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY"
```

<Note>
  解析细节：判断结束看的 `session_status` / `stop_reason` 在 `session_status` 类型事件的 `content[0].data` 里（`{"stop_reason": {"type": "end_turn"}, "session_status": "idle"}`），不在事件顶层；顶层 `type` 为 `session_status` 即回合结束标记。建议设 60 秒超时。每条 triage 约 8\~11 秒。
</Note>

从 `assistant` 消息里拼接 `content` 文本、`json.loads` 解析出 `{"team", "priority"}`，与期望团队比对；最后删除 Session：

```bash
curl -X DELETE "$AGENTSTUDIO_URL/sessions/$SESSION_ID" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY"
```

也可以用 SSE 实时流（`GET /sessions/{id}/events/stream`，请求头 `Accept: text/event-stream`）替代轮询，按 `sequence_number` 累积流式文本；评测脚本里轮询更简单。归档（`POST /sessions/{id}/archive`）与删除二选一：评测循环里用 DELETE 更干净。

score 逻辑：对每条工单跑一次 triage，按团队统计「命中 / 总数」。

**v1 基线结果（4 条集，qwen3.7-plus）：**

| 团队           | 命中/总数                           |
| ------------ | ------------------------------- |
| api-platform | 1/1                             |
| auth         | 1/1                             |
| billing      | 1/1（T3 提到 API 用量，仍正确路由 billing） |
| dashboard    | 1/1                             |

## 第四步：发布 v2 <span id="h-pv-step4" />

PM 想加一条路由规则：凡是提到 API 用量、限流、配额、请求量的工单，都路由到平台团队。用 `POST /agents/{id}` 更新 system prompt（`name` + 当前 `version` 必填），即产生 v2。

新的 system prompt = v1 的内容，追加：

```plaintext
ROUTING RULE: If the ticket text mentions API usage, rate limits, quotas, or request volume, route to api-platform. Apply this rule before any other consideration; do not second-guess it based on the rest of the ticket.
```

```bash
curl -X POST "$AGENTSTUDIO_URL/agents/$AGENT_ID" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "ticket-triage",
    "version": 1,
    "system": "You are a support-ticket triage agent for a usage-billed API product.\nRead the ticket and respond with ONLY a single line of raw JSON (no code fences, no prose):\n{\"team\": \"<billing|auth|api-platform|dashboard>\", \"priority\": \"<P1|P2|P3>\"}\nRoute based on the customer'\''s actual problem, not surface keywords.\n\nROUTING RULE: If the ticket text mentions API usage, rate limits, quotas, or request volume, route to api-platform. Apply this rule before any other consideration; do not second-guess it based on the rest of the ticket."
  }'
```

响应的 `version` 会变成 `2`。

## 插曲：代码评审去哪了？ <span id="h-pv-review" />

一次 API 调用就改了 Agent，中间没有任何评审——做 demo 没问题，生产不行。`POST /agents/{id}` 本身没有内建审批流；工作空间里任何一把 Key 都能调它。而字符串形式创建的 Session 锁定的是当时的最新版本，**这意味着升版之后新建的第一个 Session 就会用上新提示词**。这跟用 feature flag、或任何「经 API 而非代码管理的 config」是一回事。

**恢复评审的推荐模式：**

- 让「生产该用哪个版本」成为一份受变更管控的产物——例如在自己的部署配置里显式记录目标版本号；
- 任何人都可以建 v2 / v3 / v10，这些版本只是躺在服务端、不接生产流量；
- 「晋升」= 更新那份「告诉生产用哪个版本」的 config，这个 config 更新走正常的代码评审流程。进阶做法：生产侧创建 Session 时直接传 `{id, version}` 对象锁定受控版本号，连「Agent 的最新版本」都不必依赖。

落地要点：默认流量（字符串形式）绑定「创建时刻的最新版本快照」，因此「生产用哪个版本」应落在**对 Agent 最新版本的发布控制**上——谁有权限更新 Agent、何时把某个配置发布为当前最新版本。建版本很廉价，SDLC 依然完整。

## 第五步：给 v2 打分 <span id="h-pv-step5" />

用同一套评测跑 v2。有两种做法：

- **默认做法**：此时 v2 已是最新版本，直接用字符串形式建 Session（锁 v2）；
- **对比评测**：Agent 的版本完全不用动——传对象形式分别锁定 `{id, version: 1}` 和 `{id, version: 2}` 各跑一遍，随时对比任意两个历史版本的行为。

结果（默认形式，v2 为最新）：新规则太宽——T3 是一个按量计费 API 产品的**账单**工单，正文提到 "API usage charges"，被 ROUTING RULE 抢到了平台团队：

**v2 结果：**

| 团队           | 命中/总数                             |
| ------------ | --------------------------------- |
| api-platform | 1/1                               |
| auth         | 1/1                               |
| billing      | 0/1（**回归！** T3 被路由到 api-platform） |
| dashboard    | 1/1                               |

## 第六步：回滚 <span id="h-pv-step6" />

`billing` 出现回归。v1 的配置仍完整保留在服务端，回滚不需要重新部署代码。

<strong>回滚做法：发布一个与 v1 等价的新版本。</strong>默认流量（字符串形式）绑定「创建时刻的最新版本」，所以要让生产行为回到 v1，就把 v1 的 system prompt 原样再发一次 `POST /agents/{id}`，产生 v3（版本号继续自增，配置等价于 v1）：

```bash
curl -X POST "$AGENTSTUDIO_URL/agents/$AGENT_ID" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "ticket-triage",
    "version": 2,
    "system": "You are a support-ticket triage agent for a usage-billed API product.\nRead the ticket and respond with ONLY a single line of raw JSON (no code fences, no prose):\n{\"team\": \"<billing|auth|api-platform|dashboard>\", \"priority\": \"<P1|P2|P3>\"}\nRoute based on the customer'\''s actual problem, not surface keywords."
  }'
```

若只是想查看某个历史版本的配置内容以便确认要回滚到什么，用 `GET /agents/{id}/versions`（见文末）。

用「回到 v1 提示词」的 v3 重跑失分的 T3：`billing` 恢复正确路由。

由于所有版本都在服务端留存：

- v2 仍可继续迭代修复（直接以 v2 为蓝本发 v4，或用 `{id, version: 2}` 锁定评测）；
- 生产可以先留在 v3，或用小流量金丝雀——一部分请求传 `{id, version: N}` 试新版本，其余走默认最新；
- 修好后建一个新版本，走同样的评测 → 晋升流程。

## 清理 <span id="h-pv-cleanup" />

```bash
curl -X POST "$AGENTSTUDIO_URL/agents/$AGENT_ID/archive" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY"
```

<Note>
  用 archive（归档）而非删除：**Agent 不支持 DELETE（返回 405）**，归档保留审计记录、拆掉容器、停止计量；版本历史是它存在的意义。评测用的 Session 在循环里已即时 DELETE。
</Note>

## 小结 <span id="h-pv-summary" />

机制本身很小——建版本、更新升版、把生产锁到某个版本、必要时再切回去——但一旦提示词变成「版本化的服务端资源」，它就能独立于应用代码被评测和晋升。要点：

- **生产要用哪个版本，应是一份受控产物**：把它当作提示词变更的闸门，走正常评审；
- **高风险 Agent 先用小流量灰度新版本，再全量**（配合 `{id, version}` 显式锁定做分流）；
- **理解版本绑定语义**：字符串形式锁最新、对象形式 `{id, version}` 锁指定版本（不存在则 404）、顶层 `version` 字段无效；已建立的 Session 不受后续升版影响；
- **评测历史版本不需要先回滚**——对象形式直接锁定任意版本对比；回滚是为了让**默认流量**恢复旧行为。

## 附：列出全部版本 <span id="h-pv-versions" />

查看某个 Agent 的全部历史版本：

```bash
curl -s "$AGENTSTUDIO_URL/agents/$AGENT_ID/versions" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY"
```

响应结构（版本按新到旧排列）：

```json
{
  "data": [
    {
      "agent_id": "agent_xxx",
      "version": 3,
      "created_at": "2026-09-01T22:24:55+08:00",
      "config": {
        "name": "ticket-triage",
        "model": { "id": "qwen3.7-plus" },
        "system": "<该版本的完整 system prompt>",
        "tools": [ ], "mcpServers": [ ], "skills": [ ],
        "metadata": {}, "status": "...",
        "workspaceId": "...", "userId": "...",
        "gmtCreate": "...", "gmtModified": "...", "id": "...", "version": 3
      }
    }
  ],
  "next_page": null,
  "request_id": "..."
}
```

注意 `config` 是**内部存储格式的直出**：字段用驼峰（`mcpServers`、`workspaceId`、`gmtCreate`），与创建 API 的 snake\_case 不同；每版都带完整 `system` 与 `created_at`，可用于审计、对比历史提示词，以及决定把哪个版本晋升为生产版本。

## 下一步 <span id="h-pv-next" />

- [进阶：多智能体定制复杂提案](managed-agents-multiagent-proposal.md)：roster 成员的版本锁定语义与这里的 Session 锁定是对偶的。
- [进阶：生产化定时晨报机器人](managed-agents-production.md)：Deployment 的版本锁定与漂移陷阱。
- [配置智能体](managed-agents-agent-definition.md)：版本与更新语义的控制台视角。
