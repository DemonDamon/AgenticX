# context-service

企业统一上下文服务。一句话：**一份企业知识库，编译一次，全公司 agent 共用。**

它是桌面端 `knowledge_search` / `knowledge_read`（L0/L1 分级读取）与 wiki 编译产物
（增量跳过 + 跨文档合并 + 矛盾保留）的服务端镜像——企业内所有 agent 面对的是同一份
编译产物、同一种分级读取格式，不再各自检索原始文档、各自把全文塞进上下文。

## 接口（除 healthz 外全部需要 `x-agx-internal-token`）

| 接口 | 作用 |
|---|---|
| `GET /healthz` | 探活，不需要 token |
| `POST /context/ingest` | 文档入库（写盘 + 向量索引），body: `{name, text}` |
| `POST /context/compile` | 把已入库文档编译进共享 wiki（未变文档零 LLM 跳过），body: `{name}` |
| `POST /context/search` | L0 紧凑索引：每条 hit 只带查询相关摘录，body: `{query, top_k?}` |
| `POST /context/read` | L1 按需取单条全文，body: `{hit_id}` |
| `GET /context/wiki/page?path=` | 读共享 wiki 编译产物页面 |

## 为什么是独立服务而不是在 admin-console 里用 Node 重写

载荷是检索器与 wiki 编译器，不是 CRUD。核心仓 `agenticx.brain.wiki_compiler`（SP31）
与 `agenticx.brain.search` 的分级读取（SP32）已经过桌面端真机验证；用 Node 重写的结果
是两套编译器、两套检索器，而企业侧那个必然更弱——偏偏它服务的是全公司。

## 为什么 ingest 和 compile 分开

索引快（embedding），编译慢（LLM 逐文档生成页面）。admin-console 编排：先 ingest 立即可检，
再 compile 产出共享 wiki；compile 幂等——未变文档直接跳过，不花一次模型调用。

## 它不该拿到的东西

**租户库凭据。** 这个服务只回答「知识库里有什么、哪段相关、全文是什么」，用户/租户/
权限由 admin-console 和 gateway 管。即使被打穿，攻击者拿到的是企业知识文档的读能力，
不是租户库。

## 配置（全部环境变量）

| 变量 | 默认 | 说明 |
|---|---|---|
| `CONTEXT_SERVICE_INTERNAL_TOKEN`（或 `_FILE`） | 必填 | 内部 token，不配不启动 |
| `CONTEXT_STORAGE_ROOT` | `./context_data` | 共享 wiki 产物 + 向量库根（挂持久卷） |
| `CONTEXT_EMBEDDING_PROVIDER` | `ollama` | 同桌面端默认 |
| `CONTEXT_EMBEDDING_MODEL` | `bge-m3` | |
| `CONTEXT_EMBEDDING_DIM` | `1024` | |
| `CONTEXT_EMBEDDING_BASE_URL` | `http://localhost:11434` | |
| `CONTEXT_WIKI_PROVIDER` / `CONTEXT_WIKI_MODEL` | 空 | 编译 LLM，走核心仓 ProviderResolver |

## 本地运行

```bash
cd enterprise/apps/context-service
pip install -r requirements.txt
export CONTEXT_SERVICE_INTERNAL_TOKEN=dev-token
export CONTEXT_STORAGE_ROOT=/tmp/agx-context
uvicorn context_service.app:create_app --factory --port 8091
```

测试（核心仓根目录）：

```bash
python3 -m pytest -o addopts="" enterprise/apps/context-service/tests -q
```
