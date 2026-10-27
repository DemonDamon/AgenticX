---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/session-api
fetched: 2026-10-23
title: Session and Event
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Session and Event

> Session 是智能体的一次运行实例，绑定智能体与环境快照，由平台驱动状态机。Event 是会话内的原子记录，由客户端写入或经订阅服务端推送。

<meta property="og:title" content="Session and Event" />

## 状态机 <span id="h-session-state" />

会话状态字段为 `status`，状态变化通过 SSE 的 `session_status` 事件推送，详见[订阅 Event SSE 事件流](event-sse-stream.md)。

<table style={{ display: "table", tableLayout: "fixed", width: "100%" }}><colgroup><col style={{ width: "18.49%" }} /><col style={{ width: "30.82%" }} /><col style={{ width: "30.82%" }} /><col style={{ width: "19.87%" }} /></colgroup><thead><tr><th><p><strong>状态</strong></p></th><th><p><strong>触发条件</strong></p></th><th><p><strong>下一状态</strong></p></th><th><p><strong>可执行操作</strong></p></th></tr></thead><tbody><tr><td><p><code>idle</code></p></td><td><p>会话创建完成，或上一轮处理结束</p></td><td><p>收到消息 → <code>running</code></p></td><td><p>发送消息、归档、删除</p></td></tr><tr><td><p><code>running</code></p></td><td><p>收到用户消息，智能体开始处理</p></td><td><p>完成 → <code>idle</code>；不可恢复 → <code>terminated</code></p></td><td><p>中断、审批工具调用、回填函数结果</p></td></tr><tr><td><p><code>terminated</code></p></td><td><p>归档调用、或不可恢复错误</p></td><td><p>终态</p></td><td><p>查询事件历史、删除会话</p></td></tr></tbody></table>

## 会话操作 <span id="h-session-ops" />

<table style={{ display: "table", tableLayout: "fixed", width: "100%" }}><colgroup><col style={{ width: "28%" }} /><col style={{ width: "32%" }} /><col style={{ width: "40%" }} /></colgroup><thead><tr><th><p><strong>操作</strong></p></th><th><p><strong>端点</strong></p></th><th><p><strong>说明</strong></p></th></tr></thead><tbody><tr><td><p><a href="/zh/model-studio/session-create">创建 Session</a></p></td><td><p><code>POST /sessions</code></p></td><td><p>创建会话，绑定智能体快照与运行环境，初始状态 <code>idle</code></p></td></tr><tr><td><p><a href="/zh/model-studio/session-get">获取 Session</a></p></td><td><p><code>GET /sessions/\{session\_id}</code></p></td><td><p>获取会话详情，含智能体快照与当前状态</p></td></tr><tr><td><p><a href="/zh/model-studio/session-list">列出 Session</a></p></td><td><p><code>GET /sessions</code></p></td><td><p>分页列出工作空间下的会话</p></td></tr><tr><td><p><a href="/zh/model-studio/session-update">更新 Session</a></p></td><td><p><code>POST /sessions/\{session\_id}</code></p></td><td><p>更新会话元数据（标题、metadata 等）</p></td></tr><tr><td><p><a href="/zh/model-studio/session-archive">归档 Session</a></p></td><td><p><code>POST /sessions/\{session\_id}/archive</code></p></td><td><p>软归档；会话进入 <code>terminated</code> 终态</p></td></tr><tr><td><p><a href="/zh/model-studio/session-delete">删除 Session</a></p></td><td><p><code>DELETE /sessions/\{session\_id}</code></p></td><td><p>硬删除；事件历史一并清除，不可恢复</p></td></tr></tbody></table>

## 会话资源操作 <span id="h-session-resource-ops" />

<table style={{ display: "table", tableLayout: "fixed", width: "100%" }}><colgroup><col style={{ width: "28%" }} /><col style={{ width: "32%" }} /><col style={{ width: "40%" }} /></colgroup><thead><tr><th><p><strong>操作</strong></p></th><th><p><strong>端点</strong></p></th><th><p><strong>说明</strong></p></th></tr></thead><tbody><tr><td><p><a href="/zh/model-studio/session-resource-create">运行时挂载资源</a></p></td><td><p><code>POST /sessions/\{session\_id}/resources</code></p></td><td><p>会话运行期间动态挂载一个文件，服务端复制内部副本；此操作不产生会话事件</p></td></tr><tr><td><p><a href="/zh/model-studio/session-resource-list">列出会话资源</a></p></td><td><p><code>GET /sessions/\{session\_id}/resources</code></p></td><td><p>分页列出会话当前已挂载的资源</p></td></tr><tr><td><p><a href="/zh/model-studio/session-resource-get">查询会话资源详情</a></p></td><td><p><code>GET /sessions/\{session\_id}/resources/\{resource\_id}</code></p></td><td><p>查询会话中单个已挂载资源的详情</p></td></tr><tr><td><p><a href="/zh/model-studio/session-resource-delete">卸载会话资源</a></p></td><td><p><code>DELETE /sessions/\{session\_id}/resources/\{resource\_id}</code></p></td><td><p>从会话卸载指定资源并清除其内部副本；此操作不可恢复</p></td></tr></tbody></table>

## 事件操作 <span id="h-event-ops" />

<table style={{ display: "table", tableLayout: "fixed", width: "100%" }}><colgroup><col style={{ width: "28%" }} /><col style={{ width: "32%" }} /><col style={{ width: "40%" }} /></colgroup><thead><tr><th><p><strong>操作</strong></p></th><th><p><strong>端点</strong></p></th><th><p><strong>说明</strong></p></th></tr></thead><tbody><tr><td><p><a href="/zh/model-studio/event-post">发送 Event</a></p></td><td><p><code>POST /sessions/\{session\_id}/events</code></p></td><td><p>向会话注入事件（用户消息、中断、工具审批、回填函数结果等）</p></td></tr><tr><td><p><a href="/zh/model-studio/event-list">列出 Event</a></p></td><td><p><code>GET /sessions/\{session\_id}/events</code></p></td><td><p>分页列出会话内的事件历史</p></td></tr><tr><td><p><a href="/zh/model-studio/event-sse-stream">订阅 Event SSE 事件流</a></p></td><td><p><code>GET /sessions/\{session\_id}/events/stream</code></p></td><td><p>SSE 长连接订阅实时事件，含 <code>session\_status</code> 状态变更</p></td></tr></tbody></table>
