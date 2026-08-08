# Flow 模块结论

## Responsibility

`agenticx/flow` 提供两类互补能力：（1）基于装饰器的事件驱动工作流编排，供业务子类用 `@start` / `@listen` / `@router` 声明拓扑并由 `Flow.kickoff()` / `kickoff_async()` 调度执行；（2）可干预的执行计划模型 `ExecutionPlan` 及其管理器 `ExecutionPlanManager`，用于分阶段/子任务进度追踪、暂停恢复与持久化，供 `agenticx/planner` 的动态重规划消费。设计参考 crewAI Flow 与 Refly ProgressPlan/PilotEngine 思路，但二者在仓库内尚未直接耦合——`Flow` 执行引擎不自动读写 `ExecutionPlan`。

## Entry points and public interfaces

- **包导出**：`from agenticx.flow import Flow, FlowState, start, listen, router, or_, and_, ExecutionPlan, ExecutionPlanManager, …`（见 `agenticx/flow/__init__.py` 的 `__all__`）。
- **工作流侧**：子类继承 `Flow[T]`（`T` 为 `dict` 或 Pydantic `BaseModel`），调用 `kickoff(inputs)` 或 `kickoff_async(inputs)`；辅助 API 含 `reset()`、`get_execution_summary()`、`execution_state`。
- **计划侧**：`ExecutionPlan` 的干预方法（`pause` / `resume` / `reset_node` / `add_subtask` / `delete_subtask` 等）、序列化（`to_dict` / `from_dict` / `to_mermaid` / `to_execution_summary`）；`ExecutionPlanManager.register` / `get` / `update` / `persist` 及事件回调 `on()` / `on_plan_updated` 等。

## Core execution path

**Flow 编排**：类定义时 `FlowMeta` 扫描方法，收集 `_start_methods`、`_listeners`、`_routers` 与路由返回值常量；`kickoff_async` 先将 `FlowExecutionState.status` 置为 `running`，依次执行无条件 `@start()` 方法，再循环 `_process_listeners()`——对每个未完成的 listener 用 `_check_condition()` 评估 OR/AND 或嵌套 `FlowCondition`，满足则 `_collect_trigger_outputs()` 把上游输出作为 `result` 或命名字段传入 `_execute_method()`；`@router` 返回的字符串常量会被 `mark_completed` 为虚拟方法名，从而触发 `@listen("SUCCESS")` 一类分支。同步 `kickoff()` 在无运行中事件循环时用 `asyncio.run`，否则线程池包装异步路径。

**ExecutionPlan 生命周期**：调用方构造 `ExecutionPlan(session_id, goal, stages=…)` → `ExecutionPlanManager.register()` 写入内存缓存 → 可选 `persist()` 经 `PlanStorageProtocol` 落盘 → 执行器更新子任务/阶段状态并 `update()` → 干预时 `pause_plan` / `resume_plan` / `reset_subtask` 修改 `intervention_state` 并发射 `PlanEvent`。

## Important classes and functions

| 符号 | 角色 |
|------|------|
| `FlowMeta` | 元类：类创建时注册 start/listen/router 拓扑 |
| `Flow` | 工作流基类与异步执行引擎 |
| `FlowState` / `FlowExecutionState` | 用户态（Pydantic，含 `id`）与运行时完成集/输出映射 |
| `start` / `listen` / `router` / `or_` / `and_` | 装饰器与条件组合器，包装为 `StartMethod` / `ListenMethod` / `RouterMethod` |
| `FlowCondition` / `OR_CONDITION` / `AND_CONDITION` | 嵌套触发条件类型 |
| `ExecutionPlan` / `ExecutionStage` / `Subtask` | 阶段—子任务层级计划与进度属性 |
| `SubtaskStatus` / `StageStatus` / `InterventionState` | 计划状态枚举 |
| `ExecutionPlanManager` | CRUD、持久化、子任务/干预辅助、事件总线 |
| `InMemoryPlanStorage` / `FilePlanStorage` | 内存与 JSON 文件存储（默认目录 `.agenticx/plans`） |
| `PlanEvent` | 计划变更事件载荷 |

## Data and configuration

- **Flow 运行时状态**：`Flow._state`（泛型 `T`）、`FlowExecutionState.completed_methods` / `method_outputs` / `status`（`pending` \| `running` \| `paused` \| `completed` \| `failed`）。
- **ExecutionPlan 字段**：`session_id`、`goal`、`stages[]`、`current_stage_index`、`intervention_state`、`max_epochs` / `current_epoch` 等；子任务含 `query`、`result`、`error`、`scope` 等扩展字段。
- **持久化**：`FilePlanStorage` 按 `session_id` 写 `{storage_dir}/{session_id}.json`；无全局 YAML 节，存储目录由构造参数决定。

## Dependencies

- **运行时**：`pydantic`（`FlowState`、`ExecutionPlan` 模型）；标准库 `asyncio`、`inspect`。
- **上游消费者**：`agenticx.planner.adaptive_planner.AdaptivePlanner` 依赖 `ExecutionPlan` 做 LLM 重规划与 patch 应用。
- **外部参考**：模块 docstring 标明 crewAI Flow、Refly pilot 类型与 formatter 为设计来源，非运行时硬依赖。

## Tests and operations

- `tests/test_smoke_crewai_flow.py`：装饰器元数据、OR/AND 条件、`Flow.kickoff_async` 拓扑、Pydantic `FlowState`、异步 start 方法等。
- `tests/test_smoke_refly_plan_manager.py`：`ExecutionPlanManager` CRUD、干预、事件、`InMemoryPlanStorage` / `FilePlanStorage` 及与 `AdaptivePlanner` 的集成冒烟。
- **运维提示**：Flow 实例默认 `flow_id` 为 UUID；计划持久化需显式选用 `FilePlanStorage` 并 `auto_persist=True` 或手动 `persist()`。

## Unverified or ambiguous

- 仓库内未见生产路径将 `Flow.kickoff_async` 与 `ExecutionPlanManager` 串联；计划模块更像独立子系统，由 planner/未来 pilot 执行器接入。
- `@start(condition=…)` 的条件起始在 `kickoff_async` 中被跳过（仅执行无条件 start），条件起始的实际触发路径需调用方自行保证或尚未完整落地。
