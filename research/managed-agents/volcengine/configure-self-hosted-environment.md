---
source: https://ark.volcengine.com/region:cn-beijing/docs/configure-self-hosted-environment
fetched: 2026-10-24
title: 配置并运行自托管环境
---

# 配置并运行自托管环境

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

本文介绍如何从零配置自托管环境（Self-hosted Environment），选择 Go、Python 或 Java SDK 启动 Worker，并完成一次完整的 Session 工具执行。

## 你将完成什么

- 在控制台创建 `self_hosted` 类型的环境
- 为 Worker 配置并安全保存 API Key
- 选择 Go、Python 或 Java SDK，在企业主机启动 Worker
- 创建绑定自托管环境的 Session
- 发送用户消息，让主 Agent 在企业主机执行 Bash 和文件工具
- 验证工具执行结果、Session 终态和 Worker 状态

## 核心概念

| 概念 | 说明 |
| --- | --- |
| **Environment** | Agent 运行时配置，`type` 为 `self_hosted` 时表示自托管环境 |
| **Worker** | 企业部署的进程，轮询 Work Queue，并在企业 Sandbox 中执行主 Agent 的 `bash`、`read`、`write`、`edit`、`glob` 和 `grep` |
| **Work Item** | 方舟为需要工具执行的 Session 生成的任务项，Work ID 与 Session ID 一致 |
| **API Key** | Worker 和业务应用调用方舟接口时使用的鉴权凭证。Worker 使用的 API Key 权限取决于所属账号、项目和凭证策略，不会自动限制为只能访问某个 Environment |

## 工作流程

以下是自托管环境端到端的工作流程：

1. 企业管理员创建自托管 Environment，并为 Worker 准备 API Key。
2. 企业运维人员在企业主机启动 Worker，Worker 开始轮询 Work Queue。
3. 业务应用使用业务 API Key 创建 Session，建立事件流后发送用户消息。
4. 方舟控制面生成 Work Item，Worker 领取并 Ack。
5. 主 Agent 调用 `bash`、`read`、`write`、`edit`、`glob` 或 `grep` 时，Worker 在企业 Sandbox 中执行并回传结果。
6. 主 Agent 调用 Web、MCP 或多模态工具时，方舟完成执行；Agent 调用自定义工具时，业务应用完成执行。
7. 工具结果驱动下一轮推理。
8. 重复步骤 5-7，直到 Session 进入 `idle` 或终态。
9. Worker 完成 Work Item，继续轮询。

> **注意**
>
> 自托管 Environment 不会把所有工具迁移到 Worker。企业 Sandbox 的文件和网络策略只约束 Worker 执行的六个工具，不约束方舟侧执行的 Web、MCP 和多模态工具。

## 前置条件

开始前，请确认以下条件已满足：

- 已开通 Managed Agents 服务，并已创建 Agent（参见 [快速入门](quick-start-code.md)）
- 准备一台企业管理的 Linux 主机或隔离容器，具备以下条件：
  - `/bin/bash` 可用
  - `/workspace` 目录可写
  - 已选择一种 Ark Runtime SDK，并按对应仓库 README 准备运行环境：[Go](https://github.com/volcengine/ark-runtime-go)、[Python](https://github.com/volcengine/ark-runtime-python) 或 [Java](https://github.com/volcengine/ark-runtime-java)
- Worker 主机能够通过出站 HTTPS 访问方舟 API（`https://ark.cn-beijing.volces.com/api/v3`），无需开放入站端口
- 业务应用所在主机已安装 `curl` 7.76 或更高版本，并已安装 `jq`
- 准备业务 API Key（用于创建 Session，由业务应用持有）
- 准备 Worker 使用的方舟 API Key，由 Worker 主机持有

> **注意**
>
> 当前没有仅能访问指定 Environment 的独立 Worker 凭证。Worker 使用标准方舟 API Key 访问 Work Queue，实际权限取决于该 API Key 所属账号、项目和凭证策略。不要把 `MA_ENVIRONMENT_ID` 误认为鉴权范围限制。
>
> 建议为业务应用和 Worker 分配不同的 API Key，并分别保存在 Secret Manager 中。Worker API Key 的权限不会自动限制为单个 Environment。独立凭证便于单独轮换和吊销，但不能替代账号和项目级权限控制。

## 第 1 步：创建自托管环境

在控制台的 [Environments](https://ark.volcengine.com/region:cn-beijing/managed-agents/environments) 页面或使用 API 创建自托管环境。

使用 API 创建环境：

```Bash
export ARK_API_KEY="<BUSINESS_API_KEY>"  # gitleaks:allow

ENVIRONMENT_RESPONSE=$(curl --fail-with-body -sS https://ark.cn-beijing.volces.com/api/v3/environments \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-self-hosted-env",
    "description": "自托管环境，用于执行企业内部工具",
    "config": {
      "type": "self_hosted"
    }
  }') &&
ENVIRONMENT_ID=$(printf '%s\n' "$ENVIRONMENT_RESPONSE" | jq -er \
  '.id | select(type == "string" and startswith("env-"))') &&
export ENVIRONMENT_ID &&
printf 'Environment ID: %s\n' "$ENVIRONMENT_ID"
```

> **说明**
>
> 自托管环境的 `config` 仅需指定 `type` 为 `self_hosted`。依赖包（`packages`）、环境变量（`env`）、启动脚本（`setup_script`）和网络策略（`networking`）由企业自行管理，不在 Environment 配置中定义。

响应示例：

```
{
  "id": "env-20260822120000-xxxxx",
  "type": "environment",
  "name": "my-self-hosted-env",
  "config": {
    "type": "self_hosted"
  },
  "created_at": "2026-08-22T04:00:00Z"
}
```

命令会从响应中读取 `id`，确认它以 `env-` 开头，再写入 `ENVIRONMENT_ID`。如果请求返回 HTTP 4xx/5xx、响应不是合法 JSON，或响应中没有有效 ID，后续命令不会执行。

## 第 2 步：配置 Worker API Key

为 Worker 准备一个可访问当前账号和项目中 Managed Agents 资源的方舟 API Key。API Key 的创建方法，详情请参见 [API Key 管理](https://ark.volcengine.com/docs/manage-api-keys)。

> **注意**
>
> Worker 使用的是标准方舟 API Key，不是 Environment 专用凭证。不要假设该 Key 只能 Poll 或 Ack 当前 Environment 的 Work Item。应通过独立项目、独立 API Key、Secret Manager 和 Worker 侧网络策略限制风险范围。

在 Worker 主机上，把步骤 1 得到的 `ENVIRONMENT_ID` 写入 `MA_ENVIRONMENT_ID`，再配置 Worker API Key：

```bash
export MA_ENVIRONMENT_ID="<ENVIRONMENT_ID>"
export MA_WORKDIR="/workspace"
export ARK_API_KEY="<WORKER_API_KEY>"  # gitleaks:allow
# Optional: set ARK_BASE_URL only when overriding the SDK default endpoint.
export ARK_BASE_URL="https://ark.cn-beijing.volces.com/api/v3"
```

将 `ARK_API_KEY` 设置为 Worker 使用的方舟 API Key。SDK 会同时使用 `MA_ENVIRONMENT_ID` 定位 Work Queue，但该 ID 不会改变 API Key 的权限范围。

## 第 3 步：准备 Worker 主机

在企业 Linux 主机上创建工作目录，并选择一种 SDK 安装。各 SDK 的运行环境和安装方式以官方仓库 README 为准：

- [Ark Runtime Go SDK](https://github.com/volcengine/ark-runtime-go)
- [Ark Runtime Python SDK](https://github.com/volcengine/ark-runtime-python)
- [Ark Runtime Java SDK](https://github.com/volcengine/ark-runtime-java)

```bash
mkdir -p /workspace
cd /workspace

cat > /workspace/input.csv <<'CSV'
department,requests,resolved
sales,120,114
support,95,91
operations,80,79
CSV

test -s /workspace/input.csv
```

该固定输入用于步骤 5 的首次工具调用。`test` 返回状态码 `0`，表示文件已创建且内容非空。

**选项：Go**

按照 Go SDK 仓库 README 安装：

```bash
go mod init self-hosted-worker
go get github.com/volcengine/ark-runtime-go@latest
```

> **说明**
>
> Self-hosted Worker 从 Ark Runtime Go SDK v0.5.0 开始提供。如果提示 `arkruntime/lib/environments` 包不存在，请升级到最新稳定版。

**选项：Python**

按照 Python SDK 仓库 README 安装：

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -U pip
python -m pip install --upgrade arkruntime
```

> **说明**
>
> Self-hosted Worker 从 Ark Runtime Python SDK 0.5.0 开始提供。如果提示 `No module named 'arkruntime.selfhosted'`，请升级到最新稳定版。

**选项：Java**

按照 Java SDK 仓库 README，在 Maven 项目的 `pom.xml` 中添加依赖：

```xml
<dependency>
  <groupId>com.volcengine</groupId>
  <artifactId>ark-runtime</artifactId>
  <version><VERSION></version>
</dependency>
```

> **说明**
>
> 从 [Maven Central](https://central.sonatype.com/artifact/com.volcengine/ark-runtime)
> 获取最新稳定版本，并将 `<VERSION>` 替换为该版本号。Self-hosted Worker 从
> Ark Runtime Java SDK 0.5.0 开始提供；如果提示
> `package com.volcengine.ark.runtime.selfhosted does not exist`，请确认版本不低于
> 0.5.0。

检查以下条件：

- `/bin/bash` 可用且 Worker 进程有执行权限
- `/workspace` 目录可读写
- 出站 HTTPS 可达 `https://ark.cn-beijing.volces.com/api/v3`
- 准备 Agent 需要访问的企业文件或内部服务

## 第 4 步：启动常驻 Worker

使用 SDK 启动 `EnvironmentWorker`。以下示例会持续 Poll Work Queue，领取 Work Item 后在 `MA_WORKDIR` 下为每个 Session 创建独立工作目录。

**选项：Go**

创建 `main.go`：

```go
package main

import (
    "context"
    "log"
    "os"
    "os/signal"
    "syscall"

    "github.com/volcengine/ark-runtime-go/arkruntime"
    "github.com/volcengine/ark-runtime-go/arkruntime/lib/environments"
)

func main() {
    apiKey := os.Getenv("ARK_API_KEY")
    baseURL := os.Getenv("ARK_BASE_URL")
    envID := os.Getenv("MA_ENVIRONMENT_ID")
    workdir := os.Getenv("MA_WORKDIR")
    if apiKey == "" || envID == "" {
        log.Fatal("ARK_API_KEY and MA_ENVIRONMENT_ID are required")
    }
    if workdir == "" {
        workdir = "/workspace"
    }

    clientOptions := make([]arkruntime.ConfigOption, 0, 1)
    if baseURL != "" {
        clientOptions = append(clientOptions, arkruntime.WithBaseUrl(baseURL))
    }
    client := arkruntime.NewClientWithApiKey(apiKey, clientOptions...)
    worker := environments.NewEnvironmentWorkerForClient(client, environments.EnvironmentWorkerOptions{
        EnvironmentID: envID,
        WorkerID:      os.Getenv("MA_WORKER_ID"),
        Workdir:       workdir,
    })

    log.Printf("worker starting for environment %s", envID)
    ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
    defer stop()
    if err := worker.Run(ctx); err != nil {
        log.Fatalf("worker exited with error: %v", err)
    }
}
```

**选项：Python**

创建 `worker.py`：

```python
import os
import signal
import sys

from arkruntime import Ark
from arkruntime.selfhosted import ClientAPI, EnvironmentWorker, EnvironmentWorkerOptions


def required_env(name):
    value = os.environ.get(name, "")
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


client_options = {"api_key": required_env("ARK_API_KEY")}
if os.environ.get("ARK_BASE_URL"):
    client_options["base_url"] = os.environ["ARK_BASE_URL"]

client = Ark(**client_options)

worker = EnvironmentWorker(
    ClientAPI(client),
    EnvironmentWorkerOptions(
        environment_id=required_env("MA_ENVIRONMENT_ID"),
        worker_id=os.environ.get("MA_WORKER_ID", ""),
        workdir=os.environ.get("MA_WORKDIR", "/workspace"),
    ),
)

print(f"worker starting for environment {os.environ['MA_ENVIRONMENT_ID']}", file=sys.stderr)
for sig in (signal.SIGINT, signal.SIGTERM):
    signal.signal(sig, lambda _signum, _frame: worker.close())

try:
    worker.run()
finally:
    worker.close()
    client.close()
```

**选项：Java**

在 Maven 项目的 `src/main/java/` 目录下创建 `SelfHostedWorkerExample.java`：

```java
import com.volcengine.ark.runtime.selfhosted.EnvironmentWorker;
import com.volcengine.ark.runtime.selfhosted.SelfHostedClient;

public class SelfHostedWorkerExample {
    public static void main(String[] args) {
        String environmentId = requiredEnv("MA_ENVIRONMENT_ID");
        String workerId = System.getenv("MA_WORKER_ID");
        String workdir = envOrDefault("MA_WORKDIR", "/workspace");

        SelfHostedClient.Builder clientBuilder = new SelfHostedClient.Builder()
                .apiKey(requiredEnv("ARK_API_KEY"));
        String baseUrl = System.getenv("ARK_BASE_URL");
        if (baseUrl != null && !baseUrl.isEmpty()) {
            clientBuilder.baseUrl(baseUrl);
        }

        SelfHostedClient client = clientBuilder.build();

        EnvironmentWorker worker = new EnvironmentWorker(
                client,
                new EnvironmentWorker.Options()
                        .environmentId(environmentId)
                        .workerId(workerId)
                        .workdir(workdir));

        System.out.printf("worker starting for environment %s%n", environmentId);
        Runtime.getRuntime().addShutdownHook(new Thread(worker::close, "ark-self-hosted-worker-shutdown"));
        try {
            worker.run();
        } finally {
            worker.close();
        }
    }

    private static String requiredEnv(String name) {
        String value = System.getenv(name);
        if (value == null || value.isEmpty()) {
            throw new IllegalArgumentException(name + " is required");
        }
        return value;
    }

    private static String envOrDefault(String name, String defaultValue) {
        String value = System.getenv(name);
        return value == null || value.isEmpty() ? defaultValue : value;
    }
}
```

启动 Worker：

**选项：Go**

```bash
go mod tidy
go run main.go
```

**选项：Python**

```bash
python worker.py
```

**选项：Java**

```bash
mvn -q exec:java -Dexec.mainClass=SelfHostedWorkerExample
```

期望日志输出：

```
worker starting for environment env-20260822120000-xxxxx
polling work queue...
```

`EnvironmentWorker` 会持续 Poll Work Queue，队列为空时保持等待，不产生 Session。回到控制台 Environment 详情页，Worker 连接状态应显示为"在线"。

> **注意**
>
> 如果 Worker 仍显示"未连接"，优先检查：
> - `MA_ENVIRONMENT_ID` 是否正确
> - Worker 主机上的 `ARK_API_KEY` 是否为当前账号和项目下有效的方舟 API Key
> - 如设置了 `ARK_BASE_URL`，确认地址与当前方舟地域一致
> - Worker 主机系统时间是否准确（偏差过大导致签名失败）
> - 出站 HTTPS 是否可达 `https://ark.cn-beijing.volces.com/api/v3`

## 第 5 步：创建 Session，建立事件流并发送任务

### 5.1 创建 Session

回到步骤 1 使用的业务应用终端，用业务 API Key 创建 Session。不要在生产环境复用 Worker API Key：

```Bash
export ARK_API_KEY="<BUSINESS_API_KEY>"  # gitleaks:allow
export ARK_BASE_URL="https://ark.cn-beijing.volces.com/api/v3"
export AGENT_ID="<AGENT_ID>"

: "${ENVIRONMENT_ID:?Run step 1 to create an Environment first}" &&
: "${AGENT_ID:?Set AGENT_ID to an existing Agent ID}" &&
SESSION_RESPONSE=$(curl --fail-with-body -sS https://ark.cn-beijing.volces.com/api/v3/sessions \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg agent "$AGENT_ID" \
    --arg environment_id "$ENVIRONMENT_ID" \
    '{agent: $agent, environment_id: $environment_id}')") &&
SESSION_ID=$(printf '%s\n' "$SESSION_RESPONSE" | jq -er \
  '.id | select(type == "string" and startswith("sesn-"))') &&
export SESSION_ID &&
printf 'Session ID: %s\n' "$SESSION_ID"
```

将 `<AGENT_ID>` 替换为已创建的 Agent ID。命令直接使用步骤 1 保存的 `ENVIRONMENT_ID`，并把 Session ID 写入 `SESSION_ID`。请求失败或响应中没有有效 ID 时，后续命令不会执行。

响应示例：

```
{
  "id": "sesn-20260822120100-xxxxx",
  "status": "idle",
  "environment_id": "env-20260822120000-xxxxx"
}
```

### 5.2 订阅 Session 事件流

在另一个终端中，通过 [流式获取会话事件](api/stream-events-api.md) 建立 SSE 连接：

```Bash
curl -N "https://ark.cn-beijing.volces.com/api/v3/sessions/$SESSION_ID/events/stream" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Accept: text/event-stream"
```

等待服务端返回 `: ready` 后，再发送用户消息。SSE 只推送连接建立后产生的事件；如果先发送消息，业务应用会遗漏已产生的事件。

### 5.3 发送首个事件启动 Agent

仅创建 Session 不会触发任务。通过 [发送会话事件](api/send-event-api.md) 提交第一条 `user.message` 事件后，方舟才会生成 Work Item 并将其写入自托管 Environment 的 Work Queue：

```Bash
curl -sS "https://ark.cn-beijing.volces.com/api/v3/sessions/$SESSION_ID/events" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "events": [{
      "type": "user.message",
      "content": [{
        "type": "text",
        "text": "读取 /workspace/input.csv，生成汇总报告并写入 /workspace/output.md"
      }]
    }]
  }'
```

> **说明**
>
> 发送消息后，Session 从 `idle` 进入 `running`，方舟为本轮执行生成 Work Item 并写入 Environment 的 Work Queue。业务应用不直接创建 Work Item，也不调用 Work API。

## 第 6 步：验证执行结果

### 6.1 Worker 侧

Worker 日志中应看到以下关键事件：

```text
work claimed: work_id=sesn-20260822120100-xxxxx
session started: session_id=sesn-20260822120100-xxxxx
tool call: bash, command=cat /workspace/input.csv
tool call: write, path=/workspace/output.md
session completed: session_id=sesn-20260822120100-xxxxx
work completed: work_id=sesn-20260822120100-xxxxx
```

确认 `/workspace/output.md` 已生成，内容符合预期。

### 6.2 业务应用侧

在步骤 5.2 建立的 SSE 连接中，确认收到以下事件：

```text
user.message          读取 /workspace/input.csv，生成汇总报告
agent.tool_use        bash: cat /workspace/input.csv
agent.tool_result     (bash 执行结果)
agent.tool_use        write: /workspace/output.md
agent.tool_result     (write 执行结果)
agent.message         已完成，汇总报告保存至 /workspace/output.md
session.status_idle
```

### 6.3 控制台侧

在 Environment 详情页确认：

| 页面 | 预期结果 |
| --- | --- |
| 概览 | Worker 在线，执行期间 `running` 数量增加，结束后回落 |
| Work Items | 可按 Session ID 找到本轮 Work Item，状态流转为 `queued → starting → active → stopped` |

## 生产部署方式

### 常驻 Worker

适用于 VM、独立容器或已有隔离节点直接执行。`EnvironmentWorker.run()` / `EnvironmentWorker.Run()` 管理完整生命周期：Poll、Ack、Heartbeat、企业侧工具执行、结果回传和 Work Complete。

需要扩容时，优先启动多个 Worker 进程或 Pod，并为每个实例设置独立的 `MA_WORKER_ID`。不要让多个 Worker 共享同一个 Session 工作目录。

### 每 Session 独立 Sandbox

适用于 Kubernetes 每 Session 一个 Pod。Poller 负责领取 Work Item 并创建 Pod，Pod 内调用 SDK 的 `HandleItem` / `handle_item` 负责该 Work Item 的完整生命周期。

```go
poller := environments.NewWorkPollerForClient(ctx, client, environments.WorkPollerOptions{
    EnvironmentID: envID,
})

for poller.Next() {
    work := poller.Current()
    createPod(work)
}

worker := environments.NewEnvironmentWorkerForClient(client, environments.EnvironmentWorkerOptions{
    Workdir: "/workspace",
})
worker.HandleItem(ctx, environments.HandleItemOptions{
    WorkID:        os.Getenv("MA_WORK_ID"),
    EnvironmentID: os.Getenv("MA_ENVIRONMENT_ID"),
    SessionID:     os.Getenv("MA_SESSION_ID"),
})
```

> **注意**
>
> Worker 使用的 API Key 应通过 Kubernetes Secret、Secret Manager 或等价机制挂载，不能明文写入 Pod Spec、镜像、工作目录或日志。Worker 在执行 `bash` 等 Agent 工具前，应清除包含凭证的环境变量。

## 运行与排障

| 现象 | 检查项 | 处理方式 |
| --- | --- | --- |
| Worker 未连接 | API Key、Environment ID、网络 | 检查 Worker 主机上的 `ARK_API_KEY` 是否有效且能访问当前账号和项目，确认出站 HTTPS 可达 |
| Work 长时间排队 | Worker 在线状态、Worker 实例数量 | 确认 Worker 在线，必要时增加 Worker 实例 |
| Heartbeat 失败 | 租约已过期、系统时间偏差 | Worker 会自动退出，可重新 Poll 领取 |
| 工具重复执行 | Worker 执行账本、工作目录是否持久化 | 检查相同 Tool Call ID 是否直接复用已有结果。服务端对 Tool Result 的幂等处理只作用于结果回传，不能阻止 Worker 再次执行本地工具。执行状态无法确认时，不要自动重试有副作用的操作 |
| Session 无结果 | Work 与 Session Events 分别检查 | 确认 Work 已被领取且处于 `active`，同时检查 Events 是否有错误事件 |

## 清理资源

确认产物已转存后，按依赖顺序清理：

```Bash
# 1. 停止 Worker（Ctrl+C 或 kill）
# 2. 确认没有运行中的 Work
# 3. 删除测试 Session
: "${SESSION_ID:?Run step 5.1 to create a Session first}" &&
: "${ENVIRONMENT_ID:?Run step 1 to create an Environment first}" &&
curl --fail-with-body -sS -X DELETE "https://ark.cn-beijing.volces.com/api/v3/sessions/$SESSION_ID" \
  -H "Authorization: Bearer $ARK_API_KEY" &&
# 4. 删除测试 Environment
curl --fail-with-body -sS -X DELETE "https://ark.cn-beijing.volces.com/api/v3/environments/$ENVIRONMENT_ID" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

> **警告**
>
> 只删除本次创建、且记录了精确 ID 的资源。切勿按名称模糊匹配批量删除——企业账号下资源可能被多人共享，误删不可恢复。
