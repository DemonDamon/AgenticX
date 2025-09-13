"""协作智能调度引擎

提供智能体协作的核心调度和优化功能。
"""

import logging
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime, timedelta, UTC
from collections import defaultdict

from .models import (
    AgentProfile,
    CollaborationContext,
    TaskAllocation,
    CollaborationMetrics,
    PerformanceMetrics,
    CollaborationPattern,
    ConflictResolution,
    AdaptationRule,
    AgentStatus,
    TaskPriority
)

logger = logging.getLogger(__name__)


class CollaborationIntelligence:
    """协作智能调度引擎
    
    核心功能：
    1. 智能任务分配和负载均衡
    2. 协作模式识别和优化
    3. 性能监控和自适应调整
    4. 冲突检测和解决
    5. 协作效率分析和改进建议
    """
    
    def __init__(self):
        self.agents: Dict[str, AgentProfile] = {}
        self.active_contexts: Dict[str, CollaborationContext] = {}
        self.collaboration_patterns: Dict[str, CollaborationPattern] = {}
        self.performance_history: Dict[str, List[PerformanceMetrics]] = defaultdict(list)
        self.adaptation_rules: List[AdaptationRule] = []
        self.conflict_history: List[ConflictResolution] = []
        
        # 初始化默认协作模式
        self._initialize_default_patterns()
        
        # 初始化适应性规则
        self._initialize_adaptation_rules()
    
    def register_agent(self, agent_profile: AgentProfile):
        """注册智能体
        
        Args:
            agent_profile: 智能体档案
        """
        self.agents[agent_profile.agent_id] = agent_profile
        logger.info(f"智能体 {agent_profile.name} ({agent_profile.agent_id}) 已注册")
    
    def create_collaboration_session(self, context: CollaborationContext) -> str:
        """创建协作会话
        
        Args:
            context: 协作上下文
            
        Returns:
            str: 会话ID
        """
        self.active_contexts[context.session_id] = context
        
        # 为会话选择最佳协作模式
        best_pattern = self._select_collaboration_pattern(context)
        if best_pattern:
            context.shared_state['collaboration_pattern'] = best_pattern.pattern_name
            logger.info(f"为会话 {context.session_id} 选择协作模式: {best_pattern.pattern_name}")
        
        logger.info(f"创建协作会话: {context.session_id}，参与者: {len(context.participants)}")
        return context.session_id
    
    def allocate_tasks(self, session_id: str, tasks: List[Dict[str, Any]]) -> List[TaskAllocation]:
        """智能任务分配
        
        Args:
            session_id: 会话ID
            tasks: 任务列表
            
        Returns:
            List[TaskAllocation]: 任务分配结果
        """
        context = self.active_contexts.get(session_id)
        if not context:
            raise ValueError(f"会话 {session_id} 不存在")
        
        allocations = []
        available_agents = [self.agents[aid] for aid in context.participants if aid in self.agents]
        
        # 按优先级排序任务
        sorted_tasks = sorted(tasks, key=lambda t: self._get_task_priority_score(t), reverse=True)
        
        for task in sorted_tasks:
            allocation = self._allocate_single_task(task, available_agents, context)
            if allocation:
                allocations.append(allocation)
                # 更新智能体负载
                self._update_agent_load(allocation.assigned_agent, allocation.estimated_effort)
        
        logger.info(f"为会话 {session_id} 分配了 {len(allocations)} 个任务")
        return allocations
    
    def monitor_collaboration(self, session_id: str) -> CollaborationMetrics:
        """监控协作状态
        
        Args:
            session_id: 会话ID
            
        Returns:
            CollaborationMetrics: 协作指标
        """
        context = self.active_contexts.get(session_id)
        if not context:
            raise ValueError(f"会话 {session_id} 不存在")
        
        # 计算协作指标
        metrics = self._calculate_collaboration_metrics(context)
        
        # 检测瓶颈
        bottlenecks = self._detect_bottlenecks(context)
        metrics.bottlenecks = bottlenecks
        
        # 应用适应性规则
        self._apply_adaptation_rules(context, metrics)
        
        return metrics
    
    def optimize_collaboration(self, session_id: str) -> Dict[str, Any]:
        """优化协作效率
        
        Args:
            session_id: 会话ID
            
        Returns:
            Dict[str, Any]: 优化建议
        """
        context = self.active_contexts.get(session_id)
        if not context:
            raise ValueError(f"会话 {session_id} 不存在")
        
        metrics = self.monitor_collaboration(session_id)
        optimizations = []
        
        # 负载均衡优化
        load_optimization = self._optimize_load_balance(context)
        if load_optimization:
            optimizations.append(load_optimization)
        
        # 通信优化
        comm_optimization = self._optimize_communication(context)
        if comm_optimization:
            optimizations.append(comm_optimization)
        
        # 角色调整优化
        role_optimization = self._optimize_role_assignment(context)
        if role_optimization:
            optimizations.append(role_optimization)
        
        return {
            'session_id': session_id,
            'current_metrics': metrics,
            'optimizations': optimizations,
            'estimated_improvement': self._estimate_improvement(optimizations)
        }
    
    def detect_and_resolve_conflicts(self, session_id: str) -> List[ConflictResolution]:
        """检测和解决协作冲突
        
        Args:
            session_id: 会话ID
            
        Returns:
            List[ConflictResolution]: 冲突解决方案
        """
        context = self.active_contexts.get(session_id)
        if not context:
            raise ValueError(f"会话 {session_id} 不存在")
        
        # 检测冲突
        conflicts = self._detect_conflicts(context)
        resolutions = []
        
        for conflict in conflicts:
            resolution = self._resolve_conflict(conflict, context)
            if resolution:
                resolutions.append(resolution)
                self.conflict_history.append(resolution)
        
        return resolutions
    
    def learn_from_collaboration(self, session_id: str, outcomes: Dict[str, Any]):
        """从协作结果中学习
        
        Args:
            session_id: 会话ID
            outcomes: 协作结果
        """
        context = self.active_contexts.get(session_id)
        if not context:
            return
        
        # 更新智能体性能历史
        for agent_id in context.participants:
            if agent_id in self.agents:
                performance = self._calculate_agent_performance(agent_id, outcomes)
                self.performance_history[agent_id].append(performance)
        
        # 更新协作模式效果
        pattern_name = context.shared_state.get('collaboration_pattern')
        if pattern_name and pattern_name in self.collaboration_patterns:
            self._update_pattern_effectiveness(pattern_name, outcomes)
        
        # 学习新的适应性规则
        new_rules = self._learn_adaptation_rules(context, outcomes)
        self.adaptation_rules.extend(new_rules)
        
        logger.info(f"从会话 {session_id} 的协作结果中学习完成")
    
    def get_agent_recommendations(self, task_requirements: Dict[str, Any]) -> List[Tuple[str, float, str]]:
        """获取智能体推荐
        
        Args:
            task_requirements: 任务需求
            
        Returns:
            List[Tuple[str, float, str]]: (智能体ID, 匹配度, 推荐理由)
        """
        recommendations = []
        
        for agent_id, agent in self.agents.items():
            if agent.current_status == AgentStatus.OFFLINE:
                continue
            
            match_score, reasoning = self._calculate_agent_match_score(agent, task_requirements)
            if match_score > 0.3:  # 最低匹配阈值
                recommendations.append((agent_id, match_score, reasoning))
        
        # 按匹配度排序
        recommendations.sort(key=lambda x: x[1], reverse=True)
        return recommendations[:10]  # 返回前10个推荐
    
    def _initialize_default_patterns(self):
        """初始化默认协作模式"""
        # 管道模式
        pipeline_pattern = CollaborationPattern(
            pattern_name="pipeline",
            description="流水线式协作，任务按顺序传递",
            applicable_scenarios=["数据处理", "文档生成", "代码开发"],
            required_roles=["输入处理者", "核心处理者", "输出整理者"],
            communication_flow={
                "输入处理者": ["核心处理者"],
                "核心处理者": ["输出整理者"],
                "输出整理者": []
            },
            success_criteria=["任务按时完成", "质量达标", "无瓶颈"],
            typical_duration=30.0,
            complexity_level=2
        )
        
        # 并行模式
        parallel_pattern = CollaborationPattern(
            pattern_name="parallel",
            description="并行协作，多个智能体同时工作",
            applicable_scenarios=["大规模计算", "数据分析", "内容生成"],
            required_roles=["协调者", "工作者", "整合者"],
            communication_flow={
                "协调者": ["工作者"],
                "工作者": ["整合者"],
                "整合者": ["协调者"]
            },
            success_criteria=["高效并行", "结果一致", "资源利用率高"],
            typical_duration=20.0,
            complexity_level=3
        )
        
        # 层次模式
        hierarchical_pattern = CollaborationPattern(
            pattern_name="hierarchical",
            description="层次化协作，有明确的指挥链",
            applicable_scenarios=["复杂项目", "决策制定", "质量控制"],
            required_roles=["决策者", "执行者", "监督者"],
            communication_flow={
                "决策者": ["执行者", "监督者"],
                "执行者": ["监督者"],
                "监督者": ["决策者"]
            },
            success_criteria=["决策质量高", "执行效率好", "控制有效"],
            typical_duration=45.0,
            complexity_level=4
        )
        
        self.collaboration_patterns = {
            "pipeline": pipeline_pattern,
            "parallel": parallel_pattern,
            "hierarchical": hierarchical_pattern
        }
    
    def _initialize_adaptation_rules(self):
        """初始化适应性规则"""
        # 负载均衡规则
        load_balance_rule = AdaptationRule(
            rule_id="load_balance_001",
            condition="max_agent_load > 0.8 and min_agent_load < 0.3",
            action="redistribute_tasks",
            priority=1
        )
        
        # 性能优化规则
        performance_rule = AdaptationRule(
            rule_id="performance_001",
            condition="collaboration_efficiency < 0.6",
            action="suggest_pattern_change",
            priority=2
        )
        
        # 冲突预防规则
        conflict_prevention_rule = AdaptationRule(
            rule_id="conflict_prevention_001",
            condition="communication_frequency > threshold",
            action="introduce_mediator",
            priority=3
        )
        
        self.adaptation_rules = [
            load_balance_rule,
            performance_rule,
            conflict_prevention_rule
        ]
    
    def _select_collaboration_pattern(self, context: CollaborationContext) -> Optional[CollaborationPattern]:
        """选择最佳协作模式"""
        best_pattern = None
        best_score = 0.0
        
        for pattern in self.collaboration_patterns.values():
            score = self._calculate_pattern_match_score(pattern, context)
            if score > best_score:
                best_score = score
                best_pattern = pattern
        
        return best_pattern if best_score > 0.5 else None
    
    def _calculate_pattern_match_score(self, pattern: CollaborationPattern, context: CollaborationContext) -> float:
        """计算协作模式匹配分数"""
        score = 0.0
        
        # 参与者数量匹配
        participant_count = len(context.participants)
        if len(pattern.required_roles) <= participant_count <= len(pattern.required_roles) * 2:
            score += 0.3
        
        # 复杂度匹配
        if context.priority == TaskPriority.CRITICAL and pattern.complexity_level >= 3:
            score += 0.2
        elif context.priority == TaskPriority.LOW and pattern.complexity_level <= 2:
            score += 0.2
        
        # 时间约束匹配
        if context.deadline:
            time_available = (context.deadline - datetime.now()).total_seconds()
            if time_available >= pattern.typical_duration:
                score += 0.3
        else:
            score += 0.2  # 无时间约束时给予中等分数
        
        # 目标匹配
        objective_match = len(set(context.objectives) & set(pattern.success_criteria))
        if objective_match > 0:
            score += 0.2 * (objective_match / len(pattern.success_criteria))
        
        return min(1.0, score)
    
    def _allocate_single_task(self, task: Dict[str, Any], available_agents: List[AgentProfile], 
                            context: CollaborationContext) -> Optional[TaskAllocation]:
        """分配单个任务"""
        best_agent = None
        best_score = 0.0
        
        required_capabilities = task.get('required_capabilities', [])
        estimated_effort = task.get('estimated_effort', 1.0)
        
        for agent in available_agents:
            if agent.current_load + estimated_effort > 1.0:  # 负载过高
                continue
            
            score = self._calculate_task_assignment_score(agent, task, context)
            if score > best_score:
                best_score = score
                best_agent = agent
        
        if best_agent and best_score > 0.3:
            return TaskAllocation(
                task_id=task['task_id'],
                assigned_agent=best_agent.agent_id,
                estimated_effort=estimated_effort,
                deadline=task.get('deadline'),
                dependencies=task.get('dependencies', []),
                required_capabilities=required_capabilities,
                allocation_score=best_score,
                backup_agents=[a.agent_id for a in available_agents 
                             if a != best_agent and a.current_load + estimated_effort <= 1.0][:2]
            )
        
        return None
    
    def _calculate_task_assignment_score(self, agent: AgentProfile, task: Dict[str, Any], 
                                       context: CollaborationContext) -> float:
        """计算任务分配分数"""
        score = 0.0
        
        # 能力匹配分数 (40%)
        required_capabilities = task.get('required_capabilities', [])
        agent_capabilities = [cap.name for cap in agent.capabilities]
        
        if required_capabilities:
            matched_capabilities = set(required_capabilities) & set(agent_capabilities)
            capability_score = len(matched_capabilities) / len(required_capabilities)
            score += capability_score * 0.4
        else:
            score += 0.2  # 无特定要求时给予基础分数
        
        # 负载分数 (30%)
        load_score = 1.0 - agent.current_load
        score += load_score * 0.3
        
        # 历史性能分数 (20%)
        if agent.agent_id in self.performance_history:
            recent_performance = self.performance_history[agent.agent_id][-5:]  # 最近5次
            if recent_performance:
                avg_success_rate = sum(p.task_success_rate for p in recent_performance) / len(recent_performance)
                score += avg_success_rate * 0.2
        else:
            score += 0.1  # 新智能体默认分数
        
        # 专业化匹配分数 (10%)
        task_domain = task.get('domain', '')
        if task_domain in agent.specializations:
            score += 0.1
        
        return min(1.0, score)
    
    def _calculate_collaboration_metrics(self, context: CollaborationContext) -> CollaborationMetrics:
        """计算协作指标"""
        participants = [self.agents[aid] for aid in context.participants if aid in self.agents]
        
        # 基础统计
        total_participants = len(context.participants)
        active_participants = sum(1 for agent in participants if agent.current_status != AgentStatus.OFFLINE)
        
        # 计算平均响应时间（模拟）
        avg_response_time = sum(agent.current_load * 10 for agent in participants) / len(participants) if participants else 0
        
        # 计算协作效率
        total_load = sum(agent.current_load for agent in participants)
        collaboration_efficiency = min(1.0, total_load / len(participants)) if participants else 0
        
        # 计算资源利用率
        resource_utilization = {
            'cpu': sum(agent.current_load for agent in participants) / len(participants) if participants else 0,
            'memory': 0.7,  # 模拟值
            'network': 0.5   # 模拟值
        }
        
        return CollaborationMetrics(
            session_id=context.session_id,
            total_participants=total_participants,
            active_participants=active_participants,
            message_count=context.shared_state.get('message_count', 0),
            task_completion_rate=context.shared_state.get('completion_rate', 0.0),
            average_response_time=avg_response_time,
            collaboration_efficiency=collaboration_efficiency,
            resource_utilization=resource_utilization,
            quality_score=0.8  # 模拟值
        )
    
    def _detect_bottlenecks(self, context: CollaborationContext) -> List[str]:
        """检测协作瓶颈"""
        bottlenecks = []
        participants = [self.agents[aid] for aid in context.participants if aid in self.agents]
        
        # 检测负载瓶颈
        overloaded_agents = [agent for agent in participants if agent.current_load > 0.9]
        if overloaded_agents:
            bottlenecks.append(f"智能体负载过高: {[a.name for a in overloaded_agents]}")
        
        # 检测能力瓶颈
        required_capabilities = context.shared_state.get('required_capabilities', [])
        for capability in required_capabilities:
            capable_agents = [agent for agent in participants 
                            if any(cap.name == capability for cap in agent.capabilities)]
            if len(capable_agents) < 2:
                bottlenecks.append(f"能力 '{capability}' 的智能体数量不足")
        
        # 检测通信瓶颈
        if len(participants) > 10:
            bottlenecks.append("参与者数量过多，可能影响通信效率")
        
        return bottlenecks
    
    def _apply_adaptation_rules(self, context: CollaborationContext, metrics: CollaborationMetrics):
        """应用适应性规则"""
        for rule in self.adaptation_rules:
            if not rule.enabled:
                continue
            
            if self._evaluate_rule_condition(rule, context, metrics):
                self._execute_rule_action(rule, context, metrics)
                rule.last_triggered = datetime.now()
                rule.success_count += 1
    
    def _evaluate_rule_condition(self, rule: AdaptationRule, context: CollaborationContext, 
                                metrics: CollaborationMetrics) -> bool:
        """评估规则条件"""
        # 简化的条件评估逻辑
        if "max_agent_load > 0.8" in rule.condition:
            participants = [self.agents[aid] for aid in context.participants if aid in self.agents]
            max_load = max(agent.current_load for agent in participants) if participants else 0
            return max_load > 0.8
        
        if "collaboration_efficiency < 0.6" in rule.condition:
            return metrics.collaboration_efficiency < 0.6
        
        return False
    
    def _execute_rule_action(self, rule: AdaptationRule, context: CollaborationContext, 
                           metrics: CollaborationMetrics):
        """执行规则动作"""
        if rule.action == "redistribute_tasks":
            logger.info(f"执行负载重分配 for session {context.session_id}")
            # 实际的任务重分配逻辑
        
        elif rule.action == "suggest_pattern_change":
            logger.info(f"建议更改协作模式 for session {context.session_id}")
            # 协作模式变更建议
        
        elif rule.action == "introduce_mediator":
            logger.info(f"引入调解者 for session {context.session_id}")
            # 调解者引入逻辑
    
    def _get_task_priority_score(self, task: Dict[str, Any]) -> float:
        """获取任务优先级分数"""
        priority_scores = {
            TaskPriority.CRITICAL: 5.0,
            TaskPriority.URGENT: 4.0,
            TaskPriority.HIGH: 3.0,
            TaskPriority.NORMAL: 2.0,
            TaskPriority.LOW: 1.0
        }
        
        priority = task.get('priority', TaskPriority.NORMAL)
        return priority_scores.get(priority, 2.0)
    
    def _update_agent_load(self, agent_id: str, additional_load: float):
        """更新智能体负载"""
        if agent_id in self.agents:
            self.agents[agent_id].current_load += additional_load
            self.agents[agent_id].current_load = min(1.0, self.agents[agent_id].current_load)
    
    def _optimize_load_balance(self, context: CollaborationContext) -> Optional[Dict[str, Any]]:
        """优化负载均衡"""
        participants = [self.agents[aid] for aid in context.participants if aid in self.agents]
        if not participants:
            return None
        
        loads = [agent.current_load for agent in participants]
        max_load = max(loads)
        min_load = min(loads)
        
        if max_load - min_load > 0.3:  # 负载差异过大
            return {
                'type': 'load_balance',
                'description': '检测到负载不均衡，建议重新分配任务',
                'max_load': max_load,
                'min_load': min_load,
                'suggested_actions': ['重新分配高负载智能体的任务', '增加低负载智能体的工作量']
            }
        
        return None
    
    def _optimize_communication(self, context: CollaborationContext) -> Optional[Dict[str, Any]]:
        """优化通信"""
        if len(context.participants) > 8:
            return {
                'type': 'communication',
                'description': '参与者数量较多，建议优化通信结构',
                'suggested_actions': [
                    '引入层次化通信结构',
                    '设置专门的协调者角色',
                    '使用广播机制减少点对点通信'
                ]
            }
        
        return None
    
    def _optimize_role_assignment(self, context: CollaborationContext) -> Optional[Dict[str, Any]]:
        """优化角色分配"""
        # 检查是否有智能体能力与角色不匹配
        mismatched_roles = []
        
        for agent_id in context.participants:
            if agent_id in self.agents:
                agent = self.agents[agent_id]
                # 简化的角色匹配检查
                if agent.current_load > 0.8 and len(agent.capabilities) > 3:
                    mismatched_roles.append(agent_id)
        
        if mismatched_roles:
            return {
                'type': 'role_assignment',
                'description': '检测到角色分配不当',
                'mismatched_agents': mismatched_roles,
                'suggested_actions': ['重新评估智能体角色', '调整任务分配策略']
            }
        
        return None
    
    def _estimate_improvement(self, optimizations: List[Dict[str, Any]]) -> Dict[str, float]:
        """估算改进效果"""
        if not optimizations:
            return {'efficiency_gain': 0.0, 'time_saving': 0.0}
        
        # 简化的改进估算
        efficiency_gain = len(optimizations) * 0.1  # 每个优化提升10%
        time_saving = len(optimizations) * 0.05     # 每个优化节省5%时间
        
        return {
            'efficiency_gain': min(0.5, efficiency_gain),  # 最大50%提升
            'time_saving': min(0.3, time_saving)           # 最大30%时间节省
        }
    
    def _detect_conflicts(self, context: CollaborationContext) -> List[Dict[str, Any]]:
        """检测协作冲突"""
        conflicts = []
        participants = [self.agents[aid] for aid in context.participants if aid in self.agents]
        
        # 检测资源冲突
        overloaded_count = sum(1 for agent in participants if agent.current_load > 0.9)
        if overloaded_count > len(participants) * 0.5:
            conflicts.append({
                'type': 'resource_conflict',
                'description': '多个智能体负载过高，存在资源竞争',
                'severity': 'high',
                'involved_agents': [a.agent_id for a in participants if a.current_load > 0.9]
            })
        
        # 检测能力冲突
        capability_conflicts = self._detect_capability_conflicts(participants)
        conflicts.extend(capability_conflicts)
        
        return conflicts
    
    def _detect_capability_conflicts(self, participants: List[AgentProfile]) -> List[Dict[str, Any]]:
        """检测能力冲突"""
        conflicts = []
        capability_owners = defaultdict(list)
        
        # 统计每个能力的拥有者
        for agent in participants:
            for capability in agent.capabilities:
                capability_owners[capability.name].append(agent.agent_id)
        
        # 检测能力垄断（某个能力只有一个智能体拥有）
        for capability, owners in capability_owners.items():
            if len(owners) == 1 and len(participants) > 3:
                conflicts.append({
                    'type': 'capability_monopoly',
                    'description': f'能力 "{capability}" 只有一个智能体拥有，存在单点故障风险',
                    'severity': 'medium',
                    'involved_agents': owners,
                    'capability': capability
                })
        
        return conflicts
    
    def _resolve_conflict(self, conflict: Dict[str, Any], context: CollaborationContext) -> Optional[ConflictResolution]:
        """解决冲突"""
        conflict_id = f"conflict_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        
        if conflict['type'] == 'resource_conflict':
            return ConflictResolution(
                conflict_id=conflict_id,
                conflict_type=conflict['type'],
                involved_agents=conflict['involved_agents'],
                conflict_description=conflict['description'],
                resolution_strategy='load_redistribution',
                resolution_steps=[
                    '识别高负载智能体',
                    '分析任务可转移性',
                    '重新分配部分任务',
                    '监控负载变化'
                ],
                resolution_time=datetime.now(),
                outcome='负载重新分配完成'
            )
        
        elif conflict['type'] == 'capability_monopoly':
            return ConflictResolution(
                conflict_id=conflict_id,
                conflict_type=conflict['type'],
                involved_agents=conflict['involved_agents'],
                conflict_description=conflict['description'],
                resolution_strategy='capability_backup',
                resolution_steps=[
                    '识别关键能力',
                    '寻找备用智能体',
                    '进行能力培训或配置',
                    '建立冗余机制'
                ],
                resolution_time=datetime.now(),
                outcome='建立能力备份机制'
            )
        
        return None
    
    def _calculate_agent_performance(self, agent_id: str, outcomes: Dict[str, Any]) -> PerformanceMetrics:
        """计算智能体性能"""
        agent_outcomes = outcomes.get(agent_id, {})
        
        return PerformanceMetrics(
            agent_id=agent_id,
            task_success_rate=agent_outcomes.get('success_rate', 0.8),
            average_completion_time=agent_outcomes.get('avg_time', 30.0),
            quality_score=agent_outcomes.get('quality', 0.8),
            collaboration_rating=agent_outcomes.get('collaboration', 0.8),
            reliability_score=agent_outcomes.get('reliability', 0.8),
            learning_progress=agent_outcomes.get('learning', 0.1),
            measurement_period='session'
        )
    
    def _update_pattern_effectiveness(self, pattern_name: str, outcomes: Dict[str, Any]):
        """更新协作模式效果"""
        if pattern_name in self.collaboration_patterns:
            # 简化的效果更新逻辑
            success_rate = outcomes.get('overall_success_rate', 0.8)
            logger.info(f"更新协作模式 {pattern_name} 的效果: {success_rate}")
    
    def _learn_adaptation_rules(self, context: CollaborationContext, outcomes: Dict[str, Any]) -> List[AdaptationRule]:
        """学习新的适应性规则"""
        new_rules = []
        
        # 基于结果学习新规则的简化逻辑
        if outcomes.get('overall_success_rate', 0.8) < 0.6:
            new_rule = AdaptationRule(
                rule_id=f"learned_rule_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
                condition="success_rate < 0.6",
                action="increase_monitoring",
                priority=5,
                effectiveness_score=0.3
            )
            new_rules.append(new_rule)
        
        return new_rules
    
    def _calculate_agent_match_score(self, agent: AgentProfile, requirements: Dict[str, Any]) -> Tuple[float, str]:
        """计算智能体匹配分数"""
        score = 0.0
        reasoning_parts = []
        
        # 能力匹配
        required_capabilities = requirements.get('capabilities', [])
        if required_capabilities:
            agent_capabilities = [cap.name for cap in agent.capabilities]
            matched = set(required_capabilities) & set(agent_capabilities)
            capability_score = len(matched) / len(required_capabilities)
            score += capability_score * 0.4
            reasoning_parts.append(f"能力匹配: {len(matched)}/{len(required_capabilities)}")
        
        # 负载状态
        if agent.current_load < 0.7:
            score += 0.3
            reasoning_parts.append(f"负载适中: {agent.current_load:.2f}")
        
        # 历史性能
        if agent.agent_id in self.performance_history:
            recent_perf = self.performance_history[agent.agent_id][-3:]
            if recent_perf:
                avg_success = sum(p.task_success_rate for p in recent_perf) / len(recent_perf)
                score += avg_success * 0.3
                reasoning_parts.append(f"历史成功率: {avg_success:.2f}")
        
        reasoning = "; ".join(reasoning_parts)
        return score, reasoning