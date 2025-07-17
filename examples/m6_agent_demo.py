"""
AgenticX M5 智能体核心模块演示

这个演示展示了 M5 模块的完整功能：
- 事件驱动的状态管理
- 智能提示工程
- 错误处理和恢复
- 工具调用和执行
- 智能体间通信

演示场景：数学计算智能体完成复杂的多步骤计算任务
"""

import sys
import os

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from agenticx.core import (
    Agent, Task, tool, AgentExecutor, PromptManager, 
    ErrorHandler, CommunicationInterface
)
from agenticx.llms.base import BaseLLMProvider
from agenticx.llms.response import LLMResponse, TokenUsage


class MockLLMProvider(BaseLLMProvider):
    """Mock LLM provider for demonstration."""
    
    def __init__(self, responses=None):
        super().__init__(model="mock-model")
        # Use object.__setattr__ to bypass Pydantic validation
        object.__setattr__(self, 'responses', responses or [])
        object.__setattr__(self, 'call_count', 0)
    
    def invoke(self, prompt: str, **kwargs) -> LLMResponse:
        if self.call_count < len(self.responses):
            content = self.responses[self.call_count]
        else:
            content = '{"action": "finish_task", "result": "mock result", "reasoning": "mock reasoning"}'
        
        # Use object.__setattr__ to bypass Pydantic validation
        object.__setattr__(self, 'call_count', self.call_count + 1)
        
        return LLMResponse(
            id=f"mock-response-{self.call_count}",
            model_name=self.model,
            created=1234567890,
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


# 定义计算工具
@tool()
def add_numbers(a: float, b: float) -> float:
    """将两个数字相加"""
    return a + b


@tool()
def multiply_numbers(a: float, b: float) -> float:
    """将两个数字相乘"""
    return a * b


@tool()
def divide_numbers(a: float, b: float) -> float:
    """将第一个数字除以第二个数字"""
    if b == 0:
        raise ValueError("除数不能为零")
    return a / b


@tool()
def power_numbers(base: float, exponent: float) -> float:
    """计算 base 的 exponent 次方"""
    return base ** exponent


@tool()
def save_calculation(calculation: str, result: float) -> str:
    """保存计算结果到文件"""
    filename = "calculations.txt"
    with open(filename, "a", encoding="utf-8") as f:
        f.write(f"{calculation} = {result}\n")
    return f"计算结果已保存到 {filename}"


def create_math_agent() -> Agent:
    """创建数学计算智能体"""
    return Agent(
        name="MathBot",
        role="数学计算专家",
        goal="准确完成各种数学计算任务",
        backstory="我是一个专业的数学计算智能体，擅长多步骤计算和结果验证",
        organization_id="math_team"
    )


def create_complex_task() -> Task:
    """创建复杂的数学任务"""
    return Task(
        description="""
        请完成以下复杂的数学计算：
        1. 计算 (15 + 25) * 3
        2. 计算结果除以 8
        3. 将最终结果的 2 次方
        4. 保存完整的计算过程和最终结果
        
        请逐步执行，并在每一步都说明你的计算逻辑。
        """,
        expected_output="完整的计算过程和最终结果，并保存到文件",
        context={
            "calculation_type": "multi_step",
            "precision": "high",
            "save_required": True
        }
    )


def run_demo():
    """运行 M5 智能体演示"""
    print("🚀 AgenticX M5 智能体核心模块演示")
    print("=" * 50)
    
    # 使用模拟 LLM 提供者进行演示
    print("💡 使用模拟 LLM 提供者进行演示...")
    llm_provider = MockLLMProvider([
        '{"action": "tool_call", "tool": "add_numbers", "args": {"a": 15, "b": 25}, "reasoning": "首先计算 15 + 25"}',
        '{"action": "tool_call", "tool": "multiply_numbers", "args": {"a": 40, "b": 3}, "reasoning": "然后将结果乘以 3"}',
        '{"action": "tool_call", "tool": "divide_numbers", "args": {"a": 120, "b": 8}, "reasoning": "接下来除以 8"}',
        '{"action": "tool_call", "tool": "power_numbers", "args": {"base": 15, "exponent": 2}, "reasoning": "计算结果的平方"}',
        '{"action": "tool_call", "tool": "save_calculation", "args": {"calculation": "(15 + 25) * 3 / 8 ^ 2", "result": 225}, "reasoning": "保存计算结果"}',
        '{"action": "finish_task", "result": "计算完成：(15 + 25) * 3 = 120，120 / 8 = 15，15^2 = 225。最终结果是 225，已保存到文件。", "reasoning": "所有计算步骤完成"}'
    ])
    print("✅ 模拟 LLM 提供者初始化成功")
    
    # 创建智能体和任务
    agent = create_math_agent()
    task = create_complex_task()
    print(f"🤖 创建智能体: {agent.name} ({agent.role})")
    print(f"📋 任务描述: {task.description.strip()}")
    
    # 创建工具列表
    tools = [add_numbers, multiply_numbers, divide_numbers, power_numbers, save_calculation]
    print(f"🔧 可用工具: {[tool.name for tool in tools]}")
    
    # 创建执行器组件
    prompt_manager = PromptManager()
    error_handler = ErrorHandler(max_consecutive_errors=3)
    communication = CommunicationInterface(agent.id)
    
    # 创建智能体执行器
    executor = AgentExecutor(
        llm_provider=llm_provider,
        tools=tools,
        prompt_manager=prompt_manager,
        error_handler=error_handler,
        communication=communication,
        max_iterations=20
    )
    print("⚙️ 智能体执行器初始化完成")
    
    print("\n🎯 开始执行任务...")
    print("-" * 50)
    
    # 执行任务
    result = executor.run(agent, task)
    
    print("\n📊 执行结果:")
    print("-" * 50)
    
    if result["success"]:
        print("✅ 任务执行成功!")
        print(f"📝 最终结果: {result['result']}")
    else:
        print("❌ 任务执行失败!")
        print(f"🚨 错误信息: {result.get('error', '未知错误')}")
    
    # 显示执行统计
    stats = result["stats"]
    print(f"\n📈 执行统计:")
    print(f"  • 总事件数: {stats['total_events']}")
    print(f"  • 工具调用: {stats['tool_calls']}")
    print(f"  • LLM 调用: {stats['llm_calls']}")
    print(f"  • 错误次数: {stats['errors']}")
    print(f"  • 最终状态: {stats['final_state']['status']}")
    print(f"  • Token 使用: {stats['token_usage']}")
    print(f"  • 预估成本: ${stats['estimated_cost']:.4f}")
    
    # 显示事件日志详情
    print(f"\n📜 事件日志 (共 {len(result['event_log'].events)} 个事件):")
    print("-" * 50)
    
    for i, event in enumerate(result['event_log'].events, 1):
        print(f"{i:2d}. [{event.type:15s}] {event.timestamp.strftime('%H:%M:%S')}")
        
        if hasattr(event, 'tool_name'):
            print(f"     工具: {event.tool_name}")
            if hasattr(event, 'tool_args') and event.tool_args:
                print(f"     参数: {event.tool_args}")
            if hasattr(event, 'result'):
                print(f"     结果: {event.result}")
                
        elif hasattr(event, 'task_description'):
            print(f"     任务: {event.task_description[:50]}...")
            
        elif hasattr(event, 'final_result'):
            print(f"     结果: {event.final_result}")
            
        elif hasattr(event, 'error_message'):
            print(f"     错误: {event.error_message}")
    
    # 显示通信统计
    comm_stats = communication.get_message_stats()
    print(f"\n💬 通信统计:")
    print(f"  • 发送消息: {comm_stats['sent_count']}")
    print(f"  • 接收消息: {comm_stats['received_count']}")
    print(f"  • 待处理消息: {comm_stats['pending_count']}")
    
    print("\n🎉 演示完成!")
    
    # 检查是否生成了计算文件
    if os.path.exists("calculations.txt"):
        print("\n📄 生成的计算文件内容:")
        with open("calculations.txt", "r", encoding="utf-8") as f:
            print(f.read())


if __name__ == "__main__":
    run_demo() 