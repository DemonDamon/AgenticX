---
name: Summarizer v2 Phase A - Core/Domain Decoupling
overview: 把摘要内核重构为业务无关的 SummarizationEngine，领域差异下沉为 DomainPlugin（email/news 各带规则引擎），新增 /v2/summarize 通用 API 并保留 richMail 兼容 shim，引入 PromptResolver 分层接缝（A 阶段只做静态层）。
todos:
  - id: a1-types
    content: A1 core/types.py 定义 SummarizeRequest/Result/Modality/Stage 等业务无关数据模型
    status: pending
  - id: a2-prompt-resolver
    content: A2 core/prompt_resolver.py 定义 PromptResolver 协议 + StaticPromptResolver
    status: pending
  - id: a3-domain-base
    content: A3 domains/base.py 定义 DomainPlugin 协议 + DomainRegistry
    status: pending
  - id: a4-domain-email-news
    content: A4 domains/email、domains/news 插件 + 各自 rules.py 规则引擎（迁移 intent 命中词）
    status: pending
  - id: a5-engine
    content: A5 core/engine.py 业务无关 SummarizationEngine（迁移 summarizer/mapreduce 逻辑，去业务词）
    status: pending
  - id: a6-prompts-namespace
    content: A6 prompts/templates.yaml 按 domain 命名空间整理（email.single/news.map ...），保留 v4 兼容键
    status: pending
  - id: a7-api-v2
    content: A7 app.py 新增 /v2/summarize，richMail 旧路由改为调用引擎的兼容 shim
    status: pending
  - id: a8-tests
    content: A8 冒烟测试 test_phase_a_core.py + 内核零业务词 grep 校验 + README 更新
    status: pending
isProject: false
---

# Phase A - 内核业务无关化 + 领域插件化

**Author:** Damon Li
**Date:** 2026-06-18
**Planned-with:** Claude Opus 4.8
**前置:** 先读 `2026-06-18-summarizer-v2-overview.plan.md` 第 2/3/4/5 节。
**目标产物:** 重构后 v1 行为不变，新增 v2 通用入口与领域插件骨架。

## 目标

1. 抽出业务无关的 `SummarizationEngine`：只做 ingest→guard→route(单块/Map-Reduce)→resolve prompt→调用 LLM，**不含任何 email/news 字样**。
2. 领域差异下沉为 `DomainPlugin`：email/news 各自一个插件 + 规则引擎；无显式 domain 时由各插件 `rule_engine.score()` 打分择优（替代 v1 `intent.py` 的二元判断）。
3. 新增 `POST /v2/summarize`（`content` + 可选 `domain` + 可选 `options`），旧 `richMail` 路由变成调用同一引擎的**兼容 shim**，响应形状与行为保持不变。
4. 引入 `PromptResolver` 接缝：A 阶段只实现 `StaticPromptResolver`（等价 v1 行为），为 Phase E 的分层注入预留位。

## 现有代码先读（实施前必读）

- `agenticx_service/summarizer.py`（编排，迁移源）
- `agenticx_service/mapreduce.py`（Map-Reduce，迁移源）
- `agenticx_service/intent.py`（命中词，迁入各 domain rules）
- `agenticx_service/prompts/{registry.py,templates.yaml}`（提示词）
- `agenticx_service/app.py`（FastAPI 入口）
- `agenticx_service/overflow.py` / `chunking.py` / `llm_client.py`（被引擎复用，不改签名）

## 新增/变更文件

```
agenticx_service/
  core/
    __init__.py
    types.py            # 新增
    prompt_resolver.py  # 新增
    engine.py           # 新增（吸收 summarizer.py + mapreduce.py 的编排）
  domains/
    __init__.py
    base.py             # 新增
    email/__init__.py, plugin.py, rules.py   # 新增
    news/__init__.py, plugin.py, rules.py    # 新增
  prompts/templates.yaml  # 变更：补 domain 命名空间键，保留旧键
  app.py                  # 变更：加 /v2/summarize，richMail 改 shim
  summarizer.py           # 变更：保留为 deprecated 适配层（转调 engine），不删
  intent.py               # 变更：保留为 deprecated（转调 domain 规则），不删
```

> 保留 `summarizer.py`/`intent.py` 作为薄适配层，避免现有 import（含 tests）大面积失效；新代码一律走 `core`/`domains`。

## 任务清单

- [ ] **A1 数据模型** `core/types.py`
  - `class Modality(str, Enum)`: `TEXT/IMAGE/CODE/DOCUMENT/AUDIO/VIDEO`（B 阶段用，A 先全集声明）。
  - `class Stage(str, Enum)`: `SINGLE/MAP/REDUCE/INTENT`。
  - `@dataclass SummarizeRequest`: `content: str`、`parts: list | None=None`（B 用，A 留空）、`domain: str | None`、`options: dict`（如 `prompt_version`）。
  - `@dataclass SummarizeResult`: `text`、`domain`、`overflow_level`、`trace: dict`（记录 resolved domain/stage 路径/chunk 数）。保留 `scenario` 别名属性 = `domain`，兼容 v1 字段。

- [ ] **A2 提示词解析接缝** `core/prompt_resolver.py`
  - `class PromptResolver(Protocol)`: `async resolve(domain, stage, ctx) -> str`。
  - `class StaticPromptResolver`: 持有 `PromptRegistry`，按 `(domain, stage)` → 模板 id 映射（id 由 DomainPlugin 提供）取模板并 `format(**ctx)`。
  - 未命中模板时回落到 domain 默认（如 `single`）并记录到 `ctx["_resolver_fallback"]`。

- [ ] **A3 领域协议与注册表** `domains/base.py`
  - `class DomainPlugin(Protocol)`：见总览第 3 节签名（`name`/`rule_engine`/`prompt_ids()`/`supported_modalities()`/`postprocess()`）。
  - `class RuleEngine(Protocol)`: `score(content: str) -> float`（0–1）。
  - `class DomainRegistry`: 注册插件；`resolve(content, explicit) -> DomainPlugin`：有 `explicit` 用之；否则取各插件 `score` 最高者，全 0 时回落默认（配置 `domains.default`，默认 `email`）。

- [ ] **A4 email/news 插件 + 规则引擎** `domains/email/`、`domains/news/`
  - `rules.py`：把 `intent.py` 的 `_EMAIL_HINTS`/`_NEWS_HINTS` 与正则迁过来，封装为 `EmailRuleEngine.score` / `NewsRuleEngine.score`（命中数归一化到 0–1）。
  - `plugin.py`：`prompt_ids()` 返回 `{"single": "email.single", "map": "email.map", "reduce": "email.reduce"}`（news 同理）；`supported_modalities()` A 阶段都先返回 `{TEXT}`（B 扩展）；`postprocess` 默认原样返回。

- [ ] **A5 业务无关引擎** `core/engine.py`
  - `class SummarizationEngine`：构造注入 `LLMClient`、`TextChunker`、`OverflowGuard`、`PromptResolver`、`DomainRegistry`、`AppConfig`。
  - `async summarize(req: SummarizeRequest) -> SummarizeResult`：
    1. `domain = registry.resolve(req.content, req.domain)`
    2. `masked = mask_pii(req.content)`（脱敏仍为内核通用步骤）
    3. `guard = overflow.guard_input(masked)`
    4. 路由：`count_tokens <= max_single_pass_tokens` → 单块（`resolver.resolve(domain.name, "single", ctx)`）；否则 Map-Reduce（`map`/`reduce` 经 resolver 取 prompt id）。
    5. `domain.postprocess` → `overflow.wrap_result` → 填 `trace`。
  - **Map-Reduce 迁移**：把 `mapreduce.py` 的并发/Semaphore/多级 reduce 逻辑搬入或由 engine 调用，但模板名一律经 `resolver` 解析，不再 f-string 拼 `map_{scenario}`。

- [ ] **A6 提示词命名空间** `prompts/templates.yaml`
  - 新增键：`email.single`（= 旧 `v4`）、`email.map`（= 旧 `map_email`）、`email.reduce`、`news.map`、`news.reduce`、`news.single`（无则复用通用单块）。
  - **保留旧键** `v1/v2/v3/v4/map_email/...`，供 v1 适配层与现有测试继续工作。

- [ ] **A7 v2 API + 兼容 shim** `app.py`
  - 新增 `POST /v2/summarize`，请求体 `{content, domain?, options?}`，响应 `{code,message,text,data:{domain,overflow_level,trace}}`。
  - 旧 `intelli_abstract`：内部构造 `SummarizeRequest(content=email_content)` 调引擎，响应字段不变（`data.scenario` 仍来自 `result.domain`）。
  - `create_app` 注入单例 `SummarizationEngine`（支持测试传入 stub）。

- [ ] **A8 测试与校验**（见下「冒烟测试」）。

## 冒烟测试 `tests/test_phase_a_core.py`

- `test_domain_registry_routes_email_vs_news`：无显式 domain 时，邮件文本/新闻文本分别命中对应插件。
- `test_engine_single_pass_email`（stub LLM）：短邮件返回非空、`result.domain == "email"`、`trace` 含 `single`。
- `test_engine_mapreduce_routes_by_tokens`（stub LLM，超阈值文本）：走 Map-Reduce，`trace` 含 `map`/`reduce`。
- `test_explicit_domain_overrides_rules`：`domain="news"` 强制走 news，即便文本像邮件。
- `test_v2_endpoint_shape` / `test_richmail_compat_unchanged`：v2 返回含 `data.trace`；旧路由响应形状与 v1 完全一致。
- `test_core_has_no_business_words`：用 `pathlib` 读 `core/*.py`，断言不含 `email`/`news`（允许出现在本测试断言外的注释白名单需避免）。

## 设计护栏

- `core/` 严禁出现领域词（A8 用测试钉死）。
- 不改 `overflow.py`/`chunking.py`/`llm_client.py` 的公共签名。
- `intent.py`/`summarizer.py` 仅保留为转调适配层，**不删除**（旧 import 与既有 17/20 项测试需继续绿）。
- v2 与 richMail 共用同一 `SummarizationEngine` 实例，避免两套编排漂移。

## 验收标准

1. 既有全部测试（含 `test_app.py`、phase1–4）保持通过；新增 phase_a 测试通过。
2. `rg -i "email|news" agenticx_service/core/` 无业务命中。
3. `POST /v2/summarize {content}` 可在 stub 下返回结构化结果含 `trace`。
4. richMail 旧路由响应字节级兼容 v1（字段、状态码、错误文案不变）。

Made-with: Damon Li
