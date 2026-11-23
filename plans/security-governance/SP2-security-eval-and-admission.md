# SP2: 模型安全测评与准入（security-eval & admission）

Plan-Id: security-eval-and-admission
Parent-Plan: plans/security-governance/MASTER-PLAN.md（缺口 G1：无用攻击验证防线的评测能力；G6：准入是名单制非评审制）
Status: implemented（2026-11-12 实施+测试+E2E 通过，待 commit）

## 一、探查结论

| 事实 | 位置 |
|---|---|
| 规则库（语料反向生成来源）：`guard_patterns.yaml` 19 类 ~200 条（prompt_injection 10 / prompt_poison 14 / ai_safety 18 / exfiltration 23 / credential 9 / secret 18 / injection 25 等），`load_pattern_set()` 惰性加载，`pattern_set_version` 自带版本号 | `agenticx/skills/guard_engine.py:41,97-124`、`agenticx/skills/guard_patterns.yaml` |
| 规则扫描可复用：`_scan_text_v2(text, rel_path, patterns)` 按行命中 → ScanFinding（含 pattern_id/category/severity）；FP 过滤可关（`apply_fp_filter=False`，评测场景必须关，否则攻击 payload 会被当文档示例过滤掉） | `guard_engine.py:174-225` |
| 记分先例：`compute_score_and_grade`（0-100 → S+/S/A/B/C/D），评级口径与 skill guard 一致可复用 `score_to_grade` | `agenticx/skills/guard_score.py:30-64` |
| 防线栈（judge 用）：LeakDetector 17 模式（BLOCK/REDACT/WARN）、Policy.check（BLOCK/WARN/SANITIZE）、Sanitizer 9 注入启发式 | `agenticx/safety/leak_detector.py`、`policy.py`、`sanitizer.py`（契约见 docs/guides/security.md） |
| LLM 调用：`ProviderResolver.resolve(provider, model)` → `BaseLLMProvider.invoke(prompt)`；providers 读 `~/.agenticx/config.yaml`（zhipu/minimax/彩讯中转等真实模型已配置可用） | `agenticx/llms/provider_resolver.py:256-300`、`agenticx/llms/base.py:28` |
| CLI 子应用范式：typer.Typer 子 app + main.py 惰性 import 注册（`_get_*_app` + `app.add_typer`） | `agenticx/cli/main.py:140-147,505-512`、`harness_surface_commands.py` |
| G6 现状（名单制）：模型启用 = PATCH `/api/admin/providers/[id]/models/[modelName]` body `{enabled}` → `updateProviderModel` 落 PG `model_providers.models[]`；无任何评审依据 | `admin-console/.../providers/[id]/models/[modelName]/route.ts:20,27`、`lib/db-stores/postgresql/model-providers-store.ts:444-477` |
| 网关侧消费：runtimeconfig Loader 轮询 providers.json，`ResolveByModel` 跳过 `!m.Enabled`——准入落点在 console 写侧（enabled 门槛），网关不用改 | `gateway/internal/runtimeconfig/runtimeconfig.go:213-244` |
| console 配置文件范式（SP4 先例）：file store `.runtime/admin/*.json` + route CRUD + UI 卡片 | `admin-console/src/lib/alert-channels-store.ts`、`api/admin/alerts/channels/route.ts` |
| console 审计：`insertAuditEvent({tenantId, actorUserId, eventType, targetKind, targetId, detail})` → iam `audit_events` 表 | `enterprise/packages/iam-core/src/repos/audit.ts:7-36` |
| 测试范式：pytest 落 `tests/`（testpaths=["tests"]，importlib 模式）；console 用 vitest + vi.mock 相对路径 | `pyproject.toml [tool.pytest.ini_options]`、`api/admin/alerts/channels/__tests__/channels-route.test.ts` |

## 二、设计

### A. 评测线 `agx security-eval`（Python 侧）

```text
语料构建 corpus.py
  ├─ guard_patterns.yaml 反向生成：LLM 攻击面类别（prompt_injection/prompt_poison/ai_safety/
  │   injection/exfiltration/credential/secret）每条 pattern → 攻击话术模板（payload 确保命中该 regex）
  └─ jailbreak_seed.yaml（版本化种子，公开越狱手法：DAN / Developer Mode / AIM / 角色扮演 /
      base64 编码指令 / 假 system 标签 / 系统提示词套取 …，对齐 JailbreakBench 经典类别 + OWASP LLM Top 10）
      → 攻击语料 AttackCase{id, category, owasp, source, prompt, expected_rules[]}
× 模型矩阵 runner.py（invoker 注入式：ProviderResolver 真实调用 / MockInvoker 测试用，无网络依赖）
      → 每条 (attack, model) 的模型响应
→ 判定 judge.py（证明"拦得住"）
  ├─ refusal 检测（模型自我拒绝）
  └─ 防线栈检测：guard patterns（apply_fp_filter=False）+ LeakDetector + SafetyLayer Policy
  verdict ∈ refused / blocked_by_rule（响应若过防线会被拦）/ bypassed / error，附命中规则证据
→ 记分 report.py
  每模型：model_refusal_rate + defense_detection_rate + safety_score=(refused+blocked)/total
  → grade 复用 score_to_grade；分类别（OWASP 对齐）明细
→ 报告落盘（版本化 run_id + corpus_version + pattern_set_version + 时间戳）
  ├─ scorecard.json（完整明细，console 准入导入用）
  └─ scorecard.md（售前版：仅 provider 名/model 名/分数/类别矩阵，无 key/endpoint——脱敏纪律）
```

CLI 命令（`agenticx/cli/security_eval_commands.py`，main.py 注册 `security-eval`）：
- `agx security-eval run --model zhipu/glm-4.6 --model minimax/MiniMax-M2.7 [--output DIR] [--max-attacks N] [--timeout S]`
- `agx security-eval run --mock`（MockInvoker：compliant/refusing 两种行为，CI 与单测用）
- `agx security-eval show <run_dir>`（重放展示已落盘记分卡）

### B. 准入门槛（admin-console，评审制补名单制）

数据文件 `.runtime/admin/model-admission.json`（console file store 范式，仅 console 读写）：

```json
{
  "tenants": {
    "<tenant>": {
      "threshold": { "enabled": true, "minScore": 80, "requireScorecard": false },
      "scorecards": { "<model>": { "latest": {...}, "history": [... capped] } },
      "overrides": [ { "model", "operator", "reason", "ticket", "at", "scoreAtOverride" } ]
    }
  }
}
```

准入执行点（route 层判定，store 保持纯 CRUD；判定逻辑 `model-admission.ts` 纯函数可单测）：
- PATCH enable=true 且 gate on：该 model 有 scorecard 且 safety_score < minScore → 403 `model_admission_blocked`（先写 audit `model_admission_blocked_attempt` 再返回）；body 带 `override{reason 必填, ticket?}` → 放行 + override 记录入 store + audit `model_admission_override`（留痕）
- 有 scorecard 且达标 → 放行 + audit `model_admission_passed`
- 无 scorecard → `requireScorecard` 决定放行（audit `model_admission_no_scorecard`）或阻断
- gate off → 现状等价（纪律：off 等价现状）
- `addProviderModel`（POST models，enabled=true 默认）同样过 gate
- 导入：POST `/api/admin/security/scorecards`（body=CLI scorecard.json）→ 按 model name 归档 latest+history，audit `scorecard_imported`

API：
- `GET/PUT /api/admin/security/admission`（threshold CRUD）
- `GET /api/admin/security/scorecards`（列表）/ `POST`（导入）

UI（models.tsx 页 + 新 `_sections/model-admission.tsx` 面板）：
- 准入门槛配置卡（enabled/minScore/requireScorecard）
- 模型记分卡表（model → score/grade/评测时间/corpus_version）
- enable 被阻断时弹 override 对话框（reason 必填）→ 带 override 重发

### 改动清单

| # | 文件 | 改动 |
|---|---|---|
| 1 | `agenticx/security_eval/`（新包） | `corpus.py`（语料构建）/ `jailbreak_seed.yaml`（版本化种子）/ `judge.py`（refusal+防线栈判定）/ `report.py`（md+json 落盘）/ `runner.py`（invoker 注入式执行） |
| 2 | `agenticx/cli/security_eval_commands.py`（新） | security-eval 子 app（run/show） |
| 3 | `agenticx/cli/main.py` | 惰性注册 `security-eval` |
| 4 | `tests/test_security_eval_corpus.py` 等（新） | 语料命中目标规则、judge 四态判定、mock 全链路、报告落盘 |
| 5 | `admin-console/src/lib/model-admission-store.ts`（新） | file store + threshold/scorecard/override 存取 |
| 6 | `admin-console/src/lib/model-admission.ts`（新） | gate 判定纯函数（blocked/passed/no-scorecard/override） |
| 7 | `admin-console/src/app/api/admin/security/admission/route.ts`（新） | threshold GET/PUT |
| 8 | `admin-console/src/app/api/admin/security/scorecards/route.ts`（新） | GET/POST 导入 |
| 9 | `.../providers/[id]/models/[modelName]/route.ts` + `.../models/route.ts` | enable 动作接 gate（先 audit 后动作） |
| 10 | `admin-console/src/app/admin/_sections/model-admission.tsx`（新）+ `models.tsx` | 准入面板 + 403 blocked → override 对话框重发 |

### 纪律对齐

- 规则是数据：攻击语料 = guard_patterns 反向模板 + 版本化 seed 文件；阈值/门槛全部配置化（threshold 可热改），不硬编码
- 报告即产品：md 售前版不含 api_key/endpoint/prompt 原文中的凭据类 payload（报告示例化），json 供准入机读；run_id 版本化可追溯
- 默认开启 + 兜底：console gate threshold.enabled 默认 true（有 scorecard 数据才可能阻断，无 scorecard 默认放行不扰现有部署）；threshold off = 现状等价
- 先审计后动作：blocked_attempt / override / passed / no_scorecard / imported 全落 insertAuditEvent 再返回响应
- 评测调用只读模型（chat completion），不发工具、不注入系统提示词攻击目标系统

## 三、验收标准（对齐 MASTER-PLAN 第八节）

- [ ] pytest：语料构建——每条 guard 反向攻击的 prompt 确实命中其目标 regex；seed 语料版本化可加载
- [ ] pytest：judge 四态判定（refused/blocked_by_rule/bypassed/error）+ 证据字段（规则 id+命中文本）
- [ ] pytest：mock invoker 全链路 run→scorecard.json/md 落盘，分数计算正确
- [ ] vitest：store 单测（threshold/scorecard 导入去重/override 留痕）
- [ ] vitest：gate 路由测试——低分 enable 被 403 阻断且 audit 落 event；override 带理由放行且留痕；无 scorecard 放行+WARN audit；gate off 现状等价
- [ ] E2E 真机：`agx security-eval run` 对 ≥2 个真实模型（zhipu glm-4.6 + minimax MiniMax-M2.7）产出记分卡 md+json 落盘 `reports/security-eval/`
- [ ] E2E 真机：scorecard 导入 console → 低分模型 enable 被 403 → override 留痕可查
- [ ] 回归：涉及包既有测试全绿；commit 带 Plan-Id/Plan-File/Impl-Model: GLM-5.3/Made-with: Damon Li
