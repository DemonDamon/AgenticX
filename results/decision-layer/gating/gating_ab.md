# Loop Gating A/B 报告（回放侧）

- scorer: `startlux:StartLux-Decision-4B-Q4_K_M:systemone`
- forest: 12 tasks / 30 attempts（有通过记录的任务 10）
- seeds: v1, v2, v3  taus: [0.6]  max_attempts: 3
- scorer 调用: 1670 次（缓存命中 4551 次）

## train 区（策略选择只看这里）

| policy | pass_rate | avg_cost(est tok) | abort_rate |
|---|---|---|---|
| never_abort | 0.829 (±0.066) | 39733 (±2603) | 0.000 |
| fixed_horizon_10 | 0.000 (±0.000) | 6357 (±396) | 0.091 |
| error_streak_3 | 0.765 (±0.059) | 37839 (±2516) | 0.003 |
| progress_stall_8 | 0.829 (±0.066) | 39150 (±2577) | 0.001 |
| decision_head_tau0.6 | 0.665 (±0.064) | 34632 (±3075) | 0.002 |

## held-out 区（仅验收，不参与选择）

| policy | pass_rate | avg_cost(est tok) | abort_rate |
|---|---|---|---|
| never_abort | 0.667 (±0.500) | 19413 (±10524) | 0.000 |
| fixed_horizon_10 | 0.000 (±0.000) | 2011 (±484) | 0.091 |
| error_streak_3 | 0.556 (±0.500) | 19248 (±10524) | 0.003 |
| progress_stall_8 | 0.667 (±0.500) | 19413 (±10524) | 0.001 |
| decision_head_tau0.6 | 0.556 (±0.500) | 14787 (±10524) | 0.002 |

## 判读

- 决策头若在 train 区 pass_rate ≥ never_abort 且 avg_cost 更低，
  则 V3「守门员降本」获得回放证据；否则记录负结果（同样有价值）。
- held-out 区数字仅用于验收，不作为调 tau 的依据（防过拟合）。
