# SP20: ARVO 组内惩罚体系移植（MiMo-V2.6 开源吸收）

状态: 已完成（2026-09-23）
来源: XiaomiMiMo/verl @ e2b9fc0（MiMo-V2.6 "multi-harness agentic RL" 开源提交）
动机: 我们的 0/1 verifier reward 场景与 MiMo "组内打分"轴完全同构——
测例只给 0/1，需要把"过了"再分开（更短路径、更少工具错误）。

## 移植了什么

| 机制 | 源文件 | 我们的文件 | 作用位置 |
|---|---|---|---|
| adv_signed 符号守恒工具错误惩罚 | verl/trainer/ppo/signed_rebalance.py | agenticx/rl/arvo.py::signed_rebalance / apply_tool_penalty | GRPO 优势之后，改 token 优势 |
| 组内长度惩罚 | verl/utils/length_penalty.py | arvo.py::compute_group_length_penalty / grouped_length_penalty | GRPO 优势之前，改 reward |
| infra 失败分离 | arvo_penalties.py is_infra 通道 | 两个惩罚共同跳过 | 信号层 |

核心语义:
- 正样本中含工具错误的片段优势清零（停止强化）；负样本同类片段优势 ×kappa。
  按符号守恒质量: 正侧扣掉的由干净 token ×alpha 回填，负侧加上的 ×beta 扣回，
  避免整段 adv=-1 注入净负质量压平策略（MiMo 文档明确记录了这个坑）。
- 长度惩罚只罚"通过但冗长": 锚点=同组通过轨迹长度信号 p30 分位，
  三维（turns/input/output）超额取 max，凸 ramp 至 max_penalty=0.2。
- infra 轨迹不产生惩罚信号（与工程约定"infra 重试到消除"对齐）。
- 参考超参 = recipes/arvo/REFERENCE_PENALTIES.json: κ=2, scale∈[0.5,2],
  exponent=1.5, anchor p30, min_pass_rate=0.5（LengthPenaltyConfig 默认值）。

## 接入面

GRPOTrainer 新增两个默认关闭的可选参数（向后兼容，旧签名行为不变）:
- length_penalty: LengthPenaltyConfig | None —— delta 加到 reward，
  在 M4 shaping 之前（回放基线消费塑形后 reward，二者天然复合）。
- tool_penalty_kappa: float | None —— train_step_episodes 新增
  tool_error_segments（逐段工具错误标记）与 is_infra（逐 episode）。

## 验证

- tests/rl/test_arvo.py 12 个用例: 正/负侧质量守恒、clamp 边界、退化组、
  infra 豁免、死区/ramp、min_pass_rate 跳组、M4 复合、默认关闭不变。
- tests/rl + tests/trajectory 全过（212 passed）。

## 未移植（明确决策）

- verl 整体训练框架——自研核决策不变，ARVO 是纯算法层 numpy 可平移。
- MoE router 冻结——我们训 dense。
- MOPD2 多老师蒸馏——资源不匹配；概念与 SP17 对比蒸馏互补，论文引用层面处理。
- Groupwise Reward Synthesis（离线 LLM 重写奖励）——留待后续 SP 可选评估。

## 后续钩子

- tool_error_segments 信号源: harness 侧需要把工具调用错误标注进 episode
  段记录（当前接口已就绪，等 harness 供数）。
- 7k MiMo 环境扩题: 待过 task_split 守卫，与 12 道 held-out 隔离后可补充。
