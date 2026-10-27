---
source: https://docs.bigmodel.cn/cn/managed-agents/threads
fetched: 2026-10-23
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 会话线程

Thread 是 Session 内一个 Agent 的执行上下文。普通单 Agent Session 也有 primary thread；委派后新增 child thread。旧 Session 由迁移补齐主线程，历史中无线程归属的事件按主线程读取。

> [!NOTE]
>
> Thread 暂不支持控制台的独立查看与管理。请使用下列 API 获取线程列表、状态和事件；会话级调试见[在控制台查看与调试会话](session-debugging.md)。

## 先看 Session，再查看 Thread

| 入口 | 能看到什么 |
| - | - |
| Session `events` / `events/stream` | 主 Agent 全部活动，及子线程生命周期、跨线程消息、阻塞审批的摘要 |
| Thread `events` / `stream` | 当前线程完整活动，包括消息、Thinking、工具结果与模型 span |

Session 事件列表与 SSE 使用相同可见集合。子线程逐字输出不出现在主流；要渲染它，订阅该 Thread 的 `/stream`。

```bash theme={null}
curl -sS "$BASE_URL/v1/sessions/$SESSION_ID/threads?limit=20" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22"
```

响应为 `data/next_page`。主线程的 `parent_thread_id` 为 null，子线程指向父线程。

## 五个接口

| 方法 | 路径 | 用途 |
| - | - | - |
| GET | /v1/sessions/:sessionId/threads | 列出主线程、子线程及已归档线程 |
| GET | /v1/sessions/:sessionId/threads/:threadId | 读取单个 Thread |
| POST | /v1/sessions/:sessionId/threads/:threadId/archive | 归档空闲子线程，释放线程名额 |
| GET | /v1/sessions/:sessionId/threads/:threadId/events | 分页读取该线程完整事件历史 |
| GET | /v1/sessions/:sessionId/threads/:threadId/stream | 实时 SSE；live-only，可订阅 event\_deltas |

列表与事件历史均默认 100 条，均使用 next\_page → page，按创建时间升序；列表支持 statuses\[] 过滤。Thread SSE 路径以 `/stream` 结束，不是 `/events/stream`。

```bash theme={null}
curl -N -g "$BASE_URL/v1/sessions/$SESSION_ID/threads/$THREAD_ID/stream?event_deltas[]=agent.message" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22"
```

## ID 和事件方向

* `session_id` 标识整个 Session；Thread 对象的 `id`（`sthr_` 前缀）标识其中一个 Thread。
* `thread_id` 是路径/委派参数名；`session_thread_id` 是事件或请求中的归属字段，值仍是同一个 Thread ID。
* 主流中的跨线程摘要可带 `session_thread_id`。消息另有 `from_session_thread_id/from_agent_name` 或 `to_session_thread_id/to_agent_name`。
* `sent/received` 相对于你正在读取的线程：主线程派出任务是 sent，子线程收到同一任务是 received；报告回流时方向相反。

## 状态与生命周期

| Thread 状态 | 含义 |
| - | - |
| running | 正在执行 |
| idle | 本轮暂停或结束；检查 stop\_reason |
| rescheduling | 遇到可重试问题，准备重新调度 |
| terminated | 已终止 |

Session 状态由线程聚合：任一线程 running 或 rescheduling，Session 为 running；全部 terminated 时为 terminated；其余为 idle。一个子线程等待审批时，其他线程可以继续，用户也可继续与未等待审批的主线程对话。

归档仅支持 idle 子线程（包括等待审批的 idle），不能归档 primary thread；running/rescheduling 返回 400，需先发定向 interrupt 并等收尾。重复归档子线程幂等成功，历史保留。

定向打断仍发到 Session events：

```json theme={null}
{"events":[{"type":"user.interrupt","session_thread_id":"sthr_target"}]}
```

省略 session\_thread\_id 会打断所有活跃线程；普通 user.message 进入主线程，不提供直接向任意子线程发用户消息的接口。

Thread 的 agent 返回自身有效配置；Advisor 采用 `{"type":"advisor","model":"..."}`。新协议下 stats/usage 尚未产生时为 null，workflow\_run\_id 当前为 null。Thread usage 只含已计量字段，账单/Session 总量不能用缺省值或简单求和替代。

成员名单请读取对应 Agent 版本的 multiagent；Session.agent 当前返回 multiagent:null，Thread.agent 不重复 Agent 列表。


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.