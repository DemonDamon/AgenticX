# SP21: 经验层正则化（Google RRSI 论文吸收）

状态: 已完成（2026-09-24）
来源: Google RRSI（Recursive Regularized Self-Improvement）——研究冻结模型、
只演化 harness 时如何不被三件事毁掉：基准特异拟合、噪声追逐、复杂度累积。
动机: 我们栈里恰好有两层就是 RRSI 的研究对象——P0.5 策略演化循环和
SP16/17 经验层。论文点名的三个失败模式，我们有一个半对策，SP21 补齐。

## 三道选择门 → 我们的实现

| RRSI 失败模式 | RRSI 对策 | SP21 实现 |
|---|---|---|
| 基准特异拟合 | 泄漏筛查 | `screen_leakage`: 他人任务ID/绝对路径/长hex/host:port 拒绝；自己任务ID 放行（任务内记忆是刻意的） |
| 噪声追逐 | noise-adjusted gate | `admission_gate`/`prune_with_replay`: 回放统计 δ = pass(模式出现组) − pass(未出现组)，δ ≤ −min_delta 才算真缺陷信号；δ≈0 是噪声或任务难度，拒/剪 |
| 复杂度累积 | 结构剪枝 | `prune_with_replay(max_active=)`: 按跨任务票数+|δ| 排序保留 top-N，控住 prompt 注入量（RRSI 表 2: 无正则 token 开销 +57%） |

外加两件 RRSI 方法论要求的事：

- **已否定清单**（归因含回退）: `PolicyRegistry.deny/is_denied` 指纹
  （空白归一化 sha256）持久化；`evolve_loop(track_denied=True)` 对同指纹
  提议零成本跳过——被否定假设不再消耗评估预算。
- **考试任务单次验证**: `heldout_report_once` ——经验库假设类教训的错误
  模式在 held-out 任务上的回放级迁移证据；marker 落盘后第二次调用直接
  拒绝（force=True 审计重放留痕）。库内有考试任务来源教训 → 抛异常。

## 设计要点

- **回放验证免费**: RRSI 用真跑验证 harness 组件（贵）；我们用已记录轨迹
  （TrialForest 同源的 store 数据）做零成本回放。单测钉死 δ 语义：
  强判别模式 δ=-0.8 通过，纯噪声 δ=0 被拒。
- **剪枝可在冻结库上进行**: freeze 语义是"拒绝新学习"，剪枝是质量治理。
  测试钉死: 冻结库可剪、add 仍拒。
- **success_note 免回放门**: 它是任务内记忆不是假设，只过泄漏门。
  假设类（contrastive_failure/failure_pattern）才需要判别力证据。
- **RRSI 缺的我们有**: 论文没有零成本验证手段；我们的回放门正是把
  "验证"从部署期提前到入库期。

## 文件

- `agenticx/learning/trajectory/regularization.py`（新增）:
  screen_leakage/screen_lessons、ReplayStats/replay_stats、
  admission_gate、PruneReport/prune_with_replay、heldout_report_once
- `agenticx/learning/trajectory/evolution.py`（修改）:
  PolicyRegistry 增 denied 指纹清单（向后兼容旧 JSON）；
  evolve_loop 增 track_denied 参数（默认 True）
- `tests/trajectory/test_regularization.py`（新增, 15 用例）

## 验证

- SP21 单测 15 个全过：泄漏四类拒绝/自身放行、三门顺序、δ 语义、
  票数排序 cap、冻结库剪枝、单次验证 marker/force/污染红线、
  deny 指纹持久化与排版不敏感、evolve_loop 评估预算节省
- RSI 回归: tests/trajectory + tests/rl = 227 passed

## 边界

- 回放级证据 ≠ live run 能力分（报告 note 字段里写明）；live 验证等 GPU。
- min_delta/min_attempts 默认 0.15/3，首版经验值，等真数据校准。
