### M16.5: 执行引擎 (`agenticx.embodiment.execution`)

> 启发来源: ACT-1, Gato, RT-2 等具身智能模型

* `TaskPlanner(Component)`: 任务规划器

  * `decompose_task(self, task: str, context: GUIAgentContext) -> List[SubTask]`: 分解任务

  * `generate_plan(self, task: str, context: GUIAgentContext) -> ExecutionPlan`: 生成执行计划

  * `_select_planning_strategy(self, task_complexity: float) -> PlanningStrategy`: 选择规划策略

* `HierarchicalPlanner(TaskPlanner)`: 分层规划器

  * `generate_hierarchical_plan(self, task: str) -> HierarchicalPlan`: 生成分层计划

* `ActionExecutor(Component)`: 动作执行器

  * `async execute_action(self, action: GUIAction, env: GUIEnvironment) -> ActionResult`: 执行动作

  * `_get_platform_executor(self, platform: str) -> PlatformExecutor`: 获取平台执行器

* `VisionProcessor(Component)`: 视觉处理器

  * `process_screenshot(self, screenshot: bytes) -> ScreenUnderstanding`: 处理截屏

  * `detect_elements(self, screenshot: bytes) -> List[InteractionElement]`: 检测元素

  * `ocr(self, screenshot: bytes, region: Optional[BoundingBox] = None) -> str`: 文字识别

* `ElementDetector(VisionProcessor)`: 元素检测器

  * `detect_from_image(self, image: bytes) -> List[DetectedElement]`: 从图像检测

  * `detect_from_vdom(self, vdom: VirtualDOM) -> List[DetectedElement]`: 从虚拟DOM检测

* `ActionValidator(Component)`: 动作验证器

  * `validate_action(self, action: GUIAction, state: ScreenState) -> bool`: 验证动作

  * `_check_preconditions(self, action: GUIAction, state: ScreenState) -> bool`: 检查前置条件

  * `_check_postconditions(self, action: GUIAction, state: ScreenState) -> bool`: 检查后置条件

* `ErrorRecovery(Component)`: 错误恢复机制

  * `handle_execution_error(self, error: ExecutionError, context: GUIAgentContext) -> RecoveryAction`: 处理执行错误

  * `_diagnose_error(self, error: ExecutionError) -> ErrorCause`: 诊断错误原因

  * `_propose_recovery_strategy(self, cause: ErrorCause) -> RecoveryStrategy`: 提出恢复策略

* `StepLevelRecovery(ErrorRecovery)`: 步骤级恢复

  * `retry_step(self, context: GUIAgentContext) -> RecoveryAction`: 重试步骤

  * `alternative_step(self, context: GUIAgentContext) -> RecoveryAction`: 替代步骤

* `TaskLevelRecovery(ErrorRecovery)`: 任务级恢复

  * `replan_task(self, context: GUIAgentContext) -> RecoveryAction`: 重新规划任务

  * `abandon_task(self, context: GUIAgentContext) -> RecoveryAction`: 放弃任务

* `GlobalRecovery(ErrorRecovery)`: 全局恢复

  * `reset_environment(self, context: GUIAgentContext) -> RecoveryAction`: 重置环境

* `ReflectionEngine(Component)`: 反思引擎

  * `reflect_on_trajectory(self, trajectory: TrajectoryData) -> ReflectionResult`: 对轨迹进行反思

  * `generate_insights(self, trajectory: TrajectoryData) -> List[Insight]`: 生成洞察

  * `update_knowledge_base(self, insights: List[Insight]) -> None`: 更新知识库