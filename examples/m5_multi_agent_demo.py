"""
AgenticX M5 多智能体协作演示

这个演示展示了 M5 模块的多智能体协作功能：
- 多个智能体协同工作
- 智能体间通信和协调
- 任务分解和并行执行
- 结果聚合和整合

演示场景：数据分析团队协作完成数据处理任务
"""

import sys
import os
import json
import asyncio
from typing import List, Dict, Any

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from agenticx.core import (
    Agent, Task, tool, AgentExecutor, PromptManager, 
    ErrorHandler, CommunicationInterface, BroadcastCommunication
)
from agenticx.llms.base import BaseLLMProvider
from agenticx.llms.response import LLMResponse, TokenUsage


class MockLLMProvider(BaseLLMProvider):
    """Mock LLM provider for demonstration."""
    
    def __init__(self, responses=None, agent_name="default"):
        super().__init__(model=f"mock-model-{agent_name}")
        object.__setattr__(self, 'responses', responses or [])
        object.__setattr__(self, 'call_count', 0)
        object.__setattr__(self, 'agent_name', agent_name)
    
    def invoke(self, prompt: str, **kwargs) -> LLMResponse:
        if self.call_count < len(self.responses):
            content = self.responses[self.call_count]
        else:
            content = f'{{"action": "finish_task", "result": "任务完成 - {self.agent_name}", "reasoning": "默认完成"}}'
        
        object.__setattr__(self, 'call_count', self.call_count + 1)
        
        return LLMResponse(
            id=f"mock-response-{self.agent_name}-{self.call_count}",
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


# 数据处理工具
@tool()
def load_data(data_source: str) -> Dict[str, Any]:
    """加载数据源"""
    # 模拟数据加载
    mock_data = {
        "sales": [100, 150, 200, 175, 225, 300, 250],
        "customers": ["Alice", "Bob", "Charlie", "Diana", "Eve", "Frank", "Grace"],
        "dates": ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05", "2024-01-06", "2024-01-07"],
        "source": data_source
    }
    return mock_data


@tool()
def calculate_statistics(data: List[float]) -> Dict[str, float]:
    """计算统计指标"""
    if not data:
        return {"error": "数据为空"}
    
    return {
        "mean": sum(data) / len(data),
        "max": max(data),
        "min": min(data),
        "total": sum(data),
        "count": len(data)
    }


@tool()
def filter_data(data: List[Any], condition: str, value: Any) -> List[Any]:
    """根据条件过滤数据"""
    # 简单的过滤逻辑
    if condition == "greater_than":
        return [x for x in data if isinstance(x, (int, float)) and x > value]
    elif condition == "less_than":
        return [x for x in data if isinstance(x, (int, float)) and x < value]
    elif condition == "equals":
        return [x for x in data if x == value]
    else:
        return data


@tool()
def generate_report(title: str, data: Dict[str, Any]) -> str:
    """生成分析报告"""
    report = f"# {title}\n\n"
    report += "## 数据分析结果\n\n"
    
    for key, value in data.items():
        if isinstance(value, dict):
            report += f"### {key}\n"
            for sub_key, sub_value in value.items():
                report += f"- {sub_key}: {sub_value}\n"
        else:
            report += f"- {key}: {value}\n"
    
    report += "\n---\n报告生成时间: 2024-01-07\n"
    
    # 保存报告
    with open(f"{title.lower().replace(' ', '_')}_report.md", "w", encoding="utf-8") as f:
        f.write(report)
    
    return f"报告已生成并保存为 {title.lower().replace(' ', '_')}_report.md"


@tool()
def send_team_message(recipient: str, message: str, message_type: str = "info") -> str:
    """向团队成员发送消息"""
    return f"消息已发送给 {recipient}: {message} (类型: {message_type})"


def create_data_analyst() -> Agent:
    """创建数据分析师智能体"""
    return Agent(
        name="DataAnalyst",
        role="数据分析师",
        goal="分析数据并提取有价值的洞察",
        backstory="我是一个专业的数据分析师，擅长统计分析和数据解读",
        organization_id="data_team"
    )


def create_data_engineer() -> Agent:
    """创建数据工程师智能体"""
    return Agent(
        name="DataEngineer", 
        role="数据工程师",
        goal="处理和清洗数据，确保数据质量",
        backstory="我是数据工程师，负责数据管道和数据质量保证",
        organization_id="data_team"
    )


def create_report_writer() -> Agent:
    """创建报告撰写员智能体"""
    return Agent(
        name="ReportWriter",
        role="报告撰写员", 
        goal="撰写清晰的分析报告和总结",
        backstory="我专门负责将技术分析结果转化为易懂的商业报告",
        organization_id="data_team"
    )


def create_team_coordinator() -> Agent:
    """创建团队协调员智能体"""
    return Agent(
        name="TeamCoordinator",
        role="团队协调员",
        goal="协调团队工作，确保任务顺利完成", 
        backstory="我负责协调团队成员之间的工作，确保项目按时完成",
        organization_id="data_team"
    )


async def run_multi_agent_demo():
    """运行多智能体协作演示"""
    print("🚀 AgenticX M5 多智能体协作演示")
    print("=" * 60)
    
    # 创建智能体
    agents = {
        "analyst": create_data_analyst(),
        "engineer": create_data_engineer(), 
        "writer": create_report_writer(),
        "coordinator": create_team_coordinator()
    }
    
    print("🤖 创建智能体团队:")
    for role, agent in agents.items():
        print(f"  • {agent.name} ({agent.role})")
    
    # 创建 LLM 提供者（为每个智能体定制响应）
    llm_providers = {
        "analyst": MockLLMProvider([
            '{"action": "tool_call", "tool": "load_data", "args": {"data_source": "sales_database"}, "reasoning": "首先加载销售数据"}',
            '{"action": "tool_call", "tool": "calculate_statistics", "args": {"data": [100, 150, 200, 175, 225, 300, 250]}, "reasoning": "计算销售数据的统计指标"}',
            '{"action": "tool_call", "tool": "send_team_message", "args": {"recipient": "ReportWriter", "message": "数据分析完成，平均销售额为200，总销售额为1400", "message_type": "analysis_result"}, "reasoning": "向报告撰写员发送分析结果"}',
            '{"action": "finish_task", "result": "数据分析完成：平均销售额200，最高300，最低100，总计1400", "reasoning": "分析任务完成"}'
        ], "DataAnalyst"),
        
        "engineer": MockLLMProvider([
            '{"action": "tool_call", "tool": "filter_data", "args": {"data": [100, 150, 200, 175, 225, 300, 250], "condition": "greater_than", "value": 180}, "reasoning": "过滤出高于180的销售数据"}',
            '{"action": "tool_call", "tool": "send_team_message", "args": {"recipient": "DataAnalyst", "message": "数据清洗完成，高价值销售记录：[200, 225, 300, 250]", "message_type": "data_ready"}, "reasoning": "通知分析师数据已准备好"}',
            '{"action": "finish_task", "result": "数据工程任务完成：清洗并过滤了销售数据", "reasoning": "工程任务完成"}'
        ], "DataEngineer"),
        
        "writer": MockLLMProvider([
            '{"action": "tool_call", "tool": "generate_report", "args": {"title": "Sales Analysis Report", "data": {"statistics": {"mean": 200, "max": 300, "min": 100, "total": 1400}, "high_value_sales": [200, 225, 300, 250]}}, "reasoning": "生成销售分析报告"}',
            '{"action": "tool_call", "tool": "send_team_message", "args": {"recipient": "TeamCoordinator", "message": "销售分析报告已完成并保存", "message_type": "report_complete"}, "reasoning": "通知协调员报告完成"}',
            '{"action": "finish_task", "result": "销售分析报告已生成并保存为 sales_analysis_report.md", "reasoning": "报告撰写完成"}'
        ], "ReportWriter"),
        
        "coordinator": MockLLMProvider([
            '{"action": "tool_call", "tool": "send_team_message", "args": {"recipient": "DataEngineer", "message": "请开始数据清洗工作", "message_type": "task_assignment"}, "reasoning": "分配数据清洗任务"}',
            '{"action": "tool_call", "tool": "send_team_message", "args": {"recipient": "DataAnalyst", "message": "数据准备就绪，请开始分析", "message_type": "task_assignment"}, "reasoning": "分配数据分析任务"}',
            '{"action": "finish_task", "result": "团队协调完成：所有任务已分配并监控进度", "reasoning": "协调任务完成"}'
        ], "TeamCoordinator")
    }
    
    # 创建工具列表
    tools = [load_data, calculate_statistics, filter_data, generate_report, send_team_message]
    print(f"🔧 可用工具: {[tool.name for tool in tools]}")
    
    # 创建任务
    tasks = {
        "coordinator": Task(
            description="协调团队完成销售数据分析项目，分配任务并监控进度",
            expected_output="团队协调完成，所有成员收到任务分配"
        ),
        "engineer": Task(
            description="清洗和预处理销售数据，过滤出高价值销售记录",
            expected_output="清洗后的高质量数据集"
        ),
        "analyst": Task(
            description="分析销售数据，计算关键统计指标和趋势",
            expected_output="详细的数据分析结果和洞察"
        ),
        "writer": Task(
            description="基于分析结果撰写专业的销售分析报告",
            expected_output="完整的销售分析报告文档"
        )
    }
    
    # 创建通信系统
    communications = {}
    for role, agent in agents.items():
        comm = BroadcastCommunication(agent.id)
        comm.join_group("data_team")
        communications[role] = comm
    
    # 创建执行器
    executors = {}
    for role, agent in agents.items():
        executor = AgentExecutor(
            llm_provider=llm_providers[role],
            tools=tools,
            prompt_manager=PromptManager(),
            error_handler=ErrorHandler(max_consecutive_errors=2),
            communication=communications[role],
            max_iterations=10
        )
        executors[role] = executor
    
    print("\n🎯 开始多智能体协作...")
    print("-" * 60)
    
    # 并行执行任务
    results = {}
    
    async def execute_agent_task(role, agent, task, executor):
        print(f"🏃 {agent.name} 开始执行任务...")
        result = executor.run(agent, task)
        print(f"✅ {agent.name} 任务完成!")
        return role, result
    
    # 创建并发任务
    agent_tasks = []
    for role, agent in agents.items():
        task = tasks[role]
        executor = executors[role]
        agent_tasks.append(execute_agent_task(role, agent, task, executor))
    
    # 并发执行所有智能体任务
    completed_tasks = await asyncio.gather(*agent_tasks)
    
    # 收集结果
    for role, result in completed_tasks:
        results[role] = result
    
    print("\n📊 多智能体协作结果:")
    print("-" * 60)
    
    total_success = 0
    total_events = 0
    total_tools = 0
    total_llm_calls = 0
    total_cost = 0.0
    
    for role, result in results.items():
        agent_name = agents[role].name
        success = "✅ 成功" if result["success"] else "❌ 失败"
        print(f"\n🤖 {agent_name} ({role}):")
        print(f"  状态: {success}")
        print(f"  结果: {result['result']}")
        
        stats = result["stats"]
        print(f"  事件数: {stats['total_events']}")
        print(f"  工具调用: {stats['tool_calls']}")
        print(f"  LLM调用: {stats['llm_calls']}")
        print(f"  成本: ${stats['estimated_cost']:.4f}")
        
        if result["success"]:
            total_success += 1
        total_events += stats['total_events']
        total_tools += stats['tool_calls']
        total_llm_calls += stats['llm_calls']
        total_cost += stats['estimated_cost']
    
    print(f"\n📈 团队总体统计:")
    print(f"  成功率: {total_success}/{len(agents)} ({total_success/len(agents)*100:.1f}%)")
    print(f"  总事件数: {total_events}")
    print(f"  总工具调用: {total_tools}")
    print(f"  总LLM调用: {total_llm_calls}")
    print(f"  总成本: ${total_cost:.4f}")
    
    # 显示通信统计
    print(f"\n💬 团队通信统计:")
    total_messages = 0
    for role, comm in communications.items():
        stats = comm.get_message_stats()
        agent_name = agents[role].name
        print(f"  {agent_name}: 发送{stats['sent_count']} 接收{stats['received_count']}")
        total_messages += stats['sent_count']
    
    print(f"  团队总消息数: {total_messages}")
    
    # 检查生成的文件
    print(f"\n📄 生成的文件:")
    if os.path.exists("sales_analysis_report.md"):
        print("  ✅ sales_analysis_report.md - 销售分析报告")
        with open("sales_analysis_report.md", "r", encoding="utf-8") as f:
            content = f.read()
            print(f"     报告长度: {len(content)} 字符")
    else:
        print("  ❌ 未找到生成的报告文件")
    
    print("\n🎉 多智能体协作演示完成!")


if __name__ == "__main__":
    asyncio.run(run_multi_agent_demo()) 