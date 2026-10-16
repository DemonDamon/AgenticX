# SP-B2：结构化抽取与置信度体系

> 需求映射：需求书 3.1.2 投标信息结构化解析（12 需求点 #2），含资质验真、中英双语、签章识别、低置信度人工修正
> 人天：119（后端 37 / 算法 49 / 前端 20 / 测试 13）
> 前置：SP-B1（解析 artifact）
> 里程碑：M2（W4）抽取链路 + 评测基线

## 1. 目标

对解析后的标书做深度语义抽取：供应商工商信息、资质证书（含联网验真）、业绩清单、技术/商务响应、售后服务条款；中英双语；签章识别与关键页校验；全字段置信度标注，<80% 转人工复核，修正结果回流样本库。

## 2. 复用盘点

| 能力 | 位置 | 说明 |
|------|------|------|
| 工具与 Schema 体系 | `agenticx/tools/base.py`（参数校验/错误类型）、Pydantic | 抽参链路重写的骨架 |
| 模型适配 | `agenticx/llms/` | 多供应商 + 内网 Ollama + OpenAI 兼容网关 |
| 审批原语 | `agenticx/runtime/action_proposals/`（store/service） | 低置信度转人工复核：挂起-批准/拒绝-续跑、幂等、收件箱、进审计链 |
| 检索 | `agenticx/retrieval/`（hybrid/reranker） | 长标书定位候选段落 |
| 评测 | `agenticx/evaluation/`（evalset/llm_judge/runner） | 字段级准确率评测 |
| 前端 | `enterprise/features/` 设计体系 | 表单、表格、PDF 预览参考 |

设计参考：aiaudit 字段 Schema 与提示词设计（代码不在本仓库，按既有设计文档移植，Python 重写）。

## 3. 增量设计

### 3.1 字段 Schema 体系（`agenticx/bidding/extraction/schema/`）

```python
class ExtractedField(BaseModel):
    name: str                          # supplier.license.business_scope 等
    value: Any
    confidence: float                  # 0~1
    source: FieldSource                # 页码/段落/字符区间 → 原文穿透
    needs_review: bool                 # confidence < 0.8 自动置位

class SupplierProfile(BaseModel):      # 工商信息
    name: str; uscc: str; address: str; legal_person: str; contacts: list[Contact]

class Certificate(BaseModel):          # 资质证书
    name: str; grade: str | None; valid_until: date
    issuer: str; category: Literal["business_license","industry","iso","license"]
    verification: VerifyStatus | None  # 联网验真结果

class Performance(BaseModel):          # 业绩
    project_name: str; client: str; amount: Decimal; period: str

class CommercialTerms(BaseModel):      # 商务条款
    delivery_period: str; delivery_place: str; payment_terms: str
    warranty: str; acceptance_criteria: str

class AfterSales(BaseModel):           # 售后服务
    team: str; response_sla: str; scope: str; training: str; emergency: str
```

### 3.2 抽取链路（`agenticx/bidding/extraction/extractor.py`）

三段式，替代端到端一把梭（准确率与成本双控）：

1. **召回**：retrieval hybrid 定位候选段落（标书 2000 页不能全量进上下文）
2. **抽取**：按 Schema 分组调用 LLM（结构化输出对齐 Pydantic），每组独立 prompt + few-shot
3. **校验**：规则校验（USCC 校验位、日期合法性、金额格式）+ 置信度融合（模型 logprob/自评 + 规则结果）

### 3.3 资质验真（`agenticx/bidding/extraction/verifier.py`）

对接官方资质查询数据源（国家企业信用信息公示系统等，具体数据源 W1 与甲方确认，费用归甲方——见评估表前提 2）。查询走副作用账本（`reliability/call_ledger`）保证可对账重试；验真结论（有效/过期/吊销/等级不符）+ 查询凭证（截图/返回报文）落库留痕。

### 3.4 中英双语（`agenticx/bidding/extraction/translation.py`）

非中文内容先翻译再抽取：领域术语表（W5 前由语料工作流产出）+ 翻译提示词调优；抽取 Schema 不变，`source_lang` 字段标记原文语言。

### 3.5 签章识别（`agenticx/bidding/extraction/seal.py`）

- 公章/法人章/签字：CV 模型检测 + 定位（算法侧，基于开源检测模型微调或第三方引擎，W2 选型）
- 关键页校验：投标函、报价表、授权书三页签章缺失自动标记
- 电子签章验真：对接 CA 厂商验签接口（伪造/过期识别）

### 3.6 低置信度人工修正（`agenticx/bidding/extraction/review.py`）

复用 action_proposals：`needs_review` 字段生成审批工单 → 收件箱展示字段值 + 原文高亮 → 人工修正（批准/改写）→ 续跑下游 → 修正对（原文，修正值）写入 `optimization_samples` 表，作为后续提示词/微调样本库。

### 3.7 前端页面

- 解析结果页：字段分组展示、置信度色阶、点击字段跳原文（原文穿透，与 SP-B7 的 PDF 查看器共用组件）
- 复核收件箱：待复核字段队列、修正表单、留痕历史

## 4. 任务分解

| 任务 | 岗位 | 人天 |
|------|------|------|
| 字段 Schema + 抽取链路 + 置信度融合 + 评测接入（57 项主体） | 后端 18 / 算法 26 / 前端 9 / 测试 4 | 57 |
| 资质验真：数据源对接、留痕、有效期预警 | 后端 7 / 算法 3 / 测试 2 | 12 |
| 中英双语：翻译提示词、术语表、双语字段 | 后端 4 / 算法 6 / 前端 3 / 测试 2 | 15 |
| 签章识别：CV 检测、关键页校验、CA 验签 | 后端 4 / 算法 11 / 前端 4 / 测试 3 | 22 |
| 低置信度标记与人工修正回流（复用审批原语） | 后端 4 / 算法 3 / 前端 4 / 测试 2 | 13 |
| **合计** | 后端 37 / 算法 49 / 前端 20 / 测试 13 | **119** |

## 5. 验收标准

- 核心结构化字段（资质、★号参数）提取准确率 ≥98%（封版评测集口径）
- 置信度 <80% 字段 100% 进入人工复核队列，修正留痕完整
- 中英双语标书抽取结果一致（双语平行评测集）
- 关键页签章缺失检出率 100%（评测集内）；电子签章伪造/过期可识别
- 资质验真结论附查询凭证，可对账

## 6. 依赖与风险

- 依赖：SP-B1 artifact；W1 定资质数据源与 CA 验签厂商；W2 签章 CV 选型
- 风险：官方数据源接口配额/稳定性 → 验真结论缓存 + 失败转人工；扫描件质量差影响签章识别 → 预处理增强前置
