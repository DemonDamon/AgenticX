---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/managed-agents-cost-tiering
fetched: 2026-10-23
title: 进阶：联网研究与模型成本分层
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 进阶：联网研究与模型成本分层

> 让旗舰模型只做规划与综合、廉价模型用内置联网工具承担 token 密集的阅读执行，并度量这一拆分的实际收益：事件流归集、对照实验设计与不适用场景。

<meta property="og:title" content="进阶：联网研究与模型成本分层" />

## 概述 <span id="h-ct-intro" />

本篇讲 multiagent 协调者模式的**成本分层**：让旗舰模型只做规划与综合，把 token 密集的阅读执行交给廉价模型，并度量这一拆分的实际收益。多智能体的完整链路——配置形状、编排工具、线程观察——已在[进阶：多智能体定制复杂提案](managed-agents-multiagent-proposal.md)展开，本篇不重复；聚焦成本收益：这一架构为什么降低账单、如何度量，以及不适用的场景。

## 场景：阅读是主要开销 <span id="h-ct-scenario" />

多数 Agent 工作负载包含两类差异很大的工作：**少量规划和判断，大量机械的阅读和执行**。联网研究是极端例子：核实二十个事实，意味着将数十万 token 的网页内容送入模型。按旗舰费率，这笔阅读开销占据主要部分，而阅读本身并不需要旗舰的判断力。

协调者模式拆开这两种负载：旗舰协调者负责规划研究、拆解子问题、综合答案，**不直接接触原始网页**；廉价 worker 在各自并行的线程里做全部阅读，只回传提炼后的发现。同样多的阅读 token，计费费率从旗舰换成廉价档——这就是成本分层的全部要点。

同样的成本逻辑适用于任何「廉价模型足以承担 token 密集处理」的负载：文档评审、日志分析、代码库扫描。

## 架构：阅读留在 worker 线程 <span id="h-ct-arch" />

```plaintext
问题
   │
   ▼
旗舰协调者（qwen3.8-max，无自有工具）
   │  create_agent / list_agents / wait_for_agents（平台自动注入）
   ├──────────────┬──────────────┬─────────→ 并行子问题
   ▼              ▼              ▼
worker A       worker B       worker C …（qwen3.7-plus，各自独立 Session 线程）
web_search → web_fetch ×N（内置工具）
   │              │              │
   └── 提炼后的发现与来源 URL 随最终消息回传 ──┘
   ▼
协调者综合 → 最终答案
```

成本优势建立在这两条结构性质上：

1. **阅读内容不跨线程传递**。worker 读取的搜索结果和网页只存在于它自己的线程上下文里；协调者收到的是小消息（委派出去的子问题）和提炼摘要（回来的发现）。这在事件流里可以直接验证：worker 线程上是密集的 `web_search` / `web_fetch` 的 `tool_call` / `tool_call_output`，协调者主线程上只有编排工具调用与最终综合——巨大的原始内容从未出现在主线程的任何事件里。
2. **费率由模型 ID 决定**。Agent 的 `model` 字段只需 `{ id }`，能力与价格档位由 ID 本身决定。协调者与 worker 用不同 ID，账单天然分成两栏——模型 ID 也是成本归属最直接的维度。

并行是附带收益：worker 各自在独立线程里跑，墙钟时间也更短。

## 配一个两模型团队 <span id="h-ct-team" />

模型 ID 使用当前可用的档位：旗舰协调者 `qwen3.8-max`，廉价 worker `qwen3.7-plus`（更省的还有 `qwen3.6-flash` 档）。具体列表以控制台为准。

```bash
export AGENTSTUDIO_URL="https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio"
export DASHSCOPE_API_KEY="<你的 DashScope API Key>"  # gitleaks:allow
```

### worker：廉价模型 + 内置联网工具 <span id="h-ct-worker" />

内置工具比市场 MCP 少一层开通与凭证——同一个 `builtin_toolkit` 里显式启用 `web_search` 与 `web_fetch` 即可，不需要 `mcp_servers`：

```bash
curl -X POST "$AGENTSTUDIO_URL/agents" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "search_worker",
    "model": { "id": "qwen3.7-plus" },
    "tools": [
      { "type": "builtin_toolkit",
        "default_config": { "enabled": false },
        "configs": [
          { "name": "web_search", "enabled": true },
          { "name": "web_fetch", "enabled": true }
        ] }
    ],
    "system": "你是给协调者研究一个聚焦子问题的搜索 worker。用 web_search 定位来源，用 web_fetch 读取有希望的页面；优先一手来源，证据薄弱时换查询措辞，交叉核实重要结论。最终消息必须包含简明结论、来源 URL 和支撑事实，只返回提交回执不算交付。不要回传整页原文；找不到确定答案就说明还不确定的部分。"
  }'
```

工具名必须带下划线（`web_search` / `web_fetch`，不能写成 `websearch` / `webfetch`）。每个 worker 实例在自己的 Session 线程里研究一个聚焦子问题——它读的巨大网页不进入任何其他人的上下文。

<Warning>
  **联网工具选型**。`web_search` / `web_fetch` 覆盖搜索与静态读取；需要点击网页或填写表单时，改用已开通的 MCP 服务里的 `browser_use`（服务名与工具名以控制台服务目录为准）。两条路的工具名不同，system prompt 里引用的工具名要和实际启用的对上。
</Warning>

### 协调者：旗舰模型，无自有工具，只有一个 roster <span id="h-ct-coordinator" />

协调者不配 `tools`——它对 roster 之外的世界没有任何直接通道。使它成为协调者的就是 `multiagent` 字段：服务端自动注入 `create_agent` / `list_agents` / `wait_for_agents`（worker 侧获得 `submit_result`），这些工具不用定义：

```bash
curl -X POST "$AGENTSTUDIO_URL/agents" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "search_coordinator",
    "model": { "id": "qwen3.8-max" },
    "multiagent": {
      "type": "coordinator",
      "agents": [
        { "type": "agent", "id": "<search_worker 的 agent id>" }
      ]
    },
    "system": "你在协调一个搜索 worker 团队回答一个难的联网研究问题。你的 worker 有联网工具；你自己没有。把问题拆成聚焦子问题，通过 create_agent 委派给 worker，在独立子问题上并行跑多个（默认不超过 4 个）。spawn 之后、下任何结论之前总是调 wait_for_agents。worker 回报时判断是否回答了子问题；证据不足就再委派一次、换个措辞。有足够证据后，把 worker 的发现综合成对原问题的单一最终答案，保留来源 URL。"
  }'
```

之后就是[多智能体篇](managed-agents-multiagent-proposal.md)的标准链路：建 Environment、建 Session 挂协调者、POST 一条 `message` 事件。

<Note>
  **roster 版本语义**（见[多智能体篇](managed-agents-multiagent-proposal.md)）：成员不带 `version` 就是每次委派取 worker 的最新版本——改 worker 不需要动协调者；想让团队配置冻结可复现，就显式写 `version` 锁定。
</Note>

<Note>
  **协调者只知道写进它 prompt 的东西**。服务端不会向协调者暴露 worker 的 system prompt 或工具细节；它对 worker 行为的认知全部来自写在它自己 prompt 里的描述。两边描述不一致时，委派质量会下降——对齐两边的描述由配置编写方负责，服务端不强制。
</Note>

## 先验证单 worker 链路 <span id="h-ct-single" />

只有一个研究问题时，直接用一个 worker。推荐顺序：`web_search` 找到候选来源 → `web_fetch` 读取相关网页 → 把结论与来源核对后回答并附上 URL。如果某个结论依赖网页细节，仅看搜索摘要不能替代阅读原文。

这一步也是团队上线前的冒烟测试：确认 worker 线程里两类工具都出现成功调用、最终消息带着来源，再引入协调者。

## 度量这笔账 <span id="h-ct-measure" />

核算这套架构的成本收益，有两条数据路径：

**路径一：事件流逐次归组（事后可查，不需要额外设施）。** 每次模型调用都产生一条 `model_request_end` 事件，载荷带 `model`、`input_tokens` / `output_tokens` / `cache_read_input_tokens` / `cache_creation_input_tokens`，且事件顶层带 `thread_id`。按 `thread_id` 分桶就是「协调者线程开销 vs 各 worker 线程开销」；按 `data.model` 分桶就是「旗舰栏 vs 廉价栏」——两张账单直接从事件流里读出来。

**路径二：时间窗 × 模型 ID。** 在工作空间维度的用量数据里，按运行时间窗和模型 ID 两个维度取数：团队那次出现两行（旗舰 + 廉价），单旗舰对照那次只有旗舰一行。操作顺序：跑完团队记下时间窗，再跑对照记下时间窗，分别取数。用量与计价口径以[计费说明](managed-agents-billing.md)为准。

<Note>
  联网工具调用次数单独计费（`web_search` 按次计费，`web_fetch` 当前限时免费），与模型推理费用分开核算——把旧 MCP 配置换成内置工具会改变工具费用这一部分，两组成本需要重新测量。
</Note>

### 对照实验的公平性设计 <span id="h-ct-fair" />

要回答「不用这个模式要花多少」，合理的对照组是**单个旗舰 agent 挂同样的内置联网工具**（工具配置与 worker 完全一致，只把模型 ID 换成旗舰）。一个关键差异决定这个对比是否有效：**核实标准必须匹配**。放任旗舰自行判断时，成本确实更低——每个事实只读取单一来源即可交付——但核实严格度也随之降低，不能视为「同样的工作换了价格」。对照的 prompt 要明确提出团队已经在做的事：每个事实至少两次独立核实、两源分歧时重取并标记、答案里给每个事实两个来源 URL。

### 反事实估算 <span id="h-ct-counterfactual" />

想看「假如全部阅读按旗舰费率计价」，拿团队运行的 token 计数统一乘旗舰费率，与真实拆分（阅读部分按廉价费率）对比。缓存相关的费率倍率（写 / 读）以[计费说明](managed-agents-billing.md)为准——`model_request_end` 里的 `cache_read_input_tokens` / `cache_creation_input_tokens` 就是做这类核算的原始字段。

需要验证的假设是：在保持答案质量的同时，把大部分阅读 token 转移到廉价 worker 上。统一核实要求能让对比有意义，但不保证两组消耗一样的 token，也不保证团队总价更低；实际 token 量、委派开销和工具费用都要分别测量。

<Warning>
  **工具调用成功不等于协调者拿到可用结论**。实测中 worker 可能先发一条只含提交回执的消息，协调者还需要用 `send_to_agent` 追问完整报告。worker 的 system prompt 要明确要求最终消息包含事实与来源 URL，并检查实际交付内容。
</Warning>

## 成本护栏 <span id="h-ct-guardrails" />

Session 没有 budget / 花费上限字段，护栏落在三层：

- **定时任务层限流**：约束触发频率（cron 时间表本身就是节流），避免同一份任务被反复拉起。注意**并发触发并不报错**（连续两次 `/run` 各自创建 run、并行跑完），并发上限要靠触发端自己控制，见[生产化篇](managed-agents-production.md)；
- **prompt 约束 fan-out**：在协调者的 system prompt 里写清 worker 数量上限、单个 brief 的任务粒度、什么情况下不再追加——协调者 spawn 多少 worker 完全由它判断，prompt 是唯一的控制手段；
- **事后对账**：每次运行结束按模型维度核对用量，与预期区间比对，异常放大时回头收紧 prompt 里的粒度约束。

## 四点注意事项 <span id="h-ct-cautions" />

1. **对比必须在同一核实严格度下进行**。不加约束的单旗舰读取更少、成本更低，但交付标准不同；只在核实标准固定时对比两组。
2. **委派存在固定开销**。每个 worker 线程都有固定的初始化开销。同一工作拆成更多更细的 brief 反而抬高账单，brief 粒度存在最优值。
3. **核实标准只覆盖放进去的东西**。两组都核实了 20 个事实，但公园列表本身可能来自模型记忆——事实被审计了，**问题分解没有**。前提重要时，多花一次委派，让 worker 先核实它。
4. **协调者只知道写进它 prompt 的东西**。对 worker 行为描述的准确性，直接决定委派质量，也决定这套经济学能不能兑现。

## 不适用场景 <span id="h-ct-when" />

- **窄问题**：阅读太少，没有套利空间；
- **协调者凭自身知识直接作答**（无委派发生）：额外产生一次无实际产出的旗舰调用。这在事件流里有明确信号：一条**没有任何 `thread_created` 的运行**——用[多智能体篇](managed-agents-multiagent-proposal.md)的分桶渲染可直接识别；
- **原材料本身需要旗舰级判断**（微妙的文档分析，而非找事实）：廉价读者可能在提炼时把关键的东西摘掉。

## 小结 <span id="h-ct-summary" />

- **成本分层的落地手段就是模型 ID 分档**：旗舰协调者只规划与综合、从不碰原始网页；廉价 worker 在并行线程里做全部阅读；
- **阅读内容不跨线程传递**是架构性质，事件流可直接验证（worker 线程密集 `web_search` / `web_fetch`，主线程只有编排与综合）；
- **度量两条路**：`model_request_end` 按 `thread_id` / 模型归组（事件层）；时间窗 × 模型 ID（用量层）。对照实验必须严格度匹配，否则比的是两个不同的产品；
- **护栏三层**：定时任务限流、prompt 约束 fan-out、事后对账。

运行结束后的清理与[多智能体篇](managed-agents-multiagent-proposal.md)相同：Session / Environment / Agent 逐个 archive（归档保留审计记录、停计量）。

## 下一步 <span id="h-ct-next" />

- [进阶：多智能体定制复杂提案](managed-agents-multiagent-proposal.md)：本篇架构的完整搭建链路。
- [Agent 工具配置](managed-agents-builtin-tools.md)：内置工具集与逐工具启用的完整字段。
- [计费说明](managed-agents-billing.md)：模型费率、缓存与联网工具的计费口径。
