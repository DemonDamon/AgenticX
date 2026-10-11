# SP33 — Enterprise 统一上下文服务（编译产物 + 分级检索全公司 agent 共享）

## 背景与动机

SP31（wiki 增量编译 + 矛盾保留）与 SP32（L0/L1 分级读取）已落在核心产品仓的桌面端链路。
企业侧（`enterprise/`）目前没有任何服务能消费这两个能力：`features/knowledge-base` 与
`packages/sdk-py` 都还是空壳。企业客户的价值场景是：**一份企业知识库，编译一次，
全公司的 agent 共用**——不用每个 agent 重复检索原始文档、重复把全文塞进上下文。

## 方案：`enterprise/apps/context-service`（窄服务，参照 skill-registry 模式）

独立 FastAPI 服务，复用核心仓引擎、零逻辑重写：

| 接口 | 作用 | 复用 |
|---|---|---|
| `GET /healthz` | 探活，无 token | — |
| `POST /context/ingest` | 文档入库（写盘 + 向量索引） | `KBRuntime.register_document / ingest_document` |
| `POST /context/compile` | 把已入库文档编译进共享 wiki（增量跳过、跨文档合并、矛盾保留） | `WikiCompiler.compile_source`（SP31） |
| `POST /context/search` | L0 紧凑索引（≤280 字符查询相关摘录 + read 提示） | `KBRuntime.search` + `make_query_snippet`（SP32） |
| `POST /context/read` | L1 按需取单条全文 | `_HitFulltextCache` + `read_kb_hit`（SP32） |
| `GET /context/wiki/page?path=` | 读共享 wiki 编译产物页面 | SP31 页面契约 |

### 设计要点

- **统一上下文的含义**：wiki 产物（一次编译）+ L0/L1 检索（按需读取）对企业内所有
  agent 是同一份、同一格式——桌面端 `knowledge_search/knowledge_read` 的服务端镜像。
- **窄服务边界**（继承 skill-registry 哲学）：内部 token 强制（`x-agx-internal-token`，
  支持 `_FILE`）、不连租户库、写库由 admin-console 编排、路径穿越一律拒绝。
- **配置全部环境变量**：`CONTEXT_STORAGE_ROOT`（共享产物 + 向量库根）、
  `CONTEXT_EMBEDDING_*`（默认 ollama bge-m3，与桌面一致）、`CONTEXT_WIKI_PROVIDER/MODEL`
  （编译 LLM，走核心仓 ProviderResolver）、`CONTEXT_SERVICE_INTERNAL_TOKEN`（必填）。
- **ingest 与 compile 分开**：索引快、编译慢（LLM），admin-console 编排先 ingest 后
  compile；compile 幂等（未变文档零 LLM 跳过，SP31 增量指纹）。

## 验收标准

- 全部接口契约测试绿（token 鉴权 / ingest→search(L0)→read(L1) 往返 / compile 出页面 +
  wiki/page 可读 / 未变文档重编译 skipped / 路径穿越与非法文件名拒绝）。
- 服务测试在核心仓 pytest 下可直接运行（fake embedding + monkeypatch LLM，不联网）。
- Dockerfile 只拷核心仓所需子包（不 pip install agenticx 全量依赖之外的镜像爆炸）。
- 提交推送 AgenticX main。

## 非目标

- 不做租户/权限模型（admin-console 的职责）。
- 不做文档解析的格式扩展（.md/.txt 先行，PDF 等走桌面端 ingest 链路后再开放）。
- 不接 Edge Agent 默认链路（README 说明对接方式即可）。
