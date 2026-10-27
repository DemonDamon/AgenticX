---
source: https://ark.volcengine.com/region:cn-beijing/docs/agent-system-prompt-versioning
fetched: 2026-10-24
title: \[基础\] 工单分诊 Agent 系统提示词版本管理
---

# [基础] 工单分诊 Agent 系统提示词版本管理

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

本教程演示如何使用方舟 Managed Agents 的 **Agent 版本机制**，安全地迭代一个工单分诊 Agent 的 System Prompt。

**System Prompt**（系统提示词）是给 Agent 的稳定指令：它告诉 Agent 承担什么角色、遵循什么规则、按什么格式输出。同一个模型在不同 System Prompt 下会表现出完全不同的行为，因此 System Prompt 是决定 Agent 质量的核心资产。

本教程的做法是：每次更新 System Prompt 自动产生新版本，用带标注的评估集量化对比新旧表现；一旦出现回归，秒级回滚；修复后按流量灰度放量。全过程不需要重新部署任何代码。

核心亮点：

- **修改 System Prompt 即发版**：System Prompt 是服务端的版本化资产，更新一次产生一个新版本，秒级生效，不走代码发布链路。
- **回滚等于修改一个数字**：生产配置把版本号指回旧版本，新建 Session 立即回到旧行为，无部署、无停机，也不需要删除任何东西。
- **版本号即 feature flag**：灰度、A/B 对比、按用户分组放量，都用「创建 Session 时锁定哪个版本」表达。
- **量化迭代**：带标注测试集给每个版本打分，回归当场检出；不依赖肉眼盲测 System Prompt diff。

<span id="scene"></span>
# 场景介绍

一个工单分诊 Agent 的职责是：客服工单进入系统后，Agent 读完工单并输出一行 JSON——说明该派给哪个团队（`billing`、`auth`、`api-platform`、`dashboard`）、优先级如何——下游系统按结果自动派单。这类 Agent 的行为几乎完全由 System Prompt 决定，而修改 System Prompt 又非常「顺手」：一句话即可上线，不用编译、不用测试。

顺手就意味着危险。**改坏 System Prompt 与改坏代码属于同一级别的生产事故**，但大多数团队只对代码建立了版本控制。

| 环节 | System Prompt 写死在代码里 | System Prompt 作为版本化资产（本方案） |
|-|-|-|
| 更新 | 改代码 > PR > CI > 部署，十几分钟起步 | 调用一次更新接口，秒级发版 |
| 回滚 | 再走一遍部署链路 | 配置指回旧版本号，即刻生效 |
| 对比测试 | 构建两套实例或自建 feature flag | 多版本天然共存，Session 锁版本即可 |
| 事故半径 | 全量瞬间生效 | 灰度放量，问题版本只影响一小片流量 |

本教程涉及的核心能力：

| 能力点 | 说明 |
|-|-|
| Agent 版本 | Agent 是可版本化、可复用的配置资产；每次更新自动产生新版本，历史版本全部保留 |
| Session 锁版本 | 创建 Session 时 `agent` 传字符串等同于跟随最新版本；传 `{"type": "agent", "id", "version"}` 对象等同于锁定到指定版本，用于回滚、灰度对比、产品定版 |
| 运行中隔离 | 版本在 Session 生命周期内固定不变，后续发版不影响存量 Session |
| 评估闭环 | 带标注测试集加分版本跑分，让「新版本更好」成为可验证的结论，而不是主观判断 |

<span id="prerequisites"></span>
# 前置准备

准备一台 macOS 或 Linux 设备，并安装以下命令行工具：

- Bash 3.2 或更高版本
- cURL 7.68.0 或更高版本
- jq 1.6 或更高版本

<span id="prerequisites-api-key"></span>
## 开通服务并配置 API Key

先设置 API 地址和 API Key。API Key 只应保存在本地环境变量或服务端密钥系统中，不要硬编码在代码中。

```bash
export ARK_BASE_URL="https://ark.cn-beijing.volces.com/api/v3"
export ARK_API_KEY="替换为你的 ARK API Key"  # gitleaks:allow
```

鉴权使用 `Authorization: Bearer $ARK_API_KEY`。

<span id="prerequisites-eval-set"></span>
## 准备带标注的评估集

评估集是版本管理的另一半：没有它，「新版本更好」只是主观感觉。准备一份 `tickets.jsonl`，每行一条工单，带正确答案：

```json
{"subject": "五月账单重复扣款", "body": "我们本月被收了两次费用，请核对……", "team": "billing"}
{"subject": "OAuth token 过期太快", "body": "接入后每小时就要重新授权……", "team": "auth"}
{"subject": "API 用量超限报 429", "body": "我们套餐是 10000 次/月，还没用完就被限流……", "team": "billing"}
```

建议 20 到 50 条、覆盖所有团队，并**刻意包含易混淆样本**——例如上面第三条：通篇都是「API 用量」，但客户实际问的是计费问题。这类样本正是后续检出回归的关键。

<span id="workflow"></span>
# 详细操作指南

<span id="create-v1"></span>
## 创建 Agent v1，建立基线

创建分诊 Agent（纯文本判断任务，不需要挂工具）和一个运行环境：

```Bash
RESOURCE_SUFFIX="$(date +%Y%m%d%H%M%S)-$RANDOM"

curl "$ARK_BASE_URL/agents" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "ticket-triage-'"$RESOURCE_SUFFIX"'",
    "model": {"id": "doubao-seed-2-1-pro-260628"},
    "system": "你是工单分诊 Agent。读完工单后只输出一行 JSON（不要代码块、不要多余文字）:{\"team\": \"<billing|auth|api-platform|dashboard>\", \"priority\": \"<P1|P2|P3>\"}。按客户的实际问题路由，不要被表面关键词带偏。"
  }'

curl "$ARK_BASE_URL/environments" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "triage-env-'"$RESOURCE_SUFFIX"'", "config": {"type": "cloud", "networking": {"type": "unrestricted"}}}'
```

Agent 创建响应中 `version` 为 `1`——**创建即 v1，之后每次更新自动递增**。

将 Agent ID 与 Environment ID 写入环境变量，供后续脚本使用。`environment_id` 指定 Session 使用的运行环境。创建 Session 时必须传入该字段；省略后，接口返回 HTTP 400 `MissingParameter`。

```bash
export AGENT_ID="替换为上一步返回的 agent id"
export ENV_ID="替换为上一步返回的 environment id"
```

对评估集逐条执行同一套闭环：为指定版本创建 Session、发送工单、等待 `session.status_idle`，再读取最后一条 `agent.message` 并与标注答案比对。实现时必须设置总体超时，并把「结构不合法」、「工具错误」、「超时」与「模型判错」分开统计。

```bash
#!/usr/bin/env bash
set -euo pipefail
VERSION="${1:?usage: $0 <agent_version>}"

while IFS= read -r ticket; do
  expected=$(jq -r '.team' <<<"$ticket")
  text=$(jq -r '"工单标题:" + .subject + "\n\n" + .body' <<<"$ticket")

  sid=$(curl -fsS -X POST "$ARK_BASE_URL/sessions" \
    -H "Authorization: Bearer $ARK_API_KEY" -H "Content-Type: application/json" \
    -d "$(jq -nc --arg id "$AGENT_ID" --arg env "$ENV_ID" --argjson v "$VERSION" \
      '{agent:{type:"agent",id:$id,version:$v},environment_id:$env}')" | jq -r '.id')

  curl -fsS -X POST "$ARK_BASE_URL/sessions/$sid/events" \
    -H "Authorization: Bearer $ARK_API_KEY" -H "Content-Type: application/json" \
    -d "$(jq -nc --arg text "$text" \
      '{events:[{type:"user.message",content:[{type:"text",text:$text}]}]}')" >/dev/null

  idle=false
  for _ in {1..150}; do
    events=$(curl -fsS "$ARK_BASE_URL/sessions/$sid/events" \
      -H "Authorization: Bearer $ARK_API_KEY")
    if jq -e 'any(.data[]?; .type == "session.status_idle")' <<<"$events" >/dev/null; then
      idle=true; break
    fi
    sleep 2
  done
  if [[ "$idle" != true ]]; then printf '%s\ttimeout\n' "$expected"; continue; fi

  got=$(jq -r '[.data[] | select(.type == "agent.message")] | last
    | .content[0].text | fromjson | .team' <<<"$events")
  printf '%s\t%s\n' "$expected" "$got"
done < tickets.jsonl
```

每次评估还应记录 Agent 版本、模型版本、评估集版本、运行时间、失败或超时样本，以及可获得的 request ID。准确率之外，至少单独统计「结构不合法」、「工具错误」和「超时」三类异常，避免把运行故障误判成模型质量问题。

跑出 v1 基线：

```text
$ ./score.sh 1
  api-platform: 5/5
  auth: 5/5
  billing: 4/5
  dashboard: 3/5
```

`billing` 有一条错分——正是那条「通篇 API 用量、实际是计费问题」的工单，被路由到了 `api-platform`。这是我们要修复的问题，也是版本迭代的起点。

<span id="release-v2"></span>
## 发布 v2：更新 System Prompt

针对 `billing` 错分，给 System Prompt 追加一条路由规则。调用 Agent 更新接口，**必须带上当前版本号**（乐观并发锁）：

```Bash
curl "$ARK_BASE_URL/agents/$AGENT_ID" \
  -X POST \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "version": 1,
    "system": "<v1 的 system 全文>\n\n路由规则:工单只要提到 API 用量、频控、配额或请求量，一律路由到 api-platform。此规则优先于其他一切考虑，不要根据工单其余内容做二次判断。"
  }'
```

响应中 `version` 变为 `2`。更新接口有三条关键语义：

- **`version` 是并发保险**：传入值必须等于当前版本。不匹配时返回 HTTP 400 `InvalidParameter`，错误消息为 `version: conflict`，说明有其他协作者先一步发布了新版本。此时需重新查询最新版本，再基于最新配置提交，避免互相覆盖。
- **省略的字段继承上一版本**：本次只传了 `system`，`name`、`model` 等字段原样保留，不会被清空。
- **仅更新 `display_name` 不产生新版本**：只修改 `display_name` 且省略其他字段时，版本号保持不变。更新 `system`、`model`、`tools`、`skills`、`mcp_servers` 等版本化字段时，即使提交值与当前版本相同，也会生成新版本。服务端仅根据请求体中是否出现版本化字段判断，不比较新旧值。

> **注意**
>
> 版本冲突后不要直接重复提交原请求。先查询智能体详情获取最新 `version`，合并其他协作者的改动，再使用新版本号更新；继续使用旧版本号会再次返回 HTTP 400 `InvalidParameter`。

<span id="detect-regression"></span>
## 评估 v2，检出回归

用同一把尺子度量新版本：

```text
$ ./score.sh 2
  api-platform: 5/5
  auth: 5/5
  billing: 2/5   ← 从 4/5 掉到 2/5
  dashboard: 3/5
```

**v2 不但没有修好问题，还引入了回归**：那条规则写得太激进——`billing` 的工单天然会提到「API 用量」（超量才产生扣费争议），现在全部被这条规则劫持到了 `api-platform`。

值得停下来看清这件事：v2 的 System Prompt diff 在 review 时**看起来完全是改进**——更明确、更具体、指令性更强。这个坑只有「同一评估集跑两个版本、逐类目对比」才能暴露。这正是 System Prompt 变更必须走版本加评估，而不是「看起来没问题就上」的原因。

<span id="rollback-canary"></span>
## 回滚，然后灰度放量

**回滚不是一个 API，而是一次配置变更。** 生产代码创建 Session 时从配置读取版本号，出问题就把它指回去：

```Bash
# 生产配置（配置中心或环境变量）
PRODUCTION_VERSION=1   # 从 2 改回 1，即完成回滚

# 生产代码创建 Session 时始终锁定该版本
curl "$ARK_BASE_URL/sessions" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": {"type": "agent", "id": "'"$AGENT_ID"'", "version": '"$PRODUCTION_VERSION"'},
    "environment_id": "'"$ENV_ID"'"
  }'
```

三个让回滚「秒级且无痛」的事实：

- 存量 Session 在创建时就锁定了各自版本，本来就不受发版影响；
- 新建 Session 从配置修改那一刻起全部回到 v1；
- **v2 不需要删除**——它留在服务端，是下一轮修复（v3）的底稿，也是事故复盘的证据。

> **注意**
>
> 生产环境默认应使用对象形式锁定版本，以确保评估、灰度和回滚可复现。只有明确接受「自动跟随最新版本」风险的非生产或受控场景，才使用字符串形式。

修复规则后发布 v3（把「一律路由」改成「结合扣费、账单语境判断」），评估通过（`billing` 回到 5/5）。这次不直接全量，**按用户灰度放量**——版本分配是应用层的事：

```bash
# 按用户 ID 哈希分组:前 10% 的用户使用 v3，其余保留在 v1
bucket=$(( $(cksum <<<"$USER_ID" | cut -d' ' -f1) % 100 ))
if [ "$bucket" -lt 10 ]; then VERSION=3; else VERSION=1; fi
```

按用户哈希而不是按请求随机，好处是**同一用户始终落在同一版本**：行为一致，出问题也能精确圈出受影响的用户群。之后按 10% > 25% > 50% > 100% 逐档放量，每一档都用线上指标或评估集复核一遍。

随时可以列出全部版本历史，核对每一版的 System Prompt 内容：

```Bash
curl "$ARK_BASE_URL/agents/$AGENT_ID/versions" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

<span id="reference"></span>
# 版本机制参考

| 机制 | 行为 |
|-|-|
| 版本产生 | 创建即 v1；每次更新自动递增；仅更新 `display_name` 时不递增，其他版本化字段即使值相同也会递增 |
| 并发安全 | 更新必须携带当前 `version`；不匹配时返回 HTTP 400 `InvalidParameter`，错误消息为 `version: conflict` |
| Session 绑定 | `agent` 传字符串即使用该 Agent 最新版本启动;传 `{"type": "agent", "id", "version"}` 对象即锁定到指定版本 |
| 运行中隔离 | 版本在 Session 生命周期内固定;运行中也不可修改 Session 的任何配置。官方口径:「如需调整 Agent 能力，请发布 Agent 新版本并新建 Session」 |
| 回滚 | 无专门 API；生产配置把版本号指向旧版本，新建 Session 即刻生效 |
| 灰度 | 平台不感知流量分配;由应用层按版本号分流（按流量百分比或按用户哈希） |

与本系列上一篇的连接：创建 Session 时 `vault_ids` 与 `agent.version` 可以同时使用——**「以谁的身份行动」和「用哪一版行为」是 Session 上两个正交的旋钮**，多租户凭据隔离和版本灰度可以互不干扰地组合。
