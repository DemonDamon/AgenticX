---
name: machi-kb-stage1-local-mvp
overview: Machi 本地知识库阶段 1 MVP：全局单 KB、Chroma + Ollama bge-m3（可降级到在线 Provider）、VectorRetriever + 内置 knowledge_search 工具、设置页三栏 UI（配置/资料管理/调试）、引用溯源
todos:
  - id: t00-contracts
    content: "P0: 确定 API/配置契约（KBConfig schema / RetrievalHit / IngestJob 状态机），冻结后再动后端"
    status: completed
  - id: t01-backend-runtime
    content: "P0: agx serve 内新增 KBRuntime 单例：按配置装配 Knowledge(Chroma + Embedding)，懒初始化 + 重建守卫"
    status: completed
  - id: t02-backend-config-api
    content: "P0: GET/PUT /api/kb/config 读写 ~/.agenticx/config.yaml 的 knowledge_base 节点"
    status: completed
  - id: t03-backend-ingest-api
    content: "P0: POST /api/kb/documents 上传/登记文档 → 后台任务 → ingest 并返回 job_id；GET /api/kb/jobs/{id} 轮询进度"
    status: completed
  - id: t04-backend-list-delete-api
    content: "P0: GET /api/kb/documents 列表（状态/片段数/来源）；DELETE /api/kb/documents/{id}"
    status: completed
  - id: t05-backend-search-api
    content: "P0: POST /api/kb/search（供 UI 调试）+ POST /api/kb/debug/preview（切片预览）"
    status: completed
  - id: t06-agent-tool
    content: "P0: agenticx/cli/agent_tools.py 注册 knowledge_search 工具（内置），纳入 STUDIO_TOOLS 与元工具白名单"
    status: completed
  - id: t07-runtime-inject
    content: "P0: 消息上下文注入：meta_agent system prompt 在检索命中时插入引用块（遵循既有 build_meta_agent_system_prompt 规范）"
    status: completed
  - id: t08-frontend-tab
    content: "P0: settings-tab.ts 新增 knowledge；SettingsPanel TABS 加「知识库」入口（📚 图标，放在「技能」下方）"
    status: completed
  - id: t09-frontend-config-panel
    content: "P0: 配置区组件：向量库路径/后端（只读=Chroma，MVP）、Embedding Provider+模型下拉、默认 chunk_size/overlap、文件类型过滤"
    status: completed
  - id: t10-frontend-materials-panel
    content: "P0: 资料管理区：拖拽上传、列表（状态/片段/来源/修改时间）、单项重建/删除、整体进度条"
    status: completed
  - id: t11-frontend-debug-panel
    content: "P0: 调试区：问答输入 → 展示 Top-K（分数/片段/来源）；切片预览（选文档看实际分段）"
    status: completed
  - id: t12-citation-ui
    content: "P0: 消息气泡引用卡片：渲染源路径 + 片段预览，点击可跳转（复用现有 @file 交互风格）"
    status: completed
  - id: t13-ollama-detect-fallback
    content: "P0: 首次进入 KB 页：探测 Ollama（含 bge-m3）；未装则引导「配置在线 Embedding Provider」流程，不强制安装"
    status: completed
  - id: t14-tests
    content: "P0: 测试：后端 pytest（mock embedding + tmp Chroma）；前端交互打点；端到端 smoke：加 1 个 MD + 1 个 PDF → 提问带引用"
    status: completed
  - id: t15-docs-and-seed
    content: "P1: 用户文档 + 首次进入的空态引导（拖入一个示例 md 就能跑）"
    status: completed
  - id: t16-embedding-dim-guard
    content: "P0: 切换 Embedding 模型时强提示「需要重建索引」；配置里固化 embedding_id + vector_dim"
    status: completed
isProject: false
---

# Machi 本地知识库 — 阶段 1 MVP 工程计划

> Plan-Id: `machi-kb-stage1-local-mvp`
> Plan-File: `.cursor/plans/2026-04-14-machi-kb-stage1-local-mvp.plan.md`
> 回溯产品规划：`docs/plans/2026-04-14-machi-knowledge-base-product-plan.md` (v2.1 §6.1)

## 0. 强约束（照搬产品 plan §6.1，不松口）

- **单一全局 KB**（阶段 1 不做多 KB / 分身绑定 / 会话级覆盖）
- **文件格式**：`.md` / `.txt` / `.pdf`（简单版，不启用 mineru） / `.docx`
- **切片**：`recursive_chunker`，`chunk_size=800 / overlap=80`
- **向量库**：Chroma（`~/.agenticx/storage/vector_db/default`）
- **Embedding**：默认 Ollama `bge-m3`；无 Ollama 时降级到用户已配置的在线 Provider（走 `agenticx.embeddings.router`）
- **检索**：仅 `VectorRetriever`（K=5）
- **Agent 工具**：内置 `knowledge_search`（不走 MCP）
- **推迟**：多 KB / 分身绑定 / HybridRetriever / Reranker / mineru / GraphRAG / MCP 暴露 / 连接器同步

---

## 1. 契约（t00 必须先冻结）

### 1.1 配置 schema（`~/.agenticx/config.yaml` 下 `knowledge_base:` 节点）

```yaml
knowledge_base:
  enabled: true
  vector_store:
    backend: chroma
    path: ~/.agenticx/storage/vector_db/default
  embedding:
    provider: ollama          # or openai | siliconflow | bailian | ...
    model: bge-m3
    dim: 1024                 # 固化，切换必须 rebuild
  chunking:
    strategy: recursive
    chunk_size: 800
    chunk_overlap: 80
  file_filters:
    extensions: [".md", ".txt", ".pdf", ".docx"]
  retrieval:
    top_k: 5
```

### 1.2 HTTP API（挂在 `agenticx/studio/server.py`，与 `/api/mcp/*` 同级）

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/kb/config` | 读配置 |
| PUT | `/api/kb/config` | 写配置（变更 embedding 模型返回 `rebuild_required=true`） |
| GET | `/api/kb/documents` | 列出已登记资料（id / source / status / chunks / mtime） |
| POST | `/api/kb/documents` | `multipart/form-data` 上传 or `{path}` 登记本地路径；返回 `{job_id}` |
| DELETE | `/api/kb/documents/{id}` | 删除 + 清理向量 |
| POST | `/api/kb/documents/{id}/rebuild` | 单项重建 |
| GET | `/api/kb/jobs/{id}` | 轮询 ingest 进度（状态机见 §1.3） |
| POST | `/api/kb/search` | `{query, top_k?}` → `{hits: RetrievalHit[]}`；供**调试区**使用 |
| POST | `/api/kb/debug/preview` | `{path, strategy, chunk_size, overlap}` → 返回预览分段，不入库 |

### 1.3 IngestJob 状态机

```
queued → parsing → chunking → embedding → writing → done
                                                   ↘ failed(reason)
```

### 1.4 `RetrievalHit`（跨本地/远端统一，阶段 2 会复用）

```ts
type RetrievalHit = {
  id: string;
  score: number;
  text: string;
  source: {
    kind: "local" | "remote";
    uri: string;            // 本地为绝对路径；远端为 URI 或对端标识
    title?: string;
    chunk_index?: number;
    page?: number;
  };
  metadata?: Record<string, unknown>;
};
```

---

## 2. 后端改造（复用 `agenticx.*`，Machi 只写胶水）

### 2.1 文件布局

| 类型 | 路径 | 说明 |
|------|------|------|
| 新建 | `agenticx/studio/kb_routes.py` | 上面所有 `/api/kb/*` 路由 |
| 新建 | `agenticx/studio/kb_runtime.py` | `KBRuntime` 单例：从 config 装配 `Knowledge(vector_store, embedding_model)`，缓存、重建守卫、job registry |
| 新建 | `agenticx/studio/kb_jobs.py` | 基于现有后台任务基础设施的 ingest job 抽象（若已有队列就复用，无则最小 asyncio.Queue） |
| 修改 | `agenticx/studio/server.py` | `create_studio_app()` 里挂载 kb 路由 |
| 修改 | `agenticx/cli/agent_tools.py` | 注册 `knowledge_search`（调用 `KBRuntime.search`），并入 `STUDIO_TOOLS` |
| 修改 | `agenticx/runtime/prompts/meta_agent.py` | 可选：在命中时把引用块嵌入 system prompt（或走工具结果注入，推荐后者） |

**复用 API：**

- `agenticx.knowledge.Knowledge(vector_store=..., embedding_model=..., chunking_config=ChunkingConfig(...))`
- `agenticx.storage.vectordb_storages.chroma.ChromaStorage`
- `agenticx.embeddings.router.EmbeddingRouter`（根据 provider 派发）
- `agenticx.retrieval.VectorRetriever`（以 `Knowledge` 的 vector_store 包装）
- `agenticx.knowledge.readers.get_reader` / `agenticx.knowledge.chunkers.get_chunker`

### 2.2 `KBRuntime` 行为要点

- **懒加载**：首次用到才装配；未启用时路由返回 `{enabled: false}`。
- **切换 embedding**：对比 `config.embedding.dim` 与已有向量集合维度；不一致则 `rebuild_required=true`，且 **不自动删库**，由用户显式触发 rebuild。
- **线程安全**：ingest 走后台，search 同步；共享一个 Chroma client。
- **错误隔离**：单文档失败不拖垮整个 job，最终状态报 `partial_done(success=N, failed=M, reasons=[...])`。

### 2.3 `knowledge_search` 工具合约

```python
# 工具参数
{
  "query": str,
  "top_k": int = 5,   # 上限 20
}
# 工具返回
{
  "hits": List[RetrievalHit],
  "used_top_k": int,
  "source": "local"
}
```

挂在 STUDIO_TOOLS 白名单；受现有权限（per-avatar tool auth）管控。

---

## 3. 前端改造（`desktop/src/`）

### 3.1 导航 & 入口

- `desktop/src/settings-tab.ts`：在 `SETTINGS_TAB_IDS` 插入 `"knowledge"`（建议位置：`"skills"` 之后）。
- `desktop/src/components/SettingsPanel.tsx` 的 `TABS`：新增 `{ id: "knowledge", label: "知识库", icon: BookOpen }`（图标可用 lucide `BookOpen` 或 `Library`）。

### 3.2 组件布局

```
desktop/src/components/settings/knowledge/
├── KnowledgeSettings.tsx         # 容器，三栏 Tabs：「配置」「资料」「调试」
├── KnowledgeConfigPanel.tsx      # t09
├── KnowledgeMaterialsPanel.tsx   # t10（拖拽、列表、进度）
├── KnowledgeDebugPanel.tsx       # t11（Top-K + 切片预览）
├── useKnowledgeApi.ts            # fetch 封装
└── types.ts                      # RetrievalHit / KBConfig / IngestJob 类型
```

拖拽上传复用现有 `@file` / 附件的 Drop 组件（如果已抽象）；否则用原生 `DataTransfer` + 后端上传 API。

### 3.3 引用渲染（t12）

- 消息气泡在渲染文本后，若工具结果中有 `knowledge_search` → `hits`，追加引用卡片区域（与现有 @file 引用样式一致）。
- 卡片：`[源名] score=0.82  · chunk #3`；点击在新面板预览片段 + 打开源文件。

### 3.4 Ollama 探测降级（t13）

- 首次进入 KB 页触发 `GET /api/kb/config`，若 `embedding.provider=ollama` 但探测失败：显示引导卡片「未检测到 Ollama，一键切换到已配置的在线 Provider」+ 指向模型服务页。

---

## 4. 测试策略（t14）

| 层 | 用例 |
|----|------|
| 单测（pytest） | `KBRuntime` 装配、embedding 维度守卫、ingest job 状态机、`knowledge_search` 工具返回契约 |
| 单测（mock） | Mock `EmbeddingRouter` 返回固定向量；tmp 目录 Chroma |
| 集成 | 起 `agx serve` → `/api/kb/config` → 上传 1 MD + 1 PDF → 轮询 `/api/kb/jobs/{id}` → `/api/kb/search` 验证命中 |
| 前端 | 三栏组件快照测试；上传 → 进度 → 列表更新链路 |
| Smoke | Desktop 手动：拖入示例 `README.md` → 提问"如何运行" → 回答带引用卡 |

---

## 5. 风险与对策（对齐产品 plan §7）

| 风险 | 应对（阶段 1 动作） |
|------|---------------------|
| Embedding 维度锁定 | t16：UI 强提示 + 配置冻结 `embedding_id/dim` |
| 中文切片质量 | 阶段 1 不上 BM25；recursive_chunker 的中文表现留 smoke 验证，差再调 overlap/size |
| pymilvus 体积 | 阶段 1 不打包 Milvus；仅在后续设置切换时按需安装 |
| 大文件 ingestion 阻塞 | t03：强制走后台任务；单文件 > 100MB 直接拒绝并提示 |
| Ollama 未装 | t13：探测失败不报错，引导到模型服务页配置在线 Provider |
| 远端 URI 不可点 | 阶段 1 仅本地路径，此风险阶段 2 再处理 |

---

## 6. 完成定义（DoD，必须逐条过）

1. `agx serve` 启动后 `/api/kb/*` 全链路可调（curl 可验证）。
2. Desktop 设置页「知识库」tab 完整三栏可用；空态可拖入资料。
3. 拖入 1 MD + 1 PDF + 1 DOCX，状态流转 `queued → done`，可见片段数。
4. 调试区输入问题返回 Top-K，分数与来源正确；切片预览可见实际分段。
5. 在普通聊天里 Agent 能调用 `knowledge_search`，答案带引用卡。
6. 切换 Embedding 模型 UI 强提示需重建，未重建前不得混用。
7. 所有新增单测/集成测试绿；smoke 手动一次通过。
8. 用户文档 + 空态引导上线（t15 可 P1，但不得阻塞合并）。

---

## 7. 实施顺序建议（PR 粒度）

| PR | 合入内容 | 依赖 |
|----|----------|------|
| PR-1 | t00 契约文档 + t01 `KBRuntime` 最小骨架 + 单测 | 无 |
| PR-2 | t02/t03/t04/t05 后端 API + ingest 任务 + API 集成测试 | PR-1 |
| PR-3 | t06/t07 `knowledge_search` 工具 + 引用注入 | PR-2 |
| PR-4 | t08/t09/t10 前端导航 + 配置区 + 资料管理区 | PR-2 |
| PR-5 | t11/t12/t13 调试区 + 引用卡片 + Ollama 降级 | PR-3, PR-4 |
| PR-6 | t14/t16 测试加固 + 维度守卫 + smoke | PR-5 |
| PR-7 | t15 文档 & 空态引导 | PR-6 |

每个 PR commit 信息带：

```
Plan-Id: machi-kb-stage1-local-mvp
Plan-File: .cursor/plans/2026-04-14-machi-kb-stage1-local-mvp.plan.md
Made-with: Damon Li
```

---

## 8. 不在本计划内（避免范围蔓延）

- 多 KB / 分身绑定 / 会话级切换（阶段 2）
- BM25 Hybrid / Reranker（阶段 2）
- 把本机 KB 暴露为 MCP（阶段 3 差异化）
- 连接器同步（阶段 3）
- GraphRAG（阶段 3）
- 复杂 PDF 走 mineru（阶段 3 可选）

---

**版本：** 2026-04-14 · v1（待确认：是否采用，是否要进一步把 PR 粒度切细）
