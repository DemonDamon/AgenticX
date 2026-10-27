---
source: https://docs.bigmodel.cn/cn/managed-agents/memory-stores
fetched: 2026-10-23
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 记忆

Memory Store 让 Agent 拥有跨会话的长期记忆。会话是短暂的——沙箱与对话历史随会话结束而封存；Memory Store 是持久的——挂载到任意多个会话，Agent 在工作中读取和沉淀记忆，你可以随时审计每一次变更。

## 控制台操作

进入 **Managed Agents → 记忆库** 创建 Store，在详情中查看、添加或编辑记忆条目，并通过版本记录检查变更内容与来源。

创建会话或定时任务时挂载记忆库，并确认读写权限。共享记忆可跨会话复用；单次会话历史不会自动变成长期记忆。评测时优先使用只读挂载，避免不同测试用例相互影响。

## 工作方式

1. 创建一个 Memory Store，可选地预置初始内容。
2. 创建会话时把 Store 挂载为资源（read\_only 或 read\_write）。
3. 记忆以文件形式出现在沙箱的 **/mnt/memory/** 目录下，Agent 用普通文件工具读写。
4. Agent 写入的每次变更都产生一个不可变的版本记录，可回溯、可脱敏。

## 创建 Memory Store

```bash theme={null}
store=$(curl -sS "$BASE_URL/v1/memory_stores" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22" \
  -H "content-type: application/json" \
  -d '{
    "name": "Project knowledge",
    "description": "团队项目的共享知识与偏好"
  }')

STORE_ID=$(jq -r '.id' <<< "$store")
```

字段：**name**（必填，1–255 字符，不含控制或格式字符）、**description**（≤1024 字符）、**metadata**（最多 16 个 string 键值）。创建成功返回 200。

### 预置初始内容（可选）

用 Memory 接口直接写入条目。每条记忆由一个路径和一段文本组成：

```bash theme={null}
curl -sS "$BASE_URL/v1/memory_stores/$STORE_ID/memories" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22" \
  -H "content-type: application/json" \
  -d '{
    "path": "/preferences/reporting.md",
    "content": "周报使用中文撰写，数据保留两位小数，附上环比变化。"
  }'
```

**path** 以 / 开头（NFC 归一化，≤1024 UTF-8 字节，不得为裸 /、不得含空段、.、.. 或控制字符）；**content** 是 UTF-8 文本，默认上限 100 KiB。

创建 Memory 成功返回 200。本页使用 `managed-agents-2026-09-22` 协议；旧协议下创建 Memory Store 或 Memory 仍返回 201。

## 挂载到会话

创建会话时通过 **resources** 挂载，单个会话最多 8 个 Memory Store：

```bash theme={null}
curl -sS "$BASE_URL/v1/sessions" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22" \
  -H "content-type: application/json" \
  -d @- <<EOF
{
  "agent": "$AGENT_ID",
  "environment_id": "$ENVIRONMENT_ID",
  "resources": [
    {
      "type": "memory_store",
      "memory_store_id": "$STORE_ID",
      "access": "read_write",
      "instructions": "把用户表达的长期偏好写入 /preferences/ 下的文件。"
    }
  ]
}
EOF
```

* **access**：**read\_only** 或 **read\_write**，省略默认 read\_write。
* **instructions**：可选（≤4096 字符），告诉 Agent 这个 Store 的用途与写入规范。
* 挂载路径由平台生成，形如 `/mnt/memory/<名称 slug>-<ID 尾缀>`（防同名碰撞），以会话响应中 **resources\[].mount\_path** 的返回值为准。

### Agent 如何访问记忆

记忆对 Agent 就是挂载目录下的文件：用 read / grep 检索，用 write / edit 沉淀（read\_write 时）。Agent 侧的每次写入都会同步为 Memory 条目并产生版本记录，无需额外协议。

## 查看与编辑记忆

你可以在会话之外直接管理 Store 里的内容：

```bash theme={null}
curl -sS "$BASE_URL/v1/memory_stores/$STORE_ID/memories?path_prefix=/preferences/&view=full" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22"
```

列表参数：**path\_prefix**（/ 或以 / 结尾的前缀）、**depth**（0–1024，目录层级）、**view**（basic 默认不含内容；full 返回内容但 limit 上限 20）。列表元素分两类：**memory**（条目）与 **memory\_prefix**（目录前缀），便于做树状浏览。

单条操作：

| 接口 | 说明 |
| - | - |
| GET .../memories/:memoryId | 读取（view 默认 full，含内容与 content\_sha256） |
| POST .../memories | 创建（path + content） |
| POST .../memories/:memoryId | 更新 path 和/或 content。可带 **precondition**：内容已被改过则更新失败，避免覆盖他人刚写的内容 |
| DELETE .../memories/:memoryId | 删除 Memory；可带 **expected\_content\_sha256**，当前内容已变化时拒绝删除 |

更新前先读取当前 **content\_sha256**，再把它作为条件提交。**type** 与哈希都要传：

```json theme={null}
{
  "content": "更新后的内容",
  "precondition": {
    "type": "content_sha256",
    "content_sha256": "<当前 Memory 的 content_sha256>"
  }
}
```

## 审计记忆变更

每次创建、修改、删除都会产生一条不可变的版本记录，标注操作类型（**created** / **modified** / **deleted**）与执行主体（**session\_actor** 会话内 Agent，含 session\_id；或 **user\_actor** API 调用者）：

```bash theme={null}
curl -sS "$BASE_URL/v1/memory_stores/$STORE_ID/memory_versions?memory_id=$MEMORY_ID" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22"
```

如果某个版本包含不应留存的敏感内容（如用户误发的密钥），用脱敏接口抹除该版本的内容与路径，保留审计轨迹：

```bash theme={null}
curl -sS -X POST "$BASE_URL/v1/memory_stores/$STORE_ID/memory_versions/$VERSION_ID/redact" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22"
```

脱敏后该版本的 **path** / **content** / **content\_sha256** 变为 null，**redacted\_at** 与 **redacted\_by** 记录操作时间与主体。不能对当前 head 版本脱敏，会返回 409；先改内容或删除条目，再对历史版本执行 redact。

## 管理 Store

| 接口 | 说明 |
| - | - |
| GET /v1/memory\_stores | 列出你的 Store。默认不包含已归档的；要一起看到，加 `include_archived=true` |
| GET /v1/memory\_stores/:id | 获取单个 Store |
| POST /v1/memory\_stores/:id | 更新 **name** / **description** / **metadata** |
| POST /v1/memory\_stores/:id/archive | 归档。归档后不能再挂到新会话；已经挂上的会话还能继续用 |
| DELETE /v1/memory\_stores/:id | 删除 Store，里面的记忆和版本记录一并删掉 |

## 最佳实践

* **用路径组织语义**：像设计目录结构一样设计记忆路径（/preferences/、/facts/、/decisions/），配合 path\_prefix 检索。
* **用 instructions 立规矩**：挂载时明确写入规范（什么值得记、写到哪里、什么格式），比事后清理更有效。
* **敏感内容走脱敏**：删除条目不会抹掉历史版本里的内容，涉密数据要对版本执行 redact。
* **共享记忆用 read\_only**：多个 Agent 共享一份知识库时，只给需要沉淀的会话 read\_write。

## 冲突与Multi Agent

新协议下，同路径写入冲突可返回 memory\_path\_conflict\_error，条件更新失败可返回 memory\_precondition\_failed\_error；HTTP 仍为 409。读取当前版本并按正确 precondition 重试，不要将冲突当作网络故障无限重试。

同一 Session 的成员共享挂载 Store；并行改相同文件会存在竞争，给成员安排各自的条目路径或由主线程合并。归档/删除 Store 前结束其 running 的 read\_write 引用，否则会被拒绝。

## 下一步

> **[创建会话](create-session.md)**
>
> resources 数组的完整字段

> **[预装沙箱环境](sandbox-reference.md)**
>
> /mnt/memory 挂载契约

> **[本页对应 OpenAPI](api-reference.md#memory-stores)**
>
> Memory Store 与 Memory 条目


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.