# SP28 Teacher 批量补标 + 三路线 Go/No-Go 报告

> Master plan: [MASTER-PLAN.md](MASTER-PLAN.md)（核心价值 V1+V2 收口，产出路线决策）
> 前置：SP26（scorer 库 + 基线报告）、SP27（gating A/B 报告）

## 背景

SP26 回答"公开头零样本行不行"，SP27 回答"gating 有没有可测收益"。本 SP 收口：
用同一个 scorer 把 train/calib 划分补上 teacher 软标签（飞轮数据增密），然后基于
master plan 第五节的框架产出 Go/No-Go 路线报告——这是整个判断层战役的决策产出。

## 任务

### T1 批量补标（train/calib，禁 test）
- [x] `scripts/backfill_decisions.py` 增加：
  - `--exclude-test`（默认开！补标范围 = split ∈ {train, calib, ""}），
    补完断言输出文件中 test 划分 teacher 标签数为 0
  - `--scorer startlux` 配置档直通（SP26 已建）
  - `--split-filter` 可选覆盖（如只补 tool_selection）
- [x] 幂等验证：同参数重跑补 0 条（`backfill_teacher` 已有幂等语义，补 CLI 侧证明）

### T2 Go/No-Go 报告
- [x] 新建 `scripts/decision_route_report.py`：
  - 输入：SP26 基线报告 json + SP27 A/B 报告 json + 补标统计
  - 输出：`plans/decision-layer/route-decision.md`（进版本库，决策资产）
  - 内容框架：
    1. 证据汇总表（零样本 acc/ECE、gating A/B 差值、补标规模、数据积累速率）
    2. 三路线判定（A 直接部署 / B 自训 SP29+ 立项 / C 混合），按 master plan
       框架逐条对照，阈值此时用真实分布定标并写明依据
    3. 若判 B/C：给出 SP29 立项输入（数据量、缺口决策类型、基线数字）
    4. 若判兜底（数据不足）：给出采集侧调整建议（反馈 SP25 优先级）
- [x] mock 模式可全流程演练（报告生成逻辑不依赖真实 scorer）

### T3 master plan 回填
- [x] 状态表登记三个 SP 的产出与数字
- [x] 第八节核心价值终答回填（V1-V4 各配一个真实数字或明确结论）

## 做成什么样

- 补标输出：`*.labeled.jsonl`（raw 不可变），teacher_model 含量化规格，
  统计行（补标条数/题型分布/跳过原因）
- 路线报告：一页决策文档，任何后续 SP29 立项可直接引用其证据表
- master plan 状态表 + 终答完成，判断层战役闭环

## 验收

- [x] 补标幂等：重跑补 0 条；test 零渗透有断言输出
- [x] held-out 守卫：补标输入若混入考试任务决策点即抛 HeldoutViolation
      （复用 load_trainable_decisions）
- [x] 报告含明确路线建议（不允许"都行"式结论；兜底结论也必须给采集侧动作）
- [x] mock 演练：T1→T2→T3 一条链路冒烟可重跑

## 明确不做

- 不补 test 划分（基线可比性红线）
- 不在本 SP 内启动任何自训动作（SP29 立项是报告的建议产出，不是本 SP 交付物）
- 不做模型量化规格横评（Q8/Q4 差异引用官方 98.3%/100% 数字即可）
