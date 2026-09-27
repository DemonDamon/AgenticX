# plans/rsi/sp23-multi-domain-task-pool.md
# SP23 多域任务池（MiMo-V2.6-RL-oss 接入）

## 背景

TB4.0 衍生的 54 训练任务对 RL 太薄（MiMo 单步 1568 题）。SP23 将训练池
从单一 benchmark 扩为多域分布, 目标覆盖长程真实场景。

## 数据源实测（2026-09-27）

- 仓库: `XiaomiMiMo/MiMo-V2.6-RL-oss`（Apache 2.0, hf-mirror 可达）
- 镜像: 统一仓库 `xiaomimimo/mimo-v2.6-rl-oss`, tag=instance_id
  （境内经 docker.1ms.run / dockerproxy.net 加速可拉）
- code 域 2698 题: SWE 任务, verifier = test_patch + test_command（可执行）
- cyber 域 1000 题: arvo 漏洞复现, verifier 规则型（镜像内预置）
- general 域 925 环境: rubric judge 为主, 仅 deterministic 子集可收
  （SP24 再决定接入规模, 4 万+文件暂不全量拉取）
- webdev/music: 视觉/judge 型, 不收

## 关键实测结论（烟测）

format-code-task-001457（github-actions-tagger 仓库）:
- test_patch 112 行注入 26 个 jest 用例, `git apply` 干净应用
- 基线（未修复）跑分: **2 failed / 24 passed** → verifier 梯度真实存在
- test_command 脚本由 harness 注入, 容器内预置 node/jest 环境

## 纪律（与 SP18/SP21 同源）

1. MiMo 任务 ID 带域前缀（code-/cyber-/general-）, 与 TB 裸名空间零交集
   ——守卫语义不变, 12 个 TB held-out 不受影响
2. verifier 只收 executable/rule, judge 型拒收（reward 客观性红线）
3. general 域企业软件名（KPMG/SharePoint/DealCloud 等）入库前匿名化
4. 难度分层: MiMo 未标 L1-L4, 当前 difficulty=unknown; 真跑后按通过率
   回填"甜点区"筛选（SP24 接 harbor 时做）

## 交付

- `agenticx/learning/trajectory/task_pool.py`: 三域解析器 + 匿名化 + 清单落盘
- `scripts/build_task_pool.py`: 池生成（code 2698 + cyber 1000 = 3698）
- `datasets/task_pool.json`: 统一清单（summary + tasks）
- `tests/trajectory/test_task_pool.py`: 9 测试（解析/judge拒收/匿名化/守卫扩展）
- task_split.py 守卫扩展: 池内任务放行, heldout 拦截不变

## 验证

- 新测试 9/9, RSI 回归 251 passed
- check_task_split.py 自检通过
- docker 镜像拉取 + test_patch 应用 + jest 执行全通路 OK

## 未做（明确决策）

- general 域整域接入（judge 比例未知, 需逐环境筛选, SP24）
- harbor_reward 侧 PooledTask 消费适配（等真跑排期一起做）
- 难度分层标注（依赖首轮通过率数据）
