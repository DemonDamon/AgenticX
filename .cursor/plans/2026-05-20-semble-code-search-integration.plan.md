---
name: ""
overview: ""
todos: []
isProject: false
---

# Plan: Semble-Backed Code Search Integration

- Plan-Id: 2026-05-20-semble-code-search-integration
- Plan-File: .cursor/plans/2026-05-20-semble-code-search-integration.plan.md
- Owner: Damon Li
- Status: **Draft（待用户确认后进入 Phase 1）**
- 关联研究（v2 优化版）：
  - `research/codedeepresearch/semble/semble_proposal.md`
  - `research/codedeepresearch/semble/semble_agenticx_gap_analysis.md`
  - `research/codedeepresearch/semble/semble_deepwiki.md`
  - `research/codedeepresearch/semble/semble_source_notes.md`
  - `research/codedeepresearch/semble/semble_eval_plan.md`
- 关联既有 plan：
  - `.cursor/plans/2026-05-06-code-context-index-internalization.plan.md` — **本 plan 取代其 Phase 1/2，原 plan 长期作为 `native` backend 备选**
  - `.cursor/plans/2026-05-19-machi-code-mode-harness.plan.md` — 其 FR-11 由本 plan 解锁

---

## 0. 目标 (Why)

为 AgenticX 落地 **面向源代码的语义检索子系统** `agenticx/code_index/`，**使用 [MinishLab/semble](https://github.com/MinishLab/semble)（MIT, v0.1.10）作为默认 retrieval backend**，通过 adapter 模式集成而非 fork 重写。

**预期收益**（来自上游 `benchmarks/README.md`，需在 AGX 自身 codebase 上复测）：

- 代码场景检索 NDCG@10 ≈ 0.854（vs ripgrep 0.126）
- 期望 token/query 减少 ~98%（vs grep+读全文件）
- CPU only、无 API Key、无 GPU
- 索引 ~263ms / 查询 ~1.5ms（warm）

**非目标（防止 scope creep）**：

- ❌ 不重构 `agenticx/studio/kb/`、`agenticx/memory/hybrid_search.py`、`agenticx/retrieval/`
- ❌ 不替换 `knowledge_search` 工具
- ❌ 不动 runtime 主循环、agent_runtime、meta_tools
- ❌ 不删 `bash_exec` / `grep` —— 字面穷尽搜索仍归 grep
- ❌ 不 fork Semble，不重写其 ranking / chunker / tokenize 逻辑
- ❌ 本 plan 不做 Desktop UI 全量重构（仅在 Phase 5 加最小 toggle）

---

## 1. 范围与硬约束

| 维度 | 边界 |
|------|------|
| 新增子包 | `agenticx/code_index/`（与 `studio/kb/` 隔离命名） |
| 新增 PyPI 依赖 | `semble>=0.1.10,<0.2.0`（MIT，自带 model2vec / vicinity / bm25s / tree-sitter / pathspec） |
| 复用基础设施 | `_resolve_workspace_path`、`_session_workspace_roots`、`ConfigManager`、`agenticx/observability/`、`KBManager` 单例模式 |
| 默认 backend | `semble`（本 plan）；`native` 占位 NotImplemented |
| 配置开关 | `~/.agenticx/config.yaml` `code_index.enabled`（默认 false，opt-in） |
| 工具命名 | 已注册 `code_search`（`agent_tools.py:1336`）+ 新增 `code_index_create/status/clear/cancel` |
| 元数据路径 | `~/.agenticx/code_index/<sha256(codebase_path)[:16]>/`（Phase 3 才用，PoC 全内存） |
| 上游许可 | MIT，在 `NOTICE` 标注 + commit 注脚 |
| 平台支持 | macOS / Linux / Windows（DMG / NSIS / pip install 三态都要可用） |

---

## 2. 需求块

### 2.1 Functional Requirements

- **FR-1 工具立即可用**：`agenticx/code_index/` 落地后 `_tool_code_search` 不再返回 `ERROR: code_index package not installed`；现有 `_CODE_SEARCH_TOOL` schema 不需改动。
- **FR-2 懒索引**：首次 `code_search(codebase_path, query)` 自动触发后台索引；返回 `{partial: true, indexing_progress: ...}` 直至索引完成。
- **FR-3 显式预热**：`code_index_create(codebase_path)` 启动后台索引任务并返回 `task_id`；同 codebase 重复触发复用现有任务。
- **FR-4 状态查询**：`code_index_status(codebase_path)` 返回 `{status, files_total, files_done, total_chunks, languages, last_progress_at, error_summary?}`，状态机为 `pending → indexing → indexed | indexfailed`。
- **FR-5 检索**：`code_search(codebase_path, query, top_k?, strategy?)`：
  - `strategy ∈ {hybrid, semantic, bm25}`，默认 `hybrid`
  - 返回 JSON list `[{file_path, start_line, end_line, language, score, snippet, backend:"semble"}]`
  - `codebase_path` 必须解析至 session taskspace 内，否则拒绝并提示
- **FR-6 清理**：`code_index_clear(codebase_path)` 从 `CodeIndexManager` 弹出索引并释放内存。
- **FR-7 Encoder 单例**：进程内仅加载一次 `potion-code-16M`，跨 codebase 复用（参照 `mcp.py:_IndexCache` 共享 model 模式）。
- **FR-8 工作区根复用**：`codebase_path` 解析必须走 `_resolve_workspace_path(..., pick_existing=True)`，禁止绕过 session 隔离。
- **FR-9 Cancel**（Phase 2）：`code_index_cancel(task_id)` 协作式取消；可在有限步数内退出。
- **FR-10 Find-related**（Phase 3，可选）：`code_find_related(codebase_path, file_path, line)` 映射 Semble `find_related`。
- **FR-11 Desktop 设置入口**：在「设置 → 工具」Tab 顶部增加独立 Panel **「代码语义索引」**（不嵌「知识库」Tab、不新增一级 Tab、不与「桌面操控」混排）：
  - **一级（始终可见）**：能力总开关 `code_index.enabled`、索引状态提示（未索引 / 索引中 N% / 已就绪 / 失败）、按钮「预热嵌入模型」（调用 `code_index_create` 或专门的 preload IPC）。
  - **二级「高级设置」（折叠，仅 `enabled=true` 可编辑）**：`code_index.backend`（semble / native-灰显「即将推出」）、`semble.search_mode`（hybrid/semantic/bm25）、`semble.default_top_k`、`semble.include_text_files`、`preload_model`、`max_index_memory_mb`、模型缓存路径（只读展示）、「已索引工作区」列表 + 单条「清除索引」按钮。
  - **预授权工具区**：`enabled=true` 且后端已注册时，`code_search` 出现在预授权工具列表，`TOOL_LABELS.code_search = "代码搜索"`，描述明确「探索阶段优先于整文件读取；精确字符串请用 grep」。
- **FR-12 配置持久化与生效路径**：所有 `code_index.*` 字段写入 `~/.agenticx/config.yaml`；Panel 与 `ToolsTab` 共用窗口底部「保存」按钮（沿用 `ToolsTabHandle.flushIfDirty` 模式，不再单独放一颗保存键）；保存后即时生效，不需重启 Machi（与 `computer_use` 的「必须重启」语义区分）。

### 2.2 Non-Functional Requirements

- **NFR-1 隔离**：`code_index/` 不修改 `studio/kb/`、`retrieval/`、`memory/hybrid_search.py`、`agent_runtime.py`、`meta_tools.py` 任何一行代码（仅在 `agent_tools.py:_tool_code_search` 周边因 `partial=true` 等返回值微调可能涉及，须 ≤10 行）。
- **NFR-2 默认关**：`code_index.enabled=false` 时，`_CODE_SEARCH_TOOL` 不进入 `studio_tools_for_session` 输出（现状已如此）；现有路径零回归。
- **NFR-3 可观测**：所有索引状态迁移 + 检索调用 log；指标包括 `code_index_build_seconds`、`code_search_seconds`、`code_search_hit_count`。
- **NFR-4 失败可读**：`indexfailed` 必须暴露完整异常链摘要（traceback 后 5 行 + 异常类型 + 文件名），不得透出 `'_type'` 等单 token（对齐 AGENTS.md）。
- **NFR-5 跨平台打包**：
  - macOS DMG / Windows NSIS：PyInstaller spec 须 `collect_all("semble")` + `collect_all("model2vec")` + `collect_all("vicinity")` + `collect_all("tree_sitter_language_pack")` + `collect_all("bm25s")` + hiddenimports `pathspec`。
  - Windows：`bash_exec` 已知 `WinError 2` 教训沿用；不依赖 `git clone`（Semble `from_git` 不暴露）。
- **NFR-6 离线**：HF 模型下载首次需联网（实测 ~265s）；提供：
  - `agx serve` 启动时 `code_index.preload_model=true` 后台预热
  - httpx 绕代理（参照 `feishu_longconn.py` `AsyncHTTPTransport()`）
  - DMG/NSIS extraResources 内嵌 `potion-code-16M` snapshot（评估打包体积影响）
- **NFR-7 性能基线**：在 AgenticX 自身 codebase（约 17 万行 Python/TS）上：
  - 全量索引（warm model）P95 ≤ 60 s
  - 单次 `code_search` warm P95 ≤ 100 ms
  - 单次 `code_search` cold（含索引）P95 ≤ 90 s
- **NFR-8 内存**：单 codebase 索引 ≤ 1 GB 内存；超限拒绝 + 提示。
- **NFR-9 安全**：`codebase_path` 必须在 session taskspace 列表内（防 sub-agent 串台 / 越权扫描）。
- **NFR-10 中文化**：所有 tool error / desktop toggle 文案中文，对齐 AGENTS.md。

### 2.3 Acceptance Criteria

- **AC-1 零回归**：`code_index.enabled=false` 时跑全量 `pytest agenticx/`、`pytest examples/` 必须绿。
- **AC-2 Smoke ≥10**：`tests/code_index/test_semble_smoke.py` 覆盖：
  1. 创建 manager + 首次 `code_search` 触发懒索引
  2. `code_index_create` 显式预热 → `code_index_status` 状态机推进
  3. 索引中调用 `code_search` 返回 `partial=true`
  4. `code_index_clear` 释放后再次 search 触发重建
  5. `code_search` hybrid / semantic / bm25 三模式输出
  6. workspace 隔离：跨 session 不污染
  7. 大文件跳过（>1MB）
  8. `.gitignore` 尊重
  9. 失败路径：不存在的 `codebase_path`
  10. 失败路径：HF 离线 mock → 错误摘要可读
- **AC-3 Encoder 单例**：连续创建 3 个 codebase 索引，`load_model` 只被调用一次（mock 计数）。
- **AC-4 评测 PoC 门禁**：在 AgenticX 自身 codebase 上 30+ 标注查询，**B3 (Semble hybrid) Recall@10 比 B1 (grep+片段读) 提升 ≥10%**；tokens-to-first-hit B3 ≤ B1 × 0.3。详见 `semble_eval_plan.md`。
- **AC-5 Trailer 合规**：所有 commit 含 `Plan-Id: 2026-05-20-semble-code-search-integration`、`Plan-File: ...`、`Made-with: Damon Li` 三类 trailer，无 AI 工具署名。
- **AC-6 跨平台 CI**：GitHub Actions matrix 在 macOS / Ubuntu / Windows 各跑一次 smoke（≥3 条核心 case），全绿。
- **AC-7 Desktop IA 合规**：手动验收 —
  1. 关闭 `code_index.enabled`：「设置 → 工具」顶部仍可见「代码语义索引」Panel（仅主开关 + 简短说明），高级设置不可编辑；预授权工具列表里**不出现** `code_search`。
  2. 打开 → 预热模型 → 在 `code_dev` 会话调用 `code_search` 即可返回结果，**无需重启** Machi。
  3. 「知识库」Tab 顶部加一行链接式提示：「代码库语义检索见 设置 → 工具 → 代码语义索引」，且未把 code_index 配置项搬到 KB 内。
  4. 与「桌面操控」Panel 在同 Tab 内时视觉风格一致（`Panel` 组件 + `SettingsSwitch` + 高级折叠），不引入新控件库。

---

## 3. 模块设计

### 3.1 目录结构

```
agenticx/code_index/
├── __init__.py            # re-export dispatch_* 入口（保持 _tool_code_search 现有 import 路径）
├── NOTICE                 # 标注 Semble MIT
├── config.py              # _CONFIG_KEY="code_index"；读 ConfigManager + ~/.agenticx/config.yaml
├── manager.py             # CodeIndexManager 进程内单例（参照 KBManager L30）
├── state.py               # IndexTask（status, progress, error_summary, lock）
├── backends/
│   ├── __init__.py
│   ├── base.py            # CodeIndexBackend Protocol
│   ├── semble_backend.py  # 包装 SembleIndex；Encoder 由 manager 注入
│   └── native_backend.py  # raise NotImplementedError（占位 2026-05-06 plan）
├── tools.py               # dispatch_code_search / dispatch_code_index_create / ...
└── format.py              # SearchResult → JSON snippet + partial flag

tests/code_index/
├── conftest.py            # fixture: 临时 codebase + mock Encoder
├── test_semble_smoke.py   # AC-2 的 10 条
└── eval/
    ├── agx_queries.jsonl  # AC-4 的 30+ 标注
    └── run_eval.py        # 跑 B1/B3 对比，输出 markdown 报告

desktop/src/components/settings/code-index/
├── CodeIndexSettingsPanel.tsx     # 「代码语义索引」Panel（嵌在 ToolsTab 顶部）
├── api.ts                          # 调 /api/code-index/* 或 IPC 包装
└── types.ts                        # CodeIndexConfig / CodeIndexStatus 类型

desktop/electron/main.ts            # 新增 IPC: load/save-code-index-config、code-index-status、preload-code-index-model
desktop/src/global.d.ts             # 对应 IPC 类型声明
agenticx/studio/code_index/routes.py # 可选：HTTP /api/code-index/* 给远程模式
```

### 3.2 Backend Protocol（`backends/base.py`）

```python
from typing import Protocol, Sequence
from pathlib import Path

class CodeSearchHit(Protocol):
    file_path: str
    start_line: int
    end_line: int
    language: str | None
    score: float
    snippet: str

class CodeIndexBackend(Protocol):
    name: str  # "semble" | "native"
    def build(self, codebase_path: Path, *, on_progress: Callable[[int, int], None]) -> None: ...
    def search(self, query: str, top_k: int, strategy: str) -> Sequence[CodeSearchHit]: ...
    def clear(self) -> None: ...
    def find_related(self, file_path: str, line: int, top_k: int) -> Sequence[CodeSearchHit]: ...
    @property
    def stats(self) -> dict: ...
```

### 3.3 CodeIndexManager 关键不变量

- 单例 `instance()` + RLock（同 `KBManager`）
- `_encoder: Encoder | None`：首次 build 时 `from semble.index.dense import load_model`；后续复用
- `_tasks: dict[str, IndexTask]`：key 为 `sha256(codebase_path)[:16]`
- 每 codebase 一把 `asyncio.Lock`，禁止并发 build
- `reset_for_tests()` 释放所有索引

### 3.4 与现有钩子衔接（**仅以下变更**）

1. **`agent_tools.py:_tool_code_search`（L2280）**：当前直接返回 `dispatch_code_search` 字符串；改为 await async 入口（与 `knowledge_search` L4289 同款 `asyncio.to_thread` 模式）。预计改动 ≤ 8 行。
2. **`pyproject.toml`**：新增 optional dependency group `code_index = ["semble>=0.1.10,<0.2.0"]`；默认不装，需 `pip install agenticx[code_index]` 或 Desktop 内置打包时显式安装。
3. **`agent_tools.py:TOOL_LABELS` / `TOOL_DESCRIPTIONS_ZH`（L752 / L796）**：新增 `code_search: "代码搜索"` 与中文描述；**不**加入 `ADVANCED_TOOL_POLICY_NAMES`（高级设置由独立 Panel 承载，不挤到工具行内）。
4. **`SettingsPanel.tsx :: ToolsTab`（L1901）**：在 `RuntimeConfigSection` 上方插入 `<CodeIndexSettingsPanel>`；`ToolsTabHandle.flushIfDirty` 同时 flush code-index 待保存项（与现有 bash 默认超时、`max_tool_rounds` 同一保存路径）。
5. **`SettingsPanel.tsx :: KnowledgeSettings` 顶部**：加一行轻提示链接「代码库语义检索见 设置 → 工具 → 代码语义索引」，不放任何 code_index 配置控件。

**不动**：`studio_tools_for_session` L1377 已自动检测 `code_index.enabled`；`code_dev` 自动注入逻辑无需改。

### 3.5 Prompt 协同（`runtime/prompts/code_mode.py`）

Phase 5 微调 `build_phase_gate_block`：

- Explore 阶段优先级：`code_search`（若 enabled）> `code_outline` > `grep`
- 精确字符串确认：`grep` 仍是首选
- `code_search` 命中后：**必须** `file_read(start_line, end_line)` 扩上下文，禁止直接基于 snippet 作答

变更仅在「`code_index.enabled=true`」分支提示，关闭时 prompt 与现状完全一致。

---

## 4. 阶段拆分

每个阶段独立 commit（`/commit --spec=` 注入 trailer），完成后 `pytest tests/code_index/` 必须绿才进入下一阶段。

### Phase 0 — Decision lock-in（本周）

- [x] codedeepresearch v1 落盘
- [x] codedeepresearch v2 优化（本轮）
- [x] 本 plan 落盘
- [ ] 用户确认：是否同意「Semble 默认 backend，2026-05-06 plan 暂缓为 `native` 备选」
- [ ] 用户确认：optional dependency 而非默认装

### Phase 1 — Skeleton + Lazy Indexing PoC（1 周）

**DoD**：FR-1, FR-2, FR-5(hybrid), FR-7, FR-8 + AC-1, AC-2(1,5,6), AC-5 通过。

- 新增 `agenticx/code_index/` 五个核心文件（`__init__.py`, `config.py`, `manager.py`, `backends/base.py`, `backends/semble_backend.py`, `tools.py`, `format.py`）
- `pyproject.toml` optional dep
- `tests/code_index/test_semble_smoke.py` 至少 6 条
- `NOTICE` 文件追加 Semble 归属
- `_tool_code_search` async 化（≤8 行变更）
- Commit: `feat(code-index): add semble-backed code search PoC (opt-in)`

### Phase 2 — Explicit Build + Cancel + Status（1 周）

**DoD**：FR-3, FR-4, FR-6, FR-9, NFR-3, NFR-8 + AC-2(2,3,4,7,8) 通过。

- `state.py` IndexTask + asyncio.Lock 协议
- `dispatch_code_index_create/status/clear/cancel` 工具
- 进度回调（per-file）；`code_index_status` 暴露 `files_done/total`
- 大文件 / 内存超限拒绝路径
- 观测：log + metrics（Prometheus 风格 dict 暴露给 `/metrics` 若已有）
- Commit: `feat(code-index): add explicit build/status/cancel/clear lifecycle`

### Phase 3 — Cross-Platform + Offline + Packaging（1 周）

**DoD**：NFR-5, NFR-6, NFR-10, AC-6 通过。

- macOS DMG / Windows NSIS PyInstaller spec：`collect_all` 五项 + hiddenimports
- `agx serve` 启动时按 `code_index.preload_model=true` 后台预热（不阻塞首发响应）
- httpx 绕代理（如 Semble/HF 调用经 SOCKS 出错，复用飞书侧 `AsyncHTTPTransport()` 模式）
- Windows smoke：在 GitHub Actions windows-latest runner 跑核心 3 条
- `tests/code_index/test_offline_mock.py`：mock HF 离线 → 错误摘要可读
- Commit: `feat(code-index): cross-platform packaging + offline-friendly model loading`

### Phase 4 — Evaluation（1 周）

**DoD**：AC-4 通过；评测报告进 commit。

- `tests/code_index/eval/agx_queries.jsonl`：人工标注 30+ 查询（覆盖 `delegate_to_avatar` 等 AGX 专有问法）
- `tests/code_index/eval/run_eval.py`：
  - B1 = `grep -rn` + 读匹配文件全文
  - B3 = `code_search(strategy=hybrid)`
  - 指标：Recall@5/@10, MRR, tokens-to-first-hit（tiktoken cl100k_base）
- 输出 `research/codedeepresearch/semble/eval_results/<date>.md`
- 若 B3 Recall@10 比 B1 提升 ≥10% **且** tokens-to-first-hit ≤ B1×0.3 → 准备 Phase 5；否则停下复盘
- Commit: `feat(code-index): add evaluation runner + initial benchmark report`

### Phase 5 — Desktop Toggle + Prompt 协同 + 文档（1 周）

**DoD**：FR-11, FR-12 + AC-7 通过；用户文档可发布。

**信息架构定调**（已与用户对齐）：`code_index` 是 Agent 级**工具能力**而非「知识库式文档检索」，因此 Desktop 入口**落在「设置 → 工具」Tab**，与 `bash_exec` 默认超时、`max_tool_rounds`、桌面操控等 Agent runtime 配置同 Tab；**不**塞进「知识库」Tab，「知识库」Tab 顶部只放一行跳转提示，避免「代码检索」与「文档/RAG 检索」概念混淆。

- **后端 / Studio**：
  - `agenticx/studio/code_index/routes.py`（可选）：`GET /api/code-index/config|status`、`POST /api/code-index/config|preload|clear`；与 `KBManager` 路由风格一致，远程模式可用。
  - `runtime/prompts/code_mode.py` 增加 `code_index.enabled=true` 分支提示（≤30 行变更）。
- **Electron 主进程**（`desktop/electron/main.ts` + `preload.ts` + `global.d.ts`）：
  - 新增 IPC：`load-code-index-config` / `save-code-index-config` / `get-code-index-status` / `preload-code-index-model` / `clear-code-index`。
  - 写入 `~/.agenticx/config.yaml` 的 `code_index:` 节；保存后无需重启即生效（与 `computer_use.must_restart=true` 区分）。
- **Desktop 设置面板**（`desktop/src/components/settings/code-index/CodeIndexSettingsPanel.tsx`）：
  - 渲染在 `SettingsPanel.tsx :: ToolsTab` 顶部、`RuntimeConfigSection` 之上，作为该 Tab 的第一张 `Panel`。
  - **一级（始终可见）**：主开关 `code_index.enabled`、状态徽标（未索引 / 索引中 N% / 已就绪 / 失败 + 错误摘要 tooltip）、按钮「预热嵌入模型（首次 ~265s）」、按钮「打开模型缓存目录」。
  - **二级「高级设置」折叠区**（`enabled=true` 才可编辑）：`backend`（semble / native-灰显「即将推出」）、`search_mode`（hybrid/semantic/bm25）、`default_top_k`、`include_text_files`、`preload_model_on_startup`、`max_index_memory_mb`、「已索引工作区」列表（每行展示 codebase 路径 + 文件数 + 占用内存 + 「清除」按钮）。
  - 视觉：复用现有 `Panel` / `SettingsSwitch` / 折叠区组件（参考 `ComputerUseGeneralPanel` 风格），不引入新控件库；保存按钮**继续走 ToolsTab 底部统一保存**（`ToolsTabHandle.flushIfDirty` 串联）。
- **知识库 Tab 顶部**（`KnowledgeSettings.tsx`）：仅插入一行 `Alert`/链接：「需要对**代码库**做语义检索？请前往 设置 → 工具 → 代码语义索引」。**禁止**在此处放任何 code_index 配置控件，避免回到「代码检索 = 知识库的子能力」的旧认知。
- **工具命名**：`TOOL_LABELS.code_search = "代码搜索"`；预授权工具列表中 `code_search` 描述附「探索阶段优先于整文件读取；精确字符串请用 grep」一句话。
- **文档**：`docs/guides/code-search.md`（用户视角入门 + grep vs code_search 分工 + Desktop 设置截图）。
- **Conclusion**：`conclusions/` 增 `code_index_module_conclusion.md`（按 `/update-conclusion --plan=...` 流程）。
- Commit: `feat(code-index): desktop tools-tab panel + prompt integration + user docs`

### Phase 6 — Find-Related + Persistence（可选，Phase 4 评测通过后再排）

**DoD**：FR-10 通过；MVP 持久化（不要 Merkle，仅 chunks pickle）。

- `dispatch_code_find_related`
- `~/.agenticx/code_index/<hash>/` 序列化 chunks + 索引（重启复用，跳过 build）
- 文件 mtime+size 检测增量重建
- Commit: `feat(code-index): add find_related + lightweight on-disk cache`

---

## 5. Commit 划分

按 plan-management.mdc 与 commit 偏好，每条 commit 独立可回滚：

1. `feat(code-index): add semble-backed code search PoC (opt-in)` — Phase 1
2. `feat(code-index): add explicit build/status/cancel/clear lifecycle` — Phase 2
3. `feat(code-index): cross-platform packaging + offline-friendly model loading` — Phase 3
4. `feat(code-index): add evaluation runner + initial benchmark report` — Phase 4
5. `feat(code-index): desktop tools-tab panel + prompt integration + user docs` — Phase 5
6. （可选）`feat(code-index): add find_related + lightweight on-disk cache` — Phase 6

每条 `/commit --spec=.cursor/plans/2026-05-20-semble-code-search-integration.plan.md` 自动注入 Plan-Id / Plan-File / Made-with trailer。

---

## 6. 风险与缓解

| 风险 | 概率 | 缓解 |
|------|------|------|
| Semble 上游 breaking change | 中 | 顶 `<0.2.0`；关注 release notes |
| HF 模型在中国大陆下载慢/失败 | 高 | Phase 3 三道防线：`agx serve` 预热 + httpx 绕代理 + DMG 内嵌 snapshot |
| 大 monorepo (enterprise/) 内存爆 | 中 | NFR-8 1 GB 上限；超限拒并提示「请缩小 codebase_path」 |
| tree-sitter-language-pack 在 Windows 加载失败 | 中 | PyInstaller `collect_all` + 失败回退行切分（Semble 已自带） |
| 评测分数 < 门禁 | 低 | Phase 4 早做；不达标则不进 Phase 5，避免误导用户 |
| 与 2026-05-06 plan 双线推进浪费 | 高 | 显式声明 2026-05-06 plan **暂缓**；本 plan 通过后再评估是否启动 native |
| Sub-agent 越权扫描越境路径 | 中 | NFR-9：强制 codebase_path 在 session taskspace 内 |
| Desktop UI 引入新 Tab 违反 AGENTS.md 偏好 | 低 | 不新增一级 Tab；面板挂在「设置 → 工具」Tab 顶部，「知识库」Tab 仅留跳转提示 |
| 用户在「知识库」找不到代码检索入口 | 中 | 知识库 Tab 顶部 Alert 链接到「设置 → 工具 → 代码语义索引」；用户文档同步说明 |

**回滚策略**：

- `code_index.enabled=false` 即回到当前状态（`_tool_code_search` 仍返回 ERROR，但无副作用）
- `pip uninstall semble`（若使用 optional dep）
- 元数据目录 `rm -rf ~/.agenticx/code_index/`（Phase 6 才有）
- 单 commit 可独立 revert

---

## 7. 与 2026-05-06 plan 的关系

| 方面 | 2026-05-06 (claude-context) | 本 plan (semble) |
|------|------------------------------|-------------------|
| 上游 | zilliztech/claude-context | MinishLab/semble |
| 路线 | AST + Merkle + 自建 hybrid + Chroma 持久化 | adapter wrap 上游成熟 hybrid |
| chunkSize | 2500 chars / overlap 300 / 单文件 450k 上限 | 1500 chars (上游 hard-coded) |
| 语言数 | py / ts / js / go / java 首版 | 300+ 扩展名（tree-sitter pack） |
| 排序 | RRF k=100；cross-encoder 插槽 | RRF k=60 + 20+ boost/penalty 内置 |
| 持久化 | snapshot + .lock + Merkle 增量 | PoC 全内存；Phase 6 轻量 pickle |
| 工作量 | 6 Phase（含 ADR） | 5+1 Phase |
| 维护负担 | 自有代码完整 | 依赖上游升级 |
| 自主可控 | 高 | 中（受 Semble release 节奏） |

**决策建议**：

- **短期（≤1 Q）**：本 plan 落地，享受 Semble 现成 ranking 与上游持续优化
- **中期**：若评测发现 Semble 在 AgenticX 场景缺关键能力（如 Merkle 增量节省的 CI 时长足够大），再启动 2026-05-06 plan 作 `native` backend
- **长期**：保留 `backends/` 双 backend 接口，用户可在 `code_index.backend` 切换

**本 plan 通过后，2026-05-06 plan 状态应改为「Deferred — superseded by 2026-05-20 plan as default backend」**。

---

## 8. 进入实现阶段前的确认事项

需要你拍板：

1. ✅ / ❌ 是否同意按本 plan 进入 Phase 1（PoC 实现）
2. ✅ / ❌ Semble 作 optional dep（`pip install agenticx[code_index]`）vs 加入默认依赖
3. ✅ / ❌ 2026-05-06 plan 改 Status: Deferred
4. ✅ / ❌ Phase 5 Desktop toggle 是否纳入本轮（vs 单独 plan）
5. ✅ / ❌ Phase 3 是否在 DMG/NSIS 中预置 `potion-code-16M` snapshot（评估 +~30MB 打包体积是否可接受）
6. ✅ / ❌ AC-4 评测门禁（B3 Recall@10 ≥ B1 + 10% 且 tokens ≤ ×0.3）是否合适

未确认前不动 `agenticx/` 下任何代码（符合 no-scope-creep.mdc）。

Made-with: Damon Li