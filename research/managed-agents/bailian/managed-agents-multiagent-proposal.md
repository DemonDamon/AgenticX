---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/managed-agents-multiagent-proposal
fetched: 2026-10-23
title: 进阶：多智能体定制复杂提案
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 进阶：多智能体定制复杂提案

> 用 multiagent 协调者模式组织专家子 Agent 团队协作产出销售提案，用 Session Threads API 与线程级事件流精确观察每个子 Agent 的运行。

<meta property="og:title" content="进阶：多智能体定制复杂提案" />

## 概述 <span id="h-mp-intro" />

本篇介绍如何用 Managed Agents 的 `multiagent` 协调者模式，组织一支专家子 Agent 团队协作产出一份销售提案，并用 Session Threads API 与 Session 级事件流精确观察、实时渲染每个子 Agent 的运行。示例统一用 curl（REST）。

场景：虚构公司 Northstar（向中端市场运营团队卖工作流自动化平台）要自动写销售提案。现状：销售代表为每个潜客手工做定制提案——调研该细分领域公司通常关注什么、从案例库里挑两个相关案例、按内部规则表算定价、拼成两页文档。每步用不同数据源、不同判断。

用一个协调者 Agent 跑三个专家：研究员用联网搜索找该细分市场的典型关注点；案例挑选器读案例库挑两个最佳匹配；定价建模员只看规则文件和席位数。再加一个校验员，在协调者动笔前做一次对齐自检。协调者负责排序它们并写出提案。

## 环境变量与模型 <span id="h-mp-env" />

```bash
export AGENTSTUDIO_URL="https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio"
export DASHSCOPE_API_KEY="<你的 DashScope API Key>"  # gitleaks:allow
```

所有请求带 `Authorization: Bearer $DASHSCOPE_API_KEY`。多智能体的 `multiagent` 配置与 Session 事件流属于 Managed Agents 能力，当前仅 `cn-beijing`。

模型 ID 用 `qwen3.8-max` / `qwen3.7-max` / `qwen3.7-plus`。roster 里每个成员都是完整 Agent，**可按角色混用不同模型**——高价值的写作/协调用旗舰模型，机械的读文件、套规则可换更廉价的模型档位，用不同模型 ID 区分成本即可。本例统一用 `qwen3.7-plus` 演示。

多智能体场景的两个高频问题，先放在最前面：

<Warning>
  **联网搜索的选型**。本例研究员走 MCP 市场的搜索服务（`WebSearch`，工具名 `bailian_web_search`）；内置工具集的 `web_search` / `web_fetch` 也能覆盖联网检索。两条路都行，但注意 `mcp_toolkit` 的工具名与内置工具不同，system prompt 里引用的工具名要和实际启用的对上。
</Warning>

<Warning>
  **`default_config.enabled: true` 不会把工具发给模型**。`builtin_toolkit` / `mcp_toolkit` 都必须在 `configs[ ]` 里逐工具显式 `enabled: true`，否则 agent 仅能获得平台自动注入的 `mark_artifacts`（见[入门篇](managed-agents-data-analysis.md)，多智能体成员同样适用）。
</Warning>

## 定义三个专家子 Agent <span id="h-mp-workers" />

每个子 Agent 有自己的 system prompt、输出形态，且**只给它需要的工具**。研究员只有搜索；案例挑选器只能读本地库；定价建模员只看 `pricing_rules.md`。按角色限定工具，能防止定价员从网上拉竞品数字，也把整个案例库挡在协调者上下文之外。

阿里云百炼的编排工具由平台在 multiagent 模式下**自动注入**，无需在 `tools` 里声明（协调者拿到 `create_agent` / `list_agents` / `wait_for_agents`，worker 拿到 `submit_result`）。

<Note>
  下面每个 `POST /agents` 返回的 `id`（形如 `agent_<ULID>`）请记下来，后面拼进协调者的 roster。
</Note>

### 研究员 prospect\_researcher（只开搜索 MCP） <span id="h-mp-researcher" />

```bash
curl -X POST "$AGENTSTUDIO_URL/agents" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "prospect_researcher",
    "description": "Researches what companies in a given industry segment and size tier typically prioritize.",
    "model": { "id": "qwen3.7-plus" },
    "system": "你是行业研究员。收到潜客的行业细分与规模档后，用 bailian_web_search 工具搜索：该细分的战略优先级、近期动作/趋势、常见运营痛点。完成后返回严格 JSON：{\"priorities\":[...],\"recent_moves\":[...],\"pain_points\":[...],\"sources\":[...]}。只做调研，不写提案。",
    "mcp_servers": [ { "type": "official", "name": "WebSearch" } ],
    "tools": [
      { "type": "builtin_toolkit", "default_config": { "enabled": false },
        "configs": [ { "name": "read", "enabled": true } ] },
      { "type": "mcp_toolkit", "mcp_server_name": "WebSearch",
        "default_config": { "enabled": true },
        "configs": [ { "name": "bailian_web_search", "enabled": true } ] }
    ]
  }'
```

`mcp_servers.name` 是市场服务的 code（声明时不校验存在性，写错会静默失败，[生产化篇](managed-agents-production.md)讲过排查方法）。市场服务由平台代理调用，不需要提供凭证。想确认某服务提供哪些工具名：`bl mcp tools --server WebSearch`。

### 案例挑选器 case\_study\_picker（只读本地库） <span id="h-mp-picker" />

```bash
curl -X POST "$AGENTSTUDIO_URL/agents" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "case_study_picker",
    "description": "Selects the two most relevant case studies for a given prospect.",
    "model": { "id": "qwen3.7-plus" },
    "system": "案例库在 /mnt/session/uploads/case_studies/，每个文件是一个客户故事。收到潜客的行业/规模/优先级后，读遍案例库，按与潜客优先级的契合度打分，挑出最匹配的两个。返回严格 JSON：{\"picks\":[{\"file\":...,\"customer\":...,\"why_relevant\":...},...]}。你只能读本地文件，不联网。",
    "tools": [
      { "type": "builtin_toolkit", "default_config": { "enabled": false },
        "configs": [
          { "name": "read", "enabled": true },
          { "name": "glob", "enabled": true },
          { "name": "grep", "enabled": true }
        ] }
    ]
  }'
```

### 定价建模员 pricing\_modeler（只看规则文件） <span id="h-mp-modeler" />

```bash
curl -X POST "$AGENTSTUDIO_URL/agents" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "pricing_modeler",
    "description": "Builds two or three pricing options from the rules file and a seat count.",
    "model": { "id": "qwen3.7-plus" },
    "system": "定价规则在 /mnt/session/uploads/pricing_rules.md。收到席位数与用量档后，只依据规则文件建三档：保守（年付、低单价）、灵活（月付、高单价）、若席位>500 追加企业选项（含平台费）。每档给出首年总价。返回严格 JSON：{\"options\":[{\"name\":...,\"structure\":...,\"year_one_total\":...},...]}。禁止联网，禁止引用外部竞品价格。",
    "tools": [
      { "type": "builtin_toolkit", "default_config": { "enabled": false },
        "configs": [ { "name": "read", "enabled": true } ] }
    ]
  }'
```

## 再加一个校验员：写作前的方案自检 <span id="h-mp-checker" />

三个专家各自只给出局部结论，无人负责判断「三份结论合起来是否自洽」。所以 roster 里再额外放一个 `proposal_checker` 子 Agent：它在协调者动笔之前，把关案例挑选与定价框架是否对齐潜客优先级。

它由协调者在写提案前委派一次，读取研究结论、案例挑选、定价框架，判断三者是否互相自洽、是否命中潜客最关心的痛点，然后回传一句判断和修改建议。它是一个和其他专家一样的普通 worker：可被委派、可收发消息、跑在自己的线程和上下文里。

```bash
curl -X POST "$AGENTSTUDIO_URL/agents" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "proposal_checker",
    "description": "Sanity-checks whether the picked case studies and pricing framework match the prospect priorities before writing.",
    "model": { "id": "qwen3.7-plus" },
    "system": "你是提案校验员，在协调者动笔前做一次对齐检查。收到：潜客画像与优先级、已选的两个案例、定价三档框架。判断：所选案例是否命中潜客最关心的痛点？定价档位与席位/用量档是否自洽？有无与优先级脱节之处？返回严格 JSON：{\"aligned\":true|false,\"issues\":[...],\"suggestions\":[...]}。你只做判断，不改稿、不写提案。",
    "tools": [ ]
  }'
```

<Note>
  校验员是纯判断，不挂任何工具（`tools` 留空数组即可，[进阶：提示词版本管理与回滚](managed-agents-prompt-versioning.md)已验证无工具的纯 LLM agent 可以正常跑）。它承担判断类工作，可以把 `model.id` 设成比其他 worker 更强的模型来提高判断质量——能力与成本分档通过选用不同模型 ID 实现，`model` 字段没有 effort 之类的推理档位参数。
</Note>

<Note>
  `multiagent.agents[ ]` 的成员类型：`{"type":"agent","id":...}` 引用一个已创建的子 Agent，可选带 `version` 锁定版本（见下节）；`{"type":"self"}` 把协调者自己也作为可委派对象，**最多 1 个**——写两个会报 `AGENT_010 multiagent.agents 中 self 类型最多只能有一个`。
</Note>

## 为团队准备素材并配置协调者 <span id="h-mp-wiring" />

### 素材清单 <span id="h-mp-assets" />

**7 个短案例**（覆盖医疗/制造/物流/零售/金融/公共部门），能看到挑选器挑出适配潜客的两个。每个案例含 title/industry/employees/summary：

- **St. Clair Health**：区域医院网 6200 人，凭证与预授权流程分散在 11 个系统 → 合并成 3 个自动化流程，预授权周转降 58%，年省 190 万。
- **BlueRidge Health Plan**：区域支付方 2800 人，理赔异常排队邮件 19% 需返工 → 异常路由端到端自动化，返工率降到 6%，理赔平均快 11 天。
- **Calder Manufacturing**：工业 3100 人，采购单审批平均 9 天 → PO 周期降到 2.1 天，冒进支出降 14%。
- **Northwind Logistics**：3PL 4400 人，承运商入驻每家 3 周 → 降到 4 天，Q1 多激活 22% 承运商。
- **Harborview Retail Group**：专业零售 5600 人，门店库存异常靠 Slack+表格 → 140 店异常分诊自动化，缺货降 31%。
- **Aperture Payments**：金融 1900 人，KYC 与商户入驻平均 6 个工作日 → SLA 降到 36 小时，同人力吞吐 2.4 倍。
- **Summit County Government**：公共部门 3700 人，建筑许可纸质包过五部门 → 单一数字入口并行评审，中位许可时长 41 → 17 天。

**产品与定价素材**：

- **PRODUCT one-pager**：Northstar 是给中端运营团队的工作流自动化平台，核心能力——可视化流程构建、200+ SaaS 连接器、基于角色审批、SOC 2 Type II；典型效果 40–60% 人工工单下降、3 周首个工作流上线。
- **PRICING rules**：每席位 65/月，或年付 52/月；用量档 light 1.0x / standard 1.15x / heavy 1.30x 乘在单价上；企业档（>500 席位）加 48000/年平台费、年付单价降到 44/月；所有选项含 onboarding，企业档含专属 CSM。

### 上传 9 个文件 <span id="h-mp-upload" />

把 7 个案例 md、`product_one_pager.md`、`pricing_rules.md` 逐个上传。上传用 multipart，上传后须轮询 `GET /files/{id}` 到 `status=available` 才能挂载。

```bash
# 逐个上传，示例一个案例文件
curl -X POST "$AGENTSTUDIO_URL/files" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -F "file=@st_clair_health.md"
# 响应里拿 file_id，轮询：
# curl "$AGENTSTUDIO_URL/files/<file_id>" -H "Authorization: Bearer $DASHSCOPE_API_KEY"  → status=available
```

对 9 个文件重复，记下各自 `file_id`。

### 建 Environment（沙箱） <span id="h-mp-env2" />

```bash
curl -X POST "$AGENTSTUDIO_URL/environments" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "northstar-proposal-env",
    "config": {
      "type": "cloud",
      "networking": { "type": "unrestricted" }
    }
  }'
```

<Note>
  研究员的 MCP 搜索由平台代理调用、不走沙箱网络，但挑选器/定价员要读挂载文件（沙箱工具），所以 Environment 仍然需要。`networking.type` 当前取值为 `unrestricted`（全部出网放行）。响应 `id` 形如 `env_<...>`。
</Note>

### 建协调者 Agent（挂 roster） <span id="h-mp-coordinator" />

协调者引用上面四个子 Agent（三专家 + 校验员）：

```bash
curl -X POST "$AGENTSTUDIO_URL/agents" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "proposal_coordinator",
    "description": "Assembles a tailored sales proposal by orchestrating specialists.",
    "model": { "id": "qwen3.7-plus" },
    "system": "你是提案协调者，负责组装一份定制销售提案。给你潜客名和画像后，按顺序编排团队：\n1) 把行业和规模发给 prospect_researcher。\n2) 研究员回来后，把行业/规模/优先级发给 case_study_picker。\n3) 把席位数和用量档发给 pricing_modeler。\n4) 在动笔前，把研究结论、案例挑选、定价框架一起发给 proposal_checker 做对齐校验。若校验发现不对齐，据其 suggestions 调整案例或定价档再继续。\n5) 读 /mnt/session/uploads/product_one_pager.md，然后写 /mnt/session/outputs/proposal.md，包含：Executive summary（贴合潜客优先级）/ How we help（来自 one-pager）/ Proof（两个案例）/ Investment（定价选项）/ Next steps。控制在两页以内。\n你自己不做专家工作，只负责决定顺序、交接和最终写作。",
    "tools": [
      { "type": "builtin_toolkit", "default_config": { "enabled": false },
        "configs": [
          { "name": "read",  "enabled": true },
          { "name": "write", "enabled": true }
        ] }
    ],
    "multiagent": {
      "type": "coordinator",
      "agents": [
        { "type": "agent", "id": "<agent_id_prospect_researcher>" },
        { "type": "agent", "id": "<agent_id_case_study_picker>" },
        { "type": "agent", "id": "<agent_id_pricing_modeler>" },
        { "type": "agent", "id": "<agent_id_proposal_checker>" }
      ]
    }
  }'
```

协调者拿到的 `id`（`agent_<ULID>`）记为 `$AGENT_ID`。

<Note>
  **roster 成员的版本语义**：「不带 version」既不是在协调者创建时快照定版，也不是在 Session 创建时定版——协调者不动、把 pricing\_modeler 从 v1 升到 v2 后起 Session，委派出来的 pricing 线程直接用 v2；Session 创建后再升 v3、随后才发消息，线程用的还是 v3。也就是说**改子 Agent 不需要更新协调者**；反过来，想要「团队配置冻结、可复现」，就在成员里显式写 `version`，平台会接受并回显（GET 协调者时成员对象带 `version: N`）。这个语义跟[进阶：提示词版本管理与回滚](managed-agents-prompt-versioning.md)讲的 Session 版本锁定是对偶的：Session 的 `agent` 字段锁协调者自身的版本快照，roster 的 `version` 锁成员引用；都不写就都是「拿最新」。
</Note>

### 起 Session（挂 9 个文件资源） <span id="h-mp-session" />

`mount_path` **必须以 `/uploads/` 开头**，沙箱内实际路径为 `/mnt/session` + mount\_path。7 个案例挂到 `/uploads/case_studies/<slug>.md`，另两个挂到 `/uploads/` 根。指令文本里写的都是**实际路径** `/mnt/session/uploads/...`。

```bash
curl -X POST "$AGENTSTUDIO_URL/sessions" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "'"$AGENT_ID"'",
    "environment_id": "'"$ENV_ID"'",
    "title": "Meridian Health proposal",
    "resources": [
      { "type": "file", "file_id": "<file_st_clair>",   "mount_path": "/uploads/case_studies/st_clair_health.md" },
      { "type": "file", "file_id": "<file_blueridge>",  "mount_path": "/uploads/case_studies/blueridge_health_plan.md" },
      { "type": "file", "file_id": "<file_calder>",     "mount_path": "/uploads/case_studies/calder_manufacturing.md" },
      { "type": "file", "file_id": "<file_northwind>",  "mount_path": "/uploads/case_studies/northwind_logistics.md" },
      { "type": "file", "file_id": "<file_harborview>", "mount_path": "/uploads/case_studies/harborview_retail.md" },
      { "type": "file", "file_id": "<file_aperture>",   "mount_path": "/uploads/case_studies/aperture_payments.md" },
      { "type": "file", "file_id": "<file_summit>",     "mount_path": "/uploads/case_studies/summit_county_gov.md" },
      { "type": "file", "file_id": "<file_product>",    "mount_path": "/uploads/product_one_pager.md" },
      { "type": "file", "file_id": "<file_pricing>",    "mount_path": "/uploads/pricing_rules.md" }
    ]
  }'
```

<Note>
  字段就叫 `agent`（对象只传 `id` 即锁定该 Agent 当前最新版本快照；要锁旧版本传 `{"id": ..., "version": N}`）。响应里 `agent` 字段回显的是**完整配置快照**（含 system 与 tools，但不含 multiagent——roster 不进 Session 快照，成员版本按上表规则在委派时解析）。另外注意：`resources[ ]` 回显的 `file_id` 与提交的不同——挂载时平台为每个文件生成了 session 作用域的新 file id，原 upload id 仍然有效。响应 `id` 形如 `sesn_<ULID>`，记为 `$SESSION_ID`。
</Note>

## 启动提案并观察 <span id="h-mp-run" />

Session 创建时不携带初始输入，所以流程是**先建 Session、再发一条 `message` 事件**驱动它开始工作。

```bash
curl -X POST "$AGENTSTUDIO_URL/sessions/$SESSION_ID/events" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": [
      { "type": "message", "role": "user",
        "content": [ { "type": "text", "text": "Build a proposal for Meridian Health, a regional healthcare system with ~8500 employees. Estimate 600 seats at heavy usage. Write to /mnt/session/outputs/proposal.md." } ] }
    ]
  }'
```

潜客画像：**Meridian Health**，区域医疗系统，8500 员工，估 **600 席位**，**heavy** 用量。

整个流程约 4 分钟：协调者先委派研究员（联网搜 6 次），研究员回传后并行委派挑选器（glob + read×N 遍历案例库）与定价员（read 规则文件），最后委派校验员，然后读 one-pager、写 proposal.md（迭代了 4 稿——校验员的建议直接驱动了改稿）、`mark_artifacts` 登记产物。

### 流式观察（Session 级单流，按 thread\_id 分流） <span id="h-mp-sse" />

SSE 是 **Session 级单流**——协调者与全部子 Agent 的输出都汇聚到同一条流里。**没有 thread 级的 SSE 端点**：`GET /sessions/{sid}/threads/{tid}/events/stream` 返回 `404 {"type":"api_error","message":"not support"}`。想流式看，只有 Session 这一条流；想只看某个 thread，用下节的 Thread Events 轮询。

```bash
curl -N "$AGENTSTUDIO_URL/sessions/$SESSION_ID/events/stream" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Accept: text/event-stream"
```

先收 `:connected`，再收 `event: message` 帧（夹带 `:keepalive`）。**每条事件顶层都带 `thread_id`**，这是分流键：协调者主线程是 `thrd_` 前缀（primary thread），每个被委派的子 Agent 是一个 `sthr_` 前缀的 Session Thread。

多智能体专属的四种事件类型：

- **`thread_created`**：某子线程出现。`thread_id` 是新的 `sthr_...`，`content[0].data` 为 `{"agent_name": "prospect_researcher", "session_thread_id": "sthr_..."}`。
- **`thread_message_sent`**：一条消息从某线程发出。发送方的 `thread_id`（协调者是 `thrd_`、worker 是 `sthr_`），`content[ ].text` 是消息本体，`metadata.to_session_thread_id` / `to_agent_name` 指向接收方。
- **`thread_message_received`**：对端视角的同一条消息。`thread_id` 是接收方线程，`metadata.from_session_thread_id` / `from_agent_name` 指向发送方（协调者发来的消息 `from_agent_name` 是 `"coordinator"`）。
- **`thread_status`**：线程状态流转。`content[0].data` 为 `{"agent_name": ..., "thread_status": "running"|"idle", ...}`，结束时带 `stop_reason: {"type": "end_turn"}`。

常规事件（`tool_call` / `tool_call_output` / `mcp_call` / `mcp_call_output` / `model_request_start|end` / `reasoning` / `message` / `session_status`）与[入门篇](managed-agents-data-analysis.md)相同，只是全部带上了 `thread_id`。协调者被自动注入的编排工具在事件流中的形态如下：

```jsonc
// 协调者委派（主线程 thrd_ 上）
{ "type": "tool_call", "thread_id": "thrd_...",
  "content": [ { "type": "data", "data": {
      "name": "create_agent",
      "arguments": { "name": "prospect_researcher", "task": "Research what a regional ..." } } } ] }
// 协调者轮询等待与查询
{ "name": "wait_for_agents", "arguments": {} }
{ "name": "list_agents",     "arguments": {} }
// worker 侧（sthr_ 线程上）正式提交结果
{ "name": "submit_result", "arguments": { "content": "{\"picks\":[...]}" } }
// submit_result 的 output
{ "output": "{\"status\":\"submitted\"}" }
```

<Note>
  **worker 的回传通道**：worker 的最终 assistant 文本会自动作为 `thread_message_sent` 回传协调者；`submit_result` 是另一个显式提交工具，二者可能先后各出现一次。**子 Agent 的 system prompt 里不需要写「通过 send\_to\_parent 返回」这类话**——没有叫这个名字的工具，写了反而可能让模型犹豫；直接说「返回严格 JSON」即可。
</Note>

<Note>
  若不想用长连接，也可轮询历史事件：`GET /sessions/$SESSION_ID/events?order=asc`。注意**单页上限 100 条**（`limit` 传更大也只回 100），翻页用响应里的 `next_page` 游标：`...&page=<next_page>`。一个完整的多智能体回合有 168 条事件，要翻两页。
</Note>

### Session Threads API：每个子 Agent 一行 <span id="h-mp-threads" />

多智能体的结构化观察不走事件流也行——**Session Threads** 四个端点直接给线程级的清单、详情、事件与归档（这组 API 尚未进入正式公开文档）：

**List：** `GET /sessions/{session_id}/threads`

```bash
curl "$AGENTSTUDIO_URL/sessions/$SESSION_ID/threads" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY"
```

```json
{
  "data": [
    {
      "id": "sthr_xxx",
      "type": "session_thread",
      "session_id": "sesn_xxx",
      "parent_thread_id": "thrd_xxx",
      "agent": { "id": "agent_xxx", "version": 1 },
      "status": "running",
      "created_at": "2026-09-01T15:00:39Z",
      "updated_at": "2026-09-01T15:01:00Z",
      "archived_at": null
    }
  ],
  "request_id": "req_..."
}
```

每个 Thread 对应一个被委派的子 Agent 实例。关键字段：

- `parent_thread_id`：委派者线程。挂在协调者主线程下是 `thrd_...`；若某个 worker 又委派了自己的子 Agent，那条线程的 parent 会是前者的 `sthr_...`（多级委派）。
- `agent.version`：**这条线程实际运行的成员版本**——上一节表格里说的「不带 version 就在委派时拿最新」，在这里直接可查。roster 没锁版本、子 Agent 中途升了 v2，新 Session 里这一栏就是 v2。
- `status`：`running` / `idle` / `terminated`。跑批时轮询这个端点，就是一张实时的「子 Agent 工作台」。

Query 参数 `limit` / `page` 与其他列表一致；已归档 Thread 默认不返回。

**Get：** `GET /sessions/{session_id}/threads/{thread_id}`——单个 Thread 详情，字段与 List 一致（多一个 `request_id`）。两个边界：**协调者主线程（`thrd_` 前缀）不在 threads 集合里**，用它的 id 去 GET 返回 `400 invalid_parameter "Invalid request"`——threads 资源只寻址被委派的子线程，主线程只是事件流上的一个 `thread_id` 值；**已归档的 Thread 也返回同样的 400**（List 里同样没有它）——归档即从可寻址空间移除，但 Thread 的事件仍然可查（见下）。

**Events：** `GET /sessions/{session_id}/threads/{thread_id}/events`——单线程的事件序列，就是上一节那条流按 `thread_id` 切好的一片：从 `thread_created`（收到任务）到 `thread_status`（idle + stop\_reason），中间是它自己的模型调用与工具调用。不带 `limit` 时返回该线程全部事件；带 `limit` 时响应带 `next_page` 游标。**这是「只看某个子 Agent 干了什么」的最短路径**——不用再从 168 条 Session 事件里按 thread\_id 过滤。

**Archive：** `POST /sessions/{session_id}/threads/{thread_id}/archive`

```bash
curl -X POST "$AGENTSTUDIO_URL/sessions/$SESSION_ID/threads/sthr_xxx/archive" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

body 可省略。成功返回归档后的 Thread 对象（`archived_at` 填充、`updated_at` 刷新），之后 List 不再返回它；重复归档幂等。用途：长会话里清掉历史 worker 线程，让 threads 列表只留活跃的——事件数据不受影响。

### 各专家回传了什么 <span id="h-mp-returns" />

用 Thread Events 遍历四个子线程的 `thread_message_sent`（或 `submit_result` 的 `arguments.content`），能拿到每个专家的原始 JSON：

- 研究员：`priorities` / `pain_points` / `sources`——外部情报（6 次 `bailian_web_search`，事件流里是 `mcp_call` / `mcp_call_output`，`server_label` 为 `WebSearch`）。
- 挑选器：`picks`——先 `glob` 列目录、再 `read` 全部案例、打分挑两个（典型结果：St. Clair Health + Aperture Payments，医疗行业优先，完全正确）。
- 定价员：`options`——`read` 规则文件后按 600 席位 × heavy 1.30x 计算（保守档 \$486,720 = 52 × 1.3 × 600 × 12，与规则文件严丝合缝）。
- 校验员：`aligned` / `issues` / `suggestions`——一句对齐判断加修改建议。

三个报告差异很大——研究员是外部情报，挑选器是本地案例打分，定价员是纯规则计算，校验员是一句对齐判断。**每个子 Agent 在自己线程里只用自己的工具**，这就是按角色分权的直接证据。

### 客户端：把一条流渲染成团队工作台 <span id="h-mp-client" />

前三节讲的是服务端给的观察面。客户端要消费这条流，核心只有一个数据结构——**以 `thread_id` 为键的分桶字典**，再配合四个行为，渲染逻辑比想象的简单：

1. **去重按事件 `id`**。SSE 不提供游标 / 续传 token，断线重连后新连接可能重放旧帧，按 `id` 去重即可。
2. **assistant 文本整条下发，无需拼接增量**。流式文本以整条 `completed` 消息一帧到位，`sequence_number` 常为 `null`、没有同 id 多帧增量；解析时按「有 `sequence_number` 就按序累积、没有就当整条」处理。多智能体的「实时感」主要来自结构性事件：`thread_created`（线程启动）、`thread_status`（线程结束）、`mcp_call` / `tool_call`（线程执行的动作）。
3. **`session_status` 是唯一的会话级事件**。本回合仅有的 2 条不带 `thread_id` 的事件就是它（running 与 idle+stop\_reason），分流时当会话状态处理，不属于任何线程。
4. **主线程没有 `thread_created`**。`thrd_` 在流开始之前就存在了——首次见到某个 `thrd_` 事件时把它注册成 coordinator 即可。

把这四条拼起来，就是一个约 50 行的团队工作台：

```python
#!/usr/bin/env python3
# watch_team.py — 把一条 Session 级流渲染成团队工作台
# 用法：curl -N "$AGENTSTUDIO_URL/sessions/$SESSION_ID/events/stream" \
#         -H "Authorization: Bearer $DASHSCOPE_API_KEY" -H "Accept: text/event-stream" \
#       | python3 watch_team.py
import json, sys

threads = {}   # thread_id -> {name, status, last}
seen = set()   # 事件 id 去重（断线重连后新流可能重放旧帧）

def feed(line):
    d = json.loads(line)
    if d.get("id") in seen:
        return
    seen.add(d.get("id"))
    t, typ = d.get("thread_id"), d.get("type")      # session_status 没有 thread_id

    if typ == "session_status":                      # 会话级事件
        s = (d.get("content") or [{}])[0].get("data", {}).get("session_status")
        print(f"=== 会话 {s} ===")
        return
    if typ == "thread_created":                      # 子线程出生，带 agent_name
        name = (d.get("content") or [{}])[0].get("data", {}).get("agent_name")
        threads[t] = {"name": name, "status": "running", "last": ""}
        print(f"[{name}] 开工")
        return
    if t not in threads:                             # 主线程没有 thread_created
        if not (t and t.startswith("thrd_")):
            return
        threads[t] = {"name": "coordinator", "status": "running", "last": ""}
    if typ == "thread_status":
        s = (d.get("content") or [{}])[0].get("data", {}).get("thread_status")
        threads[t]["status"] = s
        print(f"[{threads[t]['name']}] {s}")
    elif typ in ("tool_call", "mcp_call"):           # 实时感的主要来源
        data = (d.get("content") or [{}])[0].get("data", {})
        print(f"[{threads[t]['name']}] {data.get('name', typ)}")
    elif typ == "message" and d.get("role") == "assistant":
        threads[t]["last"] = "".join(c.get("text", "") for c in d.get("content") or [ ])
        print(f"[{threads[t]['name']}] {threads[t]['last'][:80]!r}")

for ln in sys.stdin:                                 # 每帧一行 data:{...}
    ln = ln.rstrip("\n")
    if ln.startswith("data:"):
        feed(ln[5:])
```

对应该回合的团队实时输出时序（节选）：

```plaintext
=== 会话 running ===
[coordinator] '好的，我来按流程协调团队为 Meridian Health 构建销售提案。…'
[prospect_researcher] 开工
[coordinator] create_agent
[prospect_researcher] bailian_web_search        ×6
[prospect_researcher] submit_result
[prospect_researcher] idle
[case_study_picker] 开工
[pricing_modeler] 开工
[case_study_picker] glob / read
[pricing_modeler] read
[proposal_checker] 开工
[coordinator] write / write / write / write       ← 校验员的建议驱动了 4 次改稿
[coordinator] mark_artifacts
=== 会话 idle ===
```

**断线与权威记录**：流不回放——连接建立之前已产生的帧不会补发，重连也不补。所以权威状态一律以 `GET /sessions/{id}/events` 为准（`order=asc` + `next_page` 翻页，单页上限 100，本回合 168 条要翻两页）；只关心个别线程时，用 `GET .../threads/{tid}/events` 做单线程对齐更省。

最后是观察面的选型：

| 要什么               | 用什么                                                       |
| ----------------- | --------------------------------------------------------- |
| 全团队实时进展（一条连接）     | Session 级 SSE 流 + 分桶字典                                    |
| 一张「谁在跑 / 谁完了」的工作台 | 轮询 `GET /sessions/{id}/threads`（status + `agent.version`） |
| 深挖某个子 Agent 干了什么  | `GET .../threads/{tid}/events`（单线程全量）                     |
| 权威留档 / 事后归因       | `GET /sessions/{id}/events` 翻页拉全量                         |

## 读提案，以及一次失败归因 <span id="h-mp-postmortem" />

产物文件取回：从协调者主线程的事件里找写 `proposal.md` 的 `tool_call`（工具 `write`，路径 `/mnt/session/outputs/proposal.md`，`arguments.content` 就是全文——本例还 `mark_artifacts` 登记过，能即时拿到 file\_id），或从 Files 列表按文件名找。

<Note>
  Files 列表按 scope 过滤的正确参数是 `GET /files?scope_type=session&scope_id=<sesn_...>`——传 `session_id` 会被静默忽略，返回整个工作空间的文件列表（靠每项的 `scope` 字段区分归属）。
</Note>

**一个失败案例**：同一个协调者配置跑两次——

- **Run 1**：三个 worker 全部正确，但协调者写出的 proposal.md 里，案例名变成了案例库里不存在的「Community Health Network」「Bayshore Medical Group」，定价表变成 \$39,000/\$58,500/\$78,000——**协调者在汇总长上下文时幻觉了**。
- **Run 2**：同配置同输入，proposal.md 里是正确的 St. Clair Health + Aperture Payments。

两次运行唯一的差异是采样随机性。这给了三个教训：

1. **worker 对 ≠ 团队对**。多智能体架构把调研/挑选/定价拆给专家后，最后一公里的「汇总写作」本身仍是幻觉高风险区——协调者值得配最强的模型，prompt 里要求「引用专家回传的原文数据、禁止改写数字」也有帮助。
2. **归因靠 Threads API**。出问题时，`GET /threads/{id}/events` 逐线程检查：挑选器回传的 picks 是对的、定价员的 options 是对的、错在协调者的 write 参数——**问题精确定位到协调者**。单 Agent 出错时只有一整条日志；多智能体为每个环节保留了独立记录，便于归因。
3. **评测要进流程**。[进阶：提示词版本管理与回滚](managed-agents-prompt-versioning.md)的方法论在这里同样适用：上线前用固定的潜客画像跑一轮，对 proposal.md 做断言（案例名必须在案例库白名单里、定价必须命中规则表的计算结果），再决定放行。

## 为什么用三个（+ 一个校验）子 Agent，而非一个 <span id="h-mp-why" />

单个 Agent 带上全部工具也能写出提案，但**按角色限定工具**带来实际收益：

- 定价员**只有规则文件**、没有任何联网通道，它无法拉竞品价，定价始终来自内部规则。
- 案例挑选器这里读 7 个文件、生产里读几百个——这个体量留在**子 Agent 的上下文**里，而不是灌进协调者上下文。
- 协调者只决定**顺序和交接**，自己不做专家工作，上下文保持干净。

额外增加一个 `proposal_checker` 是同一思路的延伸：它在动笔前把案例与定价对齐到潜客优先级上，让不一致在写作前被识别并修正——本例中它驱动协调者修改了 4 稿。校验过程运行在自己的线程里，判断依据与建议都保留在事件日志中，可回溯。代价是额外启动一个 worker 线程：多一轮委派与回传，也多一份运行开销。若某些潜客场景不需要这道自检，可以把它从 roster 里去掉，协调者会直接进入写作。

## 清理（归档） <span id="h-mp-cleanup" />

统一用 archive（保留审计、停计量）。注意顺序：**running 状态的 Session 不能 DELETE**（返回 `400 invalid_parameter`），先等它 idle 或用归档；Agent 只能 archive：

```bash
curl -X POST "$AGENTSTUDIO_URL/sessions/$SESSION_ID/archive" -H "Authorization: Bearer $DASHSCOPE_API_KEY"
# 或删除：curl -X DELETE "$AGENTSTUDIO_URL/sessions/$SESSION_ID" -H "Authorization: Bearer $DASHSCOPE_API_KEY"（须 idle）
curl -X POST "$AGENTSTUDIO_URL/environments/$ENV_ID/archive"  -H "Authorization: Bearer $DASHSCOPE_API_KEY"
# 协调者与各子 Agent 逐个归档
curl -X POST "$AGENTSTUDIO_URL/agents/$AGENT_ID/archive"      -H "Authorization: Bearer $DASHSCOPE_API_KEY"
```

子 Agent 归档后不能再被新协调者引用进 roster；已有 Session 的历史线程不受影响（事件数据随 Session 保留）。

## 下一步 <span id="h-mp-next" />

- [多智能体协作](managed-agents-multiagent.md)：coordinator 编队的字段参考。
- [会话事件流](managed-agents-event-stream.md)：单 Agent 场景的事件参考。
