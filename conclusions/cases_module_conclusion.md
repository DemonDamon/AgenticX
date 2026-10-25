# Cases 模块结论

> 结论覆盖基线 commit `22d051f5d18ad83a4c6083683342ab41d7850149`（`agenticx/cases/` 全量 7 个源文件）。

## Responsibility

- **B 端案例库（case-entry）**：以 Markdown + YAML frontmatter 定义可检索、可沉淀、可复用的交付知识单元（`CaseEntry`）；frontmatter 承载 L0 检索字段与 scope/lifecycle/provenance，正文固定 L1 三节「问题 / 方案 / 结果」。
- **本地语料持久化**：`CaseStore` 在 `<workspace>/cases/{org}/{domain}/{slug}.md` 布局下读写语料，并按需重建 `cases/index.json` 编译期索引。
- **交付流水线挂钩（沉淀）**：`on_stage_passed` 在 requirements/design 阶段通过后，将阶段 `.md` 产物入队 brain wiki 编译；`compile_case_entry` 从 `DeliveryPlan`（plan.mdc）离线/可选 LLM 生成完整 case-entry 并落盘。
- **消费侧**：`search_cases` 对本地语料做 V1 关键词子串检索；`init_project_from_case` 从 case 引导新项目（生成 `plan.mdc` + 复制 `wiki/`、`skills/` 前缀 artifact）。
- **远端 context-service 客户端**：`agenticx/cases/remote.py` 封装 wiki 推送、case ingest/compile、云端 search/get（HTTP + `x-agx-internal-token`）。
- **Explicit non-responsibilities**：
  - 不负责运行 delivery 编排本身（阶段推进、worktree 管理在 `agenticx/delivery/`）；`DeliveryOrchestrator` 仅通过可选回调调用 `on_stage_passed`，本模块不默认注册该回调。
  - 未绑定 `bind_wiki_compiler` 时 `on_stage_passed` 为静默 no-op；不负责 brain wiki 编译队列的实现与执行。
  - 本地检索**无向量索引**（注释约定语料 &lt;100 条时子串匹配够用）；不负责 `enterprise/apps/context-service` 服务端实现。
  - `init_inject` 仅文件复制 + plan 引用，**不注入 runtime hooks**；非 `wiki/`、`skills/` 前缀的 artifact 不注入。
  - `agenticx/cases/__init__.py` 不 re-export `search`、`remote`、`init_inject` 子模块符号；Studio/Desktop 聊天、Enterprise 前台案例库 UI 不在本包内。

## Entry points and public interfaces

- **包级导出**（`agenticx/cases/__init__.py`，`__all__`）：`CASE_SCHEMA_VERSION`、`CaseEntry`、`case_frontmatter`、`parse_case_md`、`render_case_md`、`CaseStore`、`PRECIPITATION_STAGES`、`bind_wiki_compiler`、`reset_wiki_compiler`、`compile_case_entry`、`on_stage_passed`、`stage_fingerprint`。
- **模型**（`agenticx/cases/model.py`）：`CaseEntry`；`case_frontmatter` / `render_case_md` / `parse_case_md`；常量 `CASE_SCHEMA_VERSION = 1`。
- **存储**（`agenticx/cases/store.py`）：`CaseStore(root)`；`path_for` / `save` / `get` / `list_cases` / `build_index`；常量 `DEFAULT_ORG`、`DEFAULT_DOMAIN`。
- **沉淀**（`agenticx/cases/precipitate.py`）：`PRECIPITATION_STAGES = ("requirements", "design")`；`bind_wiki_compiler(docs_rt, queue=None)` / `reset_wiki_compiler()`；`stage_fingerprint(plan, stage_id)`；`on_stage_passed(stage_id, output_dir, plan)`；`compile_case_entry(plan, *, store, llm=None)`。
- **检索**（`agenticx/cases/search.py`）：`CaseHit`；`search_cases(query, *, store, scope_filter=None, top_k=5)`。
- **初始化注入**（`agenticx/cases/init_inject.py`）：`WIKI_PREFIX`、`SKILLS_PREFIX`；`InjectionResult`；`init_project_from_case(case, *, target_dir, store, intent="")`。
- **远端**（`agenticx/cases/remote.py`）：`DEFAULT_SERVICE_URL`、`ENV_SERVICE_URL`、`ENV_SERVICE_TOKEN`；`push_wiki` / `push_case` / `search_cases_remote` / `get_case_remote`。
- **CLI**（`agenticx/cli/main.py`）：Typer `case_app` → `agx case compile`（`compile_case_entry` + 可选 `--push` → `push_case`）、`agx case search`（本地 `search_cases` 或 `--remote` → `search_cases_remote`）、`agx case init`（`init_project_from_case`，可选 `--remote` → `get_case_remote`）；`wiki_app` → `agx wiki push`（`push_wiki`）。本地默认 cases 根为 `Path.cwd() / "cases"`（`compile` 可用 `--output-root` 覆盖）。
- **Delivery 集成点**：`agenticx/delivery/orchestrator.py` 的 `DeliveryOrchestrator(..., on_stage_passed=...)` 在阶段通过后调用注入的 callable（形状与 `on_stage_passed` 一致）；仓库内除测试外未见默认传入 `agenticx.cases.precipitate.on_stage_passed`。

## Core execution path

- **case-entry 读写**：`CaseStore.save` → `path_for(entry)`（`scope.org`/`scope.domain` + `slugify(title|case_id)` from `agenticx.brain.wiki.page`）→ `render_case_md` 写盘；`get` / `list_cases` / `build_index` → `rglob("*.md")` + `parse_case_md`，非 case 文件或解析失败仅 `logger.debug` 跳过。
- **plan → case（T3）**：`compile_case_entry` → 摘要：无 `llm` 时用 `_rule_summary`（阶段 summary 拼接，上限 `SUMMARY_MAX_CHARS=256`），有 `llm` 时 `_llm_summary` 失败回退规则摘要 → 从 `plan.stages` 组装 `solution`/`artifacts`，`testing` 阶段完成度写入 `verification.eval_passed` → `CaseEntry(case_id=f"case-{plan.task_id}", ...)` → `store.save`。
- **阶段沉淀（T2）**：`on_stage_passed` → 仅 `PRECIPITATION_STAGES` → 读 `output_dir/.case-precipitation/{stage_fingerprint}.done` 去重 → 需 `_queue` 与 `_docs_rt` 已绑定 → 对 stage 内 `.md` artifact 调用 `_queue.enqueue(_docs_rt, doc_id, basename)` → 写 marker；任意异常被捕获，不中断 delivery。
- **本地检索**：`search_cases` → query 按空白分词 → 每条目对 `summary`/`problem`/`solution` 做大小写无关子串匹配，权重 `_FIELD_WEIGHTS`（3/2/1）→ `scope_filter` 硬等值过滤（条目 scope 缺键则放行）→ 按 score 降序取 `top_k`。
- **项目初始化**：`init_project_from_case` → `default_plan` + `write_plan(target_dir/plan.mdc)`（`intent` 优先参数，否则 `case.summary` → `case.problem`；`plan.case_refs = [case.case_id]`）→ 遍历 `case.artifacts`，仅复制 `wiki/`、`skills/` 相对 `store.root` 的路径，缺失记录于 `InjectionResult.report`。
- **远端推送/拉取**：`_service_config` 解析 URL/token → `_request`（httpx，`trust_env=False`，header `x-agx-internal-token`）→ `push_wiki` POST `/context/wiki/push`；`push_case` POST `/context/ingest` + `/context/compile`；`search_cases_remote` POST `/context/cases/search`；`get_case_remote` GET `/context/cases/get`。

## Data and configuration

- **磁盘布局（D5）**：`<CaseStore.root>/{org}/{domain}/{slug}.md`，V1 默认 `org=default`（`DEFAULT_ORG`）、domain 默认 `default`（`DEFAULT_DOMAIN` 或 `scope.domain`）。
- **索引**：`<root>/index.json`，结构 `{ "version": CASE_SCHEMA_VERSION, "cases": { case_id: { path, summary, scope } } }`，由 `build_index()` 全量扫描 markdown 重建，非增量维护。
- **case-entry  schema**：frontmatter 含 `schema_version`、`case_id`、`title`、`type`（默认 `"case"`）、`summary`、`artifacts`、`scope`、`lifecycle_status`、`supersedes`、`freshness`、`provenance`、`verification`；正文标题 `# title` 与 `## 问题|方案|结果`。
- **沉淀 marker**：`<stage output_dir>/.case-precipitation/{sha1(plan_path:stage_id)[:16]}.done`。
- **远端环境变量**：`AGX_CONTEXT_SERVICE_URL`（默认 `http://localhost:8420`）、`AGX_CONTEXT_SERVICE_TOKEN`（缺失时 `_service_config` 抛 `RuntimeError`）；CLI `--url` / `--token` 优先于环境变量。
- **CLI 默认路径**：本地 case 语料根 `Path.cwd() / "cases"`；`agx case compile --output-root` 可指定落盘根；`agx wiki push --dir` 默认 `./wiki`。

## Dependencies

- **Upstream（本模块 import）**：
  - `agenticx.brain.wiki.page.slugify`（`store.path_for`、`precipitate.on_stage_passed` 的 `doc_id`）。
  - `agenticx.delivery.plan_mdc.DeliveryPlan`（沉淀）；`default_plan` / `write_plan` / `read_plan`（init 与 CLI，init 在 `init_inject`，CLI 在 `main.py`）。
  - 第三方：`yaml`（frontmatter）、`httpx`（`remote`）。
- **Downstream（调用方）**：
  - `agenticx/cli/main.py`：`case_app`、`wiki_app` 命令族。
  - `agenticx/delivery/orchestrator.py`：`on_stage_passed` 回调插槽（可选）。
  - `enterprise/apps/context-service`：HTTP 契约对端（Python 侧刻意不 import `agenticx.cases.model`，见 `context_service/app.py` 注释）。
- **同仓库边界**：delivery 编排、brain wiki 队列/runtime、context-service 进程均在本包外；case 与 `agenticx/evaluation` 内 EvalCase 等命名无关。

## Tests and operations

- **`tests/test_case_entry.py`**：model round-trip（`render_case_md` / `parse_case_md` / `case_frontmatter`）；`CaseStore` 路径、`list_cases` 域过滤、`build_index`；`compile_case_entry` 规则摘要与 LLM 分支；`on_stage_passed` 去重 marker、`bind_wiki_compiler` + mock queue；`DeliveryOrchestrator` 回调 wiring；`agx case compile` CLI。
- **`tests/test_case_consume.py`**：`search_cases` 打分与 `scope_filter`；`init_project_from_case`（plan、wiki/skills 复制、缺失 artifact 容忍）；`agx case search` / `agx case init` CLI。
- **`tests/test_case_remote.py`**：`remote._service_config`、`_page_name`、MockTransport 覆盖 `push_wiki` / `push_case` / `search_cases_remote` / `get_case_remote` 及 CLI `--push` / `--remote` 分支。
- **运维要点**：
  - 新增 case 字段时保持 `parse_case_md` 对未知 frontmatter 容忍；升级 schema 时同步 `CASE_SCHEMA_VERSION` 与 index `version`。
  - 要在 delivery 跑通 T2 wiki 入队，进程须在编排前 `bind_wiki_compiler(docs_rt, queue)` 并将 `on_stage_passed` 传给 `DeliveryOrchestrator`。
  - 云端操作需启动 context-service 并配置与服务端一致的 `AGX_CONTEXT_SERVICE_TOKEN`；wiki push / case compile 使用较长客户端超时（`_PUSH_TIMEOUT_S = 600`）。
  - 本地检索规模变大前需单独规划向量或外部检索；当前实现为全库 `rglob` + 内存打分。
