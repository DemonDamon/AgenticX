"""
AgenticX M8.5: 协作框架演示

展示如何使用多智能体协作框架的8种核心协作模式。
"""

import sys
import os

# 添加项目根目录到Python路径
current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_dir)
sys.path.insert(0, project_root)

# 直接导入模块，不使用agenticx前缀
from agenticx.core.agent import Agent
from agenticx.collaboration.enums import CollaborationMode
from agenticx.collaboration.config import (
    CollaborationManagerConfig, MasterSlaveConfig, ReflectionConfig
)
from agenticx.collaboration.patterns import MasterSlavePattern, ReflectionPattern
from agenticx.collaboration.manager import CollaborationManager


def create_demo_agents():
    """创建演示用的智能体"""
    # 创建主控智能体
    master_agent = Agent(
        id="master_001",
        name="Master Agent",
        role="master",
        goal="负责任务规划和结果聚合",
        organization_id="demo_org",
        backstory="主控智能体，具有强大的规划和协调能力"
    )
    
    # 创建从属智能体
    slave_agent_1 = Agent(
        id="slave_001",
        name="Research Agent",
        role="slave",
        goal="负责信息收集和分析",
        organization_id="demo_org",
        backstory="研究智能体，专门负责信息收集和分析工作"
    )
    
    slave_agent_2 = Agent(
        id="slave_002",
        name="Writing Agent",
        role="slave",
        goal="负责内容创作和编辑",
        organization_id="demo_org",
        backstory="写作智能体，擅长内容创作和编辑"
    )
    
    # 创建执行智能体
    executor_agent = Agent(
        id="executor_001",
        name="Executor Agent",
        role="executor",
        goal="负责具体任务执行",
        organization_id="demo_org",
        backstory="执行智能体，专注于具体任务的执行"
    )
    
    # 创建审查智能体
    reviewer_agent = Agent(
        id="reviewer_001",
        name="Reviewer Agent",
        role="reviewer",
        goal="负责质量评估和改进建议",
        organization_id="demo_org",
        backstory="审查智能体，负责质量评估和改进建议"
    )
    
    return {
        "master": master_agent,
        "slave_1": slave_agent_1,
        "slave_2": slave_agent_2,
        "executor": executor_agent,
        "reviewer": reviewer_agent
    }


def demo_master_slave_pattern():
    """演示主从层次协作模式"""
    print("=" * 60)
    print("演示：主从层次协作模式")
    print("=" * 60)
    
    agents = create_demo_agents()
    
    # 创建主从模式配置
    config = MasterSlaveConfig(
        mode=CollaborationMode.MASTER_SLAVE,
        master_agent_id=agents["master"].id,
        slave_agent_ids=[agents["slave_1"].id, agents["slave_2"].id],
        enable_hierarchical_planning=True,
        enable_result_aggregation=True
    )
    
    # 创建主从协作模式
    collaboration = MasterSlavePattern(
        master_agent=agents["master"],
        slave_agents=[agents["slave_1"], agents["slave_2"]],
        config=config
    )
    
    # 执行协作任务
    task = "分析人工智能在医疗领域的应用前景，并提供详细的研究报告"
    
    print(f"任务：{task}")
    print("开始执行主从协作...")
    
    result = collaboration.execute(task)
    
    print(f"协作结果：")
    print(f"- 成功：{result.success}")
    print(f"- 执行时间：{result.execution_time:.2f}秒")
    print(f"- 迭代次数：{result.iteration_count}")
    print(f"- 智能体贡献：{result.agent_contributions}")
    
    if result.success:
        print(f"- 结果：{result.result[:200]}..." if len(str(result.result)) > 200 else f"- 结果：{result.result}")
    else:
        print(f"- 错误：{result.error}")
    
    return result


def demo_reflection_pattern():
    """演示反思协作模式"""
    print("\n" + "=" * 60)
    print("演示：反思协作模式")
    print("=" * 60)
    
    agents = create_demo_agents()
    
    # 创建反思模式配置
    config = ReflectionConfig(
        mode=CollaborationMode.REFLECTION,
        executor_agent_id=agents["executor"].id,
        reviewer_agent_id=agents["reviewer"].id,
        max_reflection_rounds=3,
        reflection_threshold=0.8,
        enable_iterative_improvement=True
    )
    
    # 创建反思协作模式
    collaboration = ReflectionPattern(
        executor_agent=agents["executor"],
        reviewer_agent=agents["reviewer"],
        config=config
    )
    
    # 执行协作任务
    task = "设计一个智能客服系统，包括用户界面、对话流程和知识库管理"
    
    print(f"任务：{task}")
    print("开始执行反思协作...")
    
    result = collaboration.execute(task)
    
    print(f"协作结果：")
    print(f"- 成功：{result.success}")
    print(f"- 执行时间：{result.execution_time:.2f}秒")
    print(f"- 迭代次数：{result.iteration_count}")
    print(f"- 智能体贡献：{result.agent_contributions}")
    
    if result.success:
        print(f"- 结果：{result.result[:200]}..." if len(str(result.result)) > 200 else f"- 结果：{result.result}")
    else:
        print(f"- 错误：{result.error}")
    
    return result


def demo_collaboration_manager():
    """演示协作管理器"""
    print("\n" + "=" * 60)
    print("演示：协作管理器")
    print("=" * 60)
    
    # 创建管理器配置
    manager_config = CollaborationManagerConfig(
        default_timeout=300.0,
        max_concurrent_collaborations=5,
        enable_auto_optimization=True,
        enable_conflict_resolution=True,
        enable_metrics_collection=True
    )
    
    # 创建协作管理器
    manager = CollaborationManager(manager_config)
    
    agents = create_demo_agents()
    
    # 创建主从协作
    master_slave_collab = manager.create_collaboration(
        pattern=CollaborationMode.MASTER_SLAVE,
        agents=[agents["master"], agents["slave_1"], agents["slave_2"]]
    )
    
    print(f"创建主从协作：{master_slave_collab.collaboration_id}")
    
    # 创建反思协作
    reflection_collab = manager.create_collaboration(
        pattern=CollaborationMode.REFLECTION,
        agents=[agents["executor"], agents["reviewer"]]
    )
    
    print(f"创建反思协作：{reflection_collab.collaboration_id}")
    
    # 监控协作状态
    print("\n协作状态监控：")
    for collab_id in [master_slave_collab.collaboration_id, reflection_collab.collaboration_id]:
        status = manager.monitor_collaboration(collab_id)
        print(f"- {collab_id}: {status['status']}")
    
    # 获取统计信息
    stats = manager.get_collaboration_statistics()
    print(f"\n协作统计：")
    print(f"- 总协作数：{stats['total_collaborations']}")
    print(f"- 活跃协作数：{stats['active_collaborations']}")
    print(f"- 模式分布：{stats['pattern_distribution']}")
    
    return manager


def main():
    """主演示函数"""
    print("AgenticX M8.5: 多智能体协作框架演示")
    print("=" * 80)
    
    try:
        # 演示主从模式
        master_slave_result = demo_master_slave_pattern()
        
        # 演示反思模式
        reflection_result = demo_reflection_pattern()
        
        # 演示协作管理器
        manager = demo_collaboration_manager()
        
        print("\n" + "=" * 80)
        print("演示完成！")
        print("=" * 80)
        
        # 总结
        print("\n总结：")
        print("- 主从模式：适合层次化任务分解和协调")
        print("- 反思模式：适合质量改进和迭代优化")
        print("- 协作管理器：提供统一的管理和监控能力")
        
    except Exception as e:
        print(f"演示过程中发生错误：{e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main() 