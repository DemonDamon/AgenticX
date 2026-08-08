# AgenticX Evaluation 模块总结

> **内化来源**: Google ADK (Agent Development Kit)
> **创建日期**: 2024-12-27
> **核心价值**: 将智能体评估从"手工测试"升级为"工程化、自动化、标准化"的流程

> 结论更新时间：2026-05-29（覆盖 2026-02-07 之后的变更）（无重大变更）

---

## 模块概述

AgenticX Evaluation 模块是一个标准化的智能体评估框架，**内化自 Google ADK 的评估系统设计**。它提供了评估数据集定义、轨迹匹配、自动化评估执行等完整能力，使智能体的质量评估从主观判断转变为可量化、可重复的工程化流程。

---

## 目录结构

```
agenticx/evaluation/
├── __init__.py              # 模块导出接口
├── evalset.py               # 评估数据集定义
├── trajectory_matcher.py    # 轨迹匹配器
├── runner.py                # 评估执行器
├── llm_judge.py (NEW)       # LLM-as-a-Judge 评测器（内化自 Pydantic AI）
└── span_evaluator.py (NEW)  # 基于 Span 的细粒度评测器（内化自 Pydantic AI）
├── trace_converter.py (NEW) # Trace 转 EvalSet 转换器（参考 VeADK）
```

---

## 核心组件分析

### 0. 轨迹转换器 (trace_converter.py, P1-2)

**核心思想**：将执行轨迹自动转换为评估数据集，形成评测闭环。

#### TraceToEvalSetConverter
- **功能**: 从 `ExecutionTrajectory` 对象转换为 `EvalSet`
- **核心方法**:
  - `convert_from_trajectory()`: 转换单个轨迹为 EvalSet
  - `convert_from_dict()`: 从字典形式的轨迹转换
  - `_extract_query_from_trajectory()`: 从轨迹提取查询（TASK_START 信息）
  - `_extract_tool_uses_from_trajectory()`: 从轨迹提取工具调用序列（TOOL_CALL 步骤）
  - `_extract_reference_from_trajectory()`: 从轨迹提取参考答案（最后 LLM_RESPONSE）
- **业务价值**：将代理实际执行的轨迹自动转换为标准评估用例，无需手工标注即可构建评测数据集，加速评估工程化流程
- **依赖关系**：依赖 `ExecutionTrajectory`（来自 observability 模块）、`EvalSet` 和 `EvalCase`

---

## 核心组件分析

### 1. 评估数据集 (evalset.py)

**核心思想**：将测试用例标准化为 JSON 格式，支持版本管理和批量执行。

#### ExpectedToolUse
- **功能**: 定义期望的工具调用行为
- **关键字段**:
  - `tool_name`: 期望调用的工具名称
  - `arguments`: 期望的参数（可部分匹配）
  - `order`: 调用顺序（可选）
- **业务价值**: 支持精细化的工具调用行为验证

#### EvalCase
- **功能**: 单个评估用例
- **关键字段**:
  - `input`: 用户输入
  - `expected_output`: 期望的文本输出（可选）
  - `expected_tool_uses`: 期望的工具调用序列（可选）
  - `metadata`: 元数据（如难度、标签等）
- **业务价值**: 标准化测试用例格式，支持批量管理

#### EvalSet
- **功能**: 评估数据集
- **关键字段**:
  - `name`: 数据集名称
  - `version`: 版本号
  - `cases`: 评估用例列表
  - `metadata`: 数据集元数据
- **方法**:
  - `from_json_file()`: 从 JSON 文件加载
  - `to_json_file()`: 保存为 JSON 文件
  - `add_case()`: 添加用例
- **业务价值**: 支持评估数据集的版本管理和协作

---

### 2. 轨迹匹配 (trajectory_matcher.py)

**核心思想**：将智能体的实际执行轨迹与期望行为进行对比，支持多种匹配模式。

#### MatchMode
- **枚举值**:
  - `EXACT`: 精确匹配（顺序和参数完全一致）
  - `PARTIAL`: 部分匹配（允许额外的工具调用）
  - `UNORDERED`: 无序匹配（只要包含所有期望的工具调用即可）

#### TrajectoryMatcher
- **功能**: 轨迹匹配器
- **核心方法**:
  - `match_trajectory()`: 匹配实际轨迹与期望轨迹
  - `_match_exact()`: 精确匹配逻辑
  - `_match_partial()`: 部分匹配逻辑
  - `_match_unordered()`: 无序匹配逻辑
  - `_match_tool_use()`: 单个工具调用匹配
  - `_match_arguments()`: 参数匹配（支持部分匹配）
- **返回值**: `MatchResult`（包含是否匹配、匹配详情、未匹配项等）
- **业务价值**: 提供灵活的验证策略，适应不同严格度的测试需求

---

### 3. 评估执行器 (runner.py)

**核心思想**：自动化执行评估数据集，收集结果并生成报告。

#### EvaluationRunner
- **功能**: 评估执行引擎
- **核心方法**:
  - `run_eval()`: 执行单个评估用例
  - `run_eval_set()`: 批量执行评估数据集
  - `_compare_output()`: 比较输出文本
  - `_extract_trajectory()`: 从 EventLog 提取实际轨迹
- **返回值**: `EvalResult`（包含通过率、详细结果、失败用例等）
- **业务价值**: 支持 CI/CD 集成，实现智能体的自动化回归测试

---

### 4. LLM-as-a-Judge (llm_judge.py, 新增)

**核心思想**：利用高级 LLM 充当裁判，对智能体输出进行主观质量评估。

#### LLMJudge
- **功能**: 基于 Rubric 的评测器
- **特性**:
  - 支持 **Binary (pass/fail)** 和 **Continuous (0-1 score)** 评分模式
  - 支持集成上下文信息（输入、期望输出）到评测 Prompt
  - 内置 JSON 鲁棒解析机制（正则提取 + 关键字降级）
- **业务价值**: 解决无法通过字符串匹配验证的语义化质量评估问题

#### CompositeJudge
- **功能**: 多裁判组合策略
- **策略**: 支持 all (全票通过)、any (一票通过)、majority (多数票)、average (平均分)
- **业务价值**: 消除单点 LLM 评测的偏见，提升评估结果的客观性

---

### 5. Span-based 细粒度评测 (span_evaluator.py, 新增)

**核心思想**：深入执行轨迹内部，基于 Span 树验证中间状态与执行模式。

#### SpanEvaluator
- **功能**: 轨迹深度审计
- **核心方法**:
  - `evaluate_tool_was_called()`: 验证特定工具是否被调用（含参数检查）
  - `evaluate_execution_order()`: 验证 Span 的执行顺序（支持严格/非严格模式）
  - `evaluate_no_errors()`: 全局扫描是否存在错误状态的 Span
  - `evaluate_duration_within()`: 性能审计，验证耗时是否超标
- **业务价值**: 将“结果导向”的评估扩展到“过程导向”，实现对智能体思维路径的工程化约束

---

## 模块架构特点

### 1. 标准化数据格式
- **evalset.json**: 统一的评估数据集格式，支持版本管理和团队协作
- **轨迹表示**: 使用 `EventLog` 的工具调用事件作为轨迹

### 2. 灵活的验证策略
- **多种匹配模式**: 从严格的精确匹配到宽松的无序匹配，适应不同场景
- **部分参数匹配**: 允许只验证关键参数，忽略无关细节

### 3. 自动化执行
- **批量运行**: 一次性执行整个评估数据集
- **结果汇总**: 自动生成通过率和失败报告
- **CI/CD 友好**: 支持命令行执行和结果输出

---

## 技术特点

1. **工程化评估**: 从手工测试升级为自动化、可重复的评估流程
2. **标准化格式**: JSON 数据集支持版本管理和团队协作
3. **多维验证**: 支持文本输出和工具调用轨迹的双重验证
4. **灵活匹配**: 三种匹配模式适应不同严格度需求
5. **高度集成**: 与 AgenticX 的 EventLog 和 AgentExecutor 无缝集成

---

## 使用场景

1. **回归测试**: 在代码变更后验证智能体行为是否符合预期
2. **版本对比**: 比较不同版本智能体的性能差异
3. **Prompt 优化**: A/B 测试不同 Prompt 的效果
4. **持续集成**: 在 CI/CD 流程中自动执行评估

---

## 与 ADK / Pydantic AI 对比

| 维度 | ADK | Pydantic AI | AgenticX |
|------|-----|-------------|----------|
| 数据集格式 | JSON | - | 完全内化 (evalset.json) |
| 轨迹匹配 | 精确/部分/无序 | - | 完全内化 |
| LLM-as-a-Judge | - | LLMJudge | 内化实现 (llm_judge.py) |
| Span 级审计 | - | SpanTree/Evaluator | 内化实现 (span_evaluator.py) |
| 自动化执行 | EvaluationRunner | - | 深度集成 |

---

## 总结

AgenticX Evaluation 模块通过内化 Google ADK 的评估系统设计，为智能体开发提供了**标准化、自动化、工程化**的质量保障能力。它不仅支持功能正确性验证，还为性能优化和迭代改进提供了数据支撑，是构建可靠智能体应用的关键基础设施。

**VeADK 内化**：
- **TraceToEvalSetConverter（P1-2）**：新增 `trace_converter.py` 实现从 `ExecutionTrajectory` 到 `EvalSet` 的自动转换，支持从执行轨迹自动提取查询、工具调用和参考答案，形成完整的评测闭环，加速评估数据集的构建

