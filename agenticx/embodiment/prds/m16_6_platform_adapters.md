### M16.6: 数据飞轮系统 (`agenticx.embodiment.flywheel`)

> 启发来源: Tesla 的数据飞轮, Waymo 的持续学习系统

* `DataGeneratorAgent(GUIAgent)`: 数据生成智能体

  * `generate_diverse_trajectories(self, app_context: AppContext, num_trajectories: int) -> List[TrajectoryData]`: 生成多样化轨迹

  * `generate_edge_case_trajectories(self, app_context: AppContext, scenarios: List[str]) -> List[TrajectoryData]`: 生成边缘场景轨迹

* `TaskSampler(Component)`: 任务采样器

  * `sample_tasks_for_generation(self, app_context: AppContext, strategy: str) -> List[Task]`: 采样生成任务

* `QualityEvaluator(Component)`: 质量评估器

  * `evaluate_trajectory_quality(self, trajectory: TrajectoryData) -> QualityScore`: 评估轨迹质量

* `DiversityCalculator(Component)`: 多样性计算器

  * `calculate_dataset_diversity(self, dataset: List[TrajectoryData]) -> DiversityScore`: 计算数据集多样性

* `NoveltyDetector(Component)`: 新颖性检测器

  * `detect_novel_states(self, trajectory: TrajectoryData, known_states: Set[str]) -> List[ScreenState]`: 检测新颖状态

* `ContinuousLearner(Component)`: 持续学习器

  * `trigger_retraining(self, new_data: List[TrajectoryData], performance_degradation: float) -> bool`: 触发重训练

  * `select_data_for_retraining(self, new_data: List[TrajectoryData]) -> List[TrajectoryData]`: 选择重训练数据

* `ModelUpdater(Component)`: 模型更新器

  * `update_model_in_production(self, new_model: Model, validation_score: float) -> None`: 更新生产模型

* `PerformanceTracker(Component)`: 性能追踪器

  * `track_model_performance(self, model: Model, test_suite: TestSuite) -> PerformanceReport`: 追踪模型性能

* `DataFlywheel(Component)`: 数据飞轮

  * `run_cycle(self) -> None`: 运行飞轮循环

* `FeedbackLoop(Component)`: 反馈循环

  * `collect_feedback(self) -> List[Feedback]`: 收集反馈

  * `process_feedback(self, feedback: List[Feedback]) -> None`: 处理反馈

* `@flywheel_callback`: 飞轮回调装饰器

  * `on_new_data(func)`

  * `on_model_update(func)`