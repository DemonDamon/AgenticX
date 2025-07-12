#!/usr/bin/env python3
"""
AgenticX Human-in-the-Loop (HITL) 示例

演示如何使用 @human_in_the_loop 装饰器保护高风险工具操作，
以及如何处理人工审批流程。
"""

import sys
import os
import time
from typing import Dict, Any, Optional

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from agenticx.core import Agent, Task, AgentExecutor, EventLog, HumanRequestEvent, HumanResponseEvent, tool
from agenticx.tools.security import human_in_the_loop, ApprovalRequiredError
from agenticx.llms.response import LLMResponse, TokenUsage
from agenticx.llms.base import BaseLLMProvider


# ===== 1. 定义高风险工具 =====

@human_in_the_loop(prompt="⚠️ 危险操作：请批准删除数据库操作")
def delete_database(db_name: str) -> str:
    """删除数据库 - 需要人工审批"""
    return f"✅ 数据库 {db_name} 已成功删除"


@human_in_the_loop(
    prompt="💰 财务操作：请批准转账操作",
    policy_check=lambda account_from, account_to, amount: amount > 10000  # 只有超过1万的转账需要审批
)
def transfer_money(account_from: str, account_to: str, amount: float) -> str:
    """转账操作 - 大额转账需要人工审批"""
    return f"✅ 已从账户 {account_from} 向账户 {account_to} 转账 {amount} 元"


@tool()
def read_file_content(file_path: str) -> str:
    """读取文件内容 - 安全操作，无需审批"""
    return f"📄 文件内容：{file_path} 的内容..."


# ===== 2. 智能的 Mock LLM Provider =====

class InteractiveMockLLM(BaseLLMProvider):
    """支持多种场景的 Mock LLM Provider"""
    
    def __init__(self, scenario: str = "delete_db"):
        super().__init__(model="mock-interactive-model")
        # 使用 object.__setattr__ 绕过 Pydantic 验证
        object.__setattr__(self, 'scenario', scenario)
        object.__setattr__(self, 'call_count', 0)
        object.__setattr__(self, 'responses', self._get_scenario_responses(scenario))
    
    def _get_scenario_responses(self, scenario: str) -> list:
        """根据场景返回不同的响应序列"""
        scenarios = {
            "delete_db": [
                '{"action": "tool_call", "tool": "delete_database", "args": {"db_name": "production"}, "reasoning": "用户要求删除生产数据库"}',
                '{"action": "finish_task", "result": "数据库删除操作已完成", "reasoning": "人工审批通过，操作执行成功"}'
            ],
            "transfer_money": [
                '{"action": "tool_call", "tool": "transfer_money", "args": {"account_from": "A001", "account_to": "B002", "amount": 50000}, "reasoning": "执行大额转账操作"}',
                '{"action": "finish_task", "result": "转账操作已完成", "reasoning": "人工审批通过，转账成功"}'
            ],
            "mixed_operations": [
                '{"action": "tool_call", "tool": "read_file_content", "args": {"file_path": "/etc/config.txt"}, "reasoning": "先读取配置文件"}',
                '{"action": "tool_call", "tool": "delete_database", "args": {"db_name": "test_db"}, "reasoning": "然后删除测试数据库"}',
                '{"action": "finish_task", "result": "所有操作已完成", "reasoning": "文件读取和数据库删除都已完成"}'
            ]
        }
        return scenarios.get(scenario, scenarios["delete_db"])
    
    def invoke(self, prompt: str, **kwargs) -> LLMResponse:
        current_count = self.call_count
        
        if current_count < len(self.responses):
            content = self.responses[current_count]
        else:
            # 默认响应
            content = '{"action": "finish_task", "result": "任务完成", "reasoning": "没有更多操作"}'
        
        # 递增调用计数
        object.__setattr__(self, 'call_count', current_count + 1)
        
        return LLMResponse(
            id=f"mock-response-{self.call_count}",
            model_name=self.model,
            created=int(time.time()),
            content=content,
            choices=[],
            token_usage=TokenUsage(prompt_tokens=10, completion_tokens=20, total_tokens=30),
            cost=0.001
        )
    
    async def ainvoke(self, prompt: str, **kwargs) -> LLMResponse:
        return self.invoke(prompt, **kwargs)
    
    def stream(self, prompt: str, **kwargs):
        response = self.invoke(prompt, **kwargs)
        yield response.content
    
    async def astream(self, prompt: str, **kwargs):
        response = await self.ainvoke(prompt, **kwargs)
        yield response.content


# ===== 3. 人工审批模拟器 =====

class HumanApprovalSimulator:
    """模拟人工审批过程"""
    
    def __init__(self, auto_approve: bool = True):
        self.auto_approve = auto_approve
        self.approval_history = []
    
    def process_approval_request(self, event: HumanRequestEvent) -> Dict[str, Any]:
        """处理审批请求"""
        print(f"\n🔔 收到审批请求:")
        print(f"   问题: {event.question}")
        print(f"   上下文: {event.context}")
        print(f"   紧急程度: {event.urgency}")
        
        if self.auto_approve:
            decision = "approved"
            reason = "自动批准（演示模式）"
        else:
            # 在实际应用中，这里可以集成真实的审批界面
            decision = input("请输入决定 (approved/rejected): ").strip().lower()
            reason = input("请输入原因: ").strip()
        
        approval_result = {
            "request_id": event.id,
            "decision": decision,
            "reason": reason,
            "timestamp": time.time()
        }
        
        self.approval_history.append(approval_result)
        
        print(f"✅ 审批结果: {decision.upper()}")
        print(f"   原因: {reason}")
        
        return approval_result


# ===== 4. 完整的 HITL 工作流管理器 =====

class HITLWorkflowManager:
    """管理完整的 HITL 工作流"""
    
    def __init__(self, agent: Agent, executor: AgentExecutor, approval_simulator: HumanApprovalSimulator):
        self.agent = agent
        self.executor = executor
        self.approval_simulator = approval_simulator
        self.workflow_history = []
    
    def execute_task_with_hitl(self, task: Task) -> Dict[str, Any]:
        """执行带有 HITL 支持的任务"""
        print(f"\n🚀 开始执行任务: {task.description}")
        print("=" * 50)
        
        # 第一次执行，可能触发 HITL
        result = self.executor.run(self.agent, task)
        event_log: EventLog = result["event_log"]
        
        self._print_event_log(event_log, "初始执行")
        
        # 处理人工审批请求
        if event_log.needs_human_input():
            approval_results = self._handle_human_requests(event_log)
            
            # 如果有批准的请求，继续执行
            if any(r["decision"] == "approved" for r in approval_results):
                print(f"\n🔄 审批通过，继续执行任务...")
                # 这里需要实现恢复执行的逻辑
                # 在实际应用中，应该有一个状态恢复机制
                result = self._resume_execution_after_approval(task, event_log)
        
        workflow_record = {
            "task_id": task.id,
            "task_description": task.description,
            "result": result,
            "needs_approval": event_log.needs_human_input(),
            "timestamp": time.time()
        }
        
        self.workflow_history.append(workflow_record)
        
        print(f"\n✅ 任务执行完成")
        print(f"   最终结果: {result.get('result', 'N/A')}")
        print(f"   成功状态: {result.get('success', False)}")
        
        return result
    
    def _handle_human_requests(self, event_log: EventLog) -> list:
        """处理所有人工请求"""
        human_requests = event_log.get_events_by_type("human_request")
        approval_results = []
        
        for request in human_requests:
            if isinstance(request, HumanRequestEvent):
                approval_result = self.approval_simulator.process_approval_request(request)
                approval_results.append(approval_result)
        
        return approval_results
    
    def _resume_execution_after_approval(self, task: Task, original_event_log: EventLog) -> Dict[str, Any]:
        """审批后恢复执行"""
        # 简化实现：重新创建一个执行器，设置为返回成功结果
        # 在实际应用中，应该有更复杂的状态恢复逻辑
        
        # 修改 LLM 提供者以返回完成任务的响应
        if hasattr(self.executor.llm_provider, 'call_count'):
            object.__setattr__(self.executor.llm_provider, 'call_count', 1)
        
        result = self.executor.run(self.agent, task)
        self._print_event_log(result["event_log"], "审批后继续执行")
        
        return result
    
    def _print_event_log(self, event_log: EventLog, phase: str):
        """打印事件日志"""
        print(f"\n📋 {phase} - 事件日志:")
        for i, event in enumerate(event_log.events, 1):
            event_info = self._format_event_info(event)
            print(f"   {i}. [{event.type}] {event_info}")
        
        state = event_log.get_current_state()
        print(f"   当前状态: {state['status']}")
        print(f"   步骤数: {state['step_count']}")
    
    def _format_event_info(self, event) -> str:
        """格式化事件信息"""
        if hasattr(event, 'question'):
            return f"问题: {event.question}"
        elif hasattr(event, 'tool_name'):
            return f"工具: {event.tool_name}"
        elif hasattr(event, 'error_message'):
            return f"错误: {event.error_message}"
        elif hasattr(event, 'final_result'):
            return f"结果: {event.final_result}"
        else:
            return "无详细信息"


# ===== 5. 主程序 =====

def run_hitl_demo(scenario: str = "delete_db"):
    """运行 HITL 演示"""
    print(f"🎭 AgenticX Human-in-the-Loop 演示")
    print(f"场景: {scenario}")
    print("=" * 60)
    
    # 创建组件
    agent = Agent(
        name="安全审批助手",
        role="系统管理员",
        goal="安全地执行系统操作",
        organization_id="demo_org"
    )
    
    # 根据场景创建不同的任务
    tasks = {
        "delete_db": Task(
            description="删除生产环境数据库",
            expected_output="数据库删除成功确认"
        ),
        "transfer_money": Task(
            description="执行大额转账操作",
            expected_output="转账成功确认"
        ),
        "mixed_operations": Task(
            description="执行混合操作：读取配置文件并删除测试数据库",
            expected_output="所有操作完成确认"
        )
    }
    
    task = tasks.get(scenario, tasks["delete_db"])
    
    # 创建执行器
    executor = AgentExecutor(
        llm_provider=InteractiveMockLLM(scenario),
        tools=[delete_database, transfer_money, read_file_content],
        max_iterations=10
    )
    
    # 创建审批模拟器
    approval_simulator = HumanApprovalSimulator(auto_approve=True)
    
    # 创建工作流管理器
    workflow_manager = HITLWorkflowManager(agent, executor, approval_simulator)
    
    # 执行任务
    result = workflow_manager.execute_task_with_hitl(task)
    
    # 显示总结
    print(f"\n📊 执行总结:")
    print(f"   任务ID: {task.id}")
    print(f"   执行成功: {result.get('success', False)}")
    print(f"   审批历史: {len(approval_simulator.approval_history)} 次审批")
    
    return result


if __name__ == "__main__":
    # 可以通过命令行参数选择不同的场景
    import argparse
    
    parser = argparse.ArgumentParser(description="AgenticX HITL 演示")
    parser.add_argument("--scenario", choices=["delete_db", "transfer_money", "mixed_operations"], 
                       default="delete_db", help="选择演示场景")
    
    args = parser.parse_args()
    
    try:
        run_hitl_demo(args.scenario)
    except KeyboardInterrupt:
        print("\n\n👋 演示已取消")
    except Exception as e:
        print(f"\n❌ 演示出错: {e}")
        import traceback
        traceback.print_exc() 