# AgenticX Human-in-the-Loop (HITL) 示例

本示例展示了如何使用 AgenticX 框架的 Human-in-the-Loop 功能，实现智能体与人类的协同工作。

## 🌟 功能特性

### 1. 安全装饰器 (`@human_in_the_loop`)
- **默认审批**: 所有被装饰的工具都需要人工审批
- **策略检查**: 支持动态策略函数，根据参数决定是否需要审批
- **自定义提示**: 可以自定义审批请求的提示信息

### 2. 多场景支持
- **数据库删除**: 高风险操作，始终需要审批
- **资金转账**: 大额转账（>10000）需要审批，小额转账自动通过
- **混合操作**: 安全操作 + 高风险操作的组合

### 3. 完整的工作流管理
- **事件驱动**: 基于事件日志的状态管理
- **审批历史**: 完整记录所有审批决定
- **状态恢复**: 审批后自动恢复工作流执行

## 🚀 快速开始

### 基本使用

```python
from agenticx.tools.security import human_in_the_loop

@human_in_the_loop(prompt="请批准删除操作")
def delete_database(db_name: str):
    return f"数据库 {db_name} 已删除"
```

### 策略检查

```python
@human_in_the_loop(
    prompt="请批准转账操作",
    policy_check=lambda account_from, account_to, amount: amount > 10000
)
def transfer_money(account_from: str, account_to: str, amount: float):
    return f"已转账 {amount} 元"
```

### 运行示例

```bash
# 数据库删除场景
python examples/human_in_the_loop_example.py --scenario delete_db

# 资金转账场景
python examples/human_in_the_loop_example.py --scenario transfer_money

# 混合操作场景
python examples/human_in_the_loop_example.py --scenario mixed_operations
```

## 📋 示例输出

```
🎭 AgenticX Human-in-the-Loop 演示
场景: delete_db
============================================================

🚀 开始执行任务: 删除生产环境数据库
==================================================

📋 初始执行 - 事件日志:
   1. [task_start] 无详细信息
   2. [llm_call] 无详细信息
   3. [llm_response] 无详细信息
   4. [tool_call] 工具: delete_database
   5. [human_request] 问题: ⚠️ 危险操作：请批准删除数据库操作
   当前状态: waiting_for_human
   步骤数: 5

🔔 收到审批请求:
   问题: ⚠️ 危险操作：请批准删除数据库操作
   上下文: Tool: delete_database, Args: {'db_name': 'production'}
   紧急程度: high
✅ 审批结果: APPROVED
   原因: 自动批准（演示模式）

🔄 审批通过，继续执行任务...

📋 审批后继续执行 - 事件日志:
   1. [task_start] 无详细信息
   2. [llm_call] 无详细信息
   3. [llm_response] 无详细信息
   4. [finish_task] 结果: 数据库删除操作已完成
   5. [task_end] 无详细信息
   当前状态: completed
   步骤数: 5

✅ 任务执行完成
   最终结果: 数据库删除操作已完成
   成功状态: True

📊 执行总结:
   任务ID: 60c56ba9-7e18-43dc-a93f-03d31bcb9732
   审批历史: 1 次审批
```

## 🔧 技术架构

### 核心组件

1. **`@human_in_the_loop` 装饰器**
   - 将普通函数转换为需要审批的工具
   - 支持策略检查函数
   - 抛出 `ApprovalRequiredError` 异常

2. **`ApprovalRequiredError` 异常**
   - 包含审批请求信息
   - 由 `ToolExecutor` 捕获并处理
   - 触发 `HumanRequestEvent` 事件

3. **`HumanRequestEvent` 事件**
   - 记录审批请求详情
   - 包含问题、上下文、紧急程度
   - 影响工作流状态判断

4. **`HITLWorkflowManager` 管理器**
   - 处理完整的 HITL 工作流
   - 管理审批请求和响应
   - 支持状态恢复

### 执行流程

```
1. Agent 决定调用工具
2. ToolExecutor 执行工具
3. @human_in_the_loop 检查是否需要审批
4. 如需审批，抛出 ApprovalRequiredError
5. 创建 HumanRequestEvent
6. 工作流暂停，等待人工输入
7. 收到审批结果后恢复执行
```

## 🎯 使用场景

### 1. 高风险操作
- 数据库删除
- 系统配置修改
- 资源释放

### 2. 财务操作
- 大额转账
- 预算批准
- 支付处理

### 3. 合规要求
- 法律文件处理
- 敏感数据访问
- 审计操作

## 🔒 安全特性

- **默认安全**: 装饰器默认要求审批
- **策略灵活**: 支持动态策略检查
- **异常安全**: 策略检查失败时默认需要审批
- **完整记录**: 所有审批决定都有完整记录

## 🚧 扩展方向

### 1. 真实审批界面
- Web 界面集成
- 移动端推送
- 邮件/短信通知

### 2. 多级审批
- 分级审批流程
- 角色权限控制
- 审批链路管理

### 3. 智能策略
- 机器学习驱动的策略
- 风险评估模型
- 自适应阈值调整

## 📚 相关文档

- [AgenticX 核心文档](../README.md)
- [工具系统文档](../agenticx/tools/README.md)
- [事件系统文档](../agenticx/core/README.md) 