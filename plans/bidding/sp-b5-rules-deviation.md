# SP-B5：评审规则结构化与偏离比对

> 需求映射：需求书 3.2.1 评审规则结构化管理、3.2.2 投标需求一致性比对、3.3.1 业务规则可视化配置（12 需求点 #7、#8）
> 人天：111（后端 33 / 算法 37 / 前端 29 / 测试 12）
> 前置：SP-B2（结构化抽取）
> 里程碑：M3（W5）规则解析 + 偏离比对跑通

## 1. 目标

招标文件/采购需求自动解析为结构化评审项（★号项识别、参数分级、权重可编辑）；评分规则多评审办法支持、版本化；投标响应 vs 采购需求全维度偏离比对（正/负/无偏离、重大/一般分级、原文定位、统计联动扣分）；业务规则可视化配置页。

## 2. 复用盘点

| 能力 | 位置 | 说明 |
|------|------|------|
| LLM 结构化输出 | `agenticx/llms/` + Pydantic | 招标文件解析 |
| 检索 | `agenticx/retrieval/`（hybrid + reranker） | 长需求文档逐参数定位响应段落 |
| 评测 | `agenticx/evaluation/`（evalset/llm_judge/runner） | 偏离召回 ≥96% 迭代加速 |
| 前端 | `enterprise/features/` 设计体系 | 规则编辑、版本树、比对表格 |

## 3. 增量设计

### 3.1 采购需求自动解析（`agenticx/bidding/rules/tender_parser.py`）

```python
class ReviewItem(BaseModel):          # 结构化评审项
    id: str; category: Literal["technical", "commercial", "qualification"]
    name: str; requirement_text: str
    critical: bool                    # ★号实质性条款
    weight: float; params: list[ParamSpec] | None

class ParamSpec(BaseModel):
    name: str; unit: str | None
    requirement: str                  # ≥100mm / IP65 / 交付≤30天
    response_locator: str | None      # 关联投标响应段落
```

- 招标文件上传 → LLM 抽取技术参数清单、商务要求清单 → 人工编辑/新增/删除/调权重（需求书明确支持人工修正）
- ★号项识别：格式符号（★/▲/※）+ 语义识别（「实质性要求」「不满足即废标」表述）双通道

### 3.2 评分规则配置（`agenticx/bidding/scoring/plans.py`）

- 评审办法：综合评分法、最低价中标法（可扩展）
- 评分项拆分：分值、评分标准、打分依据、偏离扣分规则；客观项关联 SP-B3 计算公式，主观项仅名称/上限/评审要点
- 版本化：修改自动留存历史版本，可回滚；发布走审批（复用 action_proposals）

### 3.3 偏离比对（`agenticx/bidding/deviation/`）

```python
class Deviation(BaseModel):
    item_id: str; supplier_id: str
    direction: Literal["positive", "negative", "none"]     # 正/负/无偏离
    severity: Literal["major", "minor"] | None             # 重大(★项)/一般
    requirement_text: str; response_text: str
    locator: PageLocator                                   # 页码+段落
    score_impact: float | None                             # 联动扣分
```

- **比对 agent**：逐参数（ParamSpec × 供应商）三段式——retrieval 定位响应段 → LLM 判定方向与依据 → 数值/枚举参数走确定性比较器（能耗、速度等可量化参数不走 LLM，规避幻觉）
- **内部偏离**：同一投标文件前后表述矛盾、承诺不一致的检测（全文承诺点抽取 + 一致性校验）
- **统计联动**：每家供应商重大/一般偏离计数、偏离率；横向对比排序；偏离等级自动关联扣分规则；★项负偏离自动触发废标提示（联动 SP-B3）
- 导出：偏离项汇总表一键导出（Excel/Word）

### 3.4 可视化规则配置页（`enterprise/features/bidding/src/`）

- 规则编辑器：无效规则 / 偏离判定规则 / 评分计算规则的表单化配置（对应 SP-B3 的 Rule DSL，前端渲染为条件构建器）
- 阈值配置：风险预警阈值、相似度阈值（联动 SP-B4）
- 流程配置：评审流程节点、审批权限、报告模板选择
- 版本管理：历史版本 diff、回滚

## 4. 任务分解

| 任务 | 岗位 | 人天 |
|------|------|------|
| 评审规则结构化：招标文件 LLM 解析入库、版本化、编辑发布（38） | 后端 11 / 算法 13 / 前端 10 / 测试 4 | 38 |
| 偏离比对：逐字段比对 agent、分级/定位/统计联动、evalset 迭代（48） | 后端 12 / 算法 22 / 前端 9 / 测试 5 | 48 |
| 业务规则可视化配置页（25） | 后端 10 / 算法 2 / 前端 10 / 测试 3 | 25 |
| **合计** | 后端 33 / 算法 37 / 前端 29 / 测试 12 | **111** |

## 5. 验收标准

- 偏离项识别召回率 ≥96%（封版评测集；含正/负/无偏离三类与内部矛盾样本）
- 每条偏离项展示：需求原文、响应原文、偏离类型、页码段落位置
- ★项负偏离 100% 触发废标提示（联动 SP-B3）
- 偏离自动关联扣分；重大/一般计数与偏离率统计准确
- 规则配置全程零代码（业务人员操作验收）；版本可追溯可回滚

## 6. 依赖与风险

- 依赖：SP-B2 抽取；SP-B3 规则引擎 DSL（规则编辑器共用）
- 风险：96% 召回紧约束 → 可量化参数确定性比较器覆盖越多越好（评估集中量化参数占比决定难度）；LLM 判定全部输出依据原文，低置信转人工复核兜底
