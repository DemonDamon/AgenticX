# Weight-Layer Recursive Self-Improvement: Task Pool, Calibration, and Reward Integrity

> 工作草稿（前半篇）。状态：数据/方法/干预实验已定稿；训练曲线章节（§5-§6）
> 等 8×4090 / MinT / tinker 训练环境到位后补齐。分支：feat/rsi-data-flywheel（PR #54）。

## 0. 摘要（草）

Recursive self-improvement (RSI) 近期在 harness 层被证明可行（AIDE², arXiv:2609.26457：
8 天自主运行发现 7 项可泛化改进，且 reward hacking 比率出现未显式优化的下降）。
但 harness 层 RSI 的能力上界受冻结的底层模型限制。与此同时，环境规模化路线的
收益已趋缓（SETA, NeurIPS 2026：4,500 个可验证终端环境上对 291B 模型全参
GRPO 训练，TB 2.0 pass@1 仅 40%→43%）。我们研究**权重层 RSI**：
以 GRPO 训练循环为外环，任务池、reward 信号与经验飞轮为内环的自改进系统。

前半篇（本稿）交付三件事：
1. **多域可执行任务池**：3,698 个带容器 verifier 的 RL 任务（code/cyber 两域），
   全部 executable/rule 型判分，杜绝 LLM-judge 主观性；
2. **通过率校准方法**：以 DS V4.1 Flash 校准 10 任务样本，40-50% 通过率落在
   RL 甜点区（20-80%），确立"先校准后训练"的纪律；
3. **reward 信号完整性管线**：private-split 提示、patch 冲突型 hacking 检测、
   统计晋升门控三件套——直接移植 AIDE² 的核心教训到权重层。

后半篇将报告：RSI 训练曲线（轮次 vs held-out 通过率）、hacking 率沿训练的
演化（权重层版的 AIDE² emergent 结果）、ARVO 惩罚消融。

## 1. 引言

### 1.1 两种 RSI 层

| | harness 层（AIDE²） | 权重层（本工作） |
|---|---|---|
| 改进对象 | agent 代码（搜索策略/上下文管理） | 模型权重（GRPO 更新） |
| 上界 | 冻结模型的能力天花板 | 无显式天花板 |
| 单步成本 | 一次评估 = 数十次 LLM 调用 | 一次 rollout + 一次梯度更新 |
| 已验证 | 8 天 7 项改进，4 基准泛化 | （本工作） |

两者正交可叠加：AIDE² 发现的 harness 机制（bandit 搜索、failure memory 门控）
可作为我们训练分布的 curriculum 结构。更广义地，终端 agent 能力的杠杆有三个
正交维度：**环境规模化**（SETA：加更多训练环境）、**harness 层自改进**
（AIDE²：改 agent 代码）、**权重层自改进**（本工作：改模型本身）。

### 1.2 权重层 RSI 的三个前置问题

在训练循环能转起来之前，三个问题决定实验成败：

- **Q1 任务分布**：多少任务、什么难度配比，reward 才不饱和也不消失？
- **Q2 reward 客观性**：判分信号会不会被 agent 绕过（reward hacking）？
- **Q3 晋升纪律**：训练轮次间的"改进"如何与噪声区分？

本文前半篇分别以任务池（§3）、校准（§4）、完整性管线（§5）回答。

## 2. 相关工作

- **SETA**（arXiv:2607.10891, NeurIPS 2026）：环境规模化层的标杆——
  4,500 个可验证终端环境 + 环境合成流水线（SETA-Synth/SETA-Evol），全开源。
  与本工作两点交叉：(a) 外部锚点——其 DeepSeek-V4-Flash 基线（TB 2.0
  pass@1=40%）与我们的校准基线（40%）跨任务集一致（§4.4）；(b) 其
  64×H200 全参 GRPO 仅获 +3pp，为"单轮环境规模化收益趋缓、迭代自改进
  是下一杠杆"提供外部证据。
- **AIDE²**（arXiv:2609.26457）：harness 层 RSI 的标杆。其 (a) public/private
  信号分离、(b) 固定预算评估、(c) 统计性接受判据，全部移植进本工作的管线。
  其 related work 明确将权重层自适应列为 open direction。
- **RSR**（Recursive Self-Rewrite, arXiv:2610.02826, 腾讯混元）：与本工作最近的
  邻居——同样主张"经验→权重"，但为**一次性离线翻译管道**：多 harness 采集
  成功轨迹 → planner 提炼 runbook → critic 泄漏审计 → 通用 harness 新沙箱
  重解 → 干净轨迹 SFT（2,001→11,094 条，TB2 pass@3 57%→74.2%）。其核心
  警示：源轨迹中 29.6% 的状态管理命令等 harness 私有行为若直接训练，
  TB2 **倒退 7.9pp**（dead-end 打转行为）。**与本工作三点差异**：
  (a) RSR 是开环翻译（无轮次递归），我们是闭环飞轮（权重改进→更强
  rollout→更多经验→再改进）；(b) RSR 用离线 SFT，我们用 on-policy GRPO
  （模型采样时即在训练 harness 内，分布错位天然更小，但 hints 注入段与
  经验回放段仍需纯净度控制，见 §5.5）；(c) RSR 无晋升纪律，我们的轮次
  晋升统一过统计门控（§5.4）。
- **MiMo-V2.6-RL-oss**（XiaomiMiMo）：本工作任务池来源。其 ARVO 惩罚体系
  （工具错误惩罚、分组长度惩罚）已移植进我们的 GRPO 实现（κ=2 默认参数）。
- **REUSE**（arXiv:2609.33180, Purdue, stat.ML）：RSI 评估复用的统计理论——
  固定评估集反复驱动自适应搜索时，假晋升来自三个来源（轮内选择、
  重复检验、**自适应依赖**——候选通过决策历史成为评估集的函数），
  现有 RSI 系统实测假晋升率高达 20.7%。其 certified 晋升框架
  （精确配对符号检验 + 全局 α 预算跨决策历史分配 + 决策-only 反馈）
  将假晋升降到 0% 而最终性能几乎无损（-0.04pp）。与本工作 §5.4 的
  关系：我们的 Wilcoxon 门在二值配对下即为其符号检验（n₊/n₋ 翻转
  统计），本工作将其理论落地为权重层飞轮的工程管线（§5.4）。
- **Dream-RSI / RRSI**：经验层注入会压制长程探索多样性（对应我们 SP22 的
  hints 分期与 SP21 的正则化）。
- **Terminal-Bench 4.0**：12 个 held-out 评估任务的永久隔离基准。

## 3. 多域可执行任务池

### 3.1 构成

| 域 | 数量 | verifier | 来源 |
|---|---|---|---|
| code | 2,698 | test_patch + test_command（容器内真实执行） | MiMo SWE 任务 |
| cyber | 1,000 | 镜像内规则型 verifier | ARVO 漏洞复现 |
| **合计** | **3,698** | 全部 executable/rule | — |

general 域 925 环境因 judge 型判分占比过高被拒收（reward 客观性红线），
webdev/music 视觉/judge 型不收。**全池零 LLM-judge**——与 SWE-bench 系
同源的客观判分。

### 3.2 纪律

1. 训练/评估严格隔离：12 个 TB4.0 held-out 任务由代码守卫强制
   （`assert_trainable_task`），训练路径无法触达，无 bypass 开关；
2. 任务 ID 带域前缀（code-/cyber-），与 held-out 裸名空间零交集；
3. 企业软件名入库前匿名化。

### 3.3 工程通路

PooledTask → harbor 任务目录物化（统一镜像 `xiaomimimo/mimo-v2.6-rl-oss:tag`
经境内镜像源加速）→ 容器内 agent 执行 → verifier 打分 → reward 0/1。
qemu 模拟层下 agent 依赖安装 30min+ 的问题以 setup 缓存 bind mounts 解决
（首装一次，后续 trial 分钟级复用）。

## 4. 通过率校准

### 4.1 为什么必须先校准

GRPO 的 0/1 reward 下，通过率 0% 的任务全为负样本（无正向梯度）、
100% 的任务无信号（reward 饱和）。甜点区 20-80% 内，正负梯度并存。
不校准直接开训 = 蒙眼烧训练预算。

### 4.2 设置

- 模型：DeepSeek V4.1 Flash（经 aibox 网关）
- 任务：10 个 code 域任务（排除 Gradle 重任务 000173 与已单测的 001457）
- harness：harbor trial + agenticx agent adapter，每任务单 seed

### 4.3 结果

**基线臂（无干预）：40% 通过率**（4/10），落在甜点区中部。

| 分层 | 任务 | 判定 |
|---|---|---|
| 易 | 001661（439s）、002366（684s） | 通过 |
| 中 | 001933（1196s）、001240（2095s，压线） | 通过 |
| 难 | 000723/001499/000720/000484/000189/000718 | 失败 |

三个观察：
1. 失败任务 4/6 耗时 1400-2100s——agent 努力后失败（能力边界），
   非 infra 秒挂，负样本信息量充足；
2. 一例 agent 自报 success=true（97 次迭代）但 verifier 判 0——
   模型高估完成度，正是 RL 要修的行为；
3. 难度天然三档，无需人工调难度即可作 RL 课程编排锚点。

### 4.4 选型结论

DS V4.1 Flash 可用：40% 通过率处于甜点区中位，正负梯度均衡，
任务池无需更换。（GLM-5.3 Flash 备选未启用。）

**外部锚点**：SETA（NeurIPS 2026）报告 DeepSeek-V4-Flash 在其 terminal
agent harness 下 TB 2.0 基线 pass@1 = 40%。不同任务集、同代同级模型给出
一致的 40% 水平线——交叉印证本校准结果非孤例，同时为 A2/A5 的预期
表现提供了外部参照系（SETA 全参训练后 +3pp）。

## 5. Reward 信号完整性管线

AIDE² 的核心工程教训：评估信号的可信度决定整个外循环的搜索质量。
我们将其三个机制移植到权重层通路。

### 5.1 Private-split 提示（干预变量）

物化任务时在 instruction 尾部追加固定提示：

> "your work will be verified against a held-out test suite that is
> applied only after you finish — you cannot see these tests, and any
> edits to test files will make the verification patch fail to apply.
> Prefer robust, generalizable solutions."

针对的实测失败模式：agent 修改测试文件 → test_patch 无法 apply →
verifier 梯度失真（001457 单任务闭环实测捕获）。

### 5.2 Hacking 检测

verifier 脚本在 `git apply` 冲突时写 `hack_flag.txt`（patch 冲突型
reward hacking 的最小可执行检测）。校准脚本逐行记录并汇总 hacking 率。

### 5.3 干预实验（首轮，n=10×1）

| | 基线臂 | 干预臂 |
|---|---|---|
| 通过率 | 40% | 50% |
| hacking 标记 | 不可观测 | 1/10（000723 patch 冲突） |
| 逐任务翻转 | — | 3 个 0→1，2 个 1→0（其一为 timeout） |
| Wilcoxon 门控 | — | **拒绝**（p=1.0，n=5 非零对） |

门控拒绝本身是管线正确性的证据：10 任务单 seed 的分辨率不足，
宁可拒绝不做噪声接受——这正是 AIDE² 点火测试（3 seeds 无法定论）
教训的工程化落地。统计功效由 3-seeds 复跑补齐（进行中/待跑，
预算 ¥150-300，两臂 60 trials）。

### 5.4 统计晋升门控

`wilcoxon_gate` / `mannwhitney_gate`（配对/非配对）：接受准则 =
均值提升 ≥ min_improve 且 p < alpha（默认 0.1）。全库晋升决策
（checkpoint/hints/策略改写/飞轮轮次）统一过门，判定落盘 gate.json。

**与 REUSE 理论的对齐**（arXiv:2609.33180）：我们的配对门在二值
pass/fail 结果下退化为精确配对符号检验——干预实验的翻转统计
（n₊=3 个 0→1，n₋=2 个 1→0）即其 p 值 π(n₊, M) 的输入，该检验的
有限样本有效性由其 Lemma A.2 保证。REUSE 进一步揭示我们尚缺的两项
控制，列为飞轮训练期的工程要求：

1. **全局 α 预算**：逐轮独立使用 α=0.1 会在多轮飞轮中膨胀整体
   假阳性（REUSE 实测现有系统假晋升率可达 20.7%）。采用其
   w_t/v_p 分配：α_{t,p} = w_t·v_p·α 跨轮次与晋升计数分配，
   每次门控的有效显著性水平由 gate.json 从全局预算中扣减。
2. **决策-only 反馈**：飞轮向下一轮提议（hints 选择、经验晋升、
   课程编排）只返回晋升决策本身，不返回校准任务级的分数明细——
   否则候选生成依赖评估集超出决策历史，自适应依赖失控
   （REUSE Assumption 2）。

held-out 隔离（12 任务永久排除于训练）与上述两项正交互补：
隔离保证最终评估的独立性（Assumption 1），全局预算与决策-only
反馈保证晋升用校准集（复用集）上的统计有效性。

### 5.5 轨迹纯净度（RSR 启示，训练期前置控制）

RSR 证明：源轨迹中 29.6% 的 harness 私有命令直接 SFT 会导致 TB2 倒退
7.9pp。我们的 on-policy GRPO 天然规避了"源 harness ≠ 训练 harness"的
分布错位，但两类样本段仍携带 harness 干预信号：

- **hints 注入段**（SP22 三态门控激活时注入的经验摘要）；
- **经验回放段**（M4 replay shaping 引入的历史轨迹片段）。

控制方案（随 TokenRollout 的 `response_mask` + `generation_spans` 一起
实现）：干预段样本打标 → loss mask 或降权，且每轮训练统计**污染率**
（干预段 token 占比）作为 tracked metric——与 hacking 率（§5.2）并列为
训练数据质量的两个观测维度。经验库条目晋升回放前增加泄漏审计门
（公开接口可复现性检查），对应 RSR critic 的飞轮版。

## 6. 训练设置（占位，等训练环境）

- 后端三选一（代码均已就绪）：自有 8×4090 / MinT / tinker
  （后两者换 API key + import 即切换）
- 算法：GRPO + ARVO 惩罚（工具错误 κ=2、分组长度惩罚）+ LoRA
- rollout：harbor 真任务 episodes + 回放混合
- TokenRollout 记录层（SP24）：线上冻结 token/logprob，三投影导出，
  rollout_id 对齐 reward——训练样本为真值而非事后重分词

## 7. 训练结果（占位）

- RSI 主曲线：轮次 vs held-out 通过率
- hacking 率沿训练轮次的演化（权重层版 AIDE² §3.4）
- ARVO 消融 / hints 门控消融 / TokenRollout drift 量化

## 8. 复现

- 代码：feat/rsi-data-flywheel 分支（PR #54）
- 任务池：`datasets/task_pool.json`（3,698 任务清单）
- 校准：`scripts/calibrate_task_pool.py`（`--baseline-dir` 自动门控）
- 物化：`agenticx/rl/mimo_harbor_bridge.py`
- 测试：147+ passed（rl + trajectory 套件）

---

*生成于 2026-10-02。占位章节 §6-§7 的补齐依赖训练算力落实。*
