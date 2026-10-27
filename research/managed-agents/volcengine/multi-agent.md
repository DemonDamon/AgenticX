---
source: https://ark.volcengine.com/region:cn-beijing/docs/multi-agent
fetched: 2026-10-24
title: 编排 Multi Agent
---

# 编排 Multi Agent

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

Multi Agent（多智能体协作）允许协调器 Agent 将任务委派给多个子智能体。子智能体使用各自的模型、系统提示词、技能和工具完成任务。协调器负责拆分任务并汇总结果。

本页从已有子智能体和 Environment 开始，演示如何创建协调器、运行任务、验证结果和处理异常。

## 选择并准备

Multi Agent 适合需要角色分工或并行处理的复杂任务。如果任务不需要独立上下文或角色边界，优先使用更简单的方式。

| 任务特征 | 推荐方式 | 适用场景 |
| --- | --- | --- |
| 多个角色需要使用不同提示词、模型或工具 | Multi Agent | 代码审查、测试设计等多角色任务 |
| 单个 Agent 按固定步骤调用工具 | Agent + 工具（Tools） | 流程固定，不需要独立角色上下文 |
| 单个 Agent 复用操作说明 | Agent + 技能（Skills） | 需要沉淀流程，但不需要角色协作 |

开始前，完成以下准备：

- 创建 API Key，并配置为 `ARK_API_KEY`。详情请参见 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey)。
- 创建两个子智能体，并记录 Agent ID 和版本号。详情请参见 [Agent](define-agent.md)。
- 创建或复用云环境，并记录 Environment ID。详情请参见 [配置云环境](configure-cloud-environment.md)。
- 选择协调器模型，并确认本地已安装 `curl` 和 `jq`。

配置环境变量：

```Bash
export ARK_API_KEY="<ARK_API_KEY>"  # gitleaks:allow
export ARK_BASE_URL="https://ark.cn-beijing.volces.com/api/v3"
export COORDINATOR_MODEL_ID="<MODEL_ID>"
export REVIEWER_AGENT_ID="<REVIEWER_AGENT_ID>"
export REVIEWER_AGENT_VERSION="<REVIEWER_AGENT_VERSION>"
export TESTER_AGENT_ID="<TESTER_AGENT_ID>"
export TESTER_AGENT_VERSION="<TESTER_AGENT_VERSION>"
export ENVIRONMENT_ID="<ENVIRONMENT_ID>"
```

## 配置协调器

### 定义角色和委派规则

协调器的系统提示词需要说明每个子智能体的职责和输出。角色边界越明确，协调器越容易正确分配任务。

| 角色 | 职责 |
| --- | --- |
| 代码审查员 | 检查代码质量、架构和安全风险，输出问题与修改建议 |
| 测试工程师 | 设计测试用例，说明覆盖范围和未覆盖风险 |

系统提示词还需要要求协调器先拆分和委派任务，收到全部结果后再汇总。下方 cURL 包含完整提示词。

### 创建协调器

在 `multiagent.agents` 中传入子智能体 ID 和版本号。显式填写版本后，子智能体发布新版本不会改变当前协调器。

**选项：cURL**

```Bash
: "${ARK_BASE_URL:?Set ARK_BASE_URL}"
: "${ARK_API_KEY:?Set ARK_API_KEY}"
: "${COORDINATOR_MODEL_ID:?Set COORDINATOR_MODEL_ID}"
: "${REVIEWER_AGENT_ID:?Set REVIEWER_AGENT_ID}"
: "${REVIEWER_AGENT_VERSION:?Set REVIEWER_AGENT_VERSION}"
: "${TESTER_AGENT_ID:?Set TESTER_AGENT_ID}"
: "${TESTER_AGENT_VERSION:?Set TESTER_AGENT_VERSION}"

COORDINATOR_SYSTEM='你有以下团队成员：

【代码审查员】
- 检查代码质量、架构和安全风险。
- 输出问题列表、严重程度和修改建议。
- 不负责编写新功能。

【测试工程师】
- 设计测试用例并检查覆盖范围。
- 输出测试用例、覆盖范围和未覆盖风险。
- 不修改产品需求。

先拆分任务，再分别委派。收到全部结果后，汇总为最终结论。'
export COORDINATOR_SYSTEM

coordinator_payload=$(
  jq -n \
    --arg model_id "$COORDINATOR_MODEL_ID" \
    --arg system "$COORDINATOR_SYSTEM" \
    --arg reviewer_id "$REVIEWER_AGENT_ID" \
    --argjson reviewer_version "$REVIEWER_AGENT_VERSION" \
    --arg tester_id "$TESTER_AGENT_ID" \
    --argjson tester_version "$TESTER_AGENT_VERSION" \
    '{
      name: "engineering-lead",
      model: {id: $model_id},
      system: $system,
      multiagent: {
        type: "coordinator",
        agents: [
          {type: "agent", id: $reviewer_id, version: $reviewer_version},
          {type: "agent", id: $tester_id, version: $tester_version}
        ]
      }
    }'
)

coordinator=$(
  curl -sS --fail-with-body "$ARK_BASE_URL/agents" \
    -H "Authorization: Bearer $ARK_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$coordinator_payload"
)

export COORDINATOR_AGENT_ID
export COORDINATOR_AGENT_VERSION
COORDINATOR_AGENT_ID=$(jq -er '.id' <<<"$coordinator")
COORDINATOR_AGENT_VERSION=$(jq -er '.version' <<<"$coordinator")

printf 'Coordinator Agent ID: %s\n' "$COORDINATOR_AGENT_ID"
printf 'Coordinator Agent version: %s\n' "$COORDINATOR_AGENT_VERSION"
```

脚本将协调器 ID 和版本号写入 `COORDINATOR_AGENT_ID` 和 `COORDINATOR_AGENT_VERSION`。字段说明请参见 [创建智能体](api/create-agent-api.md)。

也可以通过控制台配置：

1. 进入 [Agent 管理页面](https://ark.volcengine.com/region:cn-beijing/managed-agent/agents)。
2. 创建或编辑 Agent，在 **04 能力扩展** 区域添加 **Multi Agents**。
3. 选择子智能体，填写前面的系统提示词并保存。
4. 记录协调器 Agent ID 和版本号。

## 运行任务

主流程使用两个终端。终端 A 接收主事件流，终端 B 创建 Session、发送任务和查询结果。需要实时观察子线程时，再打开终端 C。

### 1. 创建 Session

在终端 B 创建 Session：

**选项：cURL**

```Bash
: "${ARK_BASE_URL:?Set ARK_BASE_URL}"
: "${ARK_API_KEY:?Set ARK_API_KEY}"
: "${COORDINATOR_AGENT_ID:?Set COORDINATOR_AGENT_ID}"
: "${ENVIRONMENT_ID:?Set ENVIRONMENT_ID}"

payload=$(
  jq -n \
    --arg agent_id "$COORDINATOR_AGENT_ID" \
    --arg environment_id "$ENVIRONMENT_ID" \
    '{
      agent: $agent_id,
      environment_id: $environment_id,
      title: "Multi Agent task"
    }'
)

session=$(
  curl -sS --fail-with-body "$ARK_BASE_URL/sessions" \
    -H "Authorization: Bearer $ARK_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$payload"
)

export SESSION_ID
SESSION_ID=$(jq -er '.id' <<<"$session")
printf 'Session ID: %s\n' "$SESSION_ID"
```

脚本将 Session ID 写入 `SESSION_ID`：

```Text
Session ID: sesn-20261005121000-xxxxx
```

### 2. 订阅主事件流

在终端 A 配置同一个 Session ID：

```Bash
export ARK_API_KEY="<ARK_API_KEY>"  # gitleaks:allow
export ARK_BASE_URL="https://ark.cn-beijing.volces.com/api/v3"
export SESSION_ID="<SESSION_ID>"
```

建立主事件流：

**选项：cURL**

```Bash
: "${ARK_BASE_URL:?Set ARK_BASE_URL}"
: "${ARK_API_KEY:?Set ARK_API_KEY}"
: "${SESSION_ID:?Set SESSION_ID}"

curl -sS -N --fail-with-body --max-time 600 \
  "$ARK_BASE_URL/sessions/$SESSION_ID/events/stream" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Accept: text/event-stream"
```

终端 A 输出 `: ready` 后保持连接。先建连再发送任务，可以避免遗漏实时事件。

### 3. 发送任务

回到终端 B，配置任务内容：

```Bash
TASK_TEXT=$(cat <<'EOF'
评审以下 Python 登录接口实现。代码审查员分析代码质量、架构和安全风险，测试工程师设计测试用例并说明覆盖范围，最后汇总结论。

def login(username, password):
    key = f"login_failures:{username}"
    failures = int(redis.get(key) or 0)
    if failures >= 5:
        return {"ok": False, "reason": "locked"}
    if not verify_password(username, password):
        redis.incr(key)
        redis.expire(key, 1800)
        return {"ok": False, "reason": "denied"}
    redis.delete(key)
    return {"ok": True}
EOF
)
export TASK_TEXT
```

发送任务：

**选项：cURL**

```Bash
: "${ARK_BASE_URL:?Set ARK_BASE_URL}"
: "${ARK_API_KEY:?Set ARK_API_KEY}"
: "${SESSION_ID:?Set SESSION_ID}"
: "${TASK_TEXT:?Set TASK_TEXT}"

payload=$(
  jq -n --arg text "$TASK_TEXT" \
    '{events: [{type: "user.message", content: [{type: "text", text: $text}]}]}'
)

curl -sS --fail-with-body \
  "$ARK_BASE_URL/sessions/$SESSION_ID/events" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$payload"
```

#### 实时观察子线程（可选）

只在需要实时观察子智能体时执行以下步骤：

1. 终端 A 收到 `session.thread_created` 后，记录 `session_thread_id`。
2. 在终端 C 配置鉴权信息、Session ID 和子线程 ID：

    ```Bash
    export ARK_API_KEY="<ARK_API_KEY>"  # gitleaks:allow
    export ARK_BASE_URL="https://ark.cn-beijing.volces.com/api/v3"
    export SESSION_ID="<SESSION_ID>"
    export SESSION_THREAD_ID="<SESSION_THREAD_ID>"
    ```

3. 建立子线程事件流：

**选项：cURL**

```Bash
: "${ARK_BASE_URL:?Set ARK_BASE_URL}"
: "${ARK_API_KEY:?Set ARK_API_KEY}"
: "${SESSION_ID:?Set SESSION_ID}"
: "${SESSION_THREAD_ID:?Set SESSION_THREAD_ID}"

curl -sS -N --fail-with-body --max-time 600 \
  "$ARK_BASE_URL/sessions/$SESSION_ID/threads/$SESSION_THREAD_ID/stream" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Accept: text/event-stream"
```

4. 终端 C 输出 `: ready` 后，在终端 B 按“验证结果”中的方式补查该子线程历史。
5. 按事件 `id` 合并实时和历史事件，忽略重复 ID。

每个子线程使用独立事件流。出现多个 `session_thread_id` 时，分别重复以上步骤。

### 4. 等待本轮结束

继续观察终端 A。正常事件轨迹如下：

```Text
session.thread_created
agent.thread_message_sent
session.thread_status_idle
agent.message
session.status_idle
```

收到 `session.status_idle` 后检查 `stop_reason.type`：

- `end_turn`：本轮执行结束，按下一节验证结果。
- `requires_action`：保持连接，处理全部待操作事件后继续观察。
- `retries_exhausted`：调整输入后可以发送新任务；如果修改 Agent 配置，请创建新 Session。

## 验证结果

在终端 B 列出全部线程：

**选项：cURL**

```Bash
: "${ARK_BASE_URL:?Set ARK_BASE_URL}"
: "${ARK_API_KEY:?Set ARK_API_KEY}"
: "${SESSION_ID:?Set SESSION_ID}"

threads=$(
  curl -sS --fail-with-body \
    "$ARK_BASE_URL/sessions/$SESSION_ID/threads?limit=100" \
    -H "Authorization: Bearer $ARK_API_KEY"
)

printf 'Agent\tThread ID\tStatus\n'
jq -r '.data[] | [.agent_name, .id, .status] | @tsv' <<<"$threads"

export SESSION_THREAD_ID
if ! SESSION_THREAD_ID=$(jq -er '.data[1].id' <<<"$threads"); then
  printf 'No child thread is available yet.\n' >&2
  return 1 2>/dev/null || exit 1
fi
printf 'Selected child thread ID: %s\n' "$SESSION_THREAD_ID"
```

命令将第一个子线程 ID 写入 `SESSION_THREAD_ID`。检查其他子线程时，更新该变量并清空分页标识：

```Bash
unset THREAD_EVENTS_PAGE
```

查询该子线程的完整历史：

**选项：cURL**

```Bash
: "${ARK_BASE_URL:?Set ARK_BASE_URL}"
: "${ARK_API_KEY:?Set ARK_API_KEY}"
: "${SESSION_ID:?Set SESSION_ID}"
: "${SESSION_THREAD_ID:?Set SESSION_THREAD_ID}"

request_args=(
  --get
  "$ARK_BASE_URL/sessions/$SESSION_ID/threads/$SESSION_THREAD_ID/events"
  --data-urlencode "limit=100"
  --data-urlencode "order=asc"
)

if [[ -n ${THREAD_EVENTS_PAGE:-} ]]; then
  request_args+=(--data-urlencode "page=$THREAD_EVENTS_PAGE")
fi

if ! events=$(
  curl -sS --fail-with-body \
    "${request_args[@]}" \
    -H "Authorization: Bearer $ARK_API_KEY"
); then
  return 1 2>/dev/null || exit 1
fi

printf 'Events:\n'
jq -c '.data[]' <<<"$events"

export THREAD_EVENTS_PAGE
THREAD_EVENTS_PAGE=$(jq -r '.next_page // empty' <<<"$events")
printf 'Next page: %s\n' "$THREAD_EVENTS_PAGE"
```

如果 `Next page` 不为空，保持 `THREAD_EVENTS_PAGE` 并重复执行，直到下一页标识为空。切换子线程前必须再次清空该变量。

主线程和各子线程使用独立事件流，不能根据跨流到达顺序判断执行顺序。使用 `session_thread_id`、`from_session_thread_id` 和 `to_session_thread_id` 关联委派与返回消息。

只有同时满足以下条件，本轮任务才成功：

- 主线程产生最终 `agent.message`。
- Session 以 `stop_reason.type=end_turn` 进入 `idle`。
- 没有子线程停留在 `running` 或 `rescheduling`。
- 本轮没有出现 `session.thread_status_terminated`。

> **注意**
>
> HTTP 200 只表示服务端已受理事件。`session.status_idle` 不一定表示任务成功。

## 处理异常状态

| 信号 | 含义 | 处理动作 |
| --- | --- | --- |
| SSE 连接中断 | 中断期间的事件不会自动回放 | 先重建连接，再查询历史并按事件 ID 去重 |
| `requires_action` | 等待工具确认或外部工具结果 | 处理全部 `stop_reason.event_ids` |
| `session.thread_status_rescheduled` | 子线程正在自动重新调度 | 保持监听，不要并行手动重试 |
| `session.thread_status_terminated` | 子线程已终止 | 查询历史和错误事件，Session 空闲后重新分配任务 |
| 子线程长时间保持 `running` | 子任务未结束 | 携带 `session_thread_id` 发送 `user.interrupt` |
| `retries_exhausted` | 当前轮次重试次数已用尽 | 调整输入后重试；修改 Agent 配置后创建新 Session |

### 处理等待操作

子线程以 `requires_action` 进入 `idle` 后，按以下步骤处理：

1. 保持主事件流和目标子线程事件流连接。如果连接已关闭，先重新建连并等待 `: ready`，再补查历史。补查主线程前清空分页标识：

    ```Bash
    unset SESSION_EVENTS_PAGE
    ```

**选项：cURL**

```Bash
: "${ARK_BASE_URL:?Set ARK_BASE_URL}"
: "${ARK_API_KEY:?Set ARK_API_KEY}"
: "${SESSION_ID:?Set SESSION_ID}"

request_args=(
  --get
  "$ARK_BASE_URL/sessions/$SESSION_ID/events"
  --data-urlencode "limit=100"
  --data-urlencode "order=asc"
)

if [[ -n ${SESSION_EVENTS_PAGE:-} ]]; then
  request_args+=(--data-urlencode "page=$SESSION_EVENTS_PAGE")
fi

if ! events=$(
  curl -sS --fail-with-body \
    "${request_args[@]}" \
    -H "Authorization: Bearer $ARK_API_KEY"
); then
  return 1 2>/dev/null || exit 1
fi

printf 'Events:\n'
jq -c '.data[]' <<<"$events"

export SESSION_EVENTS_PAGE
SESSION_EVENTS_PAGE=$(jq -r '.next_page // empty' <<<"$events")
printf 'Next page: %s\n' "$SESSION_EVENTS_PAGE"
```

2. 从 `session.thread_status_idle` 中记录 `session_thread_id` 和全部 `stop_reason.event_ids`。按“验证结果”中的方式补查子线程，并逐一找到这些事件。
3. 对 `agent.tool_use` 或 `agent.mcp_tool_use`，配置关联 ID 并发送确认：

    ```Bash
    export SESSION_THREAD_ID="<SESSION_THREAD_ID>"
    export TOOL_USE_ID="<TOOL_USE_ID>"
    ```

**选项：cURL**

```Bash
: "${ARK_BASE_URL:?Set ARK_BASE_URL}"
: "${ARK_API_KEY:?Set ARK_API_KEY}"
: "${SESSION_ID:?Set SESSION_ID}"
: "${SESSION_THREAD_ID:?Set SESSION_THREAD_ID}"
: "${TOOL_USE_ID:?Set TOOL_USE_ID}"

payload=$(
  jq -n \
    --arg thread_id "$SESSION_THREAD_ID" \
    --arg tool_use_id "$TOOL_USE_ID" \
    '{
      events: [{
        type: "user.tool_confirmation",
        session_thread_id: $thread_id,
        tool_use_id: $tool_use_id,
        result: "allow"
      }]
    }'
)

curl -sS --fail-with-body \
  "$ARK_BASE_URL/sessions/$SESSION_ID/events" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$payload"
```

4. 对 `agent.custom_tool_use`，执行自定义工具并发送 `user.custom_tool_result`。请求需要携带当前 `session_thread_id` 和 `custom_tool_use_id`。详情请参见 [Tools](tools.md)。
5. 处理全部 `event_ids` 后继续观察。任务可能再次进入 `requires_action`；只有 Session 最终以 `end_turn` 结束，本轮任务才完成。

本页主流程使用云环境，不覆盖自托管 Environment 的 `user.tool_result` 流程。自托管流程请参见 [Tools](tools.md)。

### 中断线程

只停止一个子线程时，运行 `export SESSION_THREAD_ID="<SESSION_THREAD_ID>"`。停止全部活跃线程时，运行 `unset SESSION_THREAD_ID`。

**选项：cURL**

```Bash
: "${ARK_BASE_URL:?Set ARK_BASE_URL}"
: "${ARK_API_KEY:?Set ARK_API_KEY}"
: "${SESSION_ID:?Set SESSION_ID}"

if [[ -n ${SESSION_THREAD_ID:-} ]]; then
  payload=$(
    jq -n --arg thread_id "$SESSION_THREAD_ID" \
      '{events: [{type: "user.interrupt", session_thread_id: $thread_id}]}'
  )
else
  payload=$(jq -n '{events: [{type: "user.interrupt"}]}')
fi

curl -sS --fail-with-body \
  "$ARK_BASE_URL/sessions/$SESSION_ID/events" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$payload"
```

中断指定子线程后等待该线程进入 `idle`；中断全部线程后等待 Session 进入 `idle`。

## 更新协作配置

新增、移除子智能体或切换版本时，先调用 [查询智能体详情](api/get-agent-api.md) 查询协调器最新配置。更新请求需要携带当前 `version`，并整体提交匹配的系统提示词和 `multiagent.agents`。

```Bash
export COORDINATOR_AGENT_VERSION="<LATEST_VERSION>"

COORDINATOR_AGENTS_JSON=$(
  jq -n \
    --arg reviewer_id "$REVIEWER_AGENT_ID" \
    --argjson reviewer_version "$REVIEWER_AGENT_VERSION" \
    --arg tester_id "$TESTER_AGENT_ID" \
    --argjson tester_version "$TESTER_AGENT_VERSION" \
    '[
      {type: "agent", id: $reviewer_id, version: $reviewer_version},
      {type: "agent", id: $tester_id, version: $tester_version}
    ]'
)
export COORDINATOR_AGENTS_JSON
```

通过 API 创建协调器时，创建脚本已导出 `COORDINATOR_SYSTEM`。如果通过控制台创建，请先将控制台使用的完整系统提示词配置到该变量。提示词必须与成员列表保持一致。

**选项：cURL**

```Bash
: "${ARK_BASE_URL:?Set ARK_BASE_URL}"
: "${ARK_API_KEY:?Set ARK_API_KEY}"
: "${COORDINATOR_AGENT_ID:?Set COORDINATOR_AGENT_ID}"
: "${COORDINATOR_AGENT_VERSION:?Set COORDINATOR_AGENT_VERSION}"
: "${COORDINATOR_SYSTEM:?Set COORDINATOR_SYSTEM}"
: "${COORDINATOR_AGENTS_JSON:?Set COORDINATOR_AGENTS_JSON}"

update_payload=$(
  jq -n \
    --argjson version "$COORDINATOR_AGENT_VERSION" \
    --arg system "$COORDINATOR_SYSTEM" \
    --argjson agents "$COORDINATOR_AGENTS_JSON" \
    '{
      version: $version,
      system: $system,
      multiagent: {
        type: "coordinator",
        agents: $agents
      }
    }'
)

coordinator=$(
  curl -sS --fail-with-body \
    "$ARK_BASE_URL/agents/$COORDINATOR_AGENT_ID" \
    -H "Authorization: Bearer $ARK_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$update_payload"
)

export COORDINATOR_AGENT_VERSION
COORDINATOR_AGENT_VERSION=$(jq -er '.version' <<<"$coordinator")

printf 'Coordinator Agent version: %s\n' "$COORDINATOR_AGENT_VERSION"
```

脚本将新版本号写入 `COORDINATOR_AGENT_VERSION`。如果返回 `version: conflict`，重新查询并合并最新配置后再提交。

现有 Session 不会自动切换版本。只有 Session 处于 `idle`、上一轮以 `end_turn` 结束且没有其他升级请求时，才可以升级：

**选项：cURL**

```Bash
: "${ARK_BASE_URL:?Set ARK_BASE_URL}"
: "${ARK_API_KEY:?Set ARK_API_KEY}"
: "${SESSION_ID:?Set SESSION_ID}"
: "${COORDINATOR_AGENT_ID:?Set COORDINATOR_AGENT_ID}"
: "${COORDINATOR_AGENT_VERSION:?Set COORDINATOR_AGENT_VERSION}"

payload=$(
  jq -n \
    --arg agent_id "$COORDINATOR_AGENT_ID" \
    --argjson version "$COORDINATOR_AGENT_VERSION" \
    '{agent: {type: "agent_with_upgrades", id: $agent_id, version: $version}}'
)

curl -sS --fail-with-body \
  "$ARK_BASE_URL/sessions/$SESSION_ID/upgrades" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$payload"
```

等待 Session 使用目标版本恢复为 `idle`：

**选项：cURL**

```Bash
: "${ARK_BASE_URL:?Set ARK_BASE_URL}"
: "${ARK_API_KEY:?Set ARK_API_KEY}"
: "${SESSION_ID:?Set SESSION_ID}"
: "${COORDINATOR_AGENT_ID:?Set COORDINATOR_AGENT_ID}"
: "${COORDINATOR_AGENT_VERSION:?Set COORDINATOR_AGENT_VERSION}"
: "${SESSION_UPGRADE_MAX_ATTEMPTS:=60}"
: "${SESSION_UPGRADE_INTERVAL_SECONDS:=2}"

upgrade_result="timeout"

for ((attempt = 1; attempt <= SESSION_UPGRADE_MAX_ATTEMPTS; attempt++)); do
  session=$(
    curl -sS --fail-with-body \
      "$ARK_BASE_URL/sessions/$SESSION_ID" \
      -H "Authorization: Bearer $ARK_API_KEY"
  ) || {
    upgrade_result="request_failed"
    break
  }

  session_status=$(jq -er '.status' <<<"$session") || {
    upgrade_result="invalid_response"
    break
  }
  session_agent_id=$(jq -r '.agent.id // empty' <<<"$session")
  session_agent_version=$(jq -r '.agent.version // empty' <<<"$session")

  printf 'Attempt %s: status=%s, agent=%s, version=%s\n' \
    "$attempt" \
    "$session_status" \
    "$session_agent_id" \
    "$session_agent_version"

  if [[
    $session_status == "idle" &&
    $session_agent_id == "$COORDINATOR_AGENT_ID" &&
    $session_agent_version == "$COORDINATOR_AGENT_VERSION"
  ]]; then
    upgrade_result="completed"
    break
  fi

  case "$session_status" in
    terminated | failed)
      upgrade_result="$session_status"
      break
      ;;
  esac

  sleep "$SESSION_UPGRADE_INTERVAL_SECONDS"
done

if [[ $upgrade_result != "completed" ]]; then
  printf 'Session upgrade did not complete: %s\n' "$upgrade_result" >&2
  false
fi
```

脚本默认每 2 秒查询一次，最多 60 次。只有状态为 `idle`，且 `agent.id` 和 `agent.version` 与目标一致时才返回成功；超时或进入失败状态时，请检查 Session 或创建新 Session。

## 使用限制

- 子智能体数量：单个协调器最多配置 20 个子智能体，详情请参见 [创建智能体](api/create-agent-api.md)。
- 委派层级：Multi Agent 只展开一层。`multiagent.agents[].type` 为 `self` 时复用协调器配置创建子线程，但不会继续复用协调器的 `multiagent` 列表。
- 版本快照：更新协调器不会修改已有 Session 的 Agent 快照。
- 资源消耗：协调器和子智能体分别产生模型与运行资源用量，详情请参见 [模型价格](https://ark.volcengine.com/docs/model-pricing#ma_billing)。

## 清理资源

确认产物已转存后，使用精确 ID 删除本页创建的 Session。Session 仍在运行时，先中断全部线程并等待 `idle`。默认保留协调器：

```Bash
export CONFIRM_DELETE="yes"
export DELETE_COORDINATOR="no"
```

仅当协调器不再被任何 Session 使用时，才将 `DELETE_COORDINATOR` 改为 `yes`。执行删除：

**选项：cURL**

```Bash
: "${ARK_BASE_URL:?Set ARK_BASE_URL}"
: "${ARK_API_KEY:?Set ARK_API_KEY}"
: "${SESSION_ID:?Set SESSION_ID}"
: "${CONFIRM_DELETE:?Set CONFIRM_DELETE to yes}"
: "${DELETE_COORDINATOR:=no}"

if [[ $CONFIRM_DELETE != "yes" ]]; then
  printf 'Set CONFIRM_DELETE=yes to delete the recorded resources.\n' >&2
  return 1 2>/dev/null || exit 1
fi

curl -sS --fail-with-body \
  "$ARK_BASE_URL/sessions/$SESSION_ID" \
  -X DELETE \
  -H "Authorization: Bearer $ARK_API_KEY"

if [[ $DELETE_COORDINATOR == "yes" ]]; then
  : "${COORDINATOR_AGENT_ID:?Set COORDINATOR_AGENT_ID}"
  curl -sS --fail-with-body \
    "$ARK_BASE_URL/agents/$COORDINATOR_AGENT_ID" \
    -X DELETE \
    -H "Authorization: Bearer $ARK_API_KEY"
fi
```

命令不会删除子智能体或 Environment。

> **警告**
>
> 删除 Session 或 Agent 后无法恢复。只使用本页记录的精确 ID，不要按名称模糊匹配或批量删除共享资源。

## 相关文档

- [Agent](define-agent.md)
- [Session 事件流](session-event-stream.md)
- [Tools](tools.md)
- [管理 Session](manage-session.md)
