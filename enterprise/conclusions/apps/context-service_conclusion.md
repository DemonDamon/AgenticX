# context-service

企业侧**统一上下文服务**（FastAPI）。托管全公司共享的知识库：文档入库与向量检索、wiki 编译产物、L0/L1 分级读取，以及 SP-F1 的案例检索与 wiki 批量推送。复用核心仓 `agenticx.brain` / `agenticx.studio.kb`，不在企业侧重写检索器或编译器。

## Responsibility

**负责（代码已实现）：**

- `GET /healthz`：探活，无 token。
- `POST /context/ingest`：校验文档名 → 写入 `{storage}/documents/{name}.md` → `KBRuntime.register_document` + `ingest_document`（向量索引）。
- `POST /context/compile`：对已入库文档调用 `WikiCompiler.compile_source`（可配 wiki LLM；未变文档增量跳过）。
- `POST /context/search`：L0 紧凑检索（`runtime.search` + `make_query_snippet`），hit 写入 `_HIT_FULLTEXT_CACHE`（`brain_id=enterprise`）。
- `POST /context/read`：L1 按 `hit_id` 读全文（`read_kb_hit`，依赖最近一次 search 的缓存）。
- `GET /context/wiki/page?path=`：读共享 wiki 页面（路径校验防 `..`；先相对 `storage`，再相对 `storage/wiki`）。
- `POST /context/wiki/push`：批量 ingest，可选逐页 compile；单页失败记入 `errors` 不中断整批。
- `POST /context/cases/search`：向量召回（固定池 `_CASE_RECALL_POOL=20`）+ frontmatter `case_id` 判定 + `scope_filter` 硬过滤。
- `GET /context/cases/get?case_id=`：在 `documents_dir` 下扫描 `*.md`，按 frontmatter `case_id` 返回原文。
- `GET /context/wiki/list`：列出 `storage/wiki/` 下全部 `.md` 相对路径。

**明确不拥有：**

- 租户库、用户/部门权限、IAM 写库（README 与模块 docstring 均声明由 admin-console / gateway 编排；本服务无 PG/SQL 客户端）。
- 完整 `agx serve` / Studio 对话面（刻意窄镜像，只拷 KB/wiki/search 相关子包）。
- 案例领域模型（刻意不 import `agenticx.cases.model`；frontmatter 用本地 `_parse_frontmatter`）。

## Entry points and public interfaces

| 入口 | 路径 / 符号 | 角色 |
|------|-------------|------|
| App 工厂 | `context_service/app.py` — `create_app` | FastAPI；`docs_url=None`，`redoc_url=None` |
| 鉴权 | `require_internal_token` | Header `x-agx-internal-token`，`secrets.compare_digest` |
| 配置 | `context_service/config.py` — `Settings.from_env` | 无 token **拒绝启动**（`RuntimeError`） |
| KB 运行时 | `KBRuntime` + `_build_kb_config` | Chroma 集合 `enterprise_kb`，registry 在 `{storage}/kb` |
| Wiki 编译 | `WikiCompiler(storage)` | 编译 LLM 由 `CONTEXT_WIKI_PROVIDER` / `CONTEXT_WIKI_MODEL` 传入 |
| 分级读取 | `agenticx.brain.search` | `make_query_snippet`、`read_kb_hit`、`_HIT_FULLTEXT_CACHE` |
| 容器 | `Dockerfile` | python:3.12-slim，uid **10001**，端口 **8091**，HEALTHCHECK → `/healthz` |
| 本地 | `uvicorn context_service.app:create_app --factory --port 8091` | 见 README |

`create_app` 将 `runtime`、`compiler` 挂在 `app.state`，供测试替换 embedding 等，**无**对外测试后门路由。

## Core execution path

**ingest → search(L0) → read(L1)**

1. 调用方持内部 token `POST /context/ingest`（`name` 须匹配 `_SAFE_NAME_RE`）。
2. `POST /context/search`：`top_k` 限制在 1–20（默认 `Settings.default_top_k`）；返回紧凑 `text` 与 `read_full_text` 提示。
3. `POST /context/read`：从缓存取该 hit 全文；未 search 过的 id → 404。

**ingest → compile → wiki/page**

1. 文档须已存在于 `documents_dir`。
2. `WikiCompiler.compile_source` 写共享 wiki 树；`skipped` / `skipped_reason` 表示 SP31 指纹跳过。
3. `GET /context/wiki/page` 或 `GET /context/wiki/list` 读取产物。

**cases/search**

1. `runtime.search(..., top_k=20)` 按分数排序。
2. 仅处理 `source_path` 落在 `documents_dir` 下的 hit；读盘解析 frontmatter，有 `case_id` 才计入案例。
3. `scope_filter`：条目缺键保守放行；键存在且值不等则拒绝；同 `case_id` 多 chunk 只保留最高分。

**wiki/push**

逐页：写盘 → register → ingest；`compile=true`（默认）时再 `compile_source`；失败页只追加 `errors`。

## Data and configuration

无配置文件；数据落盘于 `CONTEXT_STORAGE_ROOT`（默认 `./context_data`）：

- `documents/`：入库 md 原文
- `chroma/`：向量库（backend `chroma`，collection `enterprise_kb`）
- `kb/`：`KBRuntime` registry
- `wiki/`：编译产物

环境变量（以 `Settings.from_env` 为准）：

| 变量 | 默认 | 说明 |
|------|------|------|
| `CONTEXT_SERVICE_INTERNAL_TOKEN` 或 `_FILE` | 无则拒绝启动 | 内部鉴权 |
| `CONTEXT_STORAGE_ROOT` | `./context_data` | 持久卷挂载点（Dockerfile 注释建议编排层挂 `/data`） |
| `CONTEXT_EMBEDDING_PROVIDER` | `ollama` | 传入 `EmbeddingSpec` |
| `CONTEXT_EMBEDDING_MODEL` | `bge-m3` | |
| `CONTEXT_EMBEDDING_DIM` | `1024` | 非法或非正整数回退默认 |
| `CONTEXT_EMBEDDING_BASE_URL` | `http://localhost:11434` | |
| `CONTEXT_WIKI_PROVIDER` | `""` | 空则编译器侧 provider 解析为 None |
| `CONTEXT_WIKI_MODEL` | `""` | |
| `CONTEXT_DEFAULT_TOP_K` | `5` | search / cases/search 的默认 top_k |

KB 内建常量（非环境变量）：chunk `800` / overlap `80`，扩展名 `.md`/`.txt`，单文件上限 50MiB。

运行时依赖外部 **embedding**（默认 Ollama）与可选 **wiki 编译 LLM**（核心仓 ProviderResolver 路径）；本仓库测试用确定性 embedding 桩与 monkeypatch `_invoke_llm`，不联网。

## Dependencies

**本服务 Python 直接 import 的核心仓模块：**

- `agenticx.studio.kb.contracts`（`KBConfig` 等）
- `agenticx.studio.kb.runtime` — `KBRuntime`
- `agenticx.brain.wiki_compiler` — `WikiCompiler`
- `agenticx.brain.search` — L0/L1 与 hit 缓存

**镜像 Dockerfile 拷贝的 agenticx 子树（供上述链路 transitive 使用）：** `core`、`brain`、`studio/kb`、`knowledge`、`tools`、`embeddings`、`llms`、`code_index`、`utils`（非整包 `pip install agenticx`）。

**requirements.txt 显式依赖：** `fastapi`、`uvicorn`、`httpx`、`PyYAML`、`pydantic`、`chromadb`、`litellm`。

**上游（设计意图，见 README/docstring）：** 持 `x-agx-internal-token` 的编排方（文档称 admin-console 先 ingest 再 compile）。**在 TARGET 提交上未检出 admin-console / gateway 内对该服务的 HTTP 客户端或 env 接线代码**（见「无法核实」）。

**不依赖：** 租户 PostgreSQL、Enterprise IAM 包、LiteLLM 对话网关进程（仅编译/embedding 链可能经 litellm 调模型）。

## Tests and operations

- 位置：`enterprise/apps/context-service/tests/test_app.py`（`conftest.py` 将服务根加入 `sys.path`）。
- 运行（仓库根目录，README 与测试头注释一致）：
  ```bash
  python3 -m pytest -o addopts="" enterprise/apps/context-service/tests -q
  ```
- 需要已安装 `chromadb`（`pytest.importorskip("chromadb")`）；embedding 在 fixture 中替换为 `_DeterministicEmbedding`，wiki LLM 用 monkeypatch `wiki_compiler._invoke_llm`。
- 覆盖：鉴权、ingest 校验、L0/L1 往返、compile + wiki/page、增量跳过、路径穿越、wiki/push 批量容错、cases/search 与 scope、cases/get、wiki/list 与 page 路径一致性。
- 容器以非 root 用户运行；HEALTHCHECK 本机请求 `/healthz`。

## Unverified or ambiguous

- **admin-console / gateway 是否已在 TARGET 分支接好 `CONTEXT_SERVICE_*` URL 与 token**：本结论只核对 `enterprise/apps/context-service` 源码，未找到调用方实现。
- **生产编排是否将持久卷挂到 `CONTEXT_STORAGE_ROOT`、8091 是否入服务发现**：仅 Dockerfile/README 描述，未核实现场 compose/K8s。
- **默认 Ollama / embedding 与 wiki LLM 在客户环境的可用性与配额**：代码假定可连；失败表现为 ingest/compile/search 的 HTTP 400 或编译 `error` 字段，无独立健康子检查。
- **README 接口表较 app 模块 docstring 少列 SP-F1 四个路由**；以 `app.py` 与测试为准，README 可能滞后。
- **`GET /context/cases/get` 为 O(n) 扫描 `documents_dir/*.md`**：大库性能与索引策略未在代码中优化，规模上限未定义。
