# Enterprise plugins/ 模块总结

> 结论生成时间：2026-07-21（基于当前 `enterprise/plugins/` 全量重生成，覆盖 10 个 plugin）

> 说明：本文档是 **Enterprise 运行时插件目录**（10 个 plugin）的目录级合订结论。如实区分「已落地可演示 / 仅 manifest 占位 / TODO 空壳」三态，不夸大未实现能力。具体插件协议规范见 `enterprise/docs/plugin-protocol/`（本文档不展开协议本身）。

## 模块概述

`plugins/` 是 Enterprise 的**运行时插件目录**。10 个 plugin 按"用途 + 运行时"分为四类：

| 类别 | 数量 | type | 装载方 |
|---|---|---|---|
| **合规规则包**（`moderation-*`） | 3 | `rule-pack` | gateway 通过 `policy_manifest: /app/plugins/moderation-*/manifest.yaml` 通配扫描；admin 发布后进 PG 快照 |
| **Wasm 网关插件**（`wasm-*`） | 4 | `plugin` + `runtime: wasm` | gateway wasmhost 按 `priority` 串行调用（依赖内嵌 builtin） |
| **工具包**（`tool-*`） | 2 | `tool-pack` | 独立 Python CLI（验收 / 测试用） |
| **主题包**（`theme-*`） | 1 | `theme-pack` | UI brand / theme 注入（预期与 `@agenticx/ui` + `@agenticx/config` 配合） |

## 目录结构（如实）

```
plugins/
├── moderation-pii-baseline/        # ✅ 通用 PII 基线（5 条规则，其他包 extends 它）
│   ├── manifest.yaml
│   └── README.md
├── moderation-finance/             # ✅ 金融行业包（extends 基线 + 2 条规则）
│   ├── manifest.yaml
│   └── README.md
├── moderation-medical/             # ✅ 医疗行业包（extends 基线 + 1 条关键词规则）
│   ├── manifest.yaml
│   └── README.md
├── wasm-keyword-rewrite/           # ⚙ manifest 已落，enabled=true，priority=100
│   └── manifest.yaml               # binary: builtin:keyword-rewrite（无 .wasm 文件）
├── wasm-bearer-extractor/          # ⚙ manifest 已落，enabled=false，priority=20
│   └── manifest.yaml               # binary: builtin:bearer-extractor
├── wasm-audit-tagger/              # ⚙ manifest 已落，enabled=false，priority=50
│   └── manifest.yaml               # binary: builtin:audit-tagger
├── wasm-waf-basic/                 # ⚙ manifest 已落，enabled=false，priority=10
│   └── manifest.yaml               # binary: builtin:waf-basic，mode=block
├── tool-doc-review/                # ✅ 完整实现 + 测试（可演示）
│   ├── manifest.yaml               # type: tool-pack，v0.2.0
│   ├── doc_review_cli.py           # 主 CLI
│   ├── doc_model.py                # docx/pdf 加载器
│   ├── format_checks.py           # 4 项确定性排版检查
│   ├── findings.py                 # Finding 数据类 + 分类/分级汇总
│   ├── eval_metrics.py             # miss / false-alarm 评估 CLI
│   ├── requirements.txt            # python-docx / pdfplumber / pytest
│   ├── README.md
│   └── tests/                      # conftest + 2 个测试文件 + 1 个 fixture
├── tool-watermark/                 # ⚠ 验收最小实现（仅追加注释行，非可见水印）
│   ├── manifest.yaml               # 仍带 # TODO，未填具体 rules/tools
│   ├── pdf_watermark_cli.py        # 仅在 PDF 字节末尾追加 % AGX-WATERMARK 注释
│   └── README.md
└── theme-default/                  # ❌ TODO 空壳
    ├── manifest.yaml               # 仅元数据 + # TODO，无任何 theme token
    └── README.md
```

## 各类别详解

### 1. 合规规则包（`moderation-*`，3 个，全部已落地）

协议字段：`name / version / type=rule-pack / description / extends? / rules[]`；每条规则 `id / kind(keyword|regex|pii) / action(block|redact|warn) / severity / message`。

**`moderation-pii-baseline`**（基线包，无 extends）—— 5 条 PII 规则：

| id | kind / pii_type | action | severity |
|---|---|---|---|
| `pii-email` | pii / email | redact | high |
| `pii-mobile` | pii / mobile | redact | high |
| `pii-id-card` | pii / id-card | **block** | critical |
| `pii-bank-card` | pii / bank-card | **block** | critical |
| `pii-api-key` | pii / api-key | **block** | critical |

**`moderation-finance`**（`extends: moderation-pii-baseline`）—— 再加 2 条：
- `finance-keyword-insider`（block, critical）—— 关键词：内幕交易 / 非公开财报 / 未披露并购 / 资金挪用 / 反洗钱名单
- `finance-regex-account`（warn, medium）—— regex：`(?i)(账户余额|资金流水|券商席位|授信额度)`

**`moderation-medical`**（`extends: moderation-pii-baseline`）—— 再加 1 条：
- `medical-keyword-phi`（warn, high）—— 关键词：病历全文 / 基因检测原始数据 / 住院号 / 处方原件

> 诚实说明：三个 rule-pack 的 manifest 均为完整 YAML，规则可被 gateway Go 引擎识别（`keyword` / `regex` / `pii` 三种 kind 均在引擎支持范围内）。但本目录内**没有任何运行时校验脚本**——规则的真正生效依赖 gateway 侧 `policy-engine` 与 admin 发布快照链路，不在 plugins/ 目录内体现。

### 2. Wasm 网关插件（`wasm-*`，4 个，manifest 已落但 binary 依赖宿主）

协议字段：`name / version / type=plugin / runtime=wasm / enabled / priority / scope{tenant_ids,routes} / wasm{binary,host_capabilities[]} / config{...}`。

| Plugin | priority | enabled | host_capabilities | 用途 | binary |
|---|---|---|---|---|---|
| `wasm-waf-basic` | 10（先跑） | **false** | audit_log, metrics_inc | 基础 WAF：prompt 注入关键词检测（"ignore previous instructions" / "disregard prior" / "system prompt override"），mode=block | `builtin:waf-basic` |
| `wasm-bearer-extractor` | 20 | **false** | （无） | 从 `X-Custom-Token` 头提取 token 写入 `custom_token` 属性 | `builtin:bearer-extractor` |
| `wasm-audit-tagger` | 50 | **false** | audit_log | 给请求打审计标签 `audit_tag: wasm-tagged` | `builtin:audit-tagger` |
| `wasm-keyword-rewrite` | 100（最后跑） | **true** | audit_log, metrics_inc | 关键词重写：`secret-keyword → [REDACTED]` | `builtin:keyword-rewrite` |

> 诚实说明：4 个 wasm 插件**只有 manifest**，`binary` 全部指向 `builtin:*`——**目录内没有 `.wasm` 字节码文件**。它们能否真正执行，取决于 gateway `wasmhost` 是否内嵌了同名 native builtin（对应 gateway 侧 `wasmhost/builtin.go`，不在本目录）。因此从 plugins/ 视角看，这 4 个是「manifest 完整、运行时依赖宿主」的占位，不能仅凭本目录声称「wasm 插件已可运行」。默认仅 `wasm-keyword-rewrite` 一项 `enabled: true`，其余三项 disabled。

### 3. 工具包（`tool-*`，2 个，成熟度差异大）

#### `tool-doc-review`（v0.2.0，**完整实现 + pytest，可现场演示**）

主 CLI `doc_review_cli.py` 支持两种模式：
- **txt 输入**：从 `--rules` JSON 读规则（`keyword` / `regex` 两类），逐条匹配文本，输出 `Finding[]`（含 `rule_id / severity / matched / start / end / message / category / grade`）。`.txt` 必须传 `--rules`，不支持 `--format-check`。
- **docx / pdf 输入**：必须传 `--format-check`，走 `doc_model.load_document` → `format_checks.run_format_checks`。

`format_checks.py` 实现 4 项确定性排版检查（对应 FR-1 ~ FR-4）：
1. `check_heading_hierarchy` —— 标题层级跳级检测（level > last_level + 1 即报）
2. `check_figure_table_numbering` —— 图（`图N`/`Figure N`）、表（`表N`/`Table N`）编号连续性 + 重复号检测
3. `check_font_consistency` —— 字体名 / 字号一致性（按 outline_level 分组取众数比对；**docx 专属，PDF 仅 best-effort 参与编号检查**）
4. `check_spacing_consistency` —— 段前 / 段后 / 行距一致性（按 style_name 分组；**docx 专属**）

`doc_model.py`：`python-docx` 加载 docx（提取 style / font / size / spacing / outline_level），`pdfplumber` 加载 pdf（按行提取文本，font/spacing 字段为 None）。

`findings.py`：`Finding` dataclass + `summarize_by_category`（一类/二类/三类）+ `summarize_by_grade`（严重错误/建议修改/排版建议）。

`eval_metrics.py`：独立 CLI，对比 `--expected` 标签与 `--report` 工具产出，按类别算 `missed / false_alarm / miss_rate / false_alarm_rate`。

`tests/`：`conftest.py` 提供 `clean_docx` / `flawed_docx` / `flawed_labels` 三个 fixture；`test_format_checks.py` 3 个用例（flawed 命中全部 4 个 checker、clean 误报率 ≤ 0.15、单 checker 返回非空）；`test_eval_metrics.py` 2 个用例（score 计算正确性 + CLI roundtrip）。`requirements.txt`：`python-docx==1.1.2` / `pdfplumber==0.11.4` / `pytest==8.3.3`。

> 诚实说明：这是 plugins/ 内**唯一可端到端演示**的插件，`pytest tests/ -q` 可直接跑。但当前是独立 Python CLI 形态，**尚未挂到 MCP host** 作为 agent 工具暴露。

#### `tool-watermark`（v0.1.0，**验收最小实现，非可见水印**）

`pdf_watermark_cli.py` 仅 36 行：校验输入以 `%PDF` 开头后，在 PDF 字节末尾**追加一行 `% AGX-WATERMARK: <text>` 注释**，即视为完成。`manifest.yaml` 仍带 `# TODO: populate concrete rules / tools / theme tokens`。

> 诚实说明：此实现**不渲染任何可见水印**（不动页面内容、不叠图层、不嵌 XMP 元数据结构），只是在文件尾追加一行 PDF 注释。作为「验收最小实现」可交付，但**不能作为生产级 PDF 水印能力演示**，README 也仅称其为「通用封装模板」。

### 4. 主题包（`theme-default`，**TODO 空壳**）

`manifest.yaml` 仅 `name / version / type=theme-pack / description` 四行 + `# TODO: populate concrete rules / tools / theme tokens`；README 仅 9 行指向协议文档。**没有任何 theme token、CSS、配色或品牌资源**。

> 诚实说明：本插件目前是纯占位，预期承载 `@agenticx/config` 的 `BrandConfigSchema` 默认值并被 `@agenticx/ui` 的 `runtime-brand` 加载——但目录内无任何可消费内容，不可演示。

## 当前能力矩阵（诚实版）

| 类别 | 状态 | 可否现场演示 |
|---|---|---|
| PII 基线 + 金融 / 医疗行业规则 | ✅ manifest 完整 | 规则本身可展示；运行时拦截需配合 gateway + admin 发布链路 |
| Wasm 插件 manifest | ✅ 4 个 manifest 已落 | ⚠ 仅 manifest 可展示；binary 依赖 gateway 内嵌 builtin，本目录无 `.wasm` |
| Wasm 默认启用项 | 仅 `wasm-keyword-rewrite`（enabled=true） | 同上，依赖宿主 |
| `tool-doc-review` CLI + 测试 | ✅ 完整实现，pytest 可跑 | ✅ 可现场 `pytest tests/ -q` 演示 |
| `tool-watermark` CLI | ⚠ 仅追加注释行 | 可演示 CLI 跑通，但**非可见水印**，需说明局限 |
| `theme-default` | ❌ TODO 空壳 | 不可演示 |
| 工具包 → MCP host 接入 | ❌ 未实现 | — |
| 第三方 / 客户自定义 plugin SDK | ❌ 规划中（协议文档已起） | — |

## 与 Enterprise 其他模块的关系

| 关联 | 形态 | 说明 |
|---|---|---|
| `apps/gateway`（Go `wasmhost`） | 装载 `wasm-*` | wazero runtime + 内嵌 native builtin（`builtin:*` 指向处） |
| `apps/gateway`（Go `policy-engine`） | 消费 `moderation-*` | 经 admin 发布快照拿到规则后评估 |
| `apps/gateway`（Go `mcphost`） | **未来**挂 `tool-*` | 作为 MCP tools 暴露给 agent（当前未接） |
| `packages/config` / `@agenticx/ui` | 关联 `theme-default` | theme manifest 默认路径指向本目录（当前为空壳） |
| `enterprise/docs/plugin-protocol/` | 协议规范 | 所有 plugin 类型的契约文档（本文档不展开） |
