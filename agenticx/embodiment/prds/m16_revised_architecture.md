### M16: Embodiment 模块 - 修订版架构

本文档概述了 `agenticx.embodiment` 模块的修订版架构，旨在与核心 `agenticx` 框架深度集成。

#### 核心原则

1.  **基于组件的架构**: `embodiment` 模块内的所有主要功能都将作为 `agenticx.core.component.Component` 的子类来实现。
2.  **统一的智能体模型**: `GUIAgent` 将成为 `agenticx.core.agent.Agent` 的一个特化版本，继承其核心功能。
3.  **标准化的工具**: GUI 操作将被建模为 `agenticx.core.tool.BaseTool` 的子类，从而能够与 `ToolRegistry` 和 `AgentExecutor` 无缝集成。
4.  **事件驱动方法**: 该模块将使用 `agenticx.core.event` 系统来记录所有的 GUI 交互、状态变更和学习事件。
5.  **集成化记忆**: 学习组件将利用 `agenticx.memory` 来存储和检索关于 GUI 应用、用户行为和优化后工作流的知识。

#### 修订后的模块结构

*   **`agenticx.embodiment.core`**: 此模块将包含 GUI 交互的核心抽象，并经过重构以与 `agenticx` 框架保持一致。
*   **`agenticx.embodiment.learning`**: 此模块将容纳负责从 GUI 交互中学习并优化智能体性能的组件。
*   **`agenticx.embodiment.tools`**: 一个新模块，用于将 GUI 操作定义为 `BaseTool` 的子类。

#### 关键组件变更

*   **`GUIAgent`**: 现在将继承自 `agenticx.core.agent.Agent`，并由 `learning` 模块中的多个 `Component` 实例组成。
*   **`GUIAction`**: 将被 `agenticx.embodiment.tools` 模块中的一组 `BaseTool` 子类所取代 (例如, `ClickTool`, `InputTool`, `SwipeTool`)。
*   **学习组件**: `AppKnowledgeRetriever`, `GUIExplorer` 等将被重构为 `agenticx.core.component.Component` 的子类。