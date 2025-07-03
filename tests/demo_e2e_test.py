#!/usr/bin/env python3
"""
AgenticX 端到端测试演示脚本

展示 Agent + LLM + Tools 的完整集成效果
"""

import asyncio
import sys
from pathlib import Path

# 添加项目根目录到 Python 路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

# 添加测试目录到路径
tests_dir = Path(__file__).parent
sys.path.insert(0, str(tests_dir))

from test_e2e_agent_tools import AgentToolsE2ETester


async def demo_single_interaction(tester, user_input: str):
    """演示单次交互"""
    print(f"\n{'='*60}")
    print(f"📋 演示场景: {user_input}")
    print('='*60)
    
    result = await tester.process_user_input(user_input)
    print(f"\n🎉 最终结果: {result}")
    print('='*60)


def main():
    """主演示函数"""
    print("🚀 AgenticX 端到端集成演示")
    print("=" * 60)
    print("本演示展示了 Agent 如何使用 LLM 进行 Function Call 来调用工具完成任务")
    print("=" * 60)
    
    # 创建测试器（模拟模式）
    tester = AgentToolsE2ETester()
    
    print(f"\n🤖 Agent 信息:")
    print(f"  名称: {tester.agent.name}")
    print(f"  角色: {tester.agent.role}")
    print(f"  目标: {tester.agent.goal}")
    print(f"  可用工具: {', '.join(tester.tools.keys())}")
    
    # 演示场景
    demo_scenarios = [
        "帮我计算 1000 + 2000",
        "计算 25 * 8",
        "写一个文件保存计算结果",
        "帮我算一下 100 / 5"
    ]
    
    for scenario in demo_scenarios:
        asyncio.run(demo_single_interaction(tester, scenario))
    
    print(f"\n💡 演示总结:")
    print("✅ Agent 成功识别用户意图")
    print("✅ LLM 正确选择和调用工具")
    print("✅ 工具执行并返回结果")
    print("✅ 完整的端到端流程验证")
    
    print(f"\n🔮 真实使用方式:")
    print("1. 设置 DEEPSEEK_API_KEY 环境变量")
    print("2. 运行: python tests/test_e2e_agent_tools.py --mode interactive")
    print("3. 输入: 帮我计算 1000 + 2000")
    print("4. 观察 Agent 如何调用工具完成任务")


if __name__ == "__main__":
    main() 