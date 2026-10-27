# RL 模块结论

> 结论更新时间：2026-10-25（覆盖基线至 `22d051f5d18ad83a4c6083683342ab41d7850149`）

## Responsibility

- 提供 **GRPO 策略优化闭环**：rollout 采样 → 标量 reward → 组内优势 → clipped policy loss（可选 KL），含纯 numpy 数学核与 torch 训练核两套实现并保持对拍。
- 提供 **Rollout 协议与 token 真值轨迹**：`RolloutEngine` / `RolloutSample` 供本地 TinyLM、HF、vLLM、MinT、Harbor 等多后端互换；`TokenRollout` 在采集侧冻结 token / loss_mask / logprob，与 reward 解耦。
- 提供 **决策点标注与判别头栈**：bounded-choice 题面、多来源 label、sidecar `decisions.jsonl`、teacher 受限 softmax scorer、校准评测与 `continue_stop` 轻量 MLP/logistic 头。
- 提供 **Harbor / MiMo 真任务 episode 通路**：OpenAI 兼容 `model_server` 驱动容器内 agent → verifier reward → 请求日志切段训练；MiMo 任务池物化为 harbor 目录；回放分数桥接 harness 历史轨迹。
- 提供 **飞轮统计门控与 ARVO 惩罚**：Wilcoxon/Mann-Whitney 晋升门；组内长度罚（改 reward）与 adv_signed 工具错误罚（改 advantage）；回放基线优势塑形。
- 提供 **训练工程辅助**：设备探测、torchrun 分布式、DDP/FSDP 薄包装、显存配方、内置 LoRA 注入、可选 MinT 远端 `importance_sampling` 步。
- Explicit non-responsibilities：`agenticx/trainer` 的 SFT/DPO 数据集构建、模型别名回灌网关、通用 held-out 任务划分定义本身不在本包；`agenticx/learning` 的会话观察、技能自进化、RSI 轨迹入库/调度/进化策略不在本包（本包只消费其森林与 split 守卫，并输出 decision 数据供其挖掘）。

### 与 `agenticx/trainer`、`agenticx/learning/trajectory` 的边界

| 方向 | 关系 |
|------|------|
| `agenticx/trainer` | 独立包：`build_sft` / `build_dpo`、`heldout_split` / `assert_trainable`、`resolve_model_alias`。冻结 commit 下 **trainer 不 import rl**；rl 的 `decision.load_trainable_decisions` / `assert_trainable_decision` **调用** `trainer.heldout` 与 `learning.trajectory.task_split`，防止考试任务进入决策头训练。 |
| `agenticx/learning/trajectory` | 轨迹采集、`TrialForest`、`collect_jobs`、`decision_mining` / `decision_policy` 归 trajectory；**读取** `rl.decision` 类型与 `decision_scorers.Scorer`，`schema` 文档约定 `rollout_id` 对齐 `TokenRollout` 与 `RSITrajectory`。`replay_bridge` **向上依赖** `trajectory.forest` / `harbor_collector` 生成 per-task 回放分，再喂 `replay_shaped_advantage`。 |

## Entry points and public interfaces

- **GRPO 数学**：`core_algos.grpo_outcome_advantage`、`clipped_policy_loss`、`kl_k1` / `kl_k3`、`masked_mean`、`grpo_loss`。
- **训练核**：`trainer.GRPOTrainer`（`train_step` / `train_step_episodes`）、`response_logprobs`、`torch_grpo_loss`、`grouped_episode_advantage`。
- **Rollout**：`rollout.RolloutEngine`（Protocol）、`RolloutSample`、`LocalRolloutEngine`、`TinyLM`；`TokenRollout` / `TurnRecord` / `FlatSample` / `to_flat` / `to_turn_samples`；`hf_rollout.HFRolloutEngine`、`vllm_rollout.VLLMRolloutEngine`、`mint_backend.MintRolloutEngine`。
- **Harbor / reward**：`harbor_reward.run_harbor_trial`、`extract_reward`、`make_trial_config`、`make_agent_env`；`harbor_rollout.HarborRolloutEngine` / `Episode`；`mimo_harbor_bridge.materialize_task` / `materialize_pool`。
- **服务与注入**：`model_server.serve_model`、`RequestLogEntry`、`inject_system_extra`。
- **Replay / 塑形**：`replay_bridge.task_replay_scores` / `task_replay_scores_from_jobs`；`replay_shaping.replay_shaped_advantage`。
- **ARVO / 接受门**：`arvo` 长度罚与 `apply_tool_penalty`；`acceptance.wilcoxon_gate` / `mannwhitney_gate`、`AcceptDecision`。
- **决策层**：`decision.DecisionLog`（load/save/append）、`DecisionRecord`、`assign_split`、`backfill_teacher` / `backfill_outcomes_missing`、`load_trainable_decisions`；`decision_scorers.make_scorer`、`OpenAICompatScorer`、`mock_scorer`；`decision_eval` 的 top-1 / ECE / 温度缩放；`decision_head.train_head` / `TrainedHead`。
- **分布式与规模**：`device.detect_device` / `autocast_for`；`distributed.init_distributed` / `DistInfo`；`parallel.wrap_model` / `shard`；`recipes.recommend` / `memory_feasibility`；`lora.inject_lora` / `lora_state_dict`。
- **远端 MinT**：`mint_backend.require_mint`、`MintRolloutEngine`、`mint_grpo_step`、`mint_save_and_get_sampler`。
- `__init__.py` 为空，**无包级 re-export**；调用方按子模块路径导入。

## Core execution path

``mermaid
flowchart LR
  subgraph rollout
    E[RolloutEngine.generate]
    S[RolloutSample + old_logprobs]
  end
  subgraph reward
    R[reward_fn / harbor verifier]
  end
  subgraph advantage
    A[grpo_outcome_advantage 或 replay_shaped / grouped_episode]
    V[ARVO 长度罚 / tool penalty]
  end
  subgraph update
    L[response_logprobs → torch_grpo_loss]
    O[AdamW.step]
  end
  E --> S --> R --> A --> V --> L --> O
``

- **单步 GRPO（`train_step`）**：`rollout.generate` 按 `prompt × n_samples` 顺序排列 → `reward_fn(prompt, response)` → `grpo_outcome_advantage(..., group_size=n_samples)` → 当前策略 `response_logprobs`，rollout 时 `old_logprobs` 作 ratio 分母；`ref_lm` 缺省时 ref=old（首轮 KL≈0）→ backward → 可选 `rollout.sync_weights`（vLLM 热同步）。
- **Episode GRPO（`train_step_episodes`）**：Harbor `Episode`（多 `RolloutSample` 段 + 任务级 reward）→ 可选 ARVO 长度罚改 reward → `shaping` 或 `grouped_episode_advantage` → token 级广播 → 可选 `apply_tool_penalty` → 同 `torch_grpo_loss`。
- **Harbor 真任务侧**：`HarborRolloutEngine.start` 拉起 `serve_model` → `run_harbor_trial`（子进程 `harbor trial start`，agent 经 `OPENAI_*` / `AGENTICX_*` 指向宿主机服务）→ `RequestLogEntry` 快照切段为 `RolloutSample`。
- **决策数据流**：运行时写入 `DecisionLog` sidecar（`rollout_id, turn` join `TokenRollout`）→ teacher `backfill_teacher` / execution `backfill_outcomes_missing` → `assign_split` → `decision_eval` 或 `train_head`；线上路由经 `decision_scorers`（与 `agents/decision_router` 等同协议）。
- **MinT 双轨**：本地算 advantage 与 `Datum` 构造 → 远端 `forward_backward(loss_fn="importance_sampling")` + `optim_step`，权重保存后 `save_weights_and_get_sampling_client` 交回采样。

## Data and configuration

- **轨迹与决策资产**：`TokenRollout` / `decisions.jsonl` 以 `rollout_id` 对齐；`state` 文本版本（如 `step-features-v1`）与 prompt 模板版本（`decision_scorers.PROMPT_VERSION`）换版即换数据集。
- **Harbor / MiMo**：`datasets/task_pool.json` → `materialize_*` 输出目录；trial 配置 JSON、`result.json` verifier reward、`hack_flag.txt` hacking 标记；`AGENT_SETUP_CACHE_MOUNTS` 经 trial `environment.mounts` 挂载（非 task.toml）。
- **回放分数**：默认 `collect_jobs(..., job_pattern="*tb40*")` → `TrialForest` → 任务级历史 reward 均值字典。
- **配方常量**：`recipes.QWEN_MODEL_PARAMS` / `HARDWARE` 表驱动 `recommend`；LoRA 默认 target 为 attention/MLP 线性层名后缀。
- **环境**：Harbor agent 依赖 `OPENAI_BASE_URL`、`AGENTICX_BASE_URL` 等；分布式依赖 torchrun 的 `RANK` / `WORLD_SIZE` / `LOCAL_RANK`；vLLM / mint / scipy 为场景化可选依赖。

## Dependencies

- **Upstream**：`torch`（训练与 rollout）；`numpy`（`core_algos` / `arvo` / `acceptance`）；可选 `scipy.stats`、`vllm`、`mint`、`openai`（scorer）、`transformers`（HF 路径）；Harbor CLI 与 Docker 为 M3/M4 真机路径。
- **Cross-package**：`agenticx.learning.trajectory.{forest,harbor_collector,task_split}`（回放桥与 held-out 守卫）；`agenticx.trainer.heldout`（`HeldoutViolation`）；`agents/decision_router`、`react_agent_async` 消费 `decision_scorers`。
- **Downstream**：RSI / 飞轮训练脚本与 `tests/rl/*` 为当前主要调用方；Studio 主对话路径不依赖本包。

## Tests and operations

- **套件**：`tests/rl/` 覆盖 `core_algos`、`trainer`（含 torch/numpy 对拍）、各 rollout 引擎、Harbor/mock trial、`model_server` HTTP、决策全链路、ARVO、acceptance、distributed 双进程 worker、recipes/lora/parallel/device。
- **trajectory 交叉**：`tests/trajectory/test_decision_mining.py` 使用 `DecisionLog`。
- **运维要点**：GPU 训练优先 `HFRolloutEngine` / `VLLMRolloutEngine`；macOS 开发无 vLLM 时注入 fake engine 或走 CPU `TinyLM`；Harbor 首装 agent 依赖缓存 mount，否则 qemu 下可达数十分钟；晋升变体应走 `acceptance.*_gate` 而非单次 reward 比较；决策头训练前必须 `load_trainable_decisions` 或等价 held-out 守卫；修改 `core_algos` 语义须同步 `test_trainer` 对拍与 MinT `mint_grpo_step` 构造。
