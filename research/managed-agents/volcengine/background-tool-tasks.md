---
source: https://ark.volcengine.com/region:cn-beijing/docs/background-tool-tasks
fetched: 2026-10-24
title: 运行和管理后台工具任务
---

# 运行和管理后台工具任务

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

当 Bash 命令或视频生成需要较长时间才能完成时，可以通过以下两种方式在后台运行工具：

- 明确要求 Agent 在后台执行 Bash 命令，或调用默认在后台执行的 `video_generate`。工具提交任务后立即返回 `task_id`。
- 让 Bash 命令正常执行。系统默认等待 60 秒。如果命令仍未完成，系统会将同一个任务转为后台运行并返回 `task_id`。

后台工具任务是 Session 下的子资源。它由工具调用产生，不提供单独的创建接口。业务应用可以调用 [查询会话任务列表](api/list-session-tasks-api.md)、[查询会话任务](api/get-session-task-api.md) 和 [取消会话任务](api/cancel-session-task-api.md) 管理任务。在支持后台任务且兼容当前配置的 Session 中，主 Agent 会自动获得 `task_list`、`task_get` 和 `task_kill` 工具，无需手动配置。

## 准备工作

开始前需要：

- 已创建的 API Key：配置为环境变量 `ARK_API_KEY`，详情请参见 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey)。
- 已创建的 Agent：详情请参见 [定义 Agent](define-agent.md)。
- 已创建的 Environment：详情请参见 [配置云环境](configure-cloud-environment.md)。
- 创建一个使用云端 Environment 的 Session。创建方法请参见 [启动 Session](start-session.md)。
- 为 Agent 配置需要运行的工具。Bash 使用基础工具集，视频生成使用多模态工具集，详情请参见 [Tools](tools.md)。
- 在本地安装 `curl`，并设置 API Key、Session ID 和可选的 Session 线程 ID：

    ```bash
    export ARK_API_KEY="<ARK_API_KEY>"  # gitleaks:allow
    export SESSION_ID="<SESSION_ID>"
    export SESSION_THREAD_ID="<SESSION_THREAD_ID>"
    ```

`SESSION_THREAD_ID` 用于将列表限制在指定 Session 线程；不需要按线程筛选时，可以省略该环境变量，并从请求 URL 中删除 `session_thread_id`。

本章节示例的 Base URL 与鉴权方式详情请参见 [Base URL及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

## 了解后台任务的运行方式

后台任务适合耗时较长、且不应阻塞 Session 主线程的工具调用。当前支持以下工具：

| 工具 | 进入后台的方式 | 运行行为 |
| --- | --- | --- |
| `bash` | 明确要求 Agent 在后台执行命令，或命令正常执行 60 秒后仍未完成 | 明确在后台执行时立即返回 `task_id`；正常执行时默认等待 60 秒，未完成的同一个任务随后转为后台并返回 `task_id` |
| `video_generate` | 默认在后台执行 | 提交后返回 `task_id`，视频生成完成后再由 Agent 读取结果 |

例如，发送“在后台运行测试，并在完成后汇总失败用例”后，Agent 会启动 Bash 后台任务并获得 `task_id`。如果后续消息不依赖该任务结果，Agent 可以继续处理；依赖任务结果的步骤会在任务完成后继续。

> **注意**
>
> 只要仍有未结束的后台任务或待处理的完成通知，Session 资源的 `status` 会保持 `running`。主线程可能暂时处于等待状态，但这不表示 Session 已进入 `idle`；任务完成通知会唤醒主线程并让 Agent 继续处理。不要只轮询 Session 状态判断后台任务是否完成，应查询对应 Task 的 `state`。

Task 从提交到完成的状态如下：

| 状态 | 说明 |
| --- | --- |
| `queued` | 任务已经创建，正在等待执行。 |
| `running` | 工具正在执行，或工具产物正在保存到 Session 工作区。 |
| `succeeded` | 任务执行成功。查询单个任务时，响应包含 `result`。 |
| `failed` | 任务执行失败。根据 `error_code`、`error_message` 和 `result` 排查原因。 |
| `cancelled` | 任务已经取消，不会继续执行。 |
| `unknown` | 当前无法确认任务状态。保留 `task_id` 并稍后查询；状态可能恢复为 `running` 或实际结束状态，因此不要将该状态视为成功。 |

## 列出 Session 中的任务

调用 `GET /sessions/{session_id}/tasks`，查看指定 Session 中已经产生的后台任务。正常执行的 `bash` 命令只有转为后台任务后，才会出现在列表中：

```Bash
curl -sS --fail-with-body \
  "https://ark.cn-beijing.volces.com/api/v3/sessions/${SESSION_ID}/tasks?session_thread_id=${SESSION_THREAD_ID}&state=queued,running&limit=20" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

完整请求参数和响应字段请参见 [查询会话任务列表](api/list-session-tasks-api.md)。

列表按创建时间倒序返回。可以使用以下查询参数缩小范围：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `state` | string | 按状态过滤。多个状态使用半角逗号分隔，例如 `queued,running`。 |
| `session_thread_id` | string | 只返回指定 Session 线程创建的任务。省略时返回整个 Session 的任务。 |
| `limit` | integer | 每页任务数，默认为 20，最大为 50。 |
| `cursor` | integer | 上一页响应中的 `next_cursor`。省略或传入 `0` 时，从最新任务开始查询。 |

响应中的 `items` 只包含任务摘要，不包含 `result`。存在下一页时，继续使用 `next_cursor` 查询：

```
{
  "items": [
    {
      "task_id": "task-20260910173330-54321",
      "tool": {
        "name": "video_generate",
        "tool_use_id": "toolu_02",
        "description": "Generate a city night video"
      },
      "session_id": "sesn-20260910171500-abcde",
      "session_thread_id": "sthr-20260910171500-abcde",
      "state": "running",
      "summary": "生成一段城市夜景视频",
      "created_at": 1789032810494,
      "started_at": 1789032813926
    }
  ],
  "next_cursor": 1024
}
```

记录目标任务的 `task_id`：

```bash
export TASK_ID="<TASK_ID>"
```

## 查询任务详情

调用 `GET /sessions/{session_id}/tasks/{task_id}`，查询任务的最新状态：

```Bash
curl -sS --fail-with-body \
  "https://ark.cn-beijing.volces.com/api/v3/sessions/${SESSION_ID}/tasks/${TASK_ID}" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

完整响应结构请参见 [查询会话任务](api/get-session-task-api.md)。

查询单个任务时，任务状态为 `succeeded`、`failed`、`cancelled` 或 `unknown`，响应包含 `result`；任务状态为 `queued` 或 `running` 时不返回。根据任务状态和工具类型，响应包含以下信息：

- `result.status`：工具执行结果，取值为 `ok` 或 `error`。
- `result.content`：工具返回的文本结果。
- `result.meta_info`：用于定位产物或日志的信息。Bash 任务可以返回退出码和标准输出、标准错误日志路径；视频生成任务可以返回生成任务 ID、视频地址和 Session 工作区中的产物路径。
- `error_code`、`error_message`：任务失败、取消或状态未知，且服务端记录了失败原因时的错误信息。
- `finished_at`：任务进入结束状态的时间，使用 Unix 毫秒时间戳。

> **注意**
>
> 列表接口不会返回 `result`。需要读取产物路径、日志位置或错误详情时，必须再查询单个任务。

## 取消任务

调用 `POST /sessions/{session_id}/tasks/{task_id}/cancel`，取消不再需要的后台任务：

```Bash
curl -sS --fail-with-body \
  "https://ark.cn-beijing.volces.com/api/v3/sessions/${SESSION_ID}/tasks/${TASK_ID}/cancel" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

完整接口说明请参见 [取消会话任务](api/cancel-session-task-api.md)。

接口返回 HTTP 200 表示取消请求已经处理，不代表任务一定已经停止。根据响应中的 `state` 和 `message` 判断结果：

| 响应 | 含义 | 后续处理 |
| --- | --- | --- |
| `state` 为 `cancelled` | 任务已经取消 | 不需要继续等待任务结果 |
| `state` 为 `queued` 或 `running`，没有 `message` | 取消请求已经受理，任务状态尚未刷新 | 3 秒后重新查询任务 |
| `state` 为 `queued` 或 `running`，带有 `message` | 当前执行阶段未能取消任务，例如视频已经开始生成 | 继续查询，直到任务自然结束 |
| 返回其他结束状态 | 任务在取消请求处理前已经结束 | 按返回状态处理结果 |

如果需要停止指定任务，优先使用取消任务接口。`user.interrupt` 会中断 Session 当前执行过程，并查找当前 Session 中处于 `queued` 或 `running` 状态的任务，再逐个尝试取消。该过程不是原子操作，单个任务取消失败时，其他任务仍会继续处理；它也不保证所有任务均已停止。当一个 Session 中存在多个后台任务时，不要用它替代按 `task_id` 取消。

## 处理任务完成后的事件

后台任务完成时，平台会向对应 Session 发送结果通知。只要 Session 未被显式中断、终止或删除，该通知会唤醒主线程，让 Agent 读取结果并继续处理原任务。显式中断后的迟到通知不会自动恢复执行；Session 已终止或删除时，迟到通知也不会恢复 Session。业务应用仍通过 Session SSE 接收 Agent 回复和状态事件：

1. 保持 SSE 连接，接收任务完成后产生的 Agent 回复。
2. 如果 SSE 中断，先重新建立连接，再查询历史事件补齐中断窗口。
3. 记录 `task_id`。即使错过实时事件，也可以通过 [查询会话任务列表](api/list-session-tasks-api.md) 定位任务，再通过 [查询会话任务](api/get-session-task-api.md) 读取最新状态和结果。
4. Session 被显式中断时，按第 3 步查询最终结果。需要 Agent 继续处理时，发送新的用户消息；新消息会开始新的处理轮次。
5. Session 已终止时，迟到的结果不会恢复执行。需要继续处理时，创建新的 Session 并重新发起后续步骤，详情请参见 [启动 Session](start-session.md)。
6. Task 的 `state` 为 `unknown` 时，保留 `task_id` 并稍后查询。该状态可能恢复为 `running` 或实际结束状态，不能作为成功依据。

Session 事件的订阅顺序和断线补查方式，详情请参见 [Session 事件流](session-event-stream.md)。

## 使用限制

- 后台工具任务当前支持 `bash` 和 `video_generate`。
- 每个 Session 最多同时运行 32 个工具任务，包括尚未转为后台任务的 `bash` 命令。达到上限后，新任务会失败并返回 `ToolTaskLimitExceeded`。
- 使用自托管 Environment 的 Session 暂不支持后台工具任务。
- 主 Agent 配置了自定义工具时，Session 暂不支持后台工具任务。
- 子 Agent 暂不支持后台执行工具。
- Task 只能由 Agent 的工具调用产生，不能通过 Session Task API 主动创建。
- 取消能力取决于工具的执行阶段。视频已经开始生成时，取消请求不会终止生成，也不会停止计费。

## 相关文档

- [启动 Session](start-session.md)
- [管理 Session](manage-session.md)
- [Session 事件流](session-event-stream.md)
- [Tools](tools.md)
