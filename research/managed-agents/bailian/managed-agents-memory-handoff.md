---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/managed-agents-memory-handoff
fetched: 2026-10-23
title: 进阶：跨会话工作记忆交接
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 进阶：跨会话工作记忆交接

> 用记忆库完成跨会话工作交接：API 创建与写入、会话内文件工具读写、只读交接、版本历史与条件更新冲突，以及挂载时机的边界。

<meta property="og:title" content="进阶：跨会话工作记忆交接" />

## 概述 <span id="h-mh-intro" />

本篇讲用**记忆库**（Memory Store）完成跨会话工作交接：一次会话把已核实的事实和任务进展写进工作笔记，下一次会话读取这些笔记继续推进，不再重复交代背景。机制主线：独立于会话的资源树 → 创建会话时挂载 → 会话内用文件工具读写 → API 回读与版本管理。

## 场景：下一轮会话接着上一轮推进 <span id="h-mh-scenario" />

项目每开一轮新会话，都要重新向智能体交代一遍背景——项目代号、已经核实过的数字、还没做完的事。把待交接的内容写进一个跨会话保留的位置，新会话开场先读笔记，是最接近人交接班的做法。

用记忆库实现这件事的完整链路：创建记忆库 → 写入初始笔记 → 会话以读写方式挂载并完成任务 → 写回核实的结论 → 下一个会话以只读方式挂载，读出结论继续干活。

## 先选对记忆产品 <span id="h-mh-which" />

| 需求                    | 对应产品与隔离方式                                                    |
| --------------------- | ------------------------------------------------------------ |
| 项目笔记、工作进度、跨会话交接       | **MA 记忆库（Memory Store）**：通过会话的 `resources` 挂载独立的文件树          |
| 按 UserId 提供个人偏好和个性化记忆 | **[百炼记忆库](https://docs.bailian.console.aliyun.com/zh/model-studio/memory/overview)**：独立产品，使用另一套 API |

`metadata.user_id` 不会自动隔离记忆库的内容：多个会话共用同一个记忆库，就会共享其中的内容。需要隔离时，业务侧分配独立的记忆库，并校验每个业务主体的访问归属。

## 请求顺序 <span id="h-mh-steps" />

### 1. 创建记忆库 <span id="h-mh-step1" />

```bash
curl -s -X POST "$AGENTSTUDIO_URL/memory_stores" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" -H "Content-Type: application/json" \
  -d '{"name": "project-notes", "description": "Work handoff"}'
```

返回 `memstore_` 前缀的记忆库 ID。完整参数见[创建 Memory Store API](api/memory-store-create.md)。

### 2. 写入初始笔记 <span id="h-mh-step2" />

```bash
curl -s -X POST "$AGENTSTUDIO_URL/memory_stores/$STORE_ID/memories" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" -H "Content-Type: application/json" \
  -d '{"path": "/notes/handoff.md", "content": "Project code is ORCHID-73."}'
```

返回 `mem_` 前缀的记忆 ID，记下来后面回读用。

### 3. 创建会话时挂载（read\_write） <span id="h-mh-step3" />

把记忆库作为会话资源挂载，`instructions` 写清楚交接要求：

```bash
curl -s -X POST "$AGENTSTUDIO_URL/sessions" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "agent": {"id": "<agent_id>"},
    "environment_id": "<environment_id>",
    "resources": [{
      "type": "memory_store",
      "memory_store_id": "<memory_store_id>",
      "access": "read_write",
      "instructions": "先读取工作笔记，完成任务后把已核实的事实写回笔记；使用文件工具读写，不要用 bash。"
    }]
  }'
```

### 4. 会话内读写笔记 <span id="h-mh-step4" />

记忆挂载的服务端路径是 `/mnt/memory/<名称>/…`，直接用平台提供的路径，不要自行构造普通本地目录：

```text
读取 /mnt/memory/project-notes/notes/handoff.md，
先保留原有内容，再追加一行：Verified total is 350.。
使用文件工具，不要用 bash。
```

<Warning>
  **bash 无法访问这棵记忆文件树**。读写记忆要走 `read` / `edit` / `write` 文件工具；`instructions` 里也应明确「使用文件工具，不要用 bash」。
</Warning>

### 5. API 回读确认 <span id="h-mh-step5" />

会话结束后回读，确认写回已持久化：

```bash
curl -s "$AGENTSTUDIO_URL/memory_stores/$STORE_ID/memories/$MEMORY_ID" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY"
```

实测里这一步的 `content` 同时包含原有行 `Project code is ORCHID-73.` 与追加行 `Verified total is 350.`。

### 6. 第二个会话以只读方式交接 <span id="h-mh-step6" />

新会话挂载同一个记忆库，`access` 设为 `read_only`，让接收方读取更新后的笔记：

```bash
curl -s -X POST "$AGENTSTUDIO_URL/sessions" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "agent": {"id": "<agent_id>"},
    "environment_id": "<environment_id>",
    "resources": [{
      "type": "memory_store",
      "memory_store_id": "<memory_store_id>",
      "access": "read_only"
    }]
  }'
```

实测中，只读会话正确读出 `ORCHID-73` 与 `350` 两条事实；要求它追加内容时，它在发起写入调用之前就拒绝操作，API 回读确认内容未变。**即使接收交接的 Agent 配了写入工具，也应把它的记忆挂载设为 `read_only`**，形成第二道约束。

### 7. 版本历史与条件更新 <span id="h-mh-step7" />

`GET /memory_stores/{store_id}/memory_versions` 返回版本历史（实测包含创建与编辑两类操作）。多个写入方并发修改同一条记忆时，用条件更新避免互相覆盖：在更新请求体中带上一次读取返回的 `content_sha256`：

```bash
curl -s -X POST "$AGENTSTUDIO_URL/memory_stores/$STORE_ID/memories/$MEMORY_ID" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "content": "<更新后的完整正文>",
    "precondition": {
      "type": "content_sha256",
      "content_sha256": "<上一次读取返回的哈希>"
    }
  }'
```

`type` 是必填的条件类型字段。实测中：携带当前哈希可以成功更新；携带旧哈希返回 HTTP `409`，错误码 `memory_precondition_failed_error`，较新的内容保持不变。遇到冲突后，重新读取并合并修改，再提交。

## 为工作笔记配置文件工具 <span id="h-mh-tools" />

记忆库读写走文件工具，在同一个 `builtin_toolkit` 中显式启用：

```json
{
  "type": "builtin_toolkit",
  "default_config": {"enabled": false},
  "configs": [
    {"name": "read", "enabled": true},
    {"name": "write", "enabled": true},
    {"name": "edit", "enabled": true},
    {"name": "glob", "enabled": true}
  ]
}
```

交接要求写清楚：先读取已有笔记；任务结束后记录已核实的事实和尚未完成的工作；让下一次会话继续读取同一个记忆库。

## 两处边界 <span id="h-mh-boundaries" />

- **挂载时机**：记忆库仅在创建会话时挂载。向已有会话 `POST /sessions/{id}/resources` 提交 `type: memory_store` 会返回 400（运行时资源追加只支持文件，见[构建对话客户端](managed-agents-client-streaming.md)）；需要调整时创建新会话。
- **资源列表不显示记忆挂载**：`GET /sessions/{id}/resources` 不会列出记忆库挂载，即使挂载已经生效，列表仍为空。验证挂载要结合创建配置、会话内文件工具输出与 Memory API 回读三处，资源列表为空本身不能证明挂载失败。

<Note>
  记忆库归档不可逆：归档后不能继续写入，也不能挂载到新的会话。操作前确认没有会话仍依赖它，详见[记忆库](managed-agents-memory-store.md)。
</Note>

## 小结 <span id="h-mh-summary" />

- **交接的本质是一条持久化链路**：`POST /memory_stores` 建库 → 写初始笔记 → 会话挂载读写 → 写回核实事实 → 新会话只读续读；
- **读写走文件工具**，路径固定在 `/mnt/memory/<名称>/…`，bash 进不去；
- **只读提供双重保障**：平台侧只读会阻止写入，即使接收方 Agent 配置了写入工具；两项同时设置更稳妥；
- **并发写用条件更新**：带 `content_sha256` 的乐观锁，冲突返回 409，重读合并后再提交；
- **挂载只发生在创建会话时**，资源列表不反映记忆挂载，验证要看文件工具输出和 API 回读。

## 下一步 <span id="h-mh-next" />

- [记忆库](managed-agents-memory-store.md)：挂载、访问模式、版本与工作记忆文件树的完整字段。
- [进阶：构建对话客户端](managed-agents-client-streaming.md)：会话运行中的文件挂载与撤下（与记忆库挂载的时机差异）。
- [入门：搭一个数据分析 Agent](managed-agents-data-analysis.md)：文件上传、挂载与会话基础链路。
