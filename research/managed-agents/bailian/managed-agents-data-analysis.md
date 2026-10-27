---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/managed-agents-data-analysis
fetched: 2026-10-23
title: 入门：搭一个数据分析 Agent
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 入门：搭一个数据分析 Agent

> 用 curl 走通 Managed Agents REST API 全链路：创建 Agent 与 Environment、上传并挂载数据集、驱动 Session 完成数据体检、清洗与出结论，取回产物并归档资源。

<meta property="og:title" content="入门：搭一个数据分析 Agent" />

## 概述 <span id="h-da-intro" />

本教程用 curl 走通 Managed Agents 的 REST API：创建 Agent 与 Environment、上传并挂载一份掺了脏数据的订单流水、开启 Session 让 Agent 自主完成「体检 → 清洗 → 算指标 → 写报告」，最后取回产物并归档资源。

选数据分析场景，是因为它天然带一个反馈闭环：Agent 必须先自己发现数据有什么问题，才能算对指标；算完还得回头验证数字自不自洽。这个例子覆盖了后续所有教程都会用到的 API 形态：Agent / Environment / Session、文件挂载、事件流、产物取回、归档。

本篇聚焦 API 机制本身，用最少的依赖把链路跑通，产物是 Markdown + CSV；输出质量向的进阶主题（叙事式 HTML 报告、交互图表、更精细的 system prompt）可在此链路之上自行扩展。

开始前先约定环境变量，后续所有 curl 示例都会用到：

```bash
# 工作空间专属 Base URL（当前仅 cn-beijing 地域），获取方式见 API 总览
export AGENTSTUDIO_URL="https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio"
# DashScope API Key，一把 Key 覆盖工作空间内全部资源
export DASHSCOPE_API_KEY="sk-xxxxxxxx"  # gitleaks:allow
```

鉴权方式与 Base URL 的获取详见 [概览](api/managed-agents-api-overview.md)。随着流程推进，还会陆续导出 `AGENT_ID`、`ENV_ID`、`SESSION_ID`、`FILE_ID`。

## 三个资源概念 <span id="h-da-concepts" />

Managed Agents 有三个核心资源：

- **Agent**：可复用、可版本化的配置，包含 `model`、`system`（system prompt）、`tools`。每次更新会自动升 `version`。
- **Environment**：容器模板（沙箱），指定 `packages` 和 `networking`。
- **Session**：把 Agent 绑到 Environment，挂载文件，产生事件流。Session 创建时会锁定该 Agent 最新版本的完整快照。

Agent 和 Environment 创建一次，可以在多个 Session 里复用。每个 Session 是一次自包含的运行。

## 步骤 1：创建 Agent <span id="h-da-step1" />

数据分析 Agent 的产出质量，关键在 system prompt 上。这里不写「怎么做」的流程，而是写**工作纪律**——先验数据再下结论、清洗要保守、结论必须带数字。剩下的让 Agent 自己摸索。

工具用内置工具集，`type` 为 `builtin_toolkit`（一个 Agent 最多挂 1 个内置工具集）。本例开启 6 个核心工具：`bash`、`read`、`write`、`edit`、`glob`、`grep`，足以覆盖全程离线分析；内置工具集还提供 `web_search` 与 `web_fetch` 两个联网工具，本例不需要。`mark_artifacts` 由平台运行时自动注入，用于登记产物文件，无需声明（显式列出也不影响调用）；`download_file` 已下线，不要再配置，取产物走 Files API（见 步骤 6）。

<Warning>
  **最常见的配置错误**：`default_config.enabled: true` 并不会把工具真的发给模型。必须在 `configs[ ]` 里把每个要用的工具**逐个显式列出**并置 `enabled: true`。只写 `default_config.enabled: true` 而不列 `configs`，Agent 拿到的工具列表只有平台自动注入的 `mark_artifacts`，随后任何 `bash` 调用都会回 `TOOL_NOT_FOUND: Tool 'bash' not found. Available tools: ['mark_artifacts']`，回合以「没有工具可用」结束。
</Warning>

模型选 `qwen3.8-max`。Managed Agents 接受的模型 ID 是 `qwen3.8-max` / `qwen3.7-max` / `qwen3.7-plus` / `qwen3.6-plus` / `qwen3.6-flash` 这一代命名；`qwen3-max` 这类 DashScope 旧版常规 ID 会被直接拒绝（`400 AGENT_010 模型不存在`）。具体可用列表以控制台下拉为准。

system prompt 里有换行，直接塞进 shell 单引号里容易出错，建议先落成文件再用 `-d @`：

```bash
cat > agent.json <<'EOF'
{
  "name": "data-analyst-intro",
  "model": { "id": "qwen3.8-max" },
  "system": "你是一名数据分析师。你的工作方式是「先验数据，再下结论」：\n\n- 一律写 python3 脚本处理数据，不要凭眼睛看表格就下结论。\n- 动手算指标之前，先做一次数据质量体检：行数、重复行、缺失值、以及每个分类字段的实际取值。\n- 清洗要保守。只修能够确证的问题：完全重复的行、可由其他列推算出的缺失值、同义但写法不一致的取值。\n- 看起来极端但内部自洽的数据是真实业务数据，要在报告里点出来，不要删掉。\n- 每个结论都必须带具体数字。\n\n产物写到 /mnt/session/outputs/ 下，全部写完后用 mark_artifacts 一次性登记。",
  "tools": [
    {
      "type": "builtin_toolkit",
      "default_config": {
        "enabled": true,
        "permission_policy": { "type": "always_allow" }
      },
      "configs": [
        { "name": "bash",  "enabled": true },
        { "name": "read",  "enabled": true },
        { "name": "write", "enabled": true },
        { "name": "edit",  "enabled": true },
        { "name": "glob",  "enabled": true },
        { "name": "grep",  "enabled": true },
        { "name": "mark_artifacts", "enabled": true }
      ]
    }
  ]
}
EOF

curl -X POST "$AGENTSTUDIO_URL/agents" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d @agent.json
```

从响应里取出 `id`（形如 `agent_<ULID>`），响应还会回显 `version: 1`：

```bash
export AGENT_ID="agent_xxxxxxxx"
```

这段 prompt 里有两条是本例的关键：

- **「先做一次数据质量体检」**：缺少这句时，模型容易直接读取数据并开始计算，脏数据会被静默带入结论。
- **「看起来极端但内部自洽的数据……不要删掉」**：这是防**过度清洗**的护栏。数据里埋了一笔金额畸大但完全合规的批发订单，占总营收一半以上。少了这句，模型很可能把它当异常值剔掉，报出一个「更漂亮」但错误的大盘。

<Note>
  `builtin_toolkit` 有两级开关——`default_config.{enabled, permission_policy}` 与 `configs[ ].{name, enabled, permission_policy}`。`permission_policy` 接受 `{"type": "always_allow"}`（直接执行）或 `{"type": "always_ask"}`（每次调用前等待确认）。如果某次工具调用需要人工批准，SSE 流会出现 `stop_reason.type == "requires_action"`（带 `pending_batch_id` 与 `pending_call_ids`），此时按 `batch_id` + `call_id` 回填一条 `tool_approval_response` 事件即可，详见[会话事件流](managed-agents-event-stream.md)。本例全程 `always_allow`。
</Note>

### 改配置要用 POST + version <span id="h-da-update" />

后续调整工具或 prompt 时，更新接口是 `POST /agents/{agent_id}`（`PATCH` 返回 `405` 请求方法不支持），并且 body 里必须带当前的 `version` 做乐观锁，否则报 `400 AGENT_010 智能体参数不合法 - version: version 不能为空`。更新成功后 `version` 自动 +1：

```bash
curl -X POST "$AGENTSTUDIO_URL/agents/$AGENT_ID" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "version": 1, "name": "data-analyst-intro", "model": { "id": "qwen3.8-max" }, "system": "...", "tools": [ ... ] }'
```

Session 在创建时锁定 Agent 版本快照，**已存在的 Session 不会捡到新版本**，改完 Agent 需要新建 Session 才生效。版本机制的完整用法（评测、灰度、回滚）见[进阶：提示词版本管理与回滚](managed-agents-prompt-versioning.md)。

## 步骤 2：创建 Environment <span id="h-da-step2" />

`config.type` 选 `cloud`，使用托管沙箱（创建后不可变）。数据分析要用 pandas，在 `config.packages.pip` 里声明即可——**Session 起容器时就已经装好了**，Agent 不需要在回合里花时间跑 `pip install`：

```bash
curl -X POST "$AGENTSTUDIO_URL/environments" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "data-analyst-env-01",
    "description": "入门数据分析环境：预装 pandas",
    "config": {
      "type": "cloud",
      "packages": { "apt": [ ], "pip": ["pandas"], "npm": [ ] },
      "networking": { "type": "unrestricted" }
    }
  }'
```

取出 `id`（形如 `env_<...>`）：

```bash
export ENV_ID="env_xxxxxxxx"
```

响应会把 `config.packages` 原样回显（并额外加一个 `"type": "packages"` 字段）。预装是否生效，可以在 步骤 5 的任务里让 Agent 打印版本号确认——沙箱里 pandas 就绪，且全程没有执行过任何 `pip install`。Environment 的完整字段说明见[云端托管环境](managed-agents-cloud-hosting.md)；带预装包的环境创建后可能需要预热时间，未完成前创建会话会被拒绝，详见该页「环境预热」。

<Note>
  Environment 的网络策略当前取值为 `{"type": "unrestricted"}`（全部出网放行）。本例逻辑上不需要网络——包已预装好，分析全程离线。出网链路的行为细节（网关 MITM、TLS 校验）见[进阶：密钥库安全注入与出网网关](managed-agents-credential-security.md)。
</Note>

## 步骤 3：上传数据集 <span id="h-da-step3" />

准备一份 26 行的订单流水，里面埋了三类脏数据和一个「陷阱」：

```csv
order_id,order_date,region,category,unit_price,quantity,amount
1001,2026-07-01,East,Electronics,1200,2,2400
1002,2026-07-01,North,Home,150,4,600
1003,2026-07-02,east,Electronics,1200,1,1200
1004,2026-07-02,South,Apparel,80,5,400
1005,2026-07-03,East,Home,150,3,450
1006,2026-07-03, East,Apparel,80,2,
1007,2026-07-04,North,Electronics,900,1,900
1008,2026-07-04,South,Home,150,2,300
1009,2026-07-05,East,Electronics,900,3,2700
1010,2026-07-05,east,Apparel,80,10,800
1011,2026-07-06,North,Apparel,80,3,240
1012,2026-07-06,South,Electronics,1200,1,1200
1013,2026-07-07,East,Home,150,6,900
1014,2026-07-07,East,Electronics,900,2,1800
1015,2026-07-08,North,Home,150,1,150
1016,2026-07-08,South,Apparel,80,4,320
1017,2026-07-09, East,Electronics,1200,2,2400
1018,2026-07-09,north,Home,150,5,750
1019,2026-07-10,East,Apparel,80,6,
1020,2026-07-10,South,Electronics,900,1,900
1014,2026-07-07,East,Electronics,900,2,1800
1021,2026-07-11,North,Electronics,1200,1,1200
1022,2026-07-11,South,Home,150,3,450
1023,2026-07-12,East,Home,150,2,300
1024,2026-07-12,North,Apparel,80,7,560
1025,2026-07-13,East,Electronics,1200,20,24000
```

预置的脏数据：

<table style={{ display: "table", tableLayout: "fixed", width: "100%", overflowWrap: "anywhere" }}>
  <colgroup>
    <col style={{ width: "6%" }} />

    <col style={{ width: "26%" }} />

    <col style={{ width: "28%" }} />

    <col style={{ width: "40%" }} />
  </colgroup>

  <thead>
    <tr>
      <th style={{ verticalAlign: "top" }}>#</th>
      <th style={{ verticalAlign: "top" }}>问题</th>
      <th style={{ verticalAlign: "top" }}>位置</th>
      <th style={{ verticalAlign: "top" }}>正确处理</th>
    </tr>
  </thead>

  <tbody>
    <tr>
      <td style={{ verticalAlign: "top" }}>1</td>
      <td style={{ verticalAlign: "top" }}>整行重复</td>
      <td style={{ verticalAlign: "top" }}><code>1014</code> 出现两次</td>
      <td style={{ verticalAlign: "top" }}>删掉副本，26 行 → 25 行</td>
    </tr>

    <tr>
      <td style={{ verticalAlign: "top" }}>2</td>
      <td style={{ verticalAlign: "top" }}><code>amount</code> 缺失</td>
      <td style={{ verticalAlign: "top" }}><code>1006</code>、<code>1019</code></td>
      <td style={{ verticalAlign: "top" }}>用 <code>unit\_price × quantity</code> 回填（160、480）</td>
    </tr>

    <tr>
      <td style={{ verticalAlign: "top" }}>3</td>
      <td style={{ verticalAlign: "top" }}><code>region</code> 写法不一致</td>
      <td style={{ verticalAlign: "top" }}><code>east</code>、<code>north</code>、<code>East</code>（带前导空格）</td>
      <td style={{ verticalAlign: "top" }}><code>strip</code> + 统一大小写，6 种写法归并为 3 个区</td>
    </tr>

    <tr>
      <td style={{ verticalAlign: "top" }}>4</td>
      <td style={{ verticalAlign: "top" }}><strong>陷阱</strong>：极端值</td>
      <td style={{ verticalAlign: "top" }}><code>1025</code>（1200 × 20 = 24000）</td>
      <td style={{ verticalAlign: "top" }}><strong>保留</strong>。金额与单价×数量自洽，是真实的大宗订单</td>
    </tr>
  </tbody>
</table>

问题 3 是问题 1、2 的下游：只要 region 没归一，`east` 和 `East` 就会被当成两个地区，营收被拆散，区域排名直接算错。问题 4 专门用来看 Agent 会不会过度清洗——它占总营收 52.68%，删掉它大盘就完全变样了。

正确答案（清洗后），留着在 步骤 6 核对 Agent 有没有算对：

- 25 行，region 只剩 `East` / `North` / `South` 三个取值；
- 总营收 **45,560**；
- 各 region：East `37,590` > North `4,400` > South `3,570`；
- 各 category：Electronics `38,700` > Home `3,900` > Apparel `2,960`；
- 最大单笔：订单 `1025`，`24,000`，占总营收 **52.68%**。

### 上传 <span id="h-da-upload" />

保存为 `orders.txt` 后上传（文件最大 10 MB）。**注意后缀**：当前文件类型校验不接受 `.csv`（返回 `11900014 文件类型不被允许`），同内容改用 `.txt` 后缀即可正常上传；挂载时 `mount_path` 决定沙箱内的文件名，Agent 照常按逗号分隔解析：

```bash
curl -X POST "$AGENTSTUDIO_URL/files" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -F "file=@orders.txt"
```

取出 `id`：

```bash
export FILE_ID="file_xxxxxxxx"
```

上传后不能立刻挂载。响应里的 `status` 初始是 `checking`，需要轮询 `GET /files/{id}` 直到变成 `available`（其他取值有 `rejected` / `type_rejected`）：

```bash
curl -X GET "$AGENTSTUDIO_URL/files/$FILE_ID" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY"
# 关注返回体里的 "status" 字段，等它变成 "available"
```

这份 1.1 KB 的文本文件从 `checking` 到 `available` 通常在 10 秒内。上传后要过一遍安全扫描，别上传完就直接建 Session。文件类型、大小限制与控制台操作详见[文件上传与挂载](managed-agents-file.md)。

## 步骤 4：创建 Session <span id="h-da-step4" />

Session 绑定 Agent 和 Environment，挂载文件，并起一个新容器。`resources` 会在 Agent 开始前把数据放进容器。

关于挂载路径，有两条硬约束：

- `resources[ ].mount_path` **必须以 `/uploads/` 开头**。
- 文件在沙箱内的实际路径是 `/mnt/session` + `mount_path`，即 `mount_path: "/uploads/orders.csv"` → 实际路径 `/mnt/session/uploads/orders.csv`，**只读**。

`mount_path` 决定沙箱里的文件名，与上传时的文件名无关。因为挂载点只读，Agent 必须先把文件拷到可写目录（如 `/mnt/user` 或 `/tmp`）再处理；需要取回的产物要写到 `/mnt/session/outputs/`。

`agent` 字段直接传 Agent ID 字符串（Session 会自动锁定该 Agent 最新版本的完整快照，无需显式传 version；首条输入在 Session 创建之后通过 `message` 事件下发，见 步骤 5）：

```bash
curl -X POST "$AGENTSTUDIO_URL/sessions" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "'"$AGENT_ID"'",
    "environment_id": "'"$ENV_ID"'",
    "title": "订单数据体检与分析",
    "resources": [
      { "type": "file", "file_id": "'"$FILE_ID"'", "mount_path": "/uploads/orders.csv" }
    ]
  }'
```

取出 `id`（形如 `sesn_<ULID>`），响应里还有 `status`（`idle` / `running` / `terminated`）：

```bash
export SESSION_ID="sesn_xxxxxxxx"
```

<Note>
  响应里 `resources[ ].file_id` 会变成一个**新的 ID**——平台把上传的文件复制了一份到 session 作用域下，原文件不动。
</Note>

## 步骤 5：驱动 Agent 并观察 <span id="h-da-step5" />

这一步分两步走：先发一个 `message` 事件带上任务，然后读事件流直到回合结束。

Session 创建时不携带初始输入，因此驱动 Agent 需要两步——先创建 Session，再单独 POST 一条 `message` 事件。（如果希望「触发即带首条消息」，用 [部署](managed-agents-deployment.md)，它支持 `initial_events`，会在触发时下发。）

事件流是一条 SSE 连接（比轮询更适合实时观察 Agent 迭代，本例约 2\~3 分钟）。有两个要点：

1. <strong>先开流，再发消息。</strong>先建立 SSE 连接、再发送 `message`，才能保证事件可观测；先发后开会有丢事件的竞态。
2. <strong>在 Session <code>idle</code> 且 <code>stop\_reason.type == end\_turn</code> 时退出。</strong>Session 在等待输入时都会 `idle`（回合结束、或需要回填工具结果时都会 idle），要用 `stop_reason` 区分，只有 `end_turn` 才是真正的退出信号。

### 先开 SSE 流 <span id="h-da-sse" />

SSE 端点需要请求头 `Accept: text/event-stream`。先建立连接：

```bash
# 在一个终端里保持这条连接
curl -N -X GET "$AGENTSTUDIO_URL/sessions/$SESSION_ID/events/stream" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Accept: text/event-stream"
```

连上后先收到一行注释 `:connected`，随后每个事件是一组四行（注意冒号后**没有空格**）：

```plaintext
id:1
event:message
:HTTP_STATUS/200
data:{"object":"message","status":"completed","id":"sevt_...","type":"session_status","content":[...]}
```

真正的载荷只在 `data:` 那一行，是一个 JSON 的 Message 对象。`event:` 这一行**恒为** `message`（它是 SSE 帧类型，不是事件类型），真正的事件类型在 `data` 的 `type` 字段里。

除了 `:connected`，流里还会穿插两种注释行：每个事件前的 `:HTTP_STATUS/200`，以及空闲时每 30 秒一条 `:keepalive`。解析时直接跳过所有以 `:` 开头的行。

<Note>
  `GET /sessions/{id}/events/stream` 才是流式端点。带 `Accept: text/event-stream` 去请求 `GET /sessions/{id}/events`（不带 `/stream`）不会升级成流，它会照常返回一次性的历史事件 JSON。
</Note>

### 再发任务消息 <span id="h-da-message" />

在另一个终端发送 `message` 事件。任务文本里的路径要写**实际沙箱路径** `/mnt/session/uploads/...`：

```bash
cat > msg.json <<'EOF'
{
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "/mnt/session/uploads/orders.csv 是一份电商订单流水，列：order_id, order_date, region, category, unit_price, quantity, amount。\n\n先打印一下 pandas 的版本，确认环境里已经预装。然后把文件拷到 /mnt/user 下工作，完成两件事：\n\n1. 数据质量体检并清洗，把清洗后的数据写成 /mnt/session/outputs/orders_clean.csv。\n2. 基于清洗后的数据回答四个问题：总营收是多少；各 region 营收排名；各 category 营收排名；金额最大的单笔订单是哪一笔、占总营收多少。写成 /mnt/session/outputs/findings.md。\n\n体检发现的每个问题都要在 findings.md 里说明处理方式。两个产物都要用 mark_artifacts 登记。"
        }
      ]
    }
  ]
}
EOF

curl -X POST "$AGENTSTUDIO_URL/sessions/$SESSION_ID/events" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d @msg.json
```

任务里只说了要什么，没说怎么清洗——发现问题和决定处理方式是 Agent 的活。发送时 body 里的 `type` 用 `message`，服务端回显与流里的事件 `type` 同样是 `message`，用 `role` 区分是谁说的（`user` 是回显、`assistant` 是 Agent 输出）。

### 如何解读事件流 <span id="h-da-events" />

`data:` 里的 Message 对象常用字段：`type`、`status`、`id`、`created_at`、`sequence_number`、`role`、`thread_id`、`content[ ]`。

两个容易写错的地方：

1. **顶层 `status` 不是会话状态**。它是这条消息自身的状态（通常是 `completed`）。会话状态藏在 `content[0].data.session_status` 里。
2. `thread_id` 在顶层，不在 `metadata` 下面。

实际会出现的事件 `type`：

| `type`                                      | 含义                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------ |
| `message`                                   | 消息文本。`role: user` 是发送的回显，`role: assistant` 是 Agent 输出，文本在 `content[ ].text`          |
| `reasoning`                                 | 思考占位事件，**不带** `content` 字段（解析时要容错，别直接取 `d["content"]`）                               |
| `tool_call`                                 | Agent 调用工具，`content[0].data` = `{ name, arguments, call_id }`                        |
| `tool_call_output`                          | 工具返回，`content[0].data` = `{ name, call_id, output }`，`output` 是一个 JSON **字符串**       |
| `model_request_start` / `model_request_end` | 每次模型请求的起止，`_end` 的 `content[0].data` 带 `input_tokens` / `output_tokens` / 缓存命中，适合算成本 |
| `session_status`                            | 会话状态变化，见下                                                                            |

`session_status` 的载荷在 `content[0].data`：

- 开始跑：`{ "session_status": "running" }`
- 回合结束：`{ "session_status": "idle", "stop_reason": { "type": "end_turn" } }` → **break**
- 会话终止：`{ "session_status": "terminated" }` → **break**
- 需要回填工具结果：`{ "session_status": "idle", "stop_reason": { "type": "requires_action" } }` → 发 `tool_approval_response` 或 `function_call_output`，**不要退出**

所以退出判断是：

```python
if d["type"] == "session_status":
    data = d["content"][0]["data"]
    if data["session_status"] == "terminated":
        break
    if data["session_status"] == "idle" and data.get("stop_reason", {}).get("type") == "end_turn":
        break
```

### 一个回合的典型轨迹 <span id="h-da-trace" />

一个回合约 110\~185 秒。一次完整轨迹如下（Agent 的具体动作每次会有出入，但骨架稳定）：

1. `bash` 打印版本，确认 pandas 已预装；
2. `bash` `mkdir -p /mnt/user /mnt/session/outputs` 后把 csv 从只读挂载点拷进 `/mnt/user`；
3. `write` 一个体检脚本 → `bash` 跑它；
4. **遇到问题自行恢复**：脚本被命名为 `inspect.py`，和标准库同名，导致 `import pandas` 时 numpy 内部 `import inspect` 拿到了这个脚本，抛出 traceback。Agent 读完报错，`mv` 成 `health_check.py` 后重跑成功；
5. 体检输出：`(26, 7)`、1 行完全重复、2 个 `amount` 缺失、region 有 6 种写法；
6. `write` 清洗+分析脚本 → `bash` 跑它。脚本里自带一条校验：全表 `amount == unit_price × quantity` 的不一致行数为 `0`；
7. `write` 写 `findings.md`；
8. **自己复核**：起一个 `bash python3 - <<EOF` 回读产物 CSV 复算一遍；
9. `mark_artifacts` **一次调用登记两个产物**，返回各自的 `file_id`；
10. assistant 总结 → `end_turn`。

第 4 步和第 8 步集中体现了 Agent 的自主迭代：两次都没有提示 `inspect.py` 会与标准库同名、也没有提示 pandas API 的用法，是 Agent 自己从报错中发现问题、修改后重新运行。这两处正是「迭代」发生的位置。具体问题每次不同，但「运行 → 查看结果 → 修改后重跑」的循环是稳定的，最终数字多次运行完全一致。

<Note>
  去重与重组：SSE 流当前不提供游标 / 续传 token，断连后重新建流时，按事件 `id` 去重。流式 assistant 文本理论上按 `sequence_number` 累积，但该字段常为 `null`、文本以整条 `completed` 消息下发，解析时按「有 `sequence_number` 就累积、没有就当整条」处理。
</Note>

## 步骤 6：取回产物并核对 <span id="h-da-step6" />

Agent 调 `mark_artifacts` 时，返回值里就带了每个产物的 `file_id`：

```json
{
  "marked": [
    { "path": "/mnt/session/outputs/orders_clean.csv", "description": "...", "file_id": "file_0qwg..." },
    { "path": "/mnt/session/outputs/findings.md",      "description": "...", "file_id": "file_zckv..." }
  ],
  "failed": [ ]
}
```

如果没记下这些 ID，就按 session 作用域列文件（用 `scope_type` + `scope_id` 两个 query 参数，注意**不是** `scope[type]` 这种嵌套写法，那样写过滤会被忽略、返回整个工作空间的文件）：

```bash
curl -X GET "$AGENTSTUDIO_URL/files?scope_type=session&scope_id=$SESSION_ID&limit=100" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY"
```

回合结束后，**写到 `/mnt/session/outputs/` 下的文件都会出现在这个列表里、且 `downloadable: true`**——不管有没有被 `mark_artifacts` 登记过。区分线在目录而不是登记动作：上传的输入文件（挂在 `/mnt/session/uploads/`）是 `downloadable: false`，下不回来。`mark_artifacts` 的实际收益是即时拿 `file_id` + 附 description，免得事后翻列表猜哪个文件是哪个。

下载用 `/content` 子路径（没有 `/download` 这个端点，它会 404）：

```bash
curl -X GET "$AGENTSTUDIO_URL/files/$CLEAN_FILE_ID/content" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" -o orders_clean.csv

curl -X GET "$AGENTSTUDIO_URL/files/$FINDINGS_FILE_ID/content" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" -o findings.md
```

拿回来先跟 步骤 3 的正确答案对一遍。这一步是最该养成的习惯——**Agent 说它算对了不算，自己核**：

```bash
python3 - <<'EOF'
import csv
from collections import defaultdict

rows = list(csv.DictReader(open('orders_clean.csv')))
by_region = defaultdict(float)
for r in rows:
    by_region[r['region']] += float(r['amount'])

assert len(rows) == 25, f"行数应为 25，实际 {len(rows)}"
assert sorted({r['region'] for r in rows}) == ['East', 'North', 'South']
assert sum(float(r['amount']) for r in rows) == 45560.0
assert sorted(by_region.items(), key=lambda x: -x[1]) == [
    ('East', 37590.0), ('North', 4400.0), ('South', 3570.0)]
print("清洗结果与预期一致")
EOF
```

<Note>
  注意：Agent 常用 `to_csv(..., encoding="utf-8-sig")`，取回的 CSV 带 BOM，`csv.DictReader` 拿到的第一个列名会是 `\ufefforder_id` 而不是 `order_id`。要按 `order_id` 取值就用 `open(..., encoding="utf-8-sig")`。
</Note>

最值得看的是报告里多出来的一节——Agent 没有删掉那笔畸大的订单 `1025`，而是把它单独拎出来说明，还补了一段稳健性分析（措辞每次不同，但「保留 + 单独标注」这个处理稳定出现）：

> 订单 1025 一笔即贡献过半营收……若剔除该笔：East 营收为 13,590、仍是第一；Electronics 营收为 14,700、仍是第一。即两个排名结论对该极端订单不敏感，但「East 占 82.51%」「Electronics 占 84.94%」这类占比数字高度依赖它，引用时应注明。

这正是 步骤 1 里那条「极端但自洽的数据不要删」起的作用。

### 查看本次运行的用量 <span id="h-da-usage" />

`GET /sessions/{id}` 的响应里有 `stats` 和 `usage`，运行结束后可用于核对成本：

```bash
curl -X GET "$AGENTSTUDIO_URL/sessions/$SESSION_ID" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY"
```

一轮典型运行的 `stats` 为 `{ "active_seconds": 113.7, "duration_seconds": 139.6 }`，`usage` 为 `{ "input_tokens": 118011, "output_tokens": 4431, "cache_read_input_tokens": 104152, "cache_creation_input_tokens": 13793 }`。多次运行落在 110\~185 秒 / 115k\~171k input tokens 区间，取决于 Agent 中间返工了几次。input 里 82%\~88% 是缓存命中——多轮工具调用会把同一段上下文反复带上，缓存命中率对成本影响很大。计费口径见[计费说明](managed-agents-billing.md)。

## 步骤 7：清理（归档） <span id="h-da-step7" />

用 archive 标记 Session / Environment / Agent 结束——它会拆掉容器、停止计量、并从默认列表里隐藏，但保留记录、配置和事件历史供审计。按 Session → Environment → Agent 的顺序归档：

```bash
curl -X POST "$AGENTSTUDIO_URL/sessions/$SESSION_ID/archive" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY"

curl -X POST "$AGENTSTUDIO_URL/environments/$ENV_ID/archive" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY"

curl -X POST "$AGENTSTUDIO_URL/agents/$AGENT_ID/archive" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY"
```

归档 Session 后它的 `status` 会变成 `terminated`；Environment 和 Agent 会带上 `archived_at` 时间戳，并从默认的列表接口里消失。

实际用起来，Agent 和 Environment 值得留着长期复用——下次来一份新数据，只要 `POST /sessions` 起一个新 Session 挂上去就行，不必重建。

## 原理小结 <span id="h-da-summary" />

- **Agent / Environment / Session 三层解耦**：Agent 是可版本化的「人设+工具」，Environment 是可复用的「沙箱模板」，Session 是一次自包含运行。前两者建一次、多次复用。
- **依赖装在 Environment 里，不要装在回合里**：`config.packages.pip` 声明的包在容器启动时就绪，Agent 不用花 token 和时间跑 `pip install`。
- **工具要逐个显式开启**：`default_config.enabled: true` 只是工具集总开关，真正决定模型能拿到哪些工具的是 `configs[ ]` 里逐条 `enabled: true`。漏了这一步，Agent 只有 `mark_artifacts` 可用。
- **文件是只读挂载 + 可写工作区**：上传文件挂在 `/mnt/session/uploads/`（只读），Agent 必须先拷到 `/mnt/user` 或 `/tmp` 才能改，产物写 `/mnt/session/outputs/`。`/mnt/user` 与 `/mnt/session/outputs` 在新容器里可能尚不存在，拷贝前先用 `mkdir -p` 创建。
- **产物从 `/mnt/session/outputs/` 出关**：写进该目录的文件会被平台扫描，回合结束后在 session 作用域的文件列表里可见、可下载。`mark_artifacts` 的价值是**即时**拿到 `file_id` 并附上 description——不用等扫描、不用事后翻列表，一次调用还能登记多个产物。
- **驱动靠事件、观测靠 SSE**：发 `message` 事件让 Agent 进入 `running`，SSE 流实时回传 assistant 文本与工具调用；用 `session_status` + `stop_reason` 判断何时结束。
- **idle 需要消歧**：会话状态 `idle` 在「回合结束（`end_turn`）」和「需要回填工具结果（`requires_action`）」两种情况下都会触发，务必用 `stop_reason.type` 区分，只有 `end_turn` 才退出。
- **护栏写在 system prompt 里**：「先体检再下结论」「极端但自洽的数据不要删」这两条决定了本例的成败——它们比任何流程描述都管用。

## 附：用轮询替代流式 <span id="h-da-polling" />

对更短的任务、或不想维持长连接的生产代码，可以改用轮询历史事件端点 `GET /sessions/{session_id}/events`。发完消息后，每 2 秒拉一次事件，取最后一条判断是否结束：

```bash
curl -X GET "$AGENTSTUDIO_URL/sessions/$SESSION_ID/events?order=desc&limit=1" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY"
```

返回的 `data[0]` 结构和 SSE 里的 Message 一致，所以判断条件也一样——看 `type == "session_status"` 的那条的 `content[0].data`：

```json
{
  "data": [
    {
      "object": "message",
      "status": "completed",
      "id": "sevt_...",
      "type": "session_status",
      "content": [ { "type": "data", "data": { "session_status": "idle", "stop_reason": { "type": "end_turn" } } } ]
    }
  ],
  "next_page": "MTc4ODI0..."
}
```

`session_status` 为 `terminated`、或 `idle` 且 `stop_reason.type == end_turn` → 结束。

历史事件里 `sequence_number` 常为 `null`；可用 `order`（asc/desc）与 `created_at[gt|gte|lt|lte]` 组合做时间过滤，用 `next_page` 翻页。

**权衡：**

- **流式（SSE）**：适合实时看 Agent 工作，代价是要维持长连接（进程必须一直活着，断网即掉流）。
- **轮询**：无状态、能扛进程重启、和队列/定时任务组合得很好，代价是有延迟、进度不可见。

生产环境里，当 Agent 要跑几分钟、而 handler 不能维持长连接时，用轮询。生产里「等待人工审批（HITL）」的场景也不依赖事件推送——用「轮询历史事件 + `requires_action` stop\_reason」，或「部署（cron / 手动 `/run`）+ 事后查询 runs」组合即可，见[进阶：生产化定时晨报机器人](managed-agents-production.md)。平台侧的事件推送（Webhook）见[进阶：Webhook 事件通知](managed-agents-webhook-notifications.md)。

## 速查表 <span id="h-da-cheatsheet" />

**模型 ID**：`qwen3.8-max` / `qwen3.7-max` / `qwen3.7-plus` / `qwen3.6-plus` / `qwen3.6-flash`（`qwen3-max`、`qwen-plus` 等常规 DashScope ID 会被拒）。

**内置工具**：核心工具 `bash`、`read`、`write`、`edit`、`glob`、`grep`，联网工具 `web_search`、`web_fetch`，**必须在 `configs[ ]` 里逐个 `enabled: true`**。平台额外自动注入 `mark_artifacts`（无需声明）。`download_file` 已下线，勿再配置。

**文件上传**：最大 10 MB；二进制文件上传后 `status` 由 `checking` 转 `available` 才能挂载。

**文件路径**：

- 上传文件挂载点：`/mnt/session` + `mount_path`（`mount_path` 必须以 `/uploads/` 开头，只读）。`mount_path` 决定沙箱里的文件名。
- 可写临时区：`/mnt/user` 或 `/tmp`。
- 可取回产物区：`/mnt/session/outputs/`，写入即可被扫描下载（无需登记）；`mark_artifacts` 用于即时拿 `file_id` + 附 description。

**易错的接口细节**：

| 事项       | 正确写法                                                                                                 |
| -------- | ---------------------------------------------------------------------------------------------------- |
| 更新 Agent | `POST /agents/{id}`（不是 PATCH），body 必带当前 `version` 和 `name`                                           |
| SSE 流    | `GET /sessions/{id}/events/stream`（不带 `/stream` 不会升级成流）                                              |
| 事件里的消息类型 | `message`（`role` 区分 user 回显 / assistant 输出）；思考事件是 `reasoning`。SSE 帧的 `event:` 行恒为 `message`，别拿它当事件类型 |
| 会话状态位置   | `content[0].data.session_status`（顶层 `status` 是消息状态，恒为 `completed`）                                   |
| 线程 ID 位置 | 顶层 `thread_id`（不在 `metadata` 里）                                                                      |
| 按会话列文件   | `?scope_type=session&scope_id=sesn_...`（嵌套写法 `scope[type]` 会被忽略）                                     |
| 下载文件     | `GET /files/{id}/content`（`/download` 是 404）                                                         |

`idle` **消歧**：会话状态 `idle` 在 `end_turn` 与需要回填工具结果（`requires_action`）时都会触发，用 `stop_reason.type` 区分。

## 下一步 <span id="h-da-next" />

- [进阶：生产化定时晨报机器人](managed-agents-production.md)：MCP 工具、密钥库与部署定时触发。
- [进阶：提示词版本管理与回滚](managed-agents-prompt-versioning.md)：把本篇的 Agent 纳入评测与灰度流程。
- [进阶：多智能体定制复杂提案](managed-agents-multiagent-proposal.md)：用协调者编排多个专家 Agent。
