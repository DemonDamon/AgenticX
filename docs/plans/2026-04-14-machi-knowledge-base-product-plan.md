# Machi 知识库能力 — 产品规划 (v2)

> **目标读者：** 产品 / 架构 / 前后端工程师；进入编码阶段请在 `.cursor/plans/` 建立同名或子模块实现计划，并以 `Plan-Id` / `Plan-File` 追溯。

**Goal：** 为 Machi 提供可演进的 **知识库（Knowledge Base, KB）** 能力。产品形态对标 **AnythingLLM**（桌面拖拽 + 工作区绑定 + 零配置本地 RAG），切片与调试体验对标 **Dify**（可预览的分段与召回调试），工程上 **复用 `agenticx.knowledge / retrieval / storage / embeddings` 既有模块**，不重造轮子。

**非目标（首期明确不做）：**

- 替代企业 KMS 的文档治理（ACL 审计、合规留存、版本分支）。
- 复刻 Dify 的工作流编排。
- 跨设备实时协作编辑。
- 保证所有第三方 KB 的能力对等。

---

## 1. 背景与问题陈述

用户在 Machi 内需要：

1. **把本地资料变成可长期检索的知识**（拖拽 / 选定目录 → 解析 → 入库 → 问答），而不是每轮把 `context_files` 全文塞进提示词。
2. **连接已有远端知识库**（自建、AgenticX 生态、第三方云 KB），避免重复索引与权限模型。
3. 未来扩展 **连接器同步**（云盘 / 在线文档）与 **多源融合**（本地 + 多个远端统一检索）。

仓库现有积木（见 §2），使得 Machi 一期工程可以 **收敛为「桌面产品层 + 胶水 API + 配置/作用域」** 三件事。

---

## 2. 可复用资产盘点（重要 — 决定了范围可收敛）

| 层 | 模块 | 说明 / 复用方式 |
|----|------|-----------------|
| **解析** | `agenticx.knowledge.readers` | PDF / Word / PPT / CSV / JSON / Web / Text reader 已就绪 |
| **复杂文档** | `agenticx.storage.mineru` | 复杂 PDF 表格/布局解析已打通，可作为可选后端 |
| **切片** | `agenticx.knowledge.chunkers` | `fixed_size / recursive / semantic / agentic / document / csv_row`，预留 Dify 式"切片预览"所需 |
| **文档对象** | `agenticx.knowledge.document` | `Document / DocumentMetadata / ChunkMetadata` 统一模型 |
| **处理流水线** | `agenticx.knowledge.processing` + `extractor` | `ProcessingBackend`（Simple/Structured/VLMLayout），带指标 |
| **知识库门面** | `agenticx.knowledge.Knowledge` | 上层统一知识库对象，Machi 直接消费 |
| **检索器** | `agenticx.retrieval` | `VectorRetriever / BM25Retriever / HybridRetriever / GraphRetriever / AutoRetriever / Reranker` |
| **检索工具** | `agenticx.retrieval.tools` | `DocumentIndexingTool / RetrievalTool / RerankingTool / …` 可直接作为 Agent 工具 |
| **向量库** | `agenticx.storage.vectordb_storages` | `chroma / faiss / qdrant / milvus / pgvector / pinecone / weaviate` |
| **Embedding** | `agenticx.embeddings` | `openai / siliconflow / bailian / litellm / router` |
| **图谱（远期）** | `agenticx.knowledge.graphers` | GraphRAG / SPO 抽取 / Neo4j 导出；一期**不启用**但 schema 预留 |

**结论：** Machi 侧**不做** ingestion / chunk / embedding / vector store / retriever 的从零实现；只做 **桌面 UI、Studio API 胶水、作用域与配置管理**。

---

## 3. 能力模式

### 3.1 模式 A：本地知识库（必选）

| 要素 | 说明 |
|------|------|
| **入口** | (i) 设置页「知识库」tab 的"添加资料"；(ii) 工作区拖拽；(iii) 指定目录挂载并监听变更 |
| **解析** | 复用 `agenticx.knowledge.readers`；复杂 PDF 可选启用 `mineru` 后端；失败时显示可读错误并允许部分索引 |
| **切片** | 默认 `recursive_chunker`，`chunk_size=800 / overlap=80`（中文场景需验证）；高级用户可切 semantic/agentic |
| **向量化** | 默认 Ollama 本地 `bge-m3` 或 `nomic-embed-text`；也支持已配置的在线 Embedding（走 `agenticx.embeddings.router`） |
| **存储** | **默认 Chroma**（`agenticx.storage.vectordb_storages.chroma`，零依赖、桌面友好），路径 `~/.agenticx/storage/vector_db/<kb_id>`；**可选后端**：**Milvus Lite**（进阶 / 大数据量，纯 Python、单文件 `.db`）、**Qdrant**、**FAISS**；**远端部署**场景可对接 Milvus Standalone / Cluster |
| **检索** | 一期仅 `VectorRetriever`；二期并上 `HybridRetriever + Reranker` |
| **问答** | RAG：检索 Top-K → 注入对话；同时暴露内置工具 `knowledge_search`（Agent 可显式调用）；回答 **必须带引用**（源路径 + 片段） |

**验收（产品级）：** 离线环境下，用户能完成「加资料 → 提问 → 答案带可点引用」闭环。

### 3.2 模式 B：远端知识库对接（必选，一期只做最小面）

| 子模式 | 说明 |
|--------|------|
| **B1：MCP（消费方）** | 远端以 MCP Server 暴露 `search / get_chunk / list_sources`。Machi 走现有 MCP Hub，无需主进程硬编码。 |
| **B2：HTTP 适配器** | 非 MCP 云 KB / 内网网关，通过 **适配器** 映射到统一 `RetrievalHit` 结构。 |
| **B3：AgenticX 自有远端 KB（可选产品）** | 若未来提供托管 KB，仍走 MCP / OpenAPI，与 B1/B2 同抽象。 |

**验收：** 至少打通 1 条 MCP 样例（可为官方 demo）+ 1 条 mock HTTP 适配；会话中可选择「仅本地 / 某远端 / 混合」。

### 3.3 模式 C：扩展（路线图，不必首期）

| 模式 | 价值 / 落点 |
|------|-------------|
| **把 Machi 本机 KB 暴露为 MCP** | 外部 Agent / Claude Desktop 等复用我们的索引；**差异化** |
| **连接器同步** | Notion / 飞书 / S3 / 网盘等定期拉取与增量 |
| **会话内临时 KB（@file）** | 与长期 KB 明确分层，避免产品语义混淆 |
| **多源混合检索** | 本地 + 多 MCP 并行；需 **去重 / 配额 / 超时 / 部分成功** |
| **GraphRAG / 文档图谱** | 复用 `agenticx.knowledge.graphers`；schema 预留 `kb.type: vector \| graph \| hybrid` |
| **团队/空间（远期）** | 多用户共享索引与权限；与本机离线模型冲突时需 SKU 分叉 |

---

## 4. 信息架构与 UI（设置页）

在左侧导航新增「📚 知识库」（位于「技能」下方，与「MCP」并列）。主区域分三栏：

| 区 | 内容 |
|----|------|
| **配置区** | 向量库路径（默认 `~/.agenticx/storage/vector_db/<kb_id>`）、向量库实现（Chroma 默认 / FAISS / Qdrant）、Embedding Provider + 模型（下拉复用现有 Provider 配置）、默认切片策略（`chunk_size / overlap / strategy`）、文件类型过滤 |
| **资料管理区** | 已导入资料列表（来源、大小、状态、修改时间、片段数）、单项重建索引、删除、失败原因、整体进度 |
| **调试区（Dify 式）** | 输入问题 → 展示 Top-K 片段、分数、命中策略（vec / bm25 / hybrid）、来源；支持 **切片预览**（选中文档看实际分段结果） |

**与分身 / 会话的关系（关键设计）：**

- **KB 是独立对象**：一个名字、一份索引、一组切片/检索策略。
- **分身 ↔ KB 多对多**：分身编辑页新增「挂载知识库」多选。
- **会话级开关**：会话顶部保留「临时关闭 / 切换 KB」，避免强绑定困扰。
- **全局开关**：保留"是否允许所有分身默认检索该 KB"，但**默认关闭**，避免泄漏预期。

---

## 5. 与现有系统对齐（实现时约束）

- **配置落盘：** 走 `~/.agenticx/config.yaml`，不重造一份；敏感项（API Key）遵循既有加密 / 不落日志规范。
- **后台任务：** 大文件 ingestion 必须走 `agx serve` 后台任务队列，不阻塞主聊天线程；进度通过现有 IPC/WebSocket 推送。
- **上下文注入：** 检索片段进入 `meta_agent` 或会话时，遵守既有"上下文块"规范，**不得只报数量不报内容**。
- **隐私：** 本地索引默认仅存本机；远端连接在会话 UI 需可见其"在线/离线/限流"状态。
- **Desktop UX：** 乐观 UI、错误可恢复、设置持久化等已有约定延续。

---

## 6. 分期路线图（收敛后）

### 阶段 0：契约与选型（约 1 周）

**产出：**

- `RetrievalHit`（跨本地/远端统一）、错误码、配额草案。
- 选型决议：向量库默认 Chroma、Embedding 默认 `bge-m3`（Ollama）。
- 首期"不做"清单正式签署。

**验收：** 评审通过《API/契约》与《可复用资产映射表》。

### 阶段 1：本地 KB MVP（核心，3–6 周）

**强约束：只做下面这几件，其它推迟。**

- [ ] **1 个全局作用域 KB**（先不做多 KB / 分身绑定）
- [ ] 支持文件类型：Markdown / TXT / PDF（简单版，不启用 mineru） / DOCX
- [ ] 默认切片：`recursive_chunker`，`chunk_size=800 / overlap=80`
- [ ] Embedding：Ollama `bge-m3` 为默认；可切换已配置在线 Provider
- [ ] 向量库：Chroma（路径 `~/.agenticx/storage/vector_db/default`）
- [ ] 检索：仅 `VectorRetriever`（Top-K，默认 K=5）
- [ ] Agent 工具：内置 `knowledge_search`（不走 MCP，直接 Python 注册）
- [ ] UI：设置页三栏（配置区 + 资料管理区 + 调试区）
- [ ] 引用溯源：源路径 + 片段原文，UI 可点击跳转
- [ ] 后台任务 + 进度反馈

**推迟（明确不做）：** 多 KB、分身绑定多选、HybridRetriever、Rerank、mineru、GraphRAG、MCP 暴露、连接器同步。

**验收：**

1. 离线可用（本地 Ollama）。
2. 1000 份中等体量文档（< 1MB 平均）入库不阻塞聊天。
3. 调试区可见 Top-K 与来源，答案带引用。

### 阶段 2：远端 MCP + 适配器 + 多 KB（约 3–5 周）

- MCP 检索工具注册与连接健康检查。
- HTTP 适配器接口 + 一个 mock KB 示例。
- **多 KB** + 分身绑定多选 + 会话级开关。
- 检索策略：并入 `HybridRetriever`（可开关 BM25）+ `Reranker`（可选启用）。
- 设置页「知识库连接」区块。

**验收：** 一条官方 MCP + 一条 mock HTTP 端到端走通；分身可绑定 N 个 KB。

### 阶段 3：体验 / 差异化（持续）

- **把本机 KB 暴露为 MCP**（差异化）。
- 连接器同步（Notion / 飞书 / S3 …）。
- 复杂 PDF 走 `mineru` 后端（可选开关）。
- GraphRAG 试点（复用 `agenticx.knowledge.graphers`）。
- 中文切片/分词/召回的专项调优。

---

## 7. 风险与开放问题

| 项目 | 说明 | 应对 |
|------|------|------|
| **Embedding 维度锁定** | 切换 Embedding 模型即需要重建索引 | UI 切换时强提醒 + 引导"重建"；配置里固化 `embedding_id` 与向量库版本 |
| **中文切片与 BM25** | 默认 chunker/分词对中文效果未知 | 阶段 1 不上 BM25；阶段 2 上时先验证 `jieba` 分词 |
| **向量库选型** | LanceDB 引入新 C++ 依赖 | **默认 Chroma**（已在仓库），LanceDB 留作未来选项 |
| **Milvus Lite 依赖体积** | `pymilvus` 会显著增加桌面安装包体积 | 仅当用户在设置中**显式切换**为 Milvus Lite 时按需延迟加载 / 提示安装；默认不打包 |
| **大文件 ingestion** | 阻塞聊天或内存暴涨 | 后台队列 + 分块流式处理 + 失败可重试 |
| **Embedding 云依赖** | 云 embedding 的安全/合规 | 默认本地 Ollama；云 Provider 需用户显式启用 |
| **远端 KB `source_uri` 不可达** | 第三方返回的 URI 未必可点 | UI 优雅降级：展示文本来源而非强制可点链接 |
| **与会话 FTS 边界** | 会话 FTS 面向聊天记录，KB 面向文档块 | 两者不混表；检索接口分离 |
| **Web 端 Machi** | Web 版无法本机向量库 | Web 版只消费远端 KB（或受限 IndexedDB），桌面版保留完整能力 |

---

## 8. 需求条目（便于拆 issue）

**功能需求**

- **FR-1**：用户可将本地文件 / 目录加入 KB，并完成解析与索引。
- **FR-2**：用户可通过 MCP 或 HTTP 适配器连接远端 KB 并用于问答。
- **FR-3**：问答结果展示可追溯引用（本地路径 / 远端资源标识）。
- **FR-4**：设置页提供切片预览与 Top-K 调试。
- **FR-5**：Agent 可通过 `knowledge_search` 工具显式调用 KB。
- **FR-6**（阶段 2）：分身可绑定多个 KB，会话可临时覆盖。
- **FR-7**（阶段 3）：本机 KB 可选择以 MCP 形式对外暴露。

**非功能需求**

- **NFR-1**：本地索引默认仅存本机。
- **NFR-2**：大文件 ingestion 不阻塞主聊天线程。
- **NFR-3**：切换 Embedding 模型必须有「重建索引」的显式提示。
- **NFR-4**：所有 KB 相关配置走现有 `~/.agenticx/config.yaml`，不新增配置机制。

---

## 9. 对标参考（来自 `和创/知识库qa相关信息.md`）

| 工具 | 我们借鉴什么 | 我们**不**学什么 |
|------|--------------|------------------|
| **AnythingLLM** | 桌面拖拽、Workspace 绑定、本地零配置 RAG | 其自研 embedding/store 栈（我们用 AgenticX 既有） |
| **Dify** | 切片预览、召回调试、清洗策略 | 工作流编排（超出范围） |
| **Open WebUI** | `#` 引用交互 | Web-only 的文档管理深度 |
| **RAGFlow** | 复杂 PDF 解析思路 | 一期不自研，复用 `mineru` |
| **MaxKB / FastGPT** | 快速搭建问答机器人 UX | 不走其应用平台定位 |

---

## 10. 与仓库计划路径的说明

本文档位于 `docs/plans/`，定位为 **产品向规划**。进入编码阶段时，对应的实现计划应建立在 **`.cursor/plans/`**（例如 `.cursor/plans/machi-kb-stage1-local-mvp.md`），并在提交信息中以 `Plan-Id` / `Plan-File` 追溯到本文件。

---

**文档版本：** v2.1 · 2026-04-14  
**状态：** Draft（待产品确认阶段 1 边界与默认选型：向量库 = Chroma / Embedding = Ollama bge-m3）  
**主要变更：**

- v2：明确与 AnythingLLM / Dify 的对标与取舍；新增 `agenticx.*` 资产盘点；阶段 1 MVP 强制收敛到全局单 KB；补充 UI 信息架构、风险（Embedding 维度锁定 / 中文切片 / 向量库默认 Chroma）与扩展项「本机 KB 暴露为 MCP」。
- v2.1：向量库可选后端增加 **Milvus Lite**（桌面进阶）与 **Milvus Standalone / Cluster**（远端部署）；新增 `pymilvus` 体积相关风险与按需加载策略。
