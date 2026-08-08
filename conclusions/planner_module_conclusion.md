# AgenticX Planner 模块（agenticx/planner）完整结构分析

> 结论更新时间：2026-05-29（覆盖 2026-01-03 之后的变更）（无重大变更）

## 目录路径
`agenticx/planner`

## 模块概述

AgenticX Planner 模块提供智能规划和动态重规划能力，支持基于执行快照和上下文的智能计划调整。该模块借鉴自 Refly 的 IntentAnalysisService 和 PilotEngineService，实现了可干预智能体的动态重规划机制。

## 完整目录结构和文件摘要

```
agenticx/planner/
├── __init__.py
└── adaptive_planner.py
```

### __init__.py
**文件功能**：作为 Planner 模块的入口，统一导出核心规划器类和类型定义
**技术实现**：通过 `from .adaptive_planner import` 聚合导入，在 `__all__` 中显式暴露公开 API
**关键组件**：`AdaptivePlanner`、`PlanPatch`、`PlanPatchOperation`、`ReplanningContext`
**业务逻辑**：为上层业务提供统一的规划器接口
**依赖关系**：依赖本目录内 `adaptive_planner.py`

### adaptive_planner.py
**文件功能**：实现动态重规划器，基于执行快照和上下文进行智能计划调整
**技术实现**：
1. 定义 `LLMProtocol` 协议接口，支持任意 LLM 实现
2. `AdaptivePlanner` 类封装重规划逻辑，支持 LLM 调用和 Patch 应用
3. `PlanPatch` 数据模型表示计划修改操作（add/delete/modify subtasks/stages）
4. `ReplanningContext` 封装重规划所需的所有上下文信息
5. Prompt 模板支持 Mermaid 流程图和执行摘要注入
**关键组件**：
- `AdaptivePlanner` 类：核心重规划器
  - `replan()`：执行重规划，返回 `PlanPatch`
  - `apply_patch()`：应用 Patch 到 `ExecutionPlan`
  - `_build_replanning_context()`：构建重规划上下文
  - `_build_prompt()`：生成 LLM Prompt
  - `_parse_response()`：解析 LLM 响应为 `PlanPatch`
  - `_apply_operation()`：应用单个操作到计划
- `PlanPatch`：计划 Patch 数据模型
  - `operations`：操作列表（`SubtaskPatch` 或 `StagePatch`）
  - `reasoning`：修改原因说明
  - `confidence`：置信度（0-1）
- `PlanPatchOperation`：Patch 操作类型枚举
  - `ADD_SUBTASK` / `DELETE_SUBTASK` / `MODIFY_SUBTASK`
  - `ADD_STAGE` / `DELETE_STAGE` / `MODIFY_STAGE`
  - `REORDER_SUBTASKS`
- `ReplanningContext`：重规划上下文
  - `user_question`：用户原始问题
  - `user_feedback`：用户反馈（可选）
  - `mermaid_diagram`：Mermaid 流程图
  - `execution_summary`：执行摘要
  - `completed_findings`：已完成发现列表
  - `current_epoch` / `max_epochs`：纪元信息
  - `available_tools`：可用工具列表
- `MockLLM`：模拟 LLM 实现（用于测试）
**核心能力**：
- 上下文构建：从 `ExecutionPlan` 提取 Mermaid 流程图和执行摘要
- LLM 调用：使用自定义 Prompt 模板调用 LLM 进行重规划
- 响应解析：支持 JSON 和 Markdown 代码块格式的响应解析
- Patch 应用：将 LLM 返回的操作应用到 `ExecutionPlan`
**业务逻辑**：
1. 接收当前 `ExecutionPlan` 和用户反馈
2. 构建包含 Mermaid 流程图和执行摘要的重规划上下文
3. 调用 LLM 生成 `PlanPatch`（包含操作列表和原因说明）
4. 解析并应用 Patch 到 `ExecutionPlan`，实现动态调整
**依赖关系**：
- 依赖 `agenticx.flow.execution_plan`：`ExecutionPlan`、`ExecutionStage`、`Subtask` 等
- 依赖外部 LLM 实现（通过 `LLMProtocol` 协议）
**使用示例**：
```python
from agenticx.planner import AdaptivePlanner
from agenticx.flow import ExecutionPlan

planner = AdaptivePlanner(llm=my_llm)

# 对现有计划进行重规划
patch = await planner.replan(
    plan=current_plan,
    user_feedback="需要增加对竞品的分析"
)

# 应用 Patch
updated_plan = planner.apply_patch(current_plan, patch)
```

## 技术特点

### 1. 协议化设计
- `LLMProtocol` 协议允许任意 LLM 实现接入，不绑定特定库
- `MockLLM` 提供测试友好的模拟实现

### 2. 上下文丰富
- 集成 Mermaid 流程图可视化当前执行状态
- 提取执行摘要和已完成发现，为 LLM 提供充分上下文
- 支持用户反馈注入，实现交互式重规划

### 3. 操作原子化
- `PlanPatch` 将计划修改分解为原子操作
- 支持子任务和阶段的增删改操作
- 每个操作可独立应用，支持部分失败场景

### 4. 错误处理
- LLM 响应解析失败时返回空 Patch，不中断执行
- 操作应用失败时记录日志但不影响其他操作
- 支持置信度评估，便于上层决策

## 参考实现

- **Refly IntentAnalysisService**：意图分析和计划生成逻辑
- **Refly PilotEngineService**：动态重规划机制
- **Refly prompt/formatter.ts**：Mermaid 流程图生成

## 未来扩展方向

1. 支持更复杂的 Patch 操作（如批量操作、条件操作）
2. 集成更多上下文信息（如工具调用历史、错误日志）
3. 支持多轮对话式重规划
4. 优化 Prompt 模板，降低 Token 消耗
5. 支持 Patch 操作的撤销和重做

