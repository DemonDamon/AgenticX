# Enterprise 交付缺口补强：文档校对格式校验 + 全链路并发基线

> Plan-Id: 2026-06-11-enterprise-delivery-gap-dev
> 适用执行模型：composer-2.5（本文档为自包含实施说明，执行者无需额外上下文即可落地）

## 0. 背景与定位（执行者必读）

某 Enterprise 一体化大模型应用服务投标交付，乙方以 Near 桌面端 + `enterprise/`（前后台 + AI 网关）交付。
经核查仓库真实状态，两处能力距规范书**验收硬指标**有真实开发量，需补强：

1. **文档校对助手（智能体1）的"二类格式规范校验"**
   - 现状：`enterprise/plugins/tool-doc-review/doc_review_cli.py` 仅 118 行，是 keyword/regex 文本匹配雏形，
     只能覆盖"一类规则确定型"（错别字/标点/称谓），**无法做"二类格式规范型"**（图表编号连续性、标题层级、字体字号、段落间距一致性）。
   - 验收要求（规范书 1.1.15）：一类 漏报率/误报率 ≤10%；二类 ≤15%；连续 3 个工作日测平均值；输入为百页图文 Word/PDF。

2. **200 并发的"全链路"基线**
   - 现状：`enterprise/scripts/perf/` 已有 k6 套件，但只压**网关/SSO 层**（mock upstream），不含"登录 + 对话"的应用全链路。
   - 验收要求（规范书 1.1.13）：现场 200 账号同时登录及对话正常无卡顿，网关审计日志完整。

**本 plan 不碰招标文档**（客户本地投标文档目录，已定稿），只在 `enterprise/` 内补代码与基线脚本。

## 1. 目标 / 非目标

### 目标
- 让 `tool-doc-review` 能对 .docx/.pdf 做**确定性结构与格式校验**，产出分级（严重错误/建议修改/排版建议）的结构化报告。
- 提供**漏报率/误报率评测脚手架**：给定"标注样本集 + 工具输出"，自动算出每类指标，作为验收举证。
- 扩展 perf 套件，新增**应用全链路（登录鉴权 + /api/chat 对话）200 并发** k6 脚本与基线归档，沿用现有 `lib/k6-common.js` 与 `aggregate_baseline.py` 风格。

### 非目标（明确不做，防 scope creep）
- 不做一类语义校对的 LLM 接入改造（错别字/语病走企业独享云模型，是既有链路，不在本次范围）。
- 不改 Go 网关 `apps/gateway` 的策略引擎。
- 不做 Electron 桌面 UI 的自动化压测（k6 压后端，不压 GUI）。
- 不重构 `doc_review_cli.py` 既有 keyword/regex 逻辑，只**新增**格式校验模块并复用其 `Finding`/输出结构。

## 2. 需求（可追溯）

- **FR-1 标题层级校验**：检测标题层级跳级（如 H1 直接到 H3）、编号与层级不一致。
- **FR-2 图表编号连续性**：检测"图 N / 表 N / Figure N"编号缺号、重号、跨章断号。
- **FR-3 字体/字号一致性**：同级别正文/标题字体或字号不一致时给出排版建议。
- **FR-4 段落间距/对齐一致性**：同级段落间距、行距、对齐方式不一致检测（docx 优先，PDF best-effort）。
- **FR-5 分级报告**：所有 finding 归入 `严重错误 / 建议修改 / 排版建议` 三级，输出 JSON（兼容现有 `issues`/`findings` 字段）。
- **FR-6 评测脚手架**：输入标注集 + 工具输出，按一/二类输出 漏报率、误报率。
- **FR-7 全链路并发脚本**：k6 模拟 200 用户登录取 token → 调 `/api/chat`，输出 p50/p95/p99/错误率。
- **FR-8 基线归档**：全链路结果并入 `enterprise/docs/perf-baselines/`，复用 `aggregate_baseline.py`。

- **NFR-1**：二类格式校验在干净文档上**误报率 ≤15%**（确定性算法，不得引入随机/LLM）。
- **NFR-2**：CLI 处理百页 docx 应在单机 ≤30s 内完成（避免 O(n²) 扫描）。
- **NFR-3**：所有 Python 文件遵循 `.cursor/rules/google-python-style.mdc`：英文 docstring、模块头含 `Author: Damon Li`、全包名导入、注释/代码无 emoji。
- **NFR-4**：新增第三方依赖须最小化并在 `requirements.txt` 钉版本；引用上游算法须在文件头注明来源与许可证。

- **AC-1**：对 `tests/fixtures/` 内"已知缺陷 docx"运行 CLI，FR-1~FR-4 各至少命中其对应预置缺陷 1 处，且在"干净 docx"上二类误报 ≤15%。
- **AC-2**：评测脚手架对预置标注集算出的一类/二类指标与人工核对一致（脚手架自带单测）。
- **AC-3**：`pytest enterprise/plugins/tool-doc-review/tests/` 全绿。
- **AC-4**：全链路 k6 脚本可在本地 ramp 到 200 VUs 跑通并产出 baseline JSON；脚本含 200 并发 stage。

## 3. 架构决策

- **语言/栈**：Python（与现有 CLI 一致）。docx 用 `python-docx`，PDF 结构用 `pdfplumber`（best-effort，PDF 拿不到稳定样式时只做编号/层级文本级校验，不做字体字号）。
- **解析抽象**：新增 `DocModel` 中间结构（段落列表，每段含 text/style_name/font_name/font_size/alignment/space_before/space_after/outline_level），docx 与 pdf 各实现一个 loader 填充它，校验器只面向 `DocModel`，与文件格式解耦。
- **校验器接口**：每个校验器是 `def check(doc: DocModel) -> list[Finding]`，在 registry 中注册，主流程聚合。沿用现有 `Finding` dataclass，新增 `category` 字段（`一类/二类/三类`）与 `grade`（`严重错误/建议修改/排版建议`）。
- **向后兼容**：保留现有 `--rules` keyword/regex 路径（归"一类"）；新增 `--format-check` 开关启用 FR-1~FR-4；输出 JSON 顶层保留 `issues`/`findings`，新增 `by_category` 汇总。

## 4. 任务分解（按顺序执行；每个 Task 标注产出文件与验收）

### Phase A — 文档校对格式校验

- [ ] **A1 依赖与骨架**
  - 编辑 `enterprise/plugins/tool-doc-review/requirements.txt`（新建）：`python-docx==1.1.2`、`pdfplumber==0.11.4`、`pytest==8.3.3`。
  - 编辑 `manifest.yaml`：把 `# TODO` 替换为真实 `tools:` 段（声明 `doc_review_cli` 入口、支持的 `--format-check`），保持 `type: tool-pack`。
  - 产出：可 `pip install -r` 成功。

- [ ] **A2 DocModel 与 loaders**
  - 新建 `enterprise/plugins/tool-doc-review/doc_model.py`：
    - `@dataclass Paragraph`（index, text, style_name, font_name, font_size_pt: float|None, alignment: str|None, space_before_pt, space_after_pt, line_spacing, outline_level: int|None）。
    - `@dataclass DocModel`（source_path: str, paragraphs: list[Paragraph]）。
    - `def load_docx(path) -> DocModel`（用 python-docx 读 `document.paragraphs`，从 `paragraph.style`、`runs[0].font` 取样式；缺失置 None）。
    - `def load_pdf(path) -> DocModel`（用 pdfplumber 抽取行文本，outline/字号尽力取，取不到置 None）。
    - `def load_document(path) -> DocModel`（按扩展名分派；不支持类型抛 `ValueError`）。
  - 产出：能对 fixtures docx/pdf 返回非空 paragraphs。

- [ ] **A3 格式校验器（FR-1~FR-4）**
  - 新建 `enterprise/plugins/tool-doc-review/format_checks.py`：
    - `check_heading_hierarchy(doc) -> list[Finding]`（基于 outline_level/style_name 检测跳级，category=二类，grade=排版建议）。
    - `check_figure_table_numbering(doc) -> list[Finding]`（正则提取 `图\s*(\d+)`、`表\s*(\d+)`、`(Figure|Table)\s*(\d+)`，按出现序检测缺号/重号，category=二类）。
    - `check_font_consistency(doc) -> list[Finding]`（按 outline_level 分组，统计众数字体/字号，偏离众数者报排版建议；font 信息为 None 时跳过，不报）。
    - `check_spacing_consistency(doc) -> list[Finding]`（同 style_name 段落的 space_before/after/line_spacing 偏离众数者报建议）。
    - `FORMAT_CHECKERS = [...]` registry。
  - 关键：众数法保证"干净文档"零/低误报（NFR-1）；None 字段一律跳过不报，避免误报。
  - 产出：纯函数，便于单测。

- [ ] **A4 CLI 集成**
  - 编辑 `doc_review_cli.py`：
    - `Finding` 增加 `category: str = "一类"`、`grade: str = "建议修改"` 字段（带默认值，向后兼容）。
    - 新增 `--format-check`（flag）、`--input` 支持 .docx/.pdf（非 .txt 时走 `load_document` + `FORMAT_CHECKERS`；.txt 仍走 keyword/regex）。
    - 输出 JSON 增加 `by_category`（一类/二类/三类计数）与 `by_grade`；保留 `issues`/`findings` 不破坏现有调用。
  - 产出：`python3 doc_review_cli.py --input sample.docx --format-check --output report.json` 可跑。

- [ ] **A5 漏误报评测脚手架（FR-6）**
  - 新建 `enterprise/plugins/tool-doc-review/eval_metrics.py`：
    - 标注集格式：JSON `{ "expected": [ {"category":"二类","locator":"图3","kind":"缺号"}, ... ] }`。
    - `def score(expected: list[dict], tool_findings: list[dict]) -> dict`：按 category 匹配（locator 命中即 TP），输出每类 `missed`(漏报数)、`false_alarm`(误报数)、`miss_rate`、`false_alarm_rate`。
    - `main()` CLI：`--expected labels.json --report report.json --output metrics.json`。
  - 产出：给定标注集与报告，打印一类/二类 漏报率、误报率。

- [ ] **A6 测试与样本**
  - 新建 `enterprise/plugins/tool-doc-review/tests/`：
    - `fixtures/clean_sample.docx`（结构规范，用 python-docx 在 conftest 里程序化生成，避免提交二进制）、`fixtures/flawed_sample.docx`（预置：跳级标题、图编号缺号、字号不一致、段距不一致各 ≥1 处）。
    - `conftest.py`：fixture 程序化生成上述 docx 到 tmp。
    - `test_format_checks.py`：断言 flawed 命中各类缺陷各 ≥1（AC-1）；clean 二类误报 ≤15%（NFR-1）。
    - `test_eval_metrics.py`：构造 expected + findings，断言指标计算正确（AC-2）。
  - 产出：`pytest enterprise/plugins/tool-doc-review/tests/ -q` 全绿（AC-3）。
  - 更新 `README.md`：新增 `--format-check` 用法与评测脚手架用法、依赖安装说明。

### Phase B — 全链路 200 并发基线

> 先确认应用后端鉴权与对话端点的真实路径，再写脚本。

- [ ] **B1 探明端点契约**
  - 查 `enterprise/apps/web-portal` 的登录鉴权 API（签发 JWT/Cookie 的路由）与对话端点（转发到网关或 Studio 的 `/api/chat` 等价路由）。
  - 在 plan 执行记录里写明实际路径与请求/响应体（不要臆测；用 Grep/Read 在 `enterprise/apps/web-portal/src/app/api/` 下定位）。

- [ ] **B2 全链路 k6 脚本**
  - 新建 `enterprise/scripts/perf/app-login-chat-200.js`：
    - 复用 `lib/k6-common.js` 风格新增 helper（如需要在 `lib/` 加 `appBase()`、`loginAndGetToken()`）。
    - 场景：`ramping-vus` stages `0→50(30s)→200(30s)→200(60s)`，与 `sso-200-concurrent.js` 对齐。
    - 流程：每 VU 先登录取凭据 → 携带凭据 POST 对话端点 → check 200 且响应非空。
    - thresholds：`http_req_failed: rate<0.05`，`http_req_duration: p(95)<5000`（本地宽松；AC 目标 4C/8G P95≤800ms 写注释）。
  - 产出：`k6 run enterprise/scripts/perf/app-login-chat-200.js` 跑通（AC-4）。

- [ ] **B3 编排与基线归档**
  - 新建 `enterprise/scripts/perf/run-app-baseline.sh`：参照 `run-gateway-baseline.sh` 结构，按需起 web-portal + 网关 + mock upstream（或对接已起服务，用 env 开关），跑 B2 脚本，`--summary-export` 后调 `aggregate_baseline.py` 归档到 `docs/perf-baselines/app-login-chat-<date>-<commit>.json`。
  - 注意：localhost 探活 curl 加 `--noproxy '*'`（与现有脚本一致）。
  - 产出：生成一份 app 全链路 baseline JSON。

- [ ] **B4 验收报告模板**
  - 新建 `enterprise/docs/perf-baselines/README.md`（若无）追加"全链路 200 并发"章节：说明跑法、环境字段含义、如何映射到规范书 1.1.13 验收"200 账号并发登录及对话"，以及与网关层基线的区别（应用全链路 ≠ 仅网关）。

## 5. 测试与验证命令（执行者逐条跑并贴输出）

```bash
# Phase A
cd enterprise/plugins/tool-doc-review
pip install -r requirements.txt
pytest tests/ -q                         # 期望全绿 (AC-3)
python3 doc_review_cli.py --input tests/fixtures/flawed_sample.docx --format-check --output /tmp/r.json
python3 eval_metrics.py --expected tests/fixtures/flawed_labels.json --report /tmp/r.json --output /tmp/m.json
cat /tmp/m.json                          # 查看一类/二类 漏报率/误报率

# Phase B（需先起 enterprise 中间件与应用，见 scripts/start-dev-with-infra.sh）
k6 run enterprise/scripts/perf/app-login-chat-200.js
bash enterprise/scripts/perf/run-app-baseline.sh
```

## 6. 依赖与前置
- `pip`：python-docx、pdfplumber、pytest（钉版本写入插件 requirements.txt）。
- Phase B 需本机 `k6`、`go`，并按 `enterprise/scripts/start-dev-with-infra.sh` 起 PG/Redis + 应用栈；JWT PEM 见 `enterprise/.local-secrets/`（缺失先 `bash scripts/bootstrap.sh`）。

## 7. 风险与缓解
- **PDF 样式信息不稳定**：PDF 字体/字号常取不到 → 字号/间距校验对 PDF 标记 None 并跳过，仅做编号/层级文本级校验；docx 为完整校验主路径（验收样本含 Word，可主推 docx）。
- **误报率超标**：一律用"众数对比 + None 跳过"策略，宁漏勿误，确保 NFR-1。
- **全链路端点路径未知**：B1 必须先 Grep 实际路由再写脚本，禁止臆测端点。
- **作用域蔓延**：严格只新增文件 + 最小编辑既有 CLI；不重构 keyword/regex 既有逻辑。

## 8. 交付物清单
- `enterprise/plugins/tool-doc-review/`：`requirements.txt`、`doc_model.py`、`format_checks.py`、`eval_metrics.py`、`doc_review_cli.py`(改)、`manifest.yaml`(改)、`README.md`(改)、`tests/*`。
- `enterprise/scripts/perf/`：`app-login-chat-200.js`、`run-app-baseline.sh`、`lib/k6-common.js`(可能扩展)。
- `enterprise/docs/perf-baselines/`：新基线 JSON + README 章节。

## 9. 提交规范
- 按功能点分组提交，提交信息含结构化需求块（FR/AC）。
- 每个 commit 必须含 trailer：`Made-with: Damon Li`、`Plan-Id: 2026-06-11-enterprise-delivery-gap-dev`、`Plan-File: .cursor/plans/2026-06-11-enterprise-delivery-gap-dev.plan.md`。
- 禁止任何 AI 工具署名 trailer。
