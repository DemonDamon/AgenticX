---
source: https://ark.volcengine.com/region:cn-beijing/docs/persistent-memory
fetched: 2026-10-24
title: 持久化记忆
---

# 持久化记忆

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

本文介绍如何在方舟 Managed Agents 中使用记忆存储（Memory Store），为 Agent 提供可跨 Session 保留的长期记忆。

默认情况下，每个 Session 都从新的上下文开始。Session 结束后，Agent 在本次运行中积累的偏好、约定、排障经验或业务背景不会自动带到下一次任务中。Memory Store 用于保存这些可复用信息，并在后续 Session 中重新挂载给 Agent 使用。

## 基本概念

一个 Memory Store 可以保存多条 Memory。每条 Memory 都通过独立的 `path` 标识，便于按用途组织，并在不同 Session 中复用。

Memory 的创建、读取、更新和删除不依赖 Session。要让 Agent 在运行过程中使用这些内容，需要在创建 Session 时将 Memory Store 挂载为资源。

挂载 Memory Store 后，`access` 决定 Agent 可以执行的操作。您也可以通过控制台直接管理 Memory。

## 创建 Memory Store

创建 Memory Store 时必须提供 `name`；`description` 可选。提供 `description` 时，该字段会展示给 Agent，用于说明这个 Store 中保存的内容和使用场景。

```bash
store=$(
  curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/memory_stores" \
    -H "Authorization: Bearer $ARK_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "name": "<MEMORY_STORE_NAME>",
      "description": "<MEMORY_STORE_DESCRIPTION>"
    }'
)

STORE_ID=$(jq -er '.id' <<<"$store")

echo "Memory Store ID: $STORE_ID"
```

返回的 Memory Store ID 通常形如 `memstore-...`。创建 Session 并挂载记忆时，需要传入该 ID。

## 预置 Memory 内容

在 Agent 开始运行前，可以先向 Store 中写入参考资料，例如项目规范、用户偏好、输出格式、术语表等。

根据写入数量选择接口：

- 调用 [创建记忆](api/create-memory-api.md) 写入单条 Memory，适合补充零散内容。
- 调用 [批量创建记忆](api/batch-create-memories-api.md) 批量写入多条 Memory，适合初始化术语表、用户偏好或输出模板。

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/memory_stores/$STORE_ID/memories" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "path": "/<MEMORY_1>.md",
    "content": "<CONTENT_OF_THE_MEMORY>"
  }'
```

单条 Memory 的内容上限为 100 KiB（102400 字节），约 25k tokens。单个 Store 最多保存 2,000 条 Memory。建议将记忆拆成多个小而聚焦的文件，避免使用长文档。

## 挂载 Memory Store 到 Session

Memory Store 需要在创建 Session 时通过 `resources` 数组挂载。与文件和代码仓库资源不同，Memory Store 只能在 Session 创建时挂载，不支持在运行中的 Session 中追加或移除。

在 `resources` 数组中，将资源 `type` 设置为 `memory_store`，并通过 `memory_store_id` 指定要挂载的 Memory Store。

以下示例将访问权限显式设置为 `read_only`，使 Agent 可以读取 Memory Store，但不能修改其中的内容。

```bash
session=$(
  curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/sessions" \
    -H "Authorization: Bearer $ARK_API_KEY" \
    -H "Content-Type: application/json" \
    -d @- <<EOF
{
  "agent": "$AGENT_ID",
  "environment_id": "$ENVIRONMENT_ID",
  "resources": [
    {
      "type": "memory_store",
      "memory_store_id": "$STORE_ID",
      "access": "read_only"
    }
  ]
}
EOF
)

printf '%s\n' "$session"

SESSION_ID=$(jq -er '.id' <<<"$session")
```

`access` 默认为 `read_write`。如果 Agent 会处理用户输入、网页内容或第三方工具输出等不可信内容，需要谨慎授予写权限。一次成功的 Prompt Injection 可能把恶意内容写入 Store，后续 Session 又会将其作为可信记忆读取。对于共享规范、知识库、术语表等参考内容，建议使用 `read_only`。

单个 Session 最多挂载 10 个 Memory Store。可以按不同使用场景拆分 Store，例如分别管理用户偏好、项目上下文和团队共享规范。

## Agent 如何访问 Memory

- `read_only`：Agent 可以浏览、读取和搜索 Memory，但不能修改内容。
- `read_write`：Agent 除了读取 Memory，还可以创建、更新、删除或移动内容。修改会保存在挂载的 Memory Store 中，供后续 Session 继续使用。
- Agent 对 Memory 的读取会作为普通工具调用出现在 Session 事件流中，例如 `agent.tool_use` 和 `agent.tool_result`。

## 查看和编辑 Memory

您可以通过 [查询记忆列表](api/list-memories-api.md)、[查询记忆详情](api/get-memory-api.md)、[更新记忆](api/update-memory-api.md) 和 [删除记忆](api/delete-memory-api.md) 查询和维护 Memory，用于审核内容、修正错误或清理过期信息。

### 查询 Memory 列表

可通过 `path_prefix` 按路径前缀浏览 Memory，类似查看目录。

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/memory_stores/$STORE_ID/memories?path_prefix=/&order_by=path&depth=2" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  | jq -r '.data[] | "\(.type)  \(.path)"'
```

### 读取 Memory

读取单条 Memory 会返回完整内容。

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/memory_stores/$STORE_ID/memories/$MEMORY_ID" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  | jq -r '.content'
```

### 创建 Memory

`create` 会在指定 `path` 下新建 Memory；如果路径已存在，不会覆盖原内容。修改已有 Memory 请使用更新接口。

```bash
memory=$(
  curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/memory_stores/$STORE_ID/memories" \
    -H "Authorization: Bearer $ARK_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "path": "/path/of/the/memory",
      "content": "<CONTENT_OF_THE_MEMORY>"
    }'
)

MEMORY_ID=$(jq -r '.id' <<<"$memory")
MEMORY_SHA=$(jq -r '.content_sha256' <<<"$memory")
```

### 更新 Memory

更新接口可修改内容、路径，或同时修改二者。修改路径可用于重命名或归档。

```Bash
curl -sS --fail-with-body -X POST "https://ark.cn-beijing.volces.com/api/v3/memory_stores/$STORE_ID/memories/$MEMORY_ID" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "path": "/new/path"
  }'
```

### 删除 Memory

```Bash
curl -sS --fail-with-body -X DELETE "https://ark.cn-beijing.volces.com/api/v3/memory_stores/$STORE_ID/memories/$MEMORY_ID" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

## 管理 Memory Store

除创建外，Memory Store 还支持查询、删除等操作。

### 查询 Store 列表

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/memory_stores" \
  -H "Authorization: Bearer $ARK_API_KEY"
```
### 删除 Store

```Bash
curl -sS --fail-with-body -X DELETE "https://ark.cn-beijing.volces.com/api/v3/memory_stores/$STORE_ID" \
  -H "Authorization: Bearer $ARK_API_KEY"
```
## 最佳实践

当 Store 达到 2,000 条 Memory 上限后，新 Memory 写入会失败。已有 Memory 仍可读取和更新。建议按以下方式管理长期记忆：

- **按用途拆分 Store**：不要把所有内容放进一个通用 Store。可以按用户、团队共享知识、项目上下文分别建 Store。
- **在接近上限前整理内容**：定期删除过期或重复 Memory，或将碎片化内容整理成更稳定的摘要 Store。
