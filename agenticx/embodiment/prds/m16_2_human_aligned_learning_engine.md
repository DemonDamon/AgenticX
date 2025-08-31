### M16.2: 人类对齐学习引擎 (`agenticx.embodiment.learning`)

> 启发来源: 人类学习新应用的自然过程和认知科学研究

**核心思想**: 将学习过程分解为一系列可独立工作、但又协同进化的 `Component`。这些组件在 `GUIAgent` 的生命周期中被调用，通过分析 `GUIAgentContext` 中的历史数据，不断优化智能体的行为策略和对应用的理解。

--- 

* `AppKnowledgeRetriever(agenticx.core.component.Component)`: **应用知识检索器**
  * **职责**: 从过去的经验中提取关于特定应用的高层知识。
  * `get_app_context(self, app_name: str, memory: agenticx.memory.component.MemoryComponent) -> AppContext`: 从内存中检索并构建指定应用的上下文，包括常用的 UI 模式、主要任务等。
  * `find_similar_apps(self, app_name: str, memory: agenticx.memory.component.MemoryComponent) -> List[str]`: 基于 UI 结构和交互模式，在知识库中寻找相似的应用。

* `GUIExplorer(agenticx.core.component.Component)`: **GUI 智能探索器**
  * **职责**: 在新的或不熟悉的应用界面上进行自主探索，以发现新的功能和交互路径。
  * `plan_exploration(self, context: GUIAgentContext) -> List[GUIAction]`: 基于当前屏幕状态 (`ScreenState`) 和已有的应用知识，规划一系列探索性的 `GUIAction`。
  * `record_exploration_trace(self, trace: List[Tuple[ScreenState, GUIAction, ScreenState]], memory: agenticx.memory.component.MemoryComponent) -> None`: 将探索过程中产生的轨迹 (状态-动作-新状态) 存入内存。

* `TaskSynthesizer(agenticx.core.component.Component)`: **任务合成器**
  * **职责**: 从原始的交互轨迹中逆向工程出具有意义的、可重复的任务。
  * `synthesize_from_traces(self, traces: List[ActionTrace], memory: agenticx.memory.component.MemoryComponent) -> List[GUITask]`: 分析一系列动作轨迹，将其聚类和抽象，生成新的 `GUITask` 定义并存入内存。
  * `build_state_machine(self, app_name: str, memory: agenticx.memory.component.MemoryComponent) -> AppFSM`: 基于一个应用的所有已知轨迹，构建其功能性的有限状态机模型。

* `DeepUsageOptimizer(agenticx.core.component.Component)`: **深度使用优化器**
  * **职责**: 分析已有任务的执行历史，寻找更优的执行路径 (工作流)。
  * `optimize_workflow(self, task: GUITask, history: List[GUIAgentResult], memory: agenticx.memory.component.MemoryComponent) -> GUIWorkflow`: 分析特定任务的所有成功和失败历史，生成一个更高效、更鲁棒的 `GUIWorkflow` 并存入内存。

* `EdgeCaseHandler(agenticx.core.component.Component)`: **边缘情况处理器**
  * **职责**: 从失败的执行中学习，识别边缘情况并生成应对策略。
  * `reflect_on_failure(self, failed_context: GUIAgentContext, error: Exception) -> ReflectionResult`: 对一次失败的执行进行反思，分析失败的根本原因。
  * `generate_recovery_strategy(self, reflection: ReflectionResult) -> GUIWorkflow`: 根据反思结果，生成一个用于错误恢复的微型工作流。

* `KnowledgeEvolution(agenticx.core.component.Component)`: **知识演化管理器**
  * **职责**: 统一管理和调度其他学习组件，确保知识库的持续、一致的进化。
  * `evolve(self, context: GUIAgentContext, memory: agenticx.memory.component.MemoryComponent) -> None`: 在任务执行后被调用，根据最新的 `GUIAgentContext` 触发相关的学习组件 (如 `TaskSynthesizer`, `DeepUsageOptimizer` 等)，更新知识库。