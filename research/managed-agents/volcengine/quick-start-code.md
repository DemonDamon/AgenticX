---
source: https://ark.volcengine.com/region:cn-beijing/docs/quick-start-code
fetched: 2026-10-24
title: 快速入门（代码）
---

# 快速入门（代码）

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

4 步跑通你的第一个方舟托管 Agent：创建 Agent、创建环境、开启会话、发送消息并接收流式响应。

<span id="prerequisites"></span>
# 准备工作

<span id="get_api_key"></span>
## 1. 获取并配置 API Key

1. 获取 API Key：访问 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey)，创建你的 API Key。
2. 配置环境变量：在终端中运行下面命令（替换 `your_api_key_here` 为你的方舟 API Key），配置 API Key 到环境变量。

配置持久化环境变量方法参见 [环境变量配置指南](https://ark.volcengine.com/docs/environment-variable-configuration-guide)。

**选项：macOS**

```Bash
export ARK_API_KEY="your_api_key_here"  # gitleaks:allow
```

**选项：Linux**

```Bash
export ARK_API_KEY="your_api_key_here"  # gitleaks:allow
```

**选项：Windows_CMD**

```Bash
setx ARK_API_KEY "your_api_key_here"
```

**选项：Windows_PowerShell**

```PowerShell
$env:ARK_API_KEY = "your_api_key_here"  # gitleaks:allow
```

<span id="enable_managed_agent"></span>
## 2. 开通 Managed Agents 服务

访问 [开通管理页面](https://ark.volcengine.com/region:cn-beijing/openManagement)，切换到 **Managed Agents** 页签开通服务。

<span id="enable_model_service"></span>
## 3. 开通模型服务

访问 [开通管理页面](https://ark.volcengine.com/region:cn-beijing/openManagement) 开通模型服务。

<span id="create_agent"></span>
# 1. 创建 Agent
创建一个Agent，定义其模型、系统提示和可用工具。

```Bash
agent=$(
  curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/agents" \
    -H "Authorization: Bearer $ARK_API_KEY" \
    -H "Content-Type: application/json" \
    -d @- <<'EOF'
{
  "name": "Quick Start Agent",
  "model": {"id": "doubao-seed-2-1-pro-260628"},
  "system": "你是一个高效的编程助手，擅长代码编写和问题排查。",
  "tools": [
    {"type": "agent_toolset_20260916"}
  ]
}
EOF
)

AGENT_ID=$(jq -er '.id' <<<"$agent")

echo "Agent ID: $AGENT_ID"
```

<span id="create_environment"></span>
# 2. 创建环境
Environment 定义 Agent 执行代码和调用工具时使用的沙箱环境，可配置预装依赖、环境变量和产物存储。创建 Session 时，通过 `environment_id` 引用 Environment。

本示例使用 `config.type=cloud` 的云托管环境，由方舟按需启动和自动休眠沙箱，无需自行维护主机。

> `name` 在当前项目内必须唯一；与已有环境重名时，创建请求会失败。

```Bash
environment=$(
  curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/environments" \
    -H "Authorization: Bearer $ARK_API_KEY" \
    -H "Content-Type: application/json" \
    -d @- <<'EOF'
{
  "name": "demo-env",
  "config": {
    "type": "cloud",
    "networking": {"type": "unrestricted"}
  }
}
EOF
)

ENVIRONMENT_ID=$(jq -er '.id' <<<"$environment")

echo "Environment ID: $ENVIRONMENT_ID"
```

<span id="create_session"></span>
# 3. 开启会话
创建一个引用您的Agent和环境的会话。

```Bash
session=$(
  curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/sessions" \
    -H "Authorization: Bearer $ARK_API_KEY" \
    -H "Content-Type: application/json" \
    -d @- <<EOF
{
  "agent": "$AGENT_ID",
  "environment_id": "$ENVIRONMENT_ID",
  "title": "Quickstart session"
}
EOF
)

SESSION_ID=$(jq -er '.id' <<<"$session")

echo "Session ID: $SESSION_ID"
```

<span id="send_message_stream"></span>
# 4. 发送消息并流式接收响应
获取 `session_id` 后，先通过 `SessionEvents_streamEvents` 建立 SSE 连接并等待服务端返回 `: ready`，再通过 `SessionEvents_send` 发送 `user.message` 事件。客户端通过已建立的连接接收 Agent 状态、工具调用和响应内容。

> **注意**
>
> SSE 只推送连接建立后产生的事件，不回放历史事件。如果先发送消息再建立连接，客户端会漏掉连接建立前已产生的事件。

```Bash
# Open the SSE stream and wait for the ready comment before sending the message
STREAM_DIR=$(mktemp -d)
STREAM_PIPE="$STREAM_DIR/events"
mkfifo "$STREAM_PIPE"

cleanup_stream() {
  exec 3<&- || true
  if kill -0 "$STREAM_PID" 2>/dev/null; then
    kill "$STREAM_PID" 2>/dev/null || true
  fi
  wait "$STREAM_PID" 2>/dev/null || true
  rm -f "$STREAM_PIPE"
  rmdir "$STREAM_DIR" 2>/dev/null || true
}

curl -sS -N --fail-with-body \
  "https://ark.cn-beijing.volces.com/api/v3/sessions/$SESSION_ID/events/stream" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Accept: text/event-stream" >"$STREAM_PIPE" &
STREAM_PID=$!
exec 3<"$STREAM_PIPE"
trap cleanup_stream EXIT

stream_ready=false
while IFS= read -r line <&3; do
  if [[ $line == ": ready" ]]; then
    stream_ready=true
    break
  fi
done
if [[ $stream_ready != true ]]; then
  printf 'SSE stream closed before it was ready.\n' >&2
  exit 1
fi

# Send the user message after the stream is ready
curl -sS --fail-with-body \
  "https://ark.cn-beijing.volces.com/api/v3/sessions/$SESSION_ID/events" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d @- >/dev/null <<'EOF'
{
  "events": [
    {
      "type": "user.message",
      "content": [
        {"type": "text", "text": "用 Python 编写一个脚本，生成前 20 个斐波那契数，并将其保存到 fibonacci.txt。"}
      ]
    }
  ]
}
EOF

# Process events from the established stream
stream_finished=false
while IFS= read -r line <&3; do
  [[ $line == data:* ]] || continue
  json=${line#data: }
  case $(jq -r '.type' <<<"$json") in
    agent.message)
      jq -j '.content[] | select(.type == "text") | .text' <<<"$json"
      ;;
    agent.tool_use)
      printf '\n[Using tool: %s]\n' "$(jq -r '.name' <<<"$json")"
      ;;
    session.status_idle)
      printf '\n\nAgent finished.\n'
      stream_finished=true
      break
      ;;
  esac
done

if [[ $stream_finished != true ]]; then
  printf 'SSE stream closed before the Agent finished.\n' >&2
  exit 1
fi

cleanup_stream
trap - EXIT
```

**示例输出：**

```
[Using tool: write]

[Using tool: bash]

[Using tool: read]
已完成任务：
1. 编写了 Python 脚本 /workspace/generate_fibonacci.py，用于生成斐波那契数列
2. 成功运行脚本，生成的前 20 个斐波那契数为：[0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181]
3. 结果已保存到 /workspace/fibonacci.txt 文件中，文件内按序号清晰列出了每一个斐波那契数，内容验证正确。

Agent finished.
```

<span id="full_script"></span>
# 完整脚本

将上面 4 步合并为一个可直接运行的脚本，开头加 `set -euo pipefail`，任一步失败立即终止。

**用法：**

1. 将下面代码保存为 `quickstart.sh`。
2. 确保已按「准备工作」配置好 `ARK_API_KEY` 环境变量，并已安装 `curl` 与 `jq`。
3. 执行：

   ```Bash
   bash quickstart.sh
   ```

```Bash
#!/usr/bin/env bash
set -euo pipefail

export ARK_API_KEY="${ARK_API_KEY:?请先 export ARK_API_KEY}"  # gitleaks:allow
ARK_BASE_URL="https://ark.cn-beijing.volces.com"

# Step 1: Create Agent
agent=$(
  curl -sS --fail-with-body "$ARK_BASE_URL/api/v3/agents" \
    -H "Authorization: Bearer $ARK_API_KEY" \
    -H "Content-Type: application/json" \
    -d @- <<'EOF'
{
  "name": "Quick Start Agent",
  "model": {"id": "doubao-seed-2-1-pro-260628"},
  "system": "你是一个高效的编程助手，擅长代码编写和问题排查。",
  "tools": [
    {"type": "agent_toolset_20260916"}
  ]
}
EOF
)
AGENT_ID=$(jq -er '.id' <<<"$agent")
echo "Agent ID: $AGENT_ID"

# Step 2: Create Environment
environment=$(
  curl -sS --fail-with-body "$ARK_BASE_URL/api/v3/environments" \
    -H "Authorization: Bearer $ARK_API_KEY" \
    -H "Content-Type: application/json" \
    -d @- <<'EOF'
{
  "name": "demo-env",
  "config": {
    "type": "cloud",
    "networking": {"type": "unrestricted"}
  }
}
EOF
)
ENVIRONMENT_ID=$(jq -er '.id' <<<"$environment")
echo "Environment ID: $ENVIRONMENT_ID"

# Step 3: Create Session
session=$(
  curl -sS --fail-with-body "$ARK_BASE_URL/api/v3/sessions" \
    -H "Authorization: Bearer $ARK_API_KEY" \
    -H "Content-Type: application/json" \
    -d @- <<EOF
{
  "agent": "$AGENT_ID",
  "environment_id": "$ENVIRONMENT_ID",
  "title": "Quickstart session"
}
EOF
)
SESSION_ID=$(jq -er '.id' <<<"$session")
echo "Session ID: $SESSION_ID"

# Step 4: Open the SSE stream before sending the message
STREAM_DIR=$(mktemp -d)
STREAM_PIPE="$STREAM_DIR/events"
mkfifo "$STREAM_PIPE"

cleanup_stream() {
  exec 3<&- || true
  if kill -0 "$STREAM_PID" 2>/dev/null; then
    kill "$STREAM_PID" 2>/dev/null || true
  fi
  wait "$STREAM_PID" 2>/dev/null || true
  rm -f "$STREAM_PIPE"
  rmdir "$STREAM_DIR" 2>/dev/null || true
}

curl -sS -N --fail-with-body \
  "$ARK_BASE_URL/api/v3/sessions/$SESSION_ID/events/stream" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Accept: text/event-stream" >"$STREAM_PIPE" &
STREAM_PID=$!
exec 3<"$STREAM_PIPE"
trap cleanup_stream EXIT

stream_ready=false
while IFS= read -r line <&3; do
  if [[ $line == ": ready" ]]; then
    stream_ready=true
    break
  fi
done
if [[ $stream_ready != true ]]; then
  printf 'SSE stream closed before it was ready.\n' >&2
  exit 1
fi

# Send the user message after the stream is ready
curl -sS --fail-with-body \
  "$ARK_BASE_URL/api/v3/sessions/$SESSION_ID/events" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d @- >/dev/null <<'EOF'
{
  "events": [
    {
      "type": "user.message",
      "content": [
        {"type": "text", "text": "用 Python 编写一个脚本，生成前 20 个斐波那契数，并将其保存到 fibonacci.txt。"}
      ]
    }
  ]
}
EOF

stream_finished=false
while IFS= read -r line <&3; do
  [[ $line == data:* ]] || continue
  json=${line:5}
  json=${json# }
  case $(jq -r '.type' <<<"$json") in
    agent.message)
      jq -j '.content[] | select(.type == "text") | .text' <<<"$json"
      ;;
    agent.tool_use)
      printf '\n[Using tool: %s]\n' "$(jq -r '.name' <<<"$json")"
      ;;
    session.status_idle)
      printf '\n\nAgent finished.\n'
      stream_finished=true
      break
      ;;
  esac
done

if [[ $stream_finished != true ]]; then
  printf 'SSE stream closed before the Agent finished.\n' >&2
  exit 1
fi

cleanup_stream
trap - EXIT
```

## SDK 完整示例

**选项：Python**

```Python
import json
import os
import time

import httpx
from arkruntime import Ark


client = Ark(
    api_key=os.environ["ARK_API_KEY"],
    base_url="https://ark.cn-beijing.volces.com/api/v3",
)
suffix = str(int(time.time()))

agent = client.agents.create(
    name=f"quick-start-agent-{suffix}",
    model={"id": "doubao-seed-2-1-pro-260915"},
    system="你是一个高效的编程助手，擅长代码编写和问题排查。",
    tools=[{"type": "agent_toolset_20260916"}],
)
environment = client.environments.create(
    name=f"quick-start-env-{suffix}",
    config={
        "type": "cloud",
        "networking": {"type": "unrestricted"},
    },
)
session = client.sessions.create(
    agent=agent.id,
    environment_id=environment.id,
    title="Quickstart session",
)

try:
    stream_url = "https://ark.cn-beijing.volces.com/api/v3/sessions/{}/events/stream".format(session.id)
    stream_headers = {
        "Authorization": "Bearer {}".format(os.environ["ARK_API_KEY"]),
        "Accept": "text/event-stream",
    }
    with httpx.stream(
        "GET", stream_url, headers=stream_headers, timeout=None
    ) as response:
        response.raise_for_status()
        lines = response.iter_lines()
        for line in lines:
            if line == ": ready":
                break
        else:
            raise RuntimeError("SSE stream closed before it was ready.")

        client.sessions.events.send(
            session.id,
            events=[
                {
                    "type": "user.message",
                    "content": [
                        {
                            "type": "text",
                            "text": "用 Python 输出前 20 个斐波那契数。",
                        }
                    ],
                }
            ],
        )

        agent_finished = False
        for line in lines:
            if not line.startswith("data:"):
                continue
            data = line.removeprefix("data:").strip()
            if data == "[DONE]":
                break
            event = json.loads(data)
            print(event)
            if event["type"] in {
                "session.status_idle",
                "session.status_terminated",
            }:
                agent_finished = True
                break
        if not agent_finished:
            raise RuntimeError("SSE stream closed before the Agent finished.")
finally:
    client.sessions.delete(session.id)
    client.environments.delete(environment.id)
    client.agents.delete(agent.id)
```

**选项：Go**

```Go
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/volcengine/ark-runtime-go/arkruntime"
	agentmodel "github.com/volcengine/ark-runtime-go/arkruntime/model/agent"
	envmodel "github.com/volcengine/ark-runtime-go/arkruntime/model/environment"
	sessionmodel "github.com/volcengine/ark-runtime-go/arkruntime/model/session"
)

func main() {
	ctx := context.Background()
	client := arkruntime.NewClientWithApiKey(
		os.Getenv("ARK_API_KEY"),
		arkruntime.WithBaseUrl("https://ark.cn-beijing.volces.com/api/v3"),
	)
	suffix := fmt.Sprint(time.Now().Unix())

	agent, err := client.CreateAgent(ctx, &agentmodel.CreateAgentRequest{
		Name:   "quick-start-agent-" + suffix,
		Model:  agentmodel.ModelConfig{ID: "doubao-seed-2-1-pro-260915"},
		System: agentmodel.NewOptString("你是一个高效的编程助手。"),
		Tools:  []agentmodel.ToolItem{{Type: "agent_toolset_20260916"}},
	})
	if err != nil {
		panic(err)
	}

	environment, err := client.CreateEnvironment(ctx, &envmodel.CreateEnvironmentRequest{
		Name: "quick-start-env-" + suffix,
		Config: envmodel.NewOptEnvConfig(envmodel.EnvConfig{
			Type: envmodel.EnvConfigTypeCloud,
			Networking: envmodel.NewOptNetworkingConfig(envmodel.NetworkingConfig{
				Type: envmodel.NetworkingTypeUnrestricted,
			}),
		}),
	})
	if err != nil {
		panic(err)
	}

	session, err := client.CreateSession(ctx, &sessionmodel.CreateSessionRequest{
		Agent:         sessionmodel.NewStringAgentIdentifier(agent.ID),
		EnvironmentID: sessionmodel.NewOptString(environment.ID),
		Title:         sessionmodel.NewOptString("Quickstart session"),
	})
	if err != nil {
		panic(err)
	}
	defer client.DeleteAgent(ctx, agent.ID)
	defer client.DeleteEnvironment(ctx, environment.ID)
	defer client.DeleteSession(ctx, session.ID)

	content := sessionmodel.ManagedAgentsMessageContentBlock{
		OneOf: sessionmodel.NewManagedAgentsTextBlockManagedAgentsMessageContentBlockSum(
			sessionmodel.ManagedAgentsTextBlock{Text: "用 Python 输出前 20 个斐波那契数。"},
		),
	}
	event := sessionmodel.ManagedAgentsEventParams{
		OneOf: sessionmodel.NewManagedAgentsUserMessageEventParamsManagedAgentsEventParamsSum(
			sessionmodel.ManagedAgentsUserMessageEventParams{
				Content: []sessionmodel.ManagedAgentsMessageContentBlock{content},
			},
		),
	}

	stream, err := client.StreamSessionEvents(ctx, session.ID)
	if err != nil {
		panic(err)
	}
	defer stream.Close()

	_, err = client.SendSessionEvents(ctx, session.ID, &sessionmodel.SendSessionEventsRequest{
		Events: []sessionmodel.ManagedAgentsEventParams{event},
	})
	if err != nil {
		panic(err)
	}

	agentFinished := false
	for stream.Next() {
		frame := stream.Event()
		fmt.Printf("%s: %s\n", frame.Type, frame.RawPayload)
		if frame.Type == "session.status_idle" || frame.Type == "session.status_terminated" {
			agentFinished = true
			break
		}
	}
	if err := stream.Err(); err != nil {
		panic(err)
	}
	if !agentFinished {
		panic("SSE stream closed before the Agent finished.")
	}
}
```

**选项：Java**

```Java
package com.ark.sample;

import com.volcengine.ark.runtime.models.agent.Agent;
import com.volcengine.ark.runtime.models.agent.CreateAgentRequest;
import com.volcengine.ark.runtime.models.agent.ModelConfig;
import com.volcengine.ark.runtime.models.agent.ToolItem;
import com.volcengine.ark.runtime.models.environment.CreateEnvironmentRequest;
import com.volcengine.ark.runtime.models.environment.EnvConfig;
import com.volcengine.ark.runtime.models.environment.EnvConfigType;
import com.volcengine.ark.runtime.models.environment.Environment;
import com.volcengine.ark.runtime.models.environment.NetworkingConfig;
import com.volcengine.ark.runtime.models.environment.NetworkingType;
import com.volcengine.ark.runtime.models.session.AgentIdentifier;
import com.volcengine.ark.runtime.models.session.CreateSessionRequest;
import com.volcengine.ark.runtime.models.session.ManagedAgentsMessageContentBlock;
import com.volcengine.ark.runtime.models.session.ManagedAgentsTextBlock;
import com.volcengine.ark.runtime.models.session.ManagedAgentsUserMessageEventParams;
import com.volcengine.ark.runtime.models.session.SendSessionEventsRequest;
import com.volcengine.ark.runtime.models.session.Session;
import com.volcengine.ark.runtime.service.ArkService;
import okhttp3.ResponseBody;
import okio.BufferedSource;
import retrofit2.Response;

import java.util.Arrays;

public class ManagedAgentsQuickStart {
    public static void main(String[] args) throws Exception {
        ArkService service = ArkService.builder()
                .apiKey(System.getenv("ARK_API_KEY"))
                .baseUrl("https://ark.cn-beijing.volces.com/api/v3")
                .build();
        String suffix = String.valueOf(System.currentTimeMillis());

        Agent agent = service.createAgent(
                CreateAgentRequest.builder()
                        .name("quick-start-agent-" + suffix)
                        .model(ModelConfig.builder().id("doubao-seed-2-1-pro-260915").build())
                        .system("你是一个高效的编程助手。")
                        .tools(Arrays.asList(ToolItem.builder().type("agent_toolset_20260916").build()))
                        .build());
        Environment environment = service.createEnvironment(
                CreateEnvironmentRequest.builder()
                        .name("quick-start-env-" + suffix)
                        .config(EnvConfig.builder()
                                .type(EnvConfigType.CLOUD)
                                .networking(NetworkingConfig.builder()
                                        .type(NetworkingType.UNRESTRICTED)
                                        .build())
                                .build())
                        .build());
        Session session = service.createSession(
                CreateSessionRequest.builder()
                        .agent(AgentIdentifier.ofString(agent.getId()))
                        .environmentId(environment.getId())
                        .title("Quickstart session")
                        .build());

        try {
            ManagedAgentsTextBlock text = ManagedAgentsTextBlock.builder()
                    .text("用 Python 输出前 20 个斐波那契数。")
                    .build();
            ManagedAgentsUserMessageEventParams event =
                    ManagedAgentsUserMessageEventParams.builder()
                            .content(Arrays.<ManagedAgentsMessageContentBlock>asList(text))
                            .build();

            Response<ResponseBody> response =
                    service.streamSessionEvents(session.getId()).execute();
            if (!response.isSuccessful() || response.body() == null) {
                throw new IllegalStateException("Stream request failed: " + response.code());
            }
            try (ResponseBody body = response.body()) {
                BufferedSource source = body.source();
                service.sendSessionEvents(
                        session.getId(),
                        SendSessionEventsRequest.builder()
                                .events(Arrays.asList(event))
                                .build());

                String line;
                boolean agentFinished = false;
                while ((line = source.readUtf8Line()) != null) {
                    if (line.startsWith("data:")) {
                        System.out.println(line.substring(5).trim());
                    }
                    if (line.contains("session.status_idle")
                            || line.contains("session.status_terminated")) {
                        agentFinished = true;
                        break;
                    }
                }
                if (!agentFinished) {
                    throw new IllegalStateException(
                            "SSE stream closed before the Agent finished.");
                }
            }
        } finally {
            service.deleteSession(session.getId());
            service.deleteEnvironment(environment.getId());
            service.deleteAgent(agent.getId());
            service.shutdownExecutor();
        }
    }
}
```

<span id="runtime_notes"></span>
# 运行说明

当您发送用户事件时，方舟托管 Agent 会：

1. **配置沙箱**：您的环境配置决定了沙箱的构建方式。
2. **运行Agent循环**：方舟根据您的消息确定要使用哪些工具。
3. **执行工具**：启动沙箱，在沙箱内运行文件写入、bash 命令和其他工具调用。
4. **流式传输事件**：您会在Agent工作时收到实时更新。
5. **进入空闲状态**：当Agent没有更多任务要执行时，会发出 `session.status_idle` 事件。

# 设计建议

配置 Agent 和 Session 时，按照配置的生命周期区分长期能力与单次任务：

- **长期能力写入 Agent 定义**：通过 `Agents_create` 或 `Agents_update` 配置系统提示词、Skills、Tools 和 MCP Server，供多个 Session 复用。
- **单次任务通过 Session 事件传入**：通过 `SessionEvents_send` 发送 `user.message` 事件，不要将本次任务写入 Agent 的 `system` 字段。

将单次任务写入 `system` 会降低 Agent 定义的复用性；将长期规则放入 Session 事件则需要重复传输，也容易造成不同 Session 的配置不一致。

<span id="next_steps"></span>
# 后续步骤

**[定义 Agent](define-agent.md)**

定义 Agent 的模型、系统提示词、工具集与运行行为。

**[配置环境](configure-cloud-environment.md)**

配置 Agent 运行所在的云端沙箱环境，包含网络、预装依赖包与环境变量。

**[Agent tools](tools.md)**

配置 Agent 在 Session 中可主动调用的工具集合。

**[Session 事件流](session-event-stream.md)**

通过 SSE 事件流实时接收 Agent 的消息、工具调用与状态更新。
