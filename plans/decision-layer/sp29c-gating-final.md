# SP29c：自训头 gating A/B 终审 + Go/No-Go + 战役终答

## 背景

SP29b 产出三路头（teacher 蒸馏 / execution 真值 / 混合），在 train/calib
上选出最优。本 SP 是终点站：**test 划分一次性消费**，自训头 vs 4 启发式
基线（never_abort / fixed_horizon_10 / error_streak_3 / progress_stall_8）
的 gating A/B 终审，按 route-decision 判据出 Go/No-Go。这是 SP26-28 整条
证据链（零样本证伪 → 真值回填 → 自训对照）的闭环。

## 交付

1. A/B 终审跑（复用 eval_gating_ab.py，零新评测代码）：
   `--scorer trained --model <最优头.json> --taus 0.5 0.6 0.7
   --seeds v1 v2 v3 --parallel-tasks 1 --prewarm-workers 1`
   （trained scorer 无网络 IO，prewarm 快）
2. `results/decision-layer/gating/selftrained_ab.md` 终审报告：
   - 最优头 × 3 tau × 3 seeds vs 4 基线（train/held-out 双区）
   - 部署线判定（判据延用 route-decision：train 区 pass_rate 不降出
     噪声带〔跨 seed 全距一半〕且成本节省 >5%）
   - 与 SP27 零样本 A/B 对照表（同 forest 同 seeds，唯一变量 = 头）
   - tau 敏感性与 p_abort 分布探针（复现 SP27 的惰性诊断——自训头是否
     摆脱"几乎不出手+出手即误杀"画像）
   - 统计限制声明（rollout 级样本量；功效视角：多少 rollouts 可分辨）
3. Go/No-Go 三分支判定（master plan 第五节）：
   - 部署线达标 → "自训头可部署"，SP30+ 走 feature flag 接线
   - 不敌 error_streak_3 → 判断层回到"启发式 + 持续积累"，
     自训线冻结、资源转 multi-tool 采集
   - 不可分辨 → 如实标注 + 功效估算，下期战役决策依据
4. MASTER-PLAN-SP29.md 状态表 + 第八节核心价值终答回填
   （真实数字：三路标签差距、终审 A/B、与零样本/基线的对照）

## 验收

- [ ] test 划分只在本 SP 消费一次（之后不再读）
- [ ] 终审报告含明确 Go/No-Go 判定 + 噪声带数字
- [ ] 与 SP27 零样本结果同表可比（同 forest/seed 口径）
- [ ] master plan 第八节终答用真实数字回填

## 不做

- 不做 live-loop 部署 / 不开 feature flag（即使达标）
- 不因结果不好而追加调参轮（test 已消费，重调 = 作弊；
  结果不好 = 结论本身）
- 不做超出判据的新指标发明
