# TeamBench 论文准备清单与执行计划

> 更新日期：2026-08-20
> 状态：立项准备期

---

## 一、选题确认

**论文题目（暂定）**
《TeamBench: Benchmarking Human-Agent Teams Beyond Individual Task Success》
（中文工作名：TeamBench——从个体任务成功率到团队产出的人机混合团队评测基准）

**核心主张（一句话卖点）**
现有 Agent 基准全部止步于"单智能体任务成功率"，没有任何基准测量"团队级产出"——TeamBench 填补这一空白，并首次系统揭示"个体最优、团队次优"（individual-optimal, team-suboptimal）现象。

**目标 Venue（按优先级）**
1. NeurIPS 2027 Datasets & Benchmarks Track（CCF-A，首选，预计 2027 年 5 月截稿，约 9 个月准备期）
2. ICLR 2027（备选，2026 年 9 月底截稿——时间过紧，仅当进度超预期时考虑）
3. ACL/EMNLP 2027（备选，适合偏向语言侧的框架横评故事）

**为什么是它**
- D&B track 评审标准相对客观（任务真实性、评测方法学、可复用性），不依赖审稿品味
- "所有基准都在测个体，没人测团队"是 D&B 审稿人爱听的范式缺口故事
- 公司真实办公场景数据是学界没有的护城河
- 与命题A（组织仿真）共享同一套任务资产，一次投入两篇产出
- 预估收录概率 40-50%（执行到位前提下）

**三大差异化护城河（必须守住）**
1. 团队级指标：能力转化率（个体→团队的产出损耗）为首创，对标 Woolley 集体智能因子但用于人机混合团队
2. 过程感知：不只判结果，测量协调开销（通信轮次、Token、等待）与协议合规度
3. 对抗污染：任务由参数化模板动态生成，而非固定静态题库

---

## 二、材料准备清单

### 2.1 文献调研（Phase 0-1 完成）
- [ ] 精读竞品基准：TheAgentCompany（CMU）、OSWorld 2.0、AgentBench、GAIA、SWE-bench——各自任务形态、评测方法、指标定义，明确"全部是单 Agent 视角"的证据链
- [ ] 精读团队科学理论：Woolley et al. 2010（集体智能因子）、协调成本理论（coordination cost / Brooks 定律）、组织规模与产出研究
- [ ] 横评对象框架调研：LangGraph、CrewAI、AutoGen、MetaGPT、OpenAI Agents SDK 的多 Agent 协作机制（作为实验基线）
- [ ] 多智能体 LLM 协作已有评测工作（如 MultiAgentBench 等），确认无团队级产出测量先例
- [ ] 整理 related work 矩阵表（基准 × 维度：任务数 / 单-多Agent / 指标层级 / 污染防护 / 过程感知）

### 2.2 任务套件设计（核心资产，Phase 1-2 完成）
- [ ] 定义任务分类学：三维正交——团队规模（2/4/8 Agent）、任务耦合度（独立/依赖/对抗）、办公任务类型（文档协作/数据分析/项目跟进/跨应用工作流）
- [ ] 设计 50-100 个团队级办公任务种子（每个任务必须"单 Agent 无法独立完成或明显低效"）
- [ ] 每个任务定义：角色分工卡、共享工作区初始态、交付物验收标准（artifact-based）、个体基线版本（同一任务的单人退化形态，用于计算能力转化率）
- [ ] 参数化任务生成模板（改变数值/实体/约束即可批量生成变体，抗污染）
- [ ] 任务难度校准：人工试做 10% 任务，记录人类基线时间与产出

### 2.3 指标体系（Phase 1 完成）
- [ ] 能力转化率（Capability Transfer Rate）：团队产出 / 个体产出加和，形式化定义与计算公式
- [ ] 协调开销（Coordination Overhead）：通信轮次、Token 消耗、消息冗余率、等待空闲比
- [ ] 协议合规度（Protocol Compliance）：角色越权率、任务认领冲突率、结果合并冲突数
- [ ] 团队任务成功率（以最终 artifact 状态核验，不用截图/LLM-judge 作为主判据）
- [ ] 指标有效性验证：与人工评分的相关性（子集标注）

### 2.4 评测基础设施（Phase 2 完成，基于本仓库 AgenticX）
- [ ] 基于 agenticx/core（workflow、agent_executor、event_bus）搭建多 Agent 团队执行环境
- [ ] 基于 agenticx/evaluation（evalset、runner）扩展团队级评测 runner
- [ ] artifact 核验器：对文档/表格/项目看板等交付物做状态断言
- [ ] 轨迹记录：复用 observability 的 RuntimeEvent 流，落盘全部通信与工具调用
- [ ] 统计分析脚本：能力转化率计算、scaling 曲线、显著性检验
- [ ] 对照组运行器：同一任务的"个体模式"（无通信）自动执行

### 2.5 实验数据（Phase 3 完成）
- [ ] 基线横评：4-5 个主流多 Agent 框架 × 全任务集 × 3 seeds
- [ ] 消融实验 A：团队规模 scaling（2→4→8，观察转化率衰减曲线）
- [ ] 消融实验 B：任务耦合度（独立→依赖→对抗）
- [ ] 消融实验 C：协议机制（有无共享态/冲突消解，若框架支持开关）
- [ ] 人工验证子集：≥10% 任务人工双盲评分，报告与自动指标一致性
- [ ] 公司真实团队数据对照（若可获得）：真实办公团队的转化率分布，用于校准基准现实性

### 2.6 写作与发布（Phase 4-5 完成）
- [ ] NeurIPS 官方 LaTeX 模板（D&B track）
- [ ] 核心图表 5 张：任务分类学图、能力转化率 scaling 曲线（主图）、框架横评雷达图、协调开销-产出散点、任务示例展示
- [ ] 数据集公开包（任务 JSON + 生成模板 + 核验器 + 轨迹样例）
- [ ] 开源评测代码仓库
- [ ]（加分项）Leaderboard 提交页面
- [ ]（占坑策略）Phase 3 结束后先挂 arXiv 预印本

---

## 三、详细执行计划（ToDo）

### Phase 0：立项与快速验证（第 1-2 周，2026-08-20 ~ 09-03）
- [ ] W1：精读 TheAgentCompany 与 OSWorld 2.0 两篇论文，输出差异化分析备忘
- [ ] W1：跑通 AgenticX 多 Agent 协作 demo（参考 docs/guides/multi-agent.md 的 AgentTeamManager）
- [ ] W2：手工设计 3 个种子任务（如：多人协作出周报、跨表格数据核对、项目进度同步），小规模试跑
- [ ] W2：**决策点**——试跑中能否观察到"个体最优、团队次优"现象（团队通信开销拖垮产出）？
      - 能 → 继续 Phase 1
      - 不能 → 调整任务耦合度设计后再试；两轮仍失败则回退到命题A（组织仿真路线）

### Phase 1：任务分类学与指标定义（第 3-6 周，09-04 ~ 10-01）
- [ ] W3：完成任务分类学（三维正交设计），评审定稿
- [ ] W3-4：形式化定义能力转化率、协调开销、协议合规度（数学定义 + 计算伪代码）
- [ ] W4：完成 10 个任务的全要素设计（分工卡/初始态/验收标准/个体基线版）
- [ ] W5：完成 related work 矩阵表，确认无撞车（重点检索 "team benchmark LLM"、"collective intelligence agent"、"multi-agent evaluation"）
- [ ] W6：10 任务试跑 + 指标计算闭环，输出第一版数据表
- [ ] W6：**里程碑 M1**——指标可计算、现象可复现，冻结 v0.1 指标定义

### Phase 2：任务建设与基础设施（第 7-14 周，10-02 ~ 11-26）
- [ ] W7-10：扩展到 50 个任务（每周 10-12 个，含参数化模板）
- [ ] W7-10（并行）：评测 runner 开发（团队执行 + 个体对照 + artifact 核验 + 轨迹落盘）
- [ ] W11-12：任务质量抽检（10% 人工试做）+ 模板参数爆炸测试（每个模板 ≥20 变体生成无错）
- [ ] W13-14：5 个基线框架适配层开发（LangGraph / CrewAI / AutoGen / MetaGPT / AgenticX）
- [ ] W14：**里程碑 M2**——全量任务 + 全基线跑通端到端流水线，冻结 v1.0 任务集

### Phase 3：主实验（第 15-22 周，11-27 ~ 2027-01-21）
- [ ] W15-17：主横评实验（5 框架 × 50 任务 × 3 seeds ≈ 750 runs，预留失败重跑）
- [ ] W18-19：三个消融实验
- [ ] W20：人工验证子集标注（双盲，≥2 标注者）
- [ ] W21：统计分析 + 作图，确认核心结论成立
- [ ] W22：**里程碑 M3**——主结果表冻结；挂 arXiv 预印本占坑
- [ ] W22：**决策点**——若转化率衰减曲线不显著，叙事转向"框架间协调开销差异"（数据必然支持）

### Phase 4：论文写作（第 23-26 周，01-22 ~ 02-18）
- [ ] W23：论文骨架（Introduction / Related Work / Task Suite / Metrics / Experiments / Analysis / Discussion）
- [ ] W23：先写 Experiments 与 Task Suite（数据在手最易写）
- [ ] W24：写 Metrics 与 Introduction（卖点段："所有基准测个体，我们测团队"）
- [ ] W25：写 Related Work / Analysis / Discussion，完成 5 张主图
- [ ] W26：全文合稿，内部评审第一轮（找 2-3 位同事模拟审稿）

### Phase 5：打磨与提交（第 27-30 周，02-19 ~ 03-18）
- [ ] W27：按内部评审意见修改；补做审稿人可预见的追问实验
- [ ] W28：数据集开源包与代码仓库整理（README、复现脚本、许可证）
- [ ] W29：写作打磨（术语一致性、图表规范、附录补充）
- [ ] W30：终稿内审 + 提交准备
- [ ] W30+：等待 NeurIPS 2027 D&B 正式截稿通知（约 2027 年 5 月），期间可投递 workshop 练手

---

## 四、风险与预案

| 风险 | 概率 | 预案 |
|---|---|---|
| 数据/任务集需公开，公司不允许 | 中 | 提前与领导确认数据边界；任务可脱敏为合成办公场景，模板与核验器开源同样满足 D&B 要求 |
| "个体最优、团队次优"现象不显著 | 中 | 叙事转框架间协调开销差异；或提高任务耦合度设计 |
| 与已有工作撞车（如 MultiAgentBench 扩展团队指标） | 低-中 | Phase 1 的 W5 检索确认；arXiv 占坑要早（不晚于 W22） |
| 多框架适配层工作量超预期 | 中 | 基线从 5 个砍到 3 个（LangGraph / AutoGen / AgenticX） |
| LLM API 成本超预算 | 中 | 主实验用中档模型；消融用小模型；预留 20% 预算余量 |

---

## 五、分工建议（待与领导确认）

- 选题负责人 1 名（统筹 + 指标形式化 + Introduction 写作）
- 任务设计 1-2 名（办公场景任务设计与人工校准）
- 工程 1-2 名（评测 runner + 基线适配，基于 AgenticX 现有 evaluation/observability 模块）
- 实验与分析 1 名（跑实验 + 统计 + 作图）
- 挂名参与者：按贡献分配（任务设计/工程/实验/写作各占权重，投稿前定稿作者顺序）

---

## 六、本仓库可复用的模块速查

| 需求 | 复用模块 | 位置 |
|---|---|---|
| 多 Agent 团队执行 | AgentTeamManager / Meta-Agent 模式 | docs/guides/multi-agent.md, agenticx/agents/ |
| 工作流编排 | workflow / graph | agenticx/core/workflow.py, graph.py |
| 评测框架 | evalset / runner | agenticx/evaluation/ |
| 轨迹与事件流 | RuntimeEvent / event_bus | agenticx/core/event.py, event_bus.py |
| 工具与环境 | MCPHub / sandbox | agenticx/tools/mcp_hub.py, agenticx/sandbox/ |
| 现有基准经验 | GAIA benchmark | scripts/run_gaia_benchmark.py, tests/test_gaia_*.py |
