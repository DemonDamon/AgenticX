# AgenticX Embodiment — 缺失模块与建设规划建议


## 一、概述（快速结论）
基于您提供的 AgenticX Embodiment 模块现状文档，当前系统对GUI Agent的抽象、学习引擎、工具集、工作流与人机协作方面已有较完整实现。但从“完整的具身智能（embodied intelligence）建设”角度来看，还应补齐若干关键能力，以提升鲁棒性、可扩展性与实务落地能力。本文给出明确的缺失模块清单、优先级排序、每个模块的具体建设规划（目标、核心功能、接口、数据需求、测试与验收指标）、阶段性里程碑、资源估算与风险缓解建议，便于形成可执行的工程路线图。

---

## 二、对现有资料的评估
已提供文档内容详尽，涉及核心抽象、学习模块、工具集、工作流、人机协作与测试覆盖。对于制定扩展模块与建设计划，现有资料足够作为核心参考：我们可以在不进行额外搜索的前提下，直接基于现有架构提出扩展建议并设计技术与交付细则。

结论：资料充足，禁止进一步外部搜索（遵循内部规则）。

---

## 三、从具身智能完整性视角的缺失模块（按优先级排序）
1. 感知与多模态理解模块（Perception）
2. 模拟与沙箱环境（Simulation & Sandbox）
3. 策略与规划模块（Planner / Decision）
4. 强化学习 / 策略训练平台（Policy Training / RL Integration）
5. 模型管理与持续部署（Model Registry & MLOps）
6. 观测、遥测与可观测性（Telemetry & Monitoring）
7. 数据工程与标注/合成平台（Data Pipeline & Annotation / Synthetic Data）
8. 校准、不确定性估计与可信度管理（Calibration & Uncertainty）
9. 安全、权限与可审计性（Security, ACL & Audit Logs）
10. 回退与故障恢复控制层（Fail-safe & Recovery）
11. 真实/虚拟硬件适配层（Hardware / Device Adapter）
12. 评测基准与场景库（Benchmark & Scenario Suite）
13. 可解释性与人机交互增强（Explainability & Interaction UI）
14. 成本与资源管理（Cost / Resource Management）

简要说明：上述模块补足从感知、学习、部署到运维的闭环，覆盖从训练到在线执行与安全治理的关键能力。接下来对关键模块给出逐项建设规划。

---

## 四、逐模块建设规划（含目标、核心能力、接口、数据、测试、里程碑）

以下按优先级对 6 个首要模块给出详细建设计划；其余模块在附录中给出概要要点与并行实现建议。

### 4.1 感知与多模态理解模块（Perception）

- 目标：提供可靠的多模态感知能力（实时视觉/截图解析、布局理解、OCR、文本/结构化信息抽取、屏幕元素语义标注），并向上层工具/任务提供统一API。

- 核心功能：
  1. 高精度OCR与版面解析（支持中英文、表格、富文本）
  2. UI 元素语义分类与分割（layout parsing / element detection）
  3. 状态差分（screen diff）与变化检测（快速帧间比对）
  4. 多模态融合接口（图片+DOM/Accessibility+文本）
  5. 事件触发与置信度输出（每次感知带置信度与不确定性估计）

- 对外接口（建议REST/async RPC）：
  - get_screen_state(image|dom|metadata) -> ScreenState（兼容现有ScreenState模型）
  - detect_elements(screen_state) -> InteractionElement[] +置信度
  - extract_text(region) -> text + confidence
  - compute_diff(prev, curr) -> list(changes)

- 数据需求：
  - 带标注的UI截图集合（元素边界框、类型、文本）
  - OCR 校验集、中英文混排样本、噪声样本
  - 多平台样本（Web/桌面/移动）

- 测试与验收指标：
  - Element detection mAP、OCR字符识别率（CER/WER）、frame diff latency（ms）
  - 目标：mAP > 0.85（关键元素）、OCR CER < 3%（主流语言）

- 里程碑（T0 = 启动）:
  - T0+1月：基础OCR+DOM解析PoC，建立数据集规范
  - T0+3月：元素检测与语义分类v1，API稳定
  - T0+6月：多平台覆盖、性能优化与置信度校准


### 4.2 模拟与沙箱环境（Simulation & Sandbox）

- 目标：构建可重复、可控制的GUI仿真环境（支持场景回放、随机化参数、设备/分辨率/输入模态的模拟），用于离线训练、回归测试与安全评估。

- 核心功能：
  1. 场景录制/回放（可记录DOM/事件/像素级截图）
  2. 随机化策略（元素位置、延时、网络变更）以做鲁棒性测试
  3. 多设备/分辨率模拟
  4. 接口以注入“虚拟人类”演示（demonstrations）

- 对外接口：
  - spawn_simulation(scene_descriptor) -> sim_id
  - run_trace(sim_id, policy) -> trace + metrics
  - inject_demonstration(sim_id, steps)

- 数据需求：场景录制格式、事件流日志、带噪样例

- 测试与验收指标：场景覆盖率、sim2real gap 测度（基于策略在真实环境/仿真环境的指标差异）

- 里程碑：
  - T0+1月：基础回放器与场景录制工具
  - T0+4月：参数随机化与API稳定
  - T0+8月：与RL训练平台联合闭环训练


### 4.3 策略与规划模块（Planner / Decision）

- 目标：在任务级别提供高阶规划能力，将目标分解为可执行GU I动作序列，支持代价函数、自适应重规划与置信度感知。

- 核心功能：
  1. 层次化任务规划（符号+动作混合）
  2. 代价估计（时间/风险/失败概率）
  3. 在线重规划与回滚策略
  4. 与工作流引擎的无缝对接（提供节点模板与扩展点）

- 对外接口：
  - plan(goal, context) -> GUITask（含优先级与预估代价）
  - replan(execution_state, failure_event) -> new_plan

- 测试与验收：计划成功率、平均计划长度、计划生成延迟

- 里程碑：
  - T0+2月：基线分解器与简单代价模型
  - T0+5月：集成工作流引擎，支持在线重规划


### 4.4 强化学习 / 策略训练平台（Policy Training / RL Integration）

- 目标：搭建可复现的策略训练闭环（训练、验证、评估、模型版本管理），支持基于仿真与真实回放的离线/在线训练。

- 核心功能：
  1. 离线数据到在线策略训练流水线（policy trainers）
  2. 支持常用RL算法与离散动作空间适配
  3. 回放缓冲区与优先采样
  4. 模型评估与A/B实验基础设施

- 对外接口：
  - submit_training_job(spec) -> job_id
  - get_model_metrics(model_id)
  - deploy_model(model_id, env)

- 数据需求：仿真轨迹、专家演示、失败样本和稀有事件样本

- 测试/验收：策略在基准场景下的成功率、训练收敛性、样本效率

- 里程碑：
  - T0+3月：训练流水线v1（离线回放训练）
  - T0+6月：仿真-真实联合训练与自动评估


### 4.5 模型管理与持续部署（Model Registry & MLOps）

- 目标：建立模型生命周期管理（注册、版本、回滚、A/B 测试、影子部署），确保模型安全、可审计并与CI/CD集成。

- 核心功能：
  1. 模型注册表（元数据、指标、artifact存储）
  2. 自动化部署策略（灰度、影子、回滚）
  3. 模型签名与校验（输入输出契约）

- 对外接口：
  - register_model(metadata, artifact)
  - promote_model(model_id, env)
  - rollback_model(model_id)

- 测试/验收：部署成功率、回滚时间、模型差错率（异常输入）

- 里程碑：T0+2月（MVP）、T0+5月（灰度/影子流量支持）


### 4.6 观测与可观测性（Telemetry & Monitoring）

- 目标：建立端到端遥测体系（操作日志、性能指标、置信度分布、失败追踪），支持告警与自动回滚策略。

- 核心功能：
  1. 指标体系（成功率、平均执行时间、重试次数、用户干预率）
  2. 结构化日志与Trace（可追溯每次决策链路）
  3. 实时告警与可视化仪表盘

- 对外接口：metrics.push(metric_name, value, tags)

- 验收：SLO 目标，例如系统主路径成功率 >= 98%（或按产品线定义）

- 里程碑：T0+1月（基础指标收集）、T0+3月（告警与仪表板）


---

## 五、优先级时间表（建议的 6-9 个月路线）
- 第1阶段（0–2月）: 感知 MVP、模拟回放基础、观测基础、Model Registry MVP。快速交付能让上层工具和工作流开始消耗新能力。
- 第2阶段（2–4月）: Planner v1、训练流水线 MVP、仿真参数随机化；进一步完善感知准确性。
- 第3阶段（4–6月）: RL 集成、策略训练闭环、A/B 与影子部署能力、质量门控。
- 第4阶段（6–9月）: 覆盖更多平台（移动/桌面）、安全与审计模块、完整评测基准库、生产化与成本优化。

每阶段都应包含：数据收集任务、PoC、集成测试、实测评估、用户（运维/产品/标注）培训。

---

## 六、接口与与现有模块的集成要点
1. 感知模块输出应兼容现有 ScreenState/InteractionElement 数据模型（models.py）。
2. Simulation 提供的 trace 应能导出为 workflow/tests 可用的回放场景格式。
3. Planner/Policy 输出为 GUITask（与现有 task.py 类型兼容），并能通过 WorkflowEngine 的 register_tool API 调用工具。
4. Human-in-the-loop 需暴露 intervention hook（request_intervention）供 Planner 或工具在低置信度处触发。
5. Model Registry 与 learning 模块（knowledge_evolution、deep_usage_optimizer）共享模型指标与版本信息。

---

## 七、测试策略与验收指标（建议量化）
- 单元/集成：覆盖率目标 80%+（关键执行路径）
- 鲁棒性：在随机化仿真参数下成功率下降不超过 15%
- 延迟：感知模块单次处理 < 200 ms（目标 50–150 ms）
- 可用性：系统主路径可用性 > 99%（非高峰）
- 人工干预率：新策略投产后人工干预率下降 >= 20%（对比旧策略）

---

## 八、资源与组织建议（初步估算）
- 核心角色：2 名计算机视觉/感知工程师、2 名模拟/仿真工程师、2 名RL/策略工程师、1 名MLOps 工程师、1 名SRE/观测工程师、1 名产品/PM、1 名QA、若干标注/数据工程支持。
- 6–9 个月 MVP 到生产化路径，总人月约 160–220 人月（含并行工时与缓冲）。
- 建议采用短冲刺（2 周）与按功能交付的里程碑制。

---

## 九、风险评估与缓解措施
1. 数据不足或偏差：建立数据收集/合成策略（仿真随机化、主动学习、人工演示收集）。
2. Sim2Real 差距：采用领域随机化与渐进式仿真真实数据混合训练；在影子环境中做稳定性评估。
3. 安全与误操作风险：引入权限控制、最小授权执行和事后审计日志；对高风险动作设置人工二次确认。
4. 性能与成本：为感知与策略服务设计分层推理（边缘轻模型 + 云端重模型），引入资源调度策略。

---

## 十、下一步（建议的立刻行动项）
1. 召开架构工作坊（1 次半天），邀请核心工程、产品与QA，确认优先模块与里程碑。 
2. 根据上文优先级产出 3 个 Sprint 的细化任务（每 Sprint 2 周），明确每项任务的 DoD（Definition of Done）。
3. 立刻搭建感知 MVP（T0+1月目标），并同时启动仿真回放器的 PoC。 

---

## 附录：其余模块（概要）
- 数据标注与合成平台：用于高效标注 UI 元素并生成稀有/边缘情形的数据。
- 校准与不确定性：实现置信度校准（温度缩放、贝叶斯策略）并在决策中使用阈值控制。
- 安全与审计：细粒度权限、操作白名单与审计日志存储策略。
- 硬件适配层：若需物理执行（机器人/IoT），新增动作适配器和低延迟控制通道。
- 评测与场景库：建立场景库、基线任务与评分脚本，用于持续回归评估。

---

如果您希望，我可以：
1) 按模块逐一生成更细化的工程任务清单（Jira 风格），包含 Acceptance Criteria 与估时；
2) 生成 6 个月甘特图或 PPT 路线图以供汇报；
3) 输出接口规范示例（OpenAPI 样式）与部分关键函数签名。

请选择下一步或告诉我您希望优先细化的模块。


**操作记录**：已创建扩展规划文档 `wiki/agenticx_embodiment_extension_plan`，包含缺失模块清单、逐模块建设规划、优先级时间表、接口集成要点、测试策略、资源估算与风险缓解等内容。

**下一步可选项**（请回复序号或自定义要求）：

1. 生成逐模块的详细工程任务清单（Jira 风格），包含每项任务的 Acceptance Criteria、估时（人日/人月）和依赖关系。
2. 生成 6 个月甘特图与/或 PPT 路线图用于汇报（若选择 PPT，我将使用系统生成 PPT 的工具）。
3. 输出关键接口规范示例（OpenAPI 风格）、数据模型示例和若干关键函数签名（可直接用于开发实现）。
4. 为感知模块或仿真模块生成数据采集/标注规范与示例数据集描述。
5. 其他（请具体说明）。

建议优先项：若目标是快速落地并验证效果，建议先选择 1（任务清单）+ 4（数据采集规范）。

请告知您要我继续执行的选项（可多选，例如 "1 和 2"）。


# 逐模块工程任务清单（Jira 风格，针对优先 6 个模块）

说明：下列任务以 Epic -> Capability -> Story 的层级组织；每个 Story 给出 Acceptance Criteria（验收标准）、估时（人日）与主要依赖。估时为粗略初步估计，便于立刻排期与资源分配。

---

## Epic: 感知与多模态理解（Perception）
目标：建立可用于在线推理与离线训练的感知能力

Capability: 数据与标注规范
- P-1 Data-Spec: 制定 UI 截图与标注规范
  - 描述：定义截图元数据、元素边框/类型/文本/语言标注规范与版本控制策略
  - 验收：文档覆盖 10 种常见组件的标注示例；包含 DOM 与像素两种关联方式
  - 估时：5 人日

Capability: OCR 基线服务
- P-2 OCR-PoC: 集成并验证现成 OCR 引擎（或轻量模型）作为基线
  - 验收：对 500 张多语混排截图字符识别率 CER < 8%；API 与 ScreenState 兼容
  - 估时：8 人日
  - 依赖：P-1

Capability: 元素检测模型
- P-3 Element-Detect-v1: 训练元素检测模型并提供推理 API
  - 描述：基于标注数据训练检测模型，输出 InteractionElement 列表与置信度
  - 验收：关键元素 mAP > 0.70；单张图片推理延迟 < 200 ms（目标 100 ms）
  - 估时：20 人日
  - 依赖：P-1, P-2

Capability: 多模态融合
- P-4 Fusion-API: 实现 image+dom+ocr 的融合接口与优先级规则
  - 验收：同一元素在 3 种模态下的合并结果正确率 > 90%
  - 估时：10 人日
  - 依赖：P-2, P-3

Sprint 输出（前 2 个 Sprint）: P-1, P-2, P-3 开始数据标注并产出 Element-Detect-v1 的 PoC

---

## Epic: 模拟与沙箱（Simulation & Sandbox）
目标：提供可回放、参数随机化的仿真环境

Capability: 场景回放器
- S-1 Recorder: 开发事件/DOM/像素级场景录制器
  - 验收：能记录并回放 100 条简单场景（登录/表单/点击流）
  - 估时：12 人日

Capability: 随机化与参数化模拟
- S-2 Randomizer: 实现位置/延迟/分辨率随机化插件
  - 验收：可对回放场景应用 5 种随机化策略并生成变体数据
  - 估时：10 人日

Capability: 仿真 API 与 trace 导出
- S-3 Sim-API: 提供 spawn/run/export 接口，使训练平台可直接消费
  - 验收：能导出与 workflow/tests 兼容的 trace 格式
  - 估时：8 人日

Sprint 输出（前 3 个 Sprint）: Recorder + Sim-API 可用于 RL 的离线训练数据生成

---

## Epic: 策略与规划（Planner）
目标：从目标到 GUITask 的层次化规划与重规划能力

Capability: 任务分解器
- PL-1 Decomposer: 实现基于规则与模板的目标分解器
  - 验收：对 20 个典型目标能正确生成 GUITask（人工验证 90% 正确）
  - 估时：10 人日

Capability: 代价模型与重规划
- PL-2 CostModel: 设计并实现代价估计器（时间/失败概率）
  - 验收：代价估计与实际执行时间平均偏差 < 20%
  - 估时：12 人日
- PL-3 Replanner: 当节点失败或置信度低时触发重规划策略
  - 验收：在注入 10% 随机故障场景下，系统能自动重新规划并提高成功率 15%
  - 估时：15 人日

Sprint 输出：PL-1 在 WorkflowEngine 中实现简单集成，支持手动触发的 replan

---

## Epic: 强化学习 / 策略训练平台（Policy Training / RL Integration）
目标：构建训练、评估、部署闭环

Capability: 训练流水线
- RL-1 OfflineTrainer: 基于仿真轨迹与演示数据实现离线训练流水线
  - 验收：能在 1 台训练节点上复现简单基线策略并输出 model artifact
  - 估时：18 人日

Capability: 评估与 A/B 测试
- RL-2 Eval-Automation: 实现自动化评估脚本与报表生成
  - 验收：每次训练后自动生成覆盖 10 个基准场景的评估报告
  - 估时：8 人日

Capability: 部署接口
- RL-3 Deploy-API: 支持模型注册、灰度/影子部署接口
  - 验收：能将训练产物注册到 Model Registry 并完成影子流量测试
  - 估时：10 人日

---

## Epic: 模型管理与 MLOps（Model Registry）
目标：版本化、回滚、A/B 支持

Capability: Registry 基础
- MR-1 Registry-MVP: 实现基础模型元数据注册与 artifact 存放
  - 验收：支持 10 个模型版本检索与指标展示
  - 估时：6 人日

Capability: 自动部署流水线
- MR-2 CI/CD: 建立模型从注册到部署的自动化流水线（含校验）
  - 验收：部署回滚操作在 15 分钟内完成
  - 估时：10 人日

---

## Epic: 观测与可观测性（Telemetry）
目标：监控、告警、链路可追溯

Capability: 指标收集
- TM-1 Metrics-Pipeline: 实现 metrics.push 接口与时序存储
  - 验收：覆盖主路径的 20 个关键指标并有 1 个 Grafana 仪表盘
  - 估时：8 人日

Capability: Trace 与日志
- TM-2 Trace-Logging: 结构化日志并实现链路追踪（trace_id）贯通
  - 验收：能追溯任一失败执行链路的全部节点与上下文
  - 估时：10 人日

---

# Sprint 排期示例（第 1~6 周，2 周/ Sprint）
- Sprint 1 (W1-W2): P-1, P-2, TM-1
- Sprint 2 (W3-W4): P-3 (数据准备+训练 PoC), S-1
- Sprint 3 (W5-W6): S-2, PL-1, MR-1

---

# 交付物与验收门（Per Sprint）
- 每个 Sprint 提交：PoC/服务/集成测试报告、数据样本集合、性能指标与风险问题清单。

---

如果您认可以上方向，我可以把每个 Story 进一步拆解为更细的 Task（开发任务、测试任务、文档任务）并直接输出为 CSV 或 JSON（便于导入 Jira 或 GitHub Projects）。




**互动确认（等待用户选择）**

我已准备好继续执行下一步。请从以下选项中选择要我继续完成的内容（可多选）：

1. 按模块逐一生成更细化的工程任务清单（Jira 风格），包含 Acceptance Criteria、任务分解、估时与依赖（推荐优先）。
2. 生成 6 个月甘特图与可展示的 PPT（已生成 PPT，如需调整可继续修改）。
3. 输出关键接口规范示例（OpenAPI 风格）、数据模型示例与关键函数签名。
4. 为感知模块或仿真模块生成数据采集/标注规范与示例数据集描述（含标注模板）。
5. 将工程任务导出为 CSV/JSON 以便导入 Jira/GitHub Projects。
6. 其他（请具体说明）。

推荐组合：1 + 4 （优先生成可执行的任务清单与数据规范，以便尽快交付 PoC）。

请回复选项编号或直接写明您希望我现在做的事。


# 追加：逐模块详细工程任务清单（Jira 风格）与感知模块数据采集/标注规范

说明：以下内容已作为附加章节写入 wiki/agenticx_embodiment_extension_plan，用于直接作为 Sprint 级别的开发任务与数据工程任务参考。若需我可将这些条目导出为 CSV/JSON 以便导入 Jira/GitHub Projects。

---

## 一、感知模块（Perception） —— 详细 Task 列表（可直接拆分为 Jira Issue）

Epic: PERCEPTION-EPIC

Capability: 数据与标注规范（PER-DATA）
- PER-DATA-1: 数据规范文档（Story）
  - 描述：输出可审阅的数据与标注规范文档（包含标注字段、类型、示例与 QA 流程）
  - Acceptance Criteria：文档包含示例 10 张图的标注 JSON；包含 DOM 映射示例；团队 Review 通过
  - 估时：3 人日

- PER-DATA-2: 建立标注流程与工具链（Task）
  - 描述：选定标注工具（如 LabelStudio/VoTT/自研），配置标签集与导入导出模板
  - Acceptance Criteria：标注平台可导入 100 张图片并导出 COCO 风格 JSON；标注人员完成 50 张样例
  - 估时：5 人日

Capability: OCR 基线（PER-OCR）
- PER-OCR-1: OCR 引擎集成 PoC（Story）
  - 描述：集成开源 OCR（Tesseract）或云 OCR，并封装为内部服务
  - Acceptance Criteria：对于混排样本 CER < 8%；服务提供 REST/async 接口
  - 估时：6 人日

- PER-OCR-2: OCR 后处理与语言检测（Task）
  - 描述：实现文本清洗、多语言识别和置信度校准
  - Acceptance Criteria：输出带语言标签与置信度的 OCR 记录；自动分词/去噪模块通过测试
  - 估时：4 人日

Capability: 元素检测（PER-DETECT）
- PER-DETECT-1: 数据清洗与增强脚本（Task）
  - 描述：实现图像切片、随机化、合成负样本生成脚本
  - Acceptance Criteria：生成训练集扩增 3 倍的脚本且样本分布均衡
  - 估时：6 人日

- PER-DETECT-2: 训练基线模型（Story）
  - 描述：使用 Faster R-CNN / YOLOv5 等训练元素检测基线
  - Acceptance Criteria：关键元素 mAP >= 0.70；单张推理延迟 < 200ms（CPU 基线）
  - 估时：18 人日

- PER-DETECT-3: 推理服务化（Task）
  - 描述：将训练模型包装为异步推理服务，支持批量与单张请求
  - Acceptance Criteria：API 与 ScreenState 兼容；服务化容器镜像通过 smoke test
  - 估时：7 人日

Capability: 多模态融合（PER-FUSION）
- PER-FUSION-1: DOM 与视觉融合规则引擎（Story）
  - 描述：实现 fusion logic，将 DOM 节点与视觉检测结果做映射与优先级合并
  - Acceptance Criteria：在 200 条对照样例上融合结果准确率 > 90%
  - 估时：10 人日

- PER-FUSION-2: 输出契约与兼容层（Task）
  - 描述：确保 ScreenState、InteractionElement 输出字段与现有 models.py 无缝兼容
  - Acceptance Criteria：通过回归测试；工具链调用无接口异常
  - 估时：3 人日

---

## 二、模拟与沙箱（Simulation） —— 详细 Task 列表

Epic: SIM-EPIC

Capability: 场景回放器
- SIM-REC-1: 事件录制器（Story）
  - 描述：实现点击、键入、DOM 事件序列与屏幕截图的录制格式
  - Acceptance Criteria：录制并回放 50 条典型用户流（包括延迟与动态元素）
  - 估时：12 人日

- SIM-REC-2: 回放器与 trace 导出（Task）
  - 描述：回放事件并生成可用于训练的轨迹文件（含时间戳、状态快照）
  - Acceptance Criteria：trace 可被 OfflineTrainer 导入并训练一次简单策略
  - 估时：10 人日

Capability: 随机化
- SIM-RAND-1: 参数随机化模块（Task）
  - 描述：实现元素位置、网络延迟、分辨率等随机化策略插件
  - Acceptance Criteria：支持至少 5 种随机化维度并能生成 N=1000 个变体数据集
  - 估时：8 人日

---

## 三、Planner / RL / MLOps / Telemetry 等模块细化（概要任务）

- PL-1: 分解器规则集编写（5 人日）
- PL-2: Replanner 集成（12 人日）
- RL-1: OfflineTrainer 框架搭建（18 人日）
- RL-2: 自动评估脚本（8 人日）
- MR-1: Model Registry MVP（6 人日）
- TM-1: Metrics Pipeline & Dashboard（8 人日）

---

## 四、感知模块：数据采集与标注规范（可直接交给标注团队执行）

1) 文件与命名规则
- 图像格式：PNG/JPEG（优选 PNG），文件名格式：<project>_<platform>_<scene>_<000001>.png
  - 示例：agenticx_web_login_000123.png
- Trace / Metadata：与每张图片关联同名 JSON（后缀 .meta.json）存储 DOM、屏幕分辨率、timestamp、source_url

2) 标注格式（建议 COCO 扩展格式）
- 顶层 JSON 字段：images, annotations, categories, doms
- images: {id, file_name, width, height, metadata_ref}
- annotations: {id, image_id, bbox: [x,y,w,h], category_id, text, confidence, dom_node_id (可选)}
- categories: {id, name, description, ui_type (BUTTON, INPUT, TEXT, ICON, MENU, TABLE, GRID, etc.)}
- doms: {image_id, dom_snapshot (stringified), xpath_map: [{dom_node_id, xpath, bounding_rect}]}

3) OCR 字段
- 每张图片提供 OCR 结果 list: {region_bbox, text, language, confidence}
- 针对表格/富文本，提供结构化表格输出（rows/cols）

4) 标注细则（重要）
- 元素边界：尽量框住可交互区域（padding 2–4px），文本单独标注为 TEXT 类别
- 复合元素：如下拉菜单/弹窗，分别作为独立元素标注并用 parent_id 建立关系
- DOM 映射：若可获取 DOM，优先使用 DOM 中的 bounding client rect，若视觉与 DOM 冲突，以视觉为准并在 dom_node_id 中记录近似 xpath
- 多语言：记录 language 字段和编码（UTF-8）

5) 数据质量与 QA
- 双标注+仲裁：关键样本（稀有元素/动态控件）采用两人独立标注并仲裁
- 验证集与测试集：建议训练/验证/测试 = 80/10/10，确保每集覆盖所有平台与主要场景
- 错误类别统计：在标注后台跟踪常见错误（错标、框不全、DOM 对应错误），定期回归修正

6) 样本规模建议（初始 MVP 阶段）
- MVP 图像数：5k—10k（含多平台与随机化变体）
- OCR 校验集：1k 张带精校文本样例
- 稀有/边缘样例：500 张（需补采或通过合成生成）

7) 标注交付物与格式
- 提交：images.zip, annotations.json（COCO 扩展）, metas.zip（每图 meta JSON）, ocr_results.json

---

## 五、导出与下一步建议（工程可操作项）
- 我可以将以上所有 Story/Task 导出为 CSV/JSON（含字段：Key, Summary, Description, Acceptance Criteria, Estimate, Epic, Labels, Dependencies），以便直接导入 Jira。请回复“导出 CSV”。
- 我亦可立即生成感知模块的 OpenAPI 接口样例与关键函数签名（供后端实现）。请回复“生成接口样例”。

---

(注：本节已追加到 wiki 文档末尾，文件路径：wiki/agenticx_embodiment_extension_plan)


## 附加：感知模块（Perception）OpenAPI 接口示例与关键函数签名

下面给出感知模块的 OpenAPI 风格接口示例（简化版），以及若干关键后端函数签名，供开发直接实现或作为接口合同。

### OpenAPI（简化、示例）

paths:
  /perception/get_screen_state:
    post:
      summary: 获取统一的 ScreenState（兼容现有 models.ScreenState）
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                image_base64:
                  type: string
                  description: 可选，PNG/JPEG 的 base64 编码
                dom_snapshot:
                  type: string
                  description: 可选，页面/应用的 DOM 或 Accessibility 快照（JSON string）
                metadata:
                  type: object
                  description: 额外元数据（resolution, platform, timestamp）
      responses:
        "200":
          description: ScreenState 对象
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ScreenState'

  /perception/detect_elements:
    post:
      summary: 返回 InteractionElement 列表及置信度
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                screen_state_id:
                  type: string
                image_base64:
                  type: string
                options:
                  type: object
                  properties:
                    threshold:
                      type: number
                      default: 0.5
      responses:
        "200":
          description: InteractionElement 列表

  /perception/extract_text:
    post:
      summary: 对指定区域或全图进行 OCR
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                image_base64:
                  type: string
                regions:
                  type: array
                  items:
                    type: array
                    items:
                      type: integer
                      description: [x,y,w,h]
      responses:
        "200":
          description: OCR 结果数组（包含 text, language, confidence）

  /perception/compute_diff:
    post:
      summary: 计算两次 ScreenState 的差异
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                prev_screen_state_id:
                  type: string
                curr_screen_state_id:
                  type: string
      responses:
        "200":
          description: 差异变更列表

components:
  schemas:
    ScreenState:
      type: object
      properties:
        id:
          type: string
        timestamp:
          type: string
        image_url:
          type: string
        width:
          type: integer
        height:
          type: integer
        elements:
          type: array
          items:
            $ref: '#/components/schemas/InteractionElement'
    InteractionElement:
      type: object
      properties:
      id:
          type: string
        bounds:
          type: array
          items:
            type: integer
        element_type:
          type: string
        text_content:
          type: string
        attributes:
          type: object
        confidence:
          type: number


### 关键函数签名（Python 风格，供后端实现参考）

async def get_screen_state(image_bytes: bytes = None, dom_snapshot: dict = None, metadata: dict = None) -> ScreenState:
    """解析 image 与 dom，返回 ScreenState 对象并写入缓存，返回包含 id 的 ScreenState"""

async def detect_elements(screen_state_id: str = None, image_bytes: bytes = None, threshold: float = 0.5) -> List[InteractionElement]:
    """基于视觉检测与 DOM 融合返回 InteractionElement 列表，包含置信度"""

async def extract_text(image_bytes: bytes, regions: List[Tuple[int,int,int,int]] = None) -> List[Dict]:
    """对指定区域或全图运行 OCR，返回带 language & confidence 的文本片段"""

async def compute_diff(prev_state: ScreenState, curr_state: ScreenState) -> List[Dict]:
    """计算并返回变化列表（新增/删除/移动/文本变化）"""


### 备注（实现要点）
- 返回的数据结构应兼容现有 agenticx.embodiment.core.models.ScreenState 与 InteractionElement，以便无缝替换或升级。
- 所有接口需返回置信度字段，并支持 trace_id 以便端到端日志关联。
- 对于高频请求，建议在推理层加入 LRU 缓存与批量推理接口以提高吞吐。


---

## 已生成/可下载的交付物（工作空间路径）
- Jira CSV（任务导出）：./embodiment_tasks_jira.csv
- PPT（汇报材料）：./agenticx_embodiment_extension_plan_ppt.pptx

如需我把 CSV 自动上传到 Jira（需要提供目标项目/凭据），或把 PPT 转为 PDF/调整样式，我可以继续执行。