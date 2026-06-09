# Near 记忆图谱（Graphiti + Kuzu）

Near Desktop 在保留 `WorkspaceMemoryStore` / `MEMORY.md` 与 `memory_search` 工具的前提下，可选接入 **Graphiti** 结构化时态记忆引擎，并在侧栏提供 **记忆图谱** 可视化 Panel。

## 安装（开发环境）

```bash
pip install -e ".[graphiti]"
```

可选 extra 定义于 `pyproject.toml`：`graphiti-core[kuzu]>=0.29.1,<0.30`。

DMG / Windows 安装包 **默认不打包** graphiti（Phase 2 再评估体积与 wheel 兼容性）。

## 启用

1. 编辑 `~/.agenticx/config.yaml`：

```yaml
memory_graph:
  enabled: true
  backend: kuzu
  db_path: ~/.agenticx/memory/graph.kuzu
  default_scope: session   # session | avatar | meta
  ingest:
    auto: true
    max_queue: 32
    semaphore_limit: 2
    max_chars_per_episode: 4096
  telemetry: false
```

2. 或在 Near **设置 → 通用 → 记忆图谱** 中开启（写入同一配置节）。

3. 完全退出并重启 Near（或重启 `agx serve`）。

Graphiti 遥测默认关闭（`GRAPHITI_TELEMETRY_ENABLED=false`）。

## 数据布局

| 路径 | 说明 |
|------|------|
| `~/.agenticx/memory/main.sqlite` | 既有 WorkspaceMemoryStore（不变） |
| `~/.agenticx/memory/graph.kuzu` | Graphiti Kuzu 单文件 |
| `~/.agenticx/memory/graph_ingest.json` | ingest 队列状态 / last_error |

## group 分区（隔离）

| 窗格 | group_id |
|------|----------|
| Meta（无 avatar_id） | `meta:default` |
| 分身 | `avatar:{avatar_id}` |
| 会话细粒度 | `session:{session_id}` |

API 会校验请求的 `group_id` 与当前 pane 的 `avatar_id` / `session_id`，跨分区返回 403。

## Desktop 使用

- 顶栏 **记忆图谱** 按钮（Share2 图标）打开侧栏 Panel。
- 支持 scope 切换（本会话 / 分身 / Meta）、搜索、Episode 时间轴、节点详情与删除 episode。
- ingest 失败时 Panel 内黄色警示；**不影响** 正常聊天 SSE。

## CLI 冒烟

```bash
# 状态
agx memory-graph status

# 从 session messages 手动 ingest
agx memory-graph ingest --session-id <SESSION_ID>

# 查看子图概览
agx memory-graph overview --scope session --session-id <SESSION_ID>
```

## HTTP API

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/memory/graph/overview` | 子图概览（默认 cap 80 nodes / 120 edges） |
| GET | `/api/memory/graph/episode/{uuid}` | 单 episode 溯源 |
| GET | `/api/memory/graph/episodes` | Episode 时间轴 |
| POST | `/api/memory/graph/search` |  hybrid 搜索子图 |
| GET | `/api/memory/graph/status` | pending / last_error / counts |
| DELETE | `/api/memory/graph/episode/{uuid}` | 删除 episode |
| GET/PUT | `/api/memory/graph/config` | 读写配置 |

`memory_graph.enabled=false` 时 overview 等返回 **503** `{ "error": "memory_graph_disabled" }`。

## 与现有记忆的关系

- **不替换** MemoryHook、`MEMORY.md` 主写入路径；`memory_search` 与自动召回会 **优先查 Workspace**，并在配置开启时 **合并同分区图谱事实**。
- Graph ingest 在回合结束后 **异步** 入队；收藏消息 **高优先级** ingest。
- Panel 内搜索走 Graphiti RRF；对话侧 `memory_search` 走 `agenticx/memory/recall.py`（Workspace hybrid + 可选 graph merge）。

## 对话检索（memory_search / 自动召回）

启用 `memory_graph.enabled: true` 后，聊天工具 `memory_search` 与 Meta 系统提示中的「相关历史记忆」块会：

1. 检索 `~/.agenticx/workspace/MEMORY.md` 等 Markdown 索引（中文关键词用子串匹配，英文仍走 FTS）。
2. 在同一窗格分区（`meta_default` / `avatar_*` / `group_*`）内 best-effort 调用图谱 RRF 搜索，将节点/关系摘要合并进结果。
3. 图谱不可用或超时时 **仅降级 Workspace**，并在工具 JSON 中附带 `graph_skipped_reason`（对用户不可见时由模型忽略）。

配置项：

```yaml
memory_graph:
  enabled: true
  search_in_chat: true              # false：对话不再查图谱（Panel 搜索不受影响）
  search_in_chat_graph_limit: 2     # 合并结果中图谱条目上限
```

环境变量：`AGX_MEMORY_GRAPH_SEARCH_IN_CHAT=0` 可关闭对话侧图谱合并。

**注意**：偏好类问题（「XX 是我喜欢的吗」）仍以 `MEMORY.md` 文本为准；图谱节点可能是实体 mention，不一定有 `LIKES` 关系边。

## 测试

```bash
pytest tests/test_smoke_memory_graph_graphiti.py \
       tests/test_memory_graph_api.py \
       tests/test_memory_graph_isolation.py \
       tests/test_workspace_memory.py \
       tests/test_smoke_memory_recall_bridge.py -v
```

完整 eval 场景见 `research/codedeepresearch/graphiti/graphiti_eval_plan.md`（建议 nightly / 本地手动，尚未纳入默认 CI 门禁）。

## 回滚

1. `memory_graph.enabled: false`
2. 可选删除 `~/.agenticx/memory/graph.kuzu`
3. 重启 Near — toolbar 按钮仍可见，Panel 显示「未启用」空态

## Phase 2 备忘

- 大图谱 community 聚合与更 aggressive node cap
- 偏好类关系（LIKES/PREFERS）抽取质量 eval
- Windows DMG：`graphiti-core[kuzu]` wheel 体积验证
- FalkorDB dev compose（文档级 optional backend）
