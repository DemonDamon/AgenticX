### M16.4: GRPO 训练系统 (`agenticx.embodiment.training`)

> 启发来源: Google 的 RLHF/RLAIF, Meta 的 GPO, DeepMind 的 AlphaGo/AlphaStar

* **算法演进与技术选型**

  * **GRPO (Generative RL from Observation)**: 核心思想是通过生成模型和强化学习的结合，从观察中学习，强调生成和探索。

  * **DAPO (Direct Action Policy Optimization)**: 针对确定性环境或高信噪比场景，直接优化动作策略，提高训练效率。

  * **GSPO (Generative Stochastic Policy Optimization)**: 针对随机性环境或需要深度探索的场景，优化随机策略，增强鲁棒性。

* **核心训练组件**

  * `GRPOTrainer(BaseTrainer)`: GRPO 训练器

    * `train(self, trajectories: List[TrajectoryData], config: TrainingConfig) -> TrainingResult`: 训练循环

    * `_update_policy_network(self, batch: TrainingBatch) -> None`: 更新策略网络

    * `_update_value_network(self, batch: TrainingBatch) -> None`: 更新价值网络

    * `_update_reward_model(self, batch: TrainingBatch) -> None`: 更新奖励模型

    * `_compute_advantages(self, batch: TrainingBatch) -> torch.Tensor`: 计算优势函数

  * `DAPOTrainer(BaseTrainer)`: DAPO 训练器

    * `_update_policy_network(self, batch: TrainingBatch) -> None`: 确定性策略更新

  * `GSPOTrainer(BaseTrainer)`: GSPO 训练器

    * `_update_policy_network(self, batch: TrainingBatch) -> None`: 随机性策略更新

* **veRL 框架集成**

  * `veRLIntegration(Component)`: veRL 框架集成组件

    * `configure_training(self, config: TrainingConfig) -> veRLConfig`: 配置 veRL 训练

    * `launch_distributed_training(self, config: veRLConfig) -> TrainingJob`: 启动分布式训练

    * `monitor_training_job(self, job: TrainingJob) -> TrainingStatus`: 监控训练任务

    * `get_best_checkpoint(self, job: TrainingJob) -> Checkpoint`: 获取最佳检查点

* **模型定义**

  * `PolicyNetwork(nn.Module)`: 策略网络 (支持 Transformer, ResNet 等)

    * `forward(self, state: torch.Tensor) -> torch.Tensor`: 前向传播

    * `sample_action(self, state: torch.Tensor) -> GUIAction`: 采样动作

  * `ValueNetwork(nn.Module)`: 价值网络

    * `forward(self, state: torch.Tensor) -> torch.Tensor`: 前向传播

  * `RewardModel(nn.Module)`: 奖励模型

    * `forward(self, state: torch.Tensor, action: torch.Tensor) -> torch.Tensor`: 预测奖励

* **环境与数据**

  * `GUIRLEnvironment(gym.Env)`: GUI 强化学习环境

    * `step(self, action: GUIAction) -> Tuple[ScreenState, float, bool, dict]`: 执行步骤

    * `reset(self) -> ScreenState`: 重置环境

    * `render(self, mode='human') -> Optional[np.ndarray]`: 渲染环境

  * `TrajectoryBuffer(ReplayBuffer)`: 轨迹缓冲区

    * `add_trajectory(self, trajectory: TrajectoryData) -> None`: 添加轨迹

    * `sample_batch(self, batch_size: int) -> TrainingBatch`: 采样批次

* **核心算法组件**

  * `AdvantageCalculator(Component)`: 优势计算器

    * `calculate_gae(self, rewards: torch.Tensor, values: torch.Tensor, dones: torch.Tensor) -> torch.Tensor`: 计算 GAE

* **算法数学建模**

  * `GRPOMathModel(MathModel)`: GRPO 数学模型

    * `policy_loss_function(self, policy_logits, advantages) -> torch.Tensor`: 策略损失函数

    * `value_loss_function(self, values, returns) -> torch.Tensor`: 价值损失函数

  * `DAPOMathModel(MathModel)`: DAPO 数学模型

  * `GSPOMathModel(MathModel)`: GSPO 数学模型

* **训练配置与管理**

  * `TrainingConfigManager(Component)`: 训练配置管理器

    * `load_config(self, path: str) -> TrainingConfig`: 加载配置

    * `save_config(self, config: TrainingConfig, path: str) -> None`: 保存配置

    * `validate_config(self, config: TrainingConfig) -> bool`: 验证配置

  * `GRPOLoss(nn.Module)`: GRPO 损失函数

    * `forward(self, policy_dist, value_preds, rewards, old_log_probs, advantages) -> Tuple[torch.Tensor, torch.Tensor]`: 计算损失