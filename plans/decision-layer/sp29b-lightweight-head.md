# SP29b：轻量决策头训练器 + trained scorer + 三路标签对照

## 背景

continue_stop 的 state 是 step-features-v1——7 维 StepFeatures +
3 维 AttemptContext 的确定性文本渲染（decision_policy.py L26-38）。
**表达力匹配的模型是轻量分类器，不是 LM**（master plan 不做清单第 1 条）。
framing：p(pass | step-features) 成功概率预测器，p_abort = 1 - p(pass)，
credit assignment 噪声由概率化天然吸收。

三路标签对照是本 SP 的核心实验（SP29a 数据消费）：
- **头 A（teacher 蒸馏）**：soft target = teacher probs，上限 = teacher
  （SP27 已证惰性+高置信误杀）——预期复现惰性，作为"拟合老师"的对照
- **头 B（execution 真值）**：hard target = attempt 终局 passed——
  核心假设："执行真值 > 老师观点"（SP25 标签优先级设计的第一次实证）
- **头 C（混合）**：CE(execution) + λ·KL(teacher)，λ=0.5 起步
  （teacher 软标签作正则，防小样本过拟合）

## 交付

1. `agenticx/rl/decision_head.py`：
   - `parse_step_state(state: str) -> dict[str, float]`：render_step_state
     的确定性逆（版本绑定 step-features-v1，格式变更即抛错）
   - `FEATURE_NAMES` 有序特征表（10 维：step/n_messages/n_tool_calls/
     tool_success_rate(-1→0.5 缺失值)/consecutive_failures/
     rounds_since_progress/est_tokens/attempt_index/attempts_remaining/
     spent_so_far）+ 标准化统计（train 拟合存盘）
   - `train_head(records, source, *, hidden=0, lr, epochs, seed)`：
     torch 手写 logistic（hidden=0）/ 单隐层 MLP（hidden>0），
     soft-target CE 支持，返回可序列化头（json：权重+特征表+版本+标准化统计）
   - `TrainedHead.load(path)` + `__call__(rec) -> {"q_abort": (p_yes, p_no)}`
     ——p_yes = 1 - p(pass)，符号序对齐 decision_policy 约定
2. `decision_scorers.py`：`make_scorer("trained", model=<head.json path>)`
   注册；任何加载/解析异常 raise（fail-open 由调用方 DecisionHeadPolicy 兜底）
3. `scripts/train_decision_head.py`：读 dataset.jsonl → 按 split 过滤 →
   三路训练（A/B/C）→ calib 上选模型与温度（温度不改 argmax）→
   报告 `results/decision-layer/gating/head_compare.md`：
   per-split acc/AUC/ECE + **feature importance**（logistic |w| 排序）+
   per-rollout 聚类结论 + 样本量与统计限制声明
4. 单测（tests/rl/test_decision_head.py）：
   - 解析一致性：render_step_state ↔ parse_step_state 往返（随机 StepFeatures）
   - soft/hard target 训练收敛冒烟（合成数据可分性检查）
   - 保存/加载 round-trip 字节等价；异常 head 文件 raise
   - teacher 蒸馏头在 mock 数据上拟合 teacher 概率（小 MSE）

## 验收

- [ ] 三路对照报告落盘（train/calib 数字；test 只字不提——留给 SP29c）
- [ ] feature importance 排序合理可读（预期 top：consecutive_failures /
      rounds_since_progress / tool_success_rate——与 error_streak_3 基线
      语义互证）
- [ ] 单测绿 + 既有回归绿；make_scorer("trained") 冒烟过
- [ ] 报告明确标注 rollout 级样本量限制

## 不做

- 不训 LM / 不碰 marker LoRA（master plan 不做清单第 1 条）
- 不用 sklearn（torch 已是依赖；避免新依赖）
- 不在 test 划分上做任何选择或调参
- 不做特征工程扩展（10 维直用；交互特征留给"若 B/C 头不敌基线"的下一轮）
