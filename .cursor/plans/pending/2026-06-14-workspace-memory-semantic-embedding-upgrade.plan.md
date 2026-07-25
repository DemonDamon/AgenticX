# Plan: 记忆库语义 embedding 升级（哈希向量 → 真语义向量）

Plan-Id: 2026-06-14-workspace-memory-semantic-embedding-upgrade
Status: draft (待用户确认后执行)
Owner: Damon Li
实施模型预期: composer-2.5（已按"精确到文件/函数/签名/禁改项 + 默认零回归"编写）
关联: 是 `2026-06-14-budgetmem-query-aware-memory-routing` 的 §8 P2-A 拆分独立 plan，
      两者解耦、可独立实施。

---

## 0. 给实施者（composer）的阅读须知

- 每步给了**精确文件 + 函数 + 行号锚点 + 接口签名**。行号为快照，偏移时用函数名/
  字符串锚点定位，不要猜。
- 严守 `no-scope-creep`：只改本 plan 点名的路径；不顺手重构旁边逻辑。
- Python 遵守 `google-python-style`：英文注释/docstring、文件头 `Author: Damon Li`、
  禁相对 import、代码无 emoji。
- **默认零回归**：新能力 feature flag 默认关闭；关闭时记忆检索行为与现状逐字节等价
  （仍走哈希向量）。仅当用户显式配置真 embedding 才切换。
- 每个 Phase 跑通对应冒烟再进下一个。

---

## 1. 背景与现状（事实基础，执行前必读）

### 1.1 记忆库当前用的是"哈希向量"，不是真语义 embedding
`agenticx/memory/workspace_memory.py`：
- `WorkspaceMemoryStore.__init__` 默认 `embedding_provider="hashing-v1"`,
  `embedding_model="hashing-64d"`（L95-96）。
- `_embedding_vector(text)`（L609-627）：把分词后每个 token 做 sha256，散列到 64 维
  bucket 累加符号、再归一化。**纯本地确定性映射，无任何语义**——近义词/改写句几乎
  不相似，跨语言更差。这是记忆检索召回质量的根因短板。
- `embedding_cache` 表（L144）与 `chunks` 表（L131）都把 `provider/model` 作为
  键的一部分（cache 主键 `provider+model+hash`，chunks 行存 `model`）。
- `_cosine_similarity`（L641-649）对**长度不等的两个向量直接返回 0.0**——这点很重要：
  切换 embedding 维度后，旧 64 维 chunk 与新维度 query 相似度恒为 0，必须重建索引。

### 1.2 KB 侧已有成熟的真 embedding 基础设施（直接可借鉴，勿重复造轮子）
- `agenticx/embeddings/` 下已有 provider 类：`litellm`(ollama)、`openai`、
  `siliconflow`、`bailian`，均提供 `embed_documents` / `embed_query` 接口。
- `agenticx/studio/kb/contracts.py::EmbeddingSpec`（L84）：
  `provider/model/dim/base_url/api_key/api_key_env` 字段齐全。
- `agenticx/studio/kb/runtime.py::_build_embedding_provider(spec)`（L111-171）：
  spec → provider 实例的映射；**已处理百炼 batch≤10**（L167）、各家 `dim`/`api_base`/
  key 回退（literal → env name → 厂商默认 env）。
- 结论：本 plan **不新写 provider**，只把"spec → provider"模式引到记忆库，并替换
  `_embedding_vector` 的取数来源。

### 1.3 解耦原则
记忆库（`agenticx/memory/`）**不应 import `agenticx/studio/kb/`**（KB 是上层应用）。
因此本 plan 在 memory 侧新建一个**独立的薄 builder**，底层直接复用 `agenticx.embeddings.*`
provider 类（与 kb 的 `_build_embedding_provider` 逻辑等价但不互相依赖）。

---

## 2. 目标（一句话）
让 `WorkspaceMemoryStore` 可配置使用真语义 embedding（ollama/openai/siliconflow/bailian），
默认仍回退哈希向量保证零回归；切换配置时安全重建索引并向上层暴露进度。

---

## 3. 范围（Scope）与非目标

### In scope
- memory 侧 embedding 配置层 + 独立 provider builder（复用 `agenticx.embeddings.*`）。
- `WorkspaceMemoryStore` 改为按配置取真 embedding，无 key/离线/异常时回退哈希。
- 批量 embedding + 缓存（避免逐 chunk 打 API）。
- 切换 embedding 配置后的**索引重建**入口（带进度回调）。

### Out of scope（本 plan 不做）
- 不改 KB（`studio/kb/`）任何代码——它已是真 embedding，互不影响。
- 不改 BudgetMem 路由 plan 的内容（解耦）。
- 不改图谱 / turn 归档 / decay / reinforce。
- 不改 enterprise/。
- Desktop 设置页 UI 作为**可选末期 Phase**（§5 Phase 4），核心后端不依赖它；
  若本期不做 UI，则通过 `config.yaml` + 重建 API/CLI 使用。

---

## 4. 需求（FR / NFR / AC）

### FR-1 记忆 embedding 配置节
- FR-1.1 `~/.agenticx/config.yaml` 支持 `memory.embedding` 节（字段对齐 `EmbeddingSpec`）：
  ```yaml
  memory:
    embedding:
      enabled: false        # 默认 false=继续用哈希向量（零回归）
      provider: "bailian"   # ollama|openai|siliconflow|bailian
      model: "text-embedding-v4"
      dim: 1024
      base_url: ""
      api_key: ""
      api_key_env: "DASHSCOPE_API_KEY"
  ```
- FR-1.2 新增 `agenticx/memory/embedding_config.py`：
  - `MemoryEmbeddingConfig` dataclass + `load_memory_embedding_config()`。
  - 读取 `memory.embedding`，缺节/坏值回退 `enabled=False` 安全默认（同
    `turn_archive_config.py` 风格）。

### FR-2 memory 侧 provider builder（解耦，不依赖 studio.kb）
- FR-2.1 新增 `agenticx/memory/embedding_provider.py`：
  ```python
  def build_memory_embedding_provider(cfg: MemoryEmbeddingConfig):
      """spec -> embeddings provider. Logic mirrors kb._build_embedding_provider
      but imports only agenticx.embeddings.* (no studio.kb dependency).
      Returns an object exposing embed_documents(list[str]) / embed_query(str).
      Raises MemoryEmbeddingError on unsupported provider."""
  ```
  - 复用 `agenticx.embeddings.{litellm,openai,siliconflow,bailian}`。
  - 百炼 `batch_size=10`、各家 `dim`/`api_base`/key 回退与 kb 实现保持一致口径。
- FR-2.2 `provider_signature(cfg) -> str`：返回稳定签名（如
  `"{provider}:{model}:{dim}"`），用作 `WorkspaceMemoryStore` 的
  `embedding_provider`/`embedding_model` 标识，使切换配置自然产生 cache/索引隔离。

### FR-3 WorkspaceMemoryStore 接入真 embedding
- FR-3.1 `WorkspaceMemoryStore.__init__`：当传入真 embedding 配置（或内部读取
  `load_memory_embedding_config()` 且 `enabled=True`）时：
  - `embedding_provider`/`embedding_model` 取 `provider_signature(cfg)`（FR-2.2），
    使新旧向量在 `embedding_cache`/`chunks` 中天然区分。
  - 持有一个 lazy 构建的真 provider 句柄。
- FR-3.2 `_embedding_vector(text)` 改造（**保留哈希实现为 fallback**）：
  - 真 embedding 启用 → 调 provider 的 `embed_query`/单条 `embed_documents`；
    失败（无 key/网络/异常）→ **回退哈希**并打一次 warning（不抛、不打印正文）。
  - 真 embedding 未启用 → 原哈希逻辑（现状）。
- FR-3.3 批量优化：索引写入路径（`_get_cached_embedding` 被逐 chunk 调用，L588/L396）
  增加**批量预取**——新增 `_embed_texts_batch(texts) -> list[bytes]`：先查 cache 命中，
  未命中的 texts 一次性 `embed_documents` 批量请求（百炼自动切 ≤10/批），回填 cache。
  索引 chunk 时优先走批量，避免 N 次串行 API。
- FR-3.4 维度兼容：`_cosine_similarity` 对长度不等返回 0 的行为**保留**（它正是
  "旧维度向量失效"的安全阀）；不改该函数。

### FR-4 切换 embedding → 索引重建（带进度）
- FR-4.1 新增 `WorkspaceMemoryStore.rebuild_index(workspace_dir, *, progress=None)`：
  - 清掉该 provider/model 签名下的旧 chunk 行（或对全部 chunk 重新 embed），按当前
    真 embedding 重新切块+向量化+写入。
  - `progress: Optional[Callable[[int, int, str], None]]`（done/total/stage）——
    满足"耗时操作必须暴露真实百分比/阶段"的偏好。
- FR-4.2 暴露触发入口（二选一，最小实现优先 API）：
  - Studio：`POST /api/memory/embedding/rebuild`（异步任务 + 进度查询），或
  - CLI：`agx memory reembed`（带进度打印）。
  - 入口只做编排，核心在 `rebuild_index`。
- FR-4.3 触发时机文案：在配置说明/日志里提示"更换 embedding 配置后需重建索引"
  （已是项目既有共识，见 workspace facts）。

### FR-5（可选，末期）Desktop 设置 UI
- FR-5.1 设置页"记忆"区新增 embedding provider 选择（复用既有 provider/模型选择器
  与"测试连通性"按钮范式，单一 key 输入框，不并列环境变量名输入框——对齐既有偏好）。
- FR-5.2 切换并保存后提供"重建记忆索引"按钮，调用 FR-4 入口并显示百分比进度。
- 若本期不做，标注延后，不阻塞 Phase 0-3 上线。

### NFR
- NFR-1 零回归：`memory.embedding.enabled=false` 时，向量与检索行为等价现状（哈希）。
- NFR-2 不新增三方依赖（复用 `agenticx.embeddings.*`）。
- NFR-3 真 embedding 失败必须静默回退哈希，绝不打断索引/检索/主对话。
- NFR-4 解耦：`agenticx/memory/` 不得 import `agenticx/studio/kb/`。
- NFR-5 批量请求遵守各 provider 限制（百炼 ≤10/批）。

### AC（验收）
- AC-1 `enabled=false` → `WorkspaceMemoryStore` 仍用哈希，`embedding_provider`
  签名为 `hashing-v1`，检索结果与现状一致（冒烟）。
- AC-2 `enabled=true`（mock provider）→ 索引/检索走真 embedding，
  `provider_signature` 进入 cache/chunks 标识（冒烟）。
- AC-3 真 provider 抛错（mock）→ 回退哈希 + warning，不抛异常（冒烟）。
- AC-4 `_embed_texts_batch` 对部分缓存命中 + 部分未命中，只对未命中批量请求一次
  （冒烟用计数桩断言批次数与 ≤10 切分）。
- AC-5 `rebuild_index` 用 mock provider 跑通，`progress` 回调收到递增 done/total（冒烟）。
- AC-6 全部冒烟通过；真实环境（配百炼 key）手工回归：重建后用近义改写句检索，
  召回明显优于哈希基线（人工对比，记录在 commit/回归说明）。

---

## 5. 实施步骤（分阶段，每阶段独立可验证）

### Phase 0 — 配置层（无行为变更）
1. 新增 `agenticx/memory/embedding_config.py`（FR-1.2）。
2. 冒烟 `tests/test_smoke_memory_embedding_config.py`：缺节→默认 disabled；
   完整节→正确解析；坏值→回退不抛。

### Phase 1 — provider builder（解耦，可 mock）
3. 新增 `agenticx/memory/embedding_provider.py`（FR-2）：`build_memory_embedding_provider`
   + `provider_signature` + `MemoryEmbeddingError`；底层只 import `agenticx.embeddings.*`。
4. 冒烟 `tests/test_smoke_memory_embedding_provider.py`：各 provider 分支构造正确
   （mock 类，断言 model/dim/batch_size 传参）；未知 provider→抛 `MemoryEmbeddingError`；
   签名稳定。

### Phase 2 — WorkspaceMemoryStore 接入 + 批量 + 回退
5. 改 `agenticx/memory/workspace_memory.py`（FR-3）：
   - `__init__` 按配置取签名 + lazy provider。
   - `_embedding_vector` 真/哈希双路 + 失败回退。
   - 新增 `_embed_texts_batch`，索引路径优先批量。
   - **不改** `_cosine_similarity` / `_encode_vector` / `_decode_vector`。
6. 冒烟 `tests/test_smoke_workspace_memory_real_embedding.py`：AC-1/AC-2/AC-3/AC-4。

### Phase 3 — 重建索引入口（带进度）
7. 新增 `WorkspaceMemoryStore.rebuild_index(...)`（FR-4.1）。
8. 加触发入口（FR-4.2，优先 Studio API 或 CLI 之一，最小实现）。
9. 冒烟 `tests/test_smoke_memory_reembed_rebuild.py`：AC-5（mock provider + 进度回调）。

### Phase 4 —（可选）Desktop 设置 UI
10. FR-5：provider 选择 + 重建按钮 + 进度；`npm run typecheck` 绿；人工回归。
    若本期不做，跳过并在 plan 标注延后。

### Phase 5 — 收尾
11. 全部新增冒烟 + 既有 memory 冒烟全绿。
12. 配真 key（如百炼）跑一次 `rebuild_index`，按 AC-6 人工对比近义改写召回。
13. `/commit --spec=.cursor/plans/2026-06-14-workspace-memory-semantic-embedding-upgrade.plan.md`
    分阶段提交：
    - `feat(memory): embedding 配置层`
    - `feat(memory): 解耦的 embedding provider builder`
    - `feat(memory): workspace store 接入真语义 embedding + 批量 + 回退`
    - `feat(memory): 记忆索引重建入口（带进度）`
    - （可选）`feat(desktop): 记忆 embedding 设置与重建 UI`
    每个 commit 含 `Made-with: Damon Li` 与 Plan-Id/Plan-File trailer。

---

## 6. 测试清单（冒烟，pytest，可在无网络下用 mock provider 跑）
- `tests/test_smoke_memory_embedding_config.py` — Phase 0
- `tests/test_smoke_memory_embedding_provider.py` — Phase 1
- `tests/test_smoke_workspace_memory_real_embedding.py` — Phase 2（AC-1/2/3/4）
- `tests/test_smoke_memory_reembed_rebuild.py` — Phase 3（AC-5）
- Desktop（若做 Phase 4）：`npm run typecheck`

---

## 7. 关键文件索引（执行参考）
新增：
- `agenticx/memory/embedding_config.py`
- `agenticx/memory/embedding_provider.py`
改动：
- `agenticx/memory/workspace_memory.py`（`__init__` / `_embedding_vector` /
  新增 `_embed_texts_batch` / 新增 `rebuild_index`）
- 触发入口：`agenticx/studio/server.py`（若选 API）或 `agenticx/cli/`（若选 CLI）
参考（只读，勿改/勿被 import 进 memory）：
- `agenticx/studio/kb/runtime.py::_build_embedding_provider`（逻辑范本）
- `agenticx/studio/kb/contracts.py::EmbeddingSpec`（字段范本）
- `agenticx/embeddings/*`（底层 provider，直接复用）

---

## 8. 风险与回退
- 风险：切换 embedding 维度后旧 64 维向量失效 → `_cosine_similarity` 长度不等返回 0
  作为安全阀；必须执行 `rebuild_index` 重建（FR-4，文案提示）。
- 风险：真 embedding API 抖动/限流拖慢索引 → 批量 + 缓存 + 失败回退哈希（FR-3.2/3.3），
  索引不中断。
- 风险：百炼 batch>10 报错 → builder 强制 `batch_size=10`（FR-2.1），与 KB 同口径。
- 风险：误把 KB 代码引进 memory 造成耦合 → NFR-4 + 冒烟只 import memory 模块守护。
- 回退：`memory.embedding.enabled=false` 一键回到哈希向量；各 Phase 独立 commit 可
  单独 revert；UI（Phase 4）与后端解耦可分别回滚。
```
