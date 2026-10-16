# SP-B3：无效投标筛查与客观评分引擎

> 需求映射：需求书 3.1.3 无效投标自动筛查、3.1.4 客观项自动量化评分（12 需求点 #3、#4）
> 人天：84（后端 30 / 算法 26 / 前端 19 / 测试 9）
> 前置：SP-B2（结构化字段）
> 里程碑：M3（W5）规则引擎 + 客观分跑通

## 1. 目标

法定无效情形 + 项目自定义规则自动筛查，语义级判定隐蔽无效，完整证据链；客观项自动算分（得分可追溯），主观项仅留人工入口不干预。

## 2. 复用盘点

| 能力 | 位置 | 说明 |
|------|------|------|
| 审批原语 | `agenticx/runtime/action_proposals/` | 无效判定人工复核（确认无效/恢复有效）、留痕（复核人/时间/意见） |
| 审计链 | `agenticx/observability/`、`enterprise/features/audit/` | 判定与复核全量进审计 |
| 评测 | `agenticx/evaluation/` | 无效识别准确率 100% 红线的评测 |
| 说明 | `agenticx/safety/`、`agenticx/tools/policy.py` 是**内容安全**规则，与业务规则引擎无关，不复用其执行逻辑 | |

## 3. 增量设计

### 3.1 业务规则引擎（`agenticx/bidding/rules/engine.py`）——全新

```python
class Rule(BaseModel):
    id: str; name: str
    category: Literal["formality", "qualification", "responsiveness"]  # 形式/资格/响应性
    disposition: Literal["veto", "warn"]          # 一票否决 / 警告提示
    scope: Literal["statutory", "project"]        # 法定内置 / 项目自定义
    expression: RuleExpression                    # 条件表达式（DSL）
    legal_basis: str                              # 法定条款/招标文件条款
    version: int; enabled: bool

class RuleHit(BaseModel):
    rule_id: str; supplier_id: str
    evidence: list[EvidenceSpan]                  # 原文片段（页/段/句）→ 证据链
    rationale: str                                # 判定理由（含语义判定）
```

- **条件表达式**：结构化条件（字段比较：资质等级≥要求、有效期≥开标日）+ 语义条件（供应商表述规避实质要求的隐蔽情形，LLM 判定，输出 rationale + 证据）
- **执行模型**：纯函数规则同步批量执行（毫秒级），语义规则经 LLM 异步执行；两者结果合并为 `InvalidityReport`
- **内置法定规则库**：不具备独立法人资格、资质过期/等级不达标、无有效签章等（首批 20+ 条，法务审核后固化为种子数据 `seeds/rules.yaml`）
- **项目自定义**：缺失★号关键文件、交付周期不满足实质性要求等，由 SP-B5 的评审规则配置流程产生

### 3.2 证据链生成（`agenticx/bidding/rules/evidence.py`）

判定无效时自动截取原文片段：定位到 BidFile artifact 的页码 + 段落 + 原文引用，与规则条款、判定理由组装成证据链，前端可原文穿透核验。

### 3.3 客观分计算引擎（`agenticx/bidding/scoring/`）

```python
class ScoringRule(BaseModel):
    item_id: str; name: str
    type: Literal["objective", "subjective"]
    max_score: float; weight: float
    formula: ScoreFormula | None     # objective 专用

class ScoreFormula:                  # 计算规则示例
    kind: Literal["cert_grade", "perf_count", "perf_amount", "threshold"]
    mapping: dict                    # {A:10, B:8} / 每个业绩 X 分封顶 Y

class ScoreDetail(BaseModel):        # 得分追溯
    item_id: str; supplier_id: str; score: float
    formula_snapshot: dict           # 计算公式快照
    inputs: list[FieldRef]           # 输入字段 → 原文位置
```

- 客观项（资质分/业绩分/商务分）基于 SP-B2 结构化字段自动计算，每分关联公式快照与原始数据，点击分值可查看计算过程（可追溯是验收点）
- 主观项**只**配置项名称、分值上限、评审要点；系统不预设打分标准、不提供建议分值（需求书 3.1.4 明确约束）；录入入口与合规校验在 SP-B6 工作台实现
- 评分规则版本化：规则变更不影响已出分项目（快照机制）

### 3.4 前端页面

- 无效筛查结果页：按无效原因/供应商筛选、批量导出无效清单、证据链穿透
- 复核页：确认无效/恢复有效操作、复核意见、留痕历史（复用审批收件箱交互）
- 客观分明细页：分值明细、计算依据下钻

## 4. 任务分解

| 任务 | 岗位 | 人天 |
|------|------|------|
| 无效筛查：规则引擎 + 语义判定 + 证据链 + 复核（47） | 后端 16 / 算法 18 / 前端 8 / 测试 5 | 47 |
| 客观评分：计算引擎 + 得分追溯 + 主观分入口（37） | 后端 14 / 算法 8 / 前端 11 / 测试 4 | 37 |
| **合计** | 后端 30 / 算法 26 / 前端 19 / 测试 9 | **84** |

## 5. 验收标准

- 法定无效投标识别准确率 100%（封版评测集；注意口径：系统输出为「提示+证据」，最终判定人工确认——合同风险条款已锁定责任边界）
- 语义级规避情形可识别（评测集含 10+ 隐蔽规避样本）
- 每条无效判定含：无效原因、规则条款、文件佐证位置、原文片段
- 客观项得分 100% 可追溯（公式 + 原始数据 + 原文位置）
- 复核操作全程留痕，恢复有效后自动进入后续评审环节

## 6. 依赖与风险

- 依赖：SP-B2 字段与置信度；SP-B5 评分规则配置（客ange观分公式来源）
- 风险：100% 准确率是红线指标 → 高召回优先策略 + 全量语义规则结果默认转人工复核（宁可多报不可漏报），复用审批原语消化复核量；规则库需法务参与评审（W3 启动）
