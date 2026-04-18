# Machi 知识库（Stage-1 MVP）— 用户指南

> Plan-Id: `machi-kb-stage1-local-mvp`
> Plan-File: [`.cursor/plans/2026-04-14-machi-kb-stage1-local-mvp.plan.md`](../../.cursor/plans/2026-04-14-machi-kb-stage1-local-mvp.plan.md)
> 产品规划：[`docs/plans/2026-04-14-machi-knowledge-base-product-plan.md`](../plans/2026-04-14-machi-knowledge-base-product-plan.md) (v2.1)

Machi 桌面的「知识库」面板让你把 Markdown / TXT / PDF / Word 文档
**本地索引** 成向量，对话时 Agent 可通过 `knowledge_search` 工具检索引用。
Stage-1 MVP 坚持**单一全局 KB、Chroma、Ollama bge-m3 默认**；
多 KB、分身绑定、BM25/Rerank、GraphRAG 等在后续阶段引入。

---

## 首次启用（3 步）

1. **启动 Ollama 与 bge-m3（默认路径）**
   ```bash
   # macOS / Linux
   curl -fsSL https://ollama.com/install.sh | sh
   ollama pull bge-m3
   ollama serve  # 默认 http://localhost:11434
   ```
   如果你**不想装 Ollama**，在第 2 步切换到 OpenAI / SiliconFlow / Bailian。

2. **在 Machi 设置里打开「知识库」tab**
   - 勾选「启用本地知识库」
   - 确认 Embedding Provider（默认 Ollama / bge-m3；点配置后系统会**自动探测** Ollama
     并在未命中时给出橙色提示）
   - 保存

3. **拖入资料**
   - 切到「资料」子 tab，拖拽文件到拖放区，或点击选择
   - 每个文件会走 `queued → parsing → chunking → embedding → writing → done`
   - 失败原因会显示在红色文本里（例如文件过大 / 维度不匹配 / 解析失败）

---

## 在对话里使用

一旦至少有一份资料进入 `done` 状态，**Meta-Agent 的 system prompt 会被
自动告知**「有文档问题时先调用 `knowledge_search`」。典型触发语：

- 「文档里是怎么说的？」
- 「按知识库回答」
- 「我上传的那份 PDF 里提到过…」

Agent 返回时会在回答中**内联引用**（如「根据 `notes.md` 第 3 段…」）。
对应的工具调用气泡会显示「📚 知识库命中 N 条引用：…」，含来源路径、
chunk 索引、score 与片段预览。

---

## 调试（遇到检索不准）

在「调试」子 tab：

- **Top-K 检索**：直接输入自然语言查询，看命中片段、分数、来源，
  与线上 agent 行为完全一致（复用同一条 `/api/kb/search`）。
- **切片预览**：输入任意本地文件绝对路径，试不同 `chunk_size / chunk_overlap`
  组合，不产生向量写入 —— 便于在真正索引前调优。

---

## 切换嵌入模型 ≈ 重建索引

**重要**：嵌入模型变化（provider / model / dim 任一不同）= 向量空间不兼容。
系统检测到后会做两件事：

1. 「配置」页顶部显示**橙色横幅**「⚠️ 嵌入模型或维度已变更 …」
2. `/api/kb/config` 的 PUT 返回 `rebuild_required: true`

此时你必须在「资料」页**逐个点「重建索引」**（🔄 图标）。系统
**不会自动清库**，防止误操作。

---

## 文件与存储布局

| 路径 | 作用 |
|------|------|
| `~/.agenticx/config.yaml : knowledge_base` | 所有配置 |
| `~/.agenticx/storage/vector_db/default/` | Chroma PersistentClient |
| `~/.agenticx/storage/kb/documents.json` | 文档注册表（源路径 / 状态 / 片段数） |
| `~/.agenticx/storage/kb/state.json` | `indexed_fingerprint`，用于 rebuild 检测 |
| `~/.agenticx/storage/vector_db/uploads/` | UI 上传的临时副本 |

任何时候想推倒重来：停用 KB、删除上述目录、再启用即可。

---

## 故障排除

| 现象 | 可能原因 | 处理 |
|------|----------|------|
| 「未在本机检测到 Ollama」 | Ollama 未启动或 `base_url` 错 | 启动 `ollama serve`；或在配置页切换到在线 Provider |
| ingest 一直 `queued` 不前进 | 后台线程被意外 join | 查 `agx serve` 日志；重启 serve 进程 |
| `Embedding dim mismatch` | 模型维度与 `config.embedding.dim` 不一致 | 在配置里改 dim 并重建索引 |
| 「文件过大」 | 超过 `file_filters.max_file_size_mb` | 调大配置或拆文件 |
| search 结果为空但应有命中 | 索引早于 embedding 切换 | 按重建横幅提示重建 |
| PDF 解析失败 | PDF 依赖未装或文件损坏 | 检查 `agenticx.knowledge.readers.pdf_reader` 依赖；或先转成 Markdown |

---

## 接下来（Stage-2 / Stage-3 路线图）

- 多 KB + 分身多选绑定、会话级临时覆盖
- BM25 Hybrid + Reranker（提高中文检索召回与精度）
- 把本机 KB 暴露为 MCP Server（外部 Agent 可共享你的索引）
- mineru 后端接入（复杂 PDF 表格/布局）
- Notion / 飞书 / S3 等连接器同步

详见产品 plan v2.1 §6.2 / §6.3。
