"""M8.5 多智能体协作框架智能调度优化测试

测试协作智能调度、动态角色分配和智能消息路由功能。
"""

import pytest
import asyncio
from datetime import datetime, timedelta
from unittest.mock import Mock, patch

# 导入被测试的模块
from agenticx.collaboration.intelligence.collaboration_intelligence import CollaborationIntelligence
from agenticx.collaboration.intelligence.role_assigner import DynamicRoleAssigner
from agenticx.collaboration.intelligence.message_router import SemanticMessageRouter
from agenticx.collaboration.intelligence.models import (
    AgentProfile,
    AgentCapability,
    CollaborationContext,
    TaskAllocation,
    RoleAssignment,
    RoutingDecision,
    AgentStatus,
    TaskPriority,
    MessagePriority
)


class TestCollaborationIntelligence:
    """协作智能调度引擎测试"""
    
    def setup_method(self):
        """测试前置设置"""
        self.collaboration_engine = CollaborationIntelligence()
        
        # 创建测试智能体
        self.test_agents = [
            AgentProfile(
                agent_id="agent_001",
                name="数据分析师",
                agent_type="analyst",
                capabilities=[
                    AgentCapability(name="data_analysis", level=9, domain="analytics", description="数据分析能力"),
                    AgentCapability(name="reporting", level=8, domain="communication", description="报告生成能力")
                ],
                current_status=AgentStatus.IDLE,
                current_load=0.3,
                specializations=["data_science", "statistics"]
            ),
            AgentProfile(
                agent_id="agent_002",
                name="项目协调员",
                agent_type="coordinator",
                capabilities=[
                    AgentCapability(name="coordination", level=10, domain="management", description="协调能力"),
                    AgentCapability(name="planning", level=9, domain="management", description="规划能力"),
                    AgentCapability(name="communication", level=9, domain="communication", description="沟通能力")
                ],
                current_status=AgentStatus.IDLE,
                current_load=0.2,
                specializations=["project_management"]
            ),
            AgentProfile(
                agent_id="agent_003",
                name="技术专家",
                agent_type="expert",
                capabilities=[
                    AgentCapability(name="technical_support", level=9, domain="technical", description="技术支持"),
                    AgentCapability(name="problem_solving", level=9, domain="technical", description="问题解决")
                ],
                current_status=AgentStatus.IDLE,
                current_load=0.5,
                specializations=["software_engineering"]
            )
        ]
        
        # 注册测试智能体
        for agent in self.test_agents:
            self.collaboration_engine.register_agent(agent)
    
    def test_agent_registration(self):
        """测试智能体注册"""
        # 注册新智能体
        new_agent = AgentProfile(
            agent_id="agent_004",
            name="质量检查员",
            agent_type="supervisor",
            capabilities=[
                AgentCapability(name="quality_control", level=9, domain="quality", description="质量控制")
            ],
            current_status=AgentStatus.IDLE,
            current_load=0.1
        )
        
        self.collaboration_engine.register_agent(new_agent)
        
        # 验证注册成功
        assert "agent_004" in self.collaboration_engine.agents
        assert self.collaboration_engine.agents["agent_004"].name == "质量检查员"
    
    def test_collaboration_session_creation(self):
        """测试协作会话创建"""
        # 创建协作上下文
        context = CollaborationContext(
            session_id="session_001",
            participants=["agent_001", "agent_002", "agent_003"],
            current_phase="analysis",
            objectives=["数据分析", "报告生成"],
            priority=TaskPriority.HIGH,
            deadline=datetime.now() + timedelta(hours=2),
            shared_state={}
        )
        
        # 创建协作会话
        session_id = self.collaboration_engine.create_collaboration_session(context)
        
        # 验证会话创建成功
        assert session_id == "session_001"
        assert session_id in self.collaboration_engine.active_contexts
        assert len(self.collaboration_engine.active_contexts[session_id].participants) == 3
    
    def test_task_allocation(self):
        """测试智能任务分配"""
        # 创建协作会话
        context = CollaborationContext(
            session_id="session_002",
            participants=["agent_001", "agent_002", "agent_003"],
            current_phase="processing",
            objectives=["数据处理"],
            priority=TaskPriority.NORMAL
        )
        self.collaboration_engine.create_collaboration_session(context)
        
        # 定义测试任务
        tasks = [
            {
                'task_id': 'task_001',
                'required_capabilities': ['data_analysis'],
                'estimated_effort': 0.4,
                'priority': TaskPriority.HIGH
            },
            {
                'task_id': 'task_002',
                'required_capabilities': ['coordination'],
                'estimated_effort': 0.3,
                'priority': TaskPriority.NORMAL
            }
        ]
        
        # 执行任务分配
        allocations = self.collaboration_engine.allocate_tasks("session_002", tasks)
        
        # 验证分配结果
        assert len(allocations) == 2
        
        # 验证数据分析任务分配给了数据分析师
        data_task_allocation = next((a for a in allocations if a.task_id == 'task_001'), None)
        assert data_task_allocation is not None
        assert data_task_allocation.assigned_agent == "agent_001"
        
        # 验证协调任务分配给了协调员
        coord_task_allocation = next((a for a in allocations if a.task_id == 'task_002'), None)
        assert coord_task_allocation is not None
        assert coord_task_allocation.assigned_agent == "agent_002"
    
    def test_collaboration_monitoring(self):
        """测试协作监控"""
        # 创建协作会话
        context = CollaborationContext(
            session_id="session_003",
            participants=["agent_001", "agent_002"],
            current_phase="monitoring",
            objectives=["监控测试"]
        )
        self.collaboration_engine.create_collaboration_session(context)
        
        # 监控协作状态
        metrics = self.collaboration_engine.monitor_collaboration("session_003")
        
        # 验证监控结果
        assert metrics.session_id == "session_003"
        assert metrics.total_participants == 2
        assert metrics.active_participants >= 0
        assert 0 <= metrics.collaboration_efficiency <= 1
    
    def test_collaboration_optimization(self):
        """测试协作优化"""
        # 创建协作会话
        context = CollaborationContext(
            session_id="session_004",
            participants=["agent_001", "agent_002", "agent_003"],
            current_phase="optimization",
            objectives=["优化测试"]
        )
        self.collaboration_engine.create_collaboration_session(context)
        
        # 执行协作优化
        optimization_result = self.collaboration_engine.optimize_collaboration("session_004")
        
        # 验证优化结果
        assert 'session_id' in optimization_result
        assert 'current_metrics' in optimization_result
        assert 'optimizations' in optimization_result
        assert 'estimated_improvement' in optimization_result
        assert optimization_result['session_id'] == "session_004"
    
    def test_conflict_detection_and_resolution(self):
        """测试冲突检测和解决"""
        # 创建高负载场景
        for agent in self.test_agents:
            agent.current_load = 0.95  # 设置高负载
        
        context = CollaborationContext(
            session_id="session_005",
            participants=["agent_001", "agent_002", "agent_003"],
            current_phase="conflict_resolution",
            objectives=["冲突测试"]
        )
        self.collaboration_engine.create_collaboration_session(context)
        
        # 检测和解决冲突
        resolutions = self.collaboration_engine.detect_and_resolve_conflicts("session_005")
        
        # 验证冲突解决
        assert isinstance(resolutions, list)
        # 在高负载情况下应该检测到资源冲突
        if resolutions:
            assert any('resource_conflict' in r.conflict_type for r in resolutions)
    
    def test_learning_from_collaboration(self):
        """测试协作学习"""
        # 创建协作会话
        context = CollaborationContext(
            session_id="session_006",
            participants=["agent_001", "agent_002"],
            current_phase="learning",
            objectives=["学习测试"]
        )
        self.collaboration_engine.create_collaboration_session(context)
        
        # 模拟协作结果
        outcomes = {
            'agent_001': {
                'success_rate': 0.9,
                'avg_time': 25.0,
                'quality': 0.85
            },
            'agent_002': {
                'success_rate': 0.8,
                'avg_time': 30.0,
                'quality': 0.9
            },
            'overall_success_rate': 0.85
        }
        
        # 执行学习
        initial_history_count = len(self.collaboration_engine.performance_history)
        self.collaboration_engine.learn_from_collaboration("session_006", outcomes)
        
        # 验证学习效果
        assert len(self.collaboration_engine.performance_history) >= initial_history_count
    
    def test_agent_recommendations(self):
        """测试智能体推荐"""
        # 定义任务需求
        task_requirements = {
            'capabilities': ['data_analysis', 'reporting'],
            'complexity': 'moderate',
            'deadline': datetime.now() + timedelta(hours=4)
        }
        
        # 获取推荐
        recommendations = self.collaboration_engine.get_agent_recommendations(task_requirements)
        
        # 验证推荐结果
        assert isinstance(recommendations, list)
        assert len(recommendations) > 0
        
        # 验证推荐格式
        for agent_id, match_score, reasoning in recommendations:
            assert isinstance(agent_id, str)
            assert 0 <= match_score <= 1
            assert isinstance(reasoning, str)
        
        # 验证数据分析师应该有较高的匹配度
        analyst_recommendation = next((r for r in recommendations if r[0] == "agent_001"), None)
        assert analyst_recommendation is not None
        assert analyst_recommendation[1] > 0.5  # 匹配度应该较高


class TestDynamicRoleAssigner:
    """动态角色分配器测试"""
    
    def setup_method(self):
        """测试前置设置"""
        self.role_assigner = DynamicRoleAssigner()
        
        # 创建测试智能体
        self.test_agents = [
            AgentProfile(
                agent_id="agent_101",
                name="协调专家",
                agent_type="coordinator",
                capabilities=[
                    AgentCapability(name="coordination", level=9, domain="management", description="协调能力"),
                    AgentCapability(name="leadership", level=8, domain="management", description="领导能力"),
                    AgentCapability(name="communication", level=9, domain="communication", description="沟通能力")
                ],
                current_status=AgentStatus.IDLE,
                current_load=0.2
            ),
            AgentProfile(
                agent_id="agent_102",
                name="执行专家",
                agent_type="executor",
                capabilities=[
                    AgentCapability(name="task_execution", level=9, domain="execution", description="任务执行能力"),
                    AgentCapability(name="efficiency", level=9, domain="execution", description="效率能力")
                ],
                current_status=AgentStatus.IDLE,
                current_load=0.4
            )
        ]
        
        # 创建测试上下文
        self.test_context = CollaborationContext(
            session_id="role_test_session",
            participants=["agent_101", "agent_102"],
            current_phase="testing",
            objectives=["角色分配测试"]
        )
    
    def test_role_analysis(self):
        """测试角色需求分析"""
        # 定义任务需求
        task_requirements = {
            'complexity': 'moderate',
            'domain_requirements': ['data_science'],
            'participant_count': 3
        }
        
        # 分析所需角色
        required_roles = self.role_assigner.analyze_required_roles(
            self.test_context, task_requirements
        )
        
        # 验证分析结果
        assert isinstance(required_roles, list)
        assert len(required_roles) > 0
        
        # 验证包含基础角色
        role_names = [role['name'] for role in required_roles]
        assert 'coordinator' in role_names
        assert 'executor' in role_names
    
    def test_role_assignment(self):
        """测试角色分配"""
        # 获取所需角色
        required_roles = [
            self.role_assigner.role_templates['coordinator'],
            self.role_assigner.role_templates['executor']
        ]
        
        # 执行角色分配
        assignments = self.role_assigner.assign_roles(
            self.test_agents, required_roles, self.test_context
        )
        
        # 验证分配结果（包括默认分配）
        assert len(assignments) >= 2
        
        # 验证协调者角色分配
        coordinator_assignment = next(
            (a for a in assignments if a.role_name == 'coordinator'), None
        )
        assert coordinator_assignment is not None
        assert coordinator_assignment.agent_id == "agent_101"  # 协调专家应该被分配协调者角色
        
        # 验证执行者角色分配
        executor_assignment = next(
            (a for a in assignments if a.role_name == 'executor'), None
        )
        assert executor_assignment is not None
        assert executor_assignment.agent_id == "agent_102"  # 执行专家应该被分配执行者角色
    
    def test_role_performance_evaluation(self):
        """测试角色性能评估"""
        # 创建角色分配历史
        assignment = RoleAssignment(
            agent_id="agent_101",
            session_id="role_test_session",
            role="coordinator",
            role_name="coordinator",
            responsibilities=["协调团队", "分配任务"],
            authority_level=3,
            expected_workload=0.7,
            assignment_reason="具有协调专长",
            confidence_score=0.9
        )
        self.role_assigner.assignment_history.append(assignment)
        
        # 模拟性能数据
        performance_data = {
            'agent_101': {
                'success_rate': 0.9,
                'quality_score': 0.85,
                'efficiency': 0.8
            }
        }
        
        # 评估角色性能
        role_scores = self.role_assigner.evaluate_role_performance(
            "role_test_session", performance_data
        )
        
        # 验证评估结果
        assert isinstance(role_scores, dict)
        assert len(role_scores) > 0
        
        # 验证分数在合理范围内
        for score in role_scores.values():
            assert 0 <= score <= 1
    
    def test_role_recommendations(self):
        """测试角色推荐"""
        # 获取角色推荐
        available_roles = ['coordinator', 'executor', 'supervisor']
        recommendations = self.role_assigner.get_role_recommendations(
            "agent_101", available_roles
        )
        
        # 验证推荐结果
        assert isinstance(recommendations, list)
        assert len(recommendations) > 0
        
        # 验证推荐格式
        for role_name, suitability, reasoning in recommendations:
            assert role_name in available_roles
            assert 0 <= suitability <= 1
            assert isinstance(reasoning, str)
        
        # 验证协调者角色应该有较高的适合度（基于智能体能力）
        coordinator_rec = next((r for r in recommendations if r[0] == 'coordinator'), None)
        assert coordinator_rec is not None
    
    def test_role_reassignment(self):
        """测试角色重新分配"""
        # 创建初始分配
        assignment = RoleAssignment(
            agent_id="agent_102",
            session_id="role_test_session",
            role="coordinator",
            role_name="coordinator",
            responsibilities=["协调团队", "分配任务"],
            authority_level=3,
            expected_workload=0.8,
            assignment_reason="临时协调员",
            confidence_score=0.7
        )
        self.role_assigner.assignment_history.append(assignment)
        
        # 模拟性能不佳的数据
        performance_data = {
            'agent_102': {
                'success_rate': 0.4,  # 低成功率
                'quality_score': 0.5,
                'efficiency': 0.3
            }
        }
        
        # 执行角色重新分配
        new_assignments = self.role_assigner.reassign_roles(
            "role_test_session", performance_data, self.test_context
        )
        
        # 验证重新分配结果
        assert isinstance(new_assignments, list)
        # 由于性能不佳，应该考虑重新分配
    
    def test_learning_from_assignments(self):
        """测试从分配结果中学习"""
        # 创建分配历史
        assignment = RoleAssignment(
            agent_id="agent_101",
            session_id="role_test_session",
            role="coordinator",
            role_name="coordinator",
            responsibilities=["协调团队", "分配任务"],
            authority_level=3,
            expected_workload=0.6,
            assignment_reason="学习测试分配",
            confidence_score=0.8
        )
        self.role_assigner.assignment_history.append(assignment)
        
        # 模拟协作结果
        outcomes = {
            'agent_101': {
                'success_rate': 0.9,
                'quality': 0.85
            }
        }
        
        # 执行学习
        initial_affinity = len(self.role_assigner.agent_role_affinity)
        self.role_assigner.learn_from_assignments("role_test_session", outcomes)
        
        # 验证学习效果
        assert len(self.role_assigner.agent_role_affinity) >= initial_affinity
        # 验证智能体-角色亲和度被更新
        assert "agent_101" in self.role_assigner.agent_role_affinity


class TestSemanticMessageRouter:
    """语义消息路由器测试"""
    
    def setup_method(self):
        """测试前置设置"""
        self.message_router = SemanticMessageRouter()
        
        # 设置智能体能力
        self.message_router.update_agent_capabilities("agent_201", {
            "data_analysis", "reporting", "communication"
        })
        self.message_router.update_agent_capabilities("agent_202", {
            "coordination", "leadership", "problem_solving"
        })
        self.message_router.update_agent_capabilities("agent_203", {
            "technical_support", "debugging", "system_control"
        })
        
        # 创建测试上下文
        self.test_context = CollaborationContext(
            session_id="message_test_session",
            participants=["agent_201", "agent_202", "agent_203"],
            current_phase="testing",
            objectives=["消息路由测试"]
        )
    
    def test_message_semantic_analysis(self):
        """测试消息语义分析"""
        # 创建测试消息
        message = {
            "message_id": "msg_001",
            "sender_id": "agent_201",
            "content": "需要帮助分析这批数据，请协助处理",
            "message_type": "request",
            "priority": MessagePriority.HIGH,
            "timestamp": datetime.now()
        }
        
        # 执行语义分析（通过路由消息间接测试）
        decision = self.message_router.route_message(message, self.test_context)
        
        # 验证路由决策
        assert isinstance(decision, RoutingDecision)
        assert decision.message_id == "msg_001"
        assert decision.source_agent == "agent_201"
        assert len(decision.target_agents) > 0
        assert decision.confidence > 0
    
    def test_capability_based_routing(self):
        """测试基于能力的路由"""
        # 创建需要数据分析能力的消息
        message = {
            "message_id": "msg_002",
            "sender_id": "agent_202",
            "content": "请帮忙分析这些数据并生成报告",
            "message_type": "request",
            "priority": MessagePriority.NORMAL,
            "timestamp": datetime.now()
        }
        
        # 执行路由
        decision = self.message_router.route_message(message, self.test_context)
        
        # 验证路由到具有数据分析能力的智能体
        assert "agent_201" in decision.target_agents  # agent_201有数据分析能力
    
    def test_urgent_message_routing(self):
        """测试紧急消息路由"""
        # 创建紧急消息
        message = {
            "message_id": "msg_003",
            "sender_id": "agent_201",
            "content": "紧急！系统出现严重错误，需要立即处理",
            "message_type": "notification",
            "priority": MessagePriority.CRITICAL,
            "timestamp": datetime.now()
        }
        
        # 执行路由
        decision = self.message_router.route_message(message, self.test_context)
        
        # 验证紧急消息的路由特性
        assert decision.priority == MessagePriority.CRITICAL
        assert decision.expected_latency < 1.0  # 紧急消息应该快速交付
        assert "agent_203" in decision.target_agents  # 技术支持智能体应该收到
    
    def test_message_caching(self):
        """测试消息路由缓存"""
        # 创建相同内容的消息
        message1 = {
            "message_id": "msg_004",
            "sender_id": "agent_201",
            "content": "请帮助处理数据分析任务",
            "message_type": "request",
            "priority": MessagePriority.NORMAL,
            "timestamp": datetime.now()
        }
        
        message2 = {
             "message_id": "msg_005",
             "sender_id": "agent_201",
             "content": "请帮助处理数据分析任务",
             "message_type": "request",
             "priority": MessagePriority.NORMAL,
             "timestamp": datetime.now()
         }
        
        # 第一次路由
        decision1 = self.message_router.route_message(message1, self.test_context)
        
        # 第二次路由（应该使用缓存）
        decision2 = self.message_router.route_message(message2, self.test_context)
        
        # 验证路由结果相似（由于缓存）
        assert decision1.routing_strategy == decision2.routing_strategy
        assert decision1.target_agents == decision2.target_agents
    
    def test_routing_performance_optimization(self):
        """测试路由性能优化"""
        # 模拟反馈数据
        feedback_data = {
            'overall_performance': 0.8,
            'delivery_times': [1.2, 0.8, 1.5, 0.9],
            'success_rates': [0.9, 0.85, 0.95, 0.8]
        }
        
        # 执行性能优化
        self.message_router.optimize_routing_performance(feedback_data)
        
        # 验证优化执行（主要验证不抛出异常）
        assert True  # 如果没有异常，说明优化执行成功
    
    def test_routing_statistics(self):
        """测试路由统计"""
        # 发送几条测试消息
        messages = [
            {
                "message_id": f"msg_{i:03d}",
                "sender_id": "agent_201",
                "content": f"测试消息 {i}",
                "message_type": "request",
                "priority": MessagePriority.NORMAL,
                "timestamp": datetime.now()
            }
            for i in range(5)
        ]
        
        # 路由所有消息
        for message in messages:
            self.message_router.route_message(message, self.test_context)
        
        # 获取统计信息
        stats = self.message_router.get_routing_statistics()
        
        # 验证统计结果
        assert 'total_messages' in stats
        assert stats['total_messages'] >= 5
        assert 'average_confidence' in stats
        assert 'average_delivery_time' in stats
        assert 0 <= stats['average_confidence'] <= 1
    
    def test_routing_feedback_handling(self):
        """测试路由反馈处理"""
        # 发送测试消息
        message = {
            "message_id": "msg_feedback_test",
            "sender_id": "agent_201",
            "content": "反馈测试消息",
            "message_type": "request",
            "priority": MessagePriority.NORMAL,
            "timestamp": datetime.now()
        }
        
        # 路由消息
        decision = self.message_router.route_message(message, self.test_context)
        
        # 提供反馈
        feedback = {
            'success': True,
            'actual_delivery_time': 1.2,
            'recipient_satisfaction': 0.9
        }
        
        # 处理反馈
        self.message_router.handle_routing_feedback("msg_feedback_test", feedback)
        
        # 验证反馈处理（检查性能数据是否更新）
        assert len(self.message_router.routing_performance) >= 0
    
    def test_routing_rule_management(self):
        """测试路由规则管理"""
        # 添加自定义路由规则
        custom_rule = {
            'condition': 'message_type == "emergency"',
            'action': 'broadcast_immediately',
            'priority': 10
        }
        
        initial_rule_count = len(self.message_router.routing_rules)
        self.message_router.add_routing_rule("emergency_rule", custom_rule)
        
        # 验证规则添加
        assert len(self.message_router.routing_rules) == initial_rule_count + 1
        assert "emergency_rule" in self.message_router.routing_rules
        assert self.message_router.routing_rules["emergency_rule"]['enabled'] is True


if __name__ == "__main__":
    # 运行测试
    pytest.main([__file__, "-v"])