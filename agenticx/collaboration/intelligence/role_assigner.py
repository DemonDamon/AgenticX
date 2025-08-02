"""动态角色分配器

根据任务需求和智能体能力动态分配角色。
"""

import logging
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime
from collections import defaultdict

from .models import (
    AgentProfile,
    AgentCapability,
    RoleAssignment,
    CollaborationContext,
    TaskPriority,
    AgentStatus
)

logger = logging.getLogger(__name__)


class DynamicRoleAssigner:
    """动态角色分配器
    
    核心功能：
    1. 基于任务需求分析所需角色
    2. 根据智能体能力匹配最佳角色
    3. 动态调整角色分配
    4. 监控角色执行效果
    5. 学习优化角色分配策略
    """
    
    def __init__(self):
        self.role_templates: Dict[str, Dict[str, Any]] = {}
        self.assignment_history: List[RoleAssignment] = []
        self.role_performance: Dict[str, Dict[str, float]] = defaultdict(dict)
        self.agent_role_affinity: Dict[str, Dict[str, float]] = defaultdict(dict)
        
        # 初始化预定义角色模板
        self._initialize_role_templates()
    
    def analyze_required_roles(self, context: CollaborationContext, 
                             task_requirements: Dict[str, Any]) -> List[Dict[str, Any]]:
        """分析任务所需角色
        
        Args:
            context: 协作上下文
            task_requirements: 任务需求
            
        Returns:
            List[Dict[str, Any]]: 所需角色列表
        """
        required_roles = []
        
        # 基于任务复杂度确定基础角色
        complexity = task_requirements.get('complexity', 'moderate')
        participant_count = len(context.participants)
        
        if complexity == 'simple' or participant_count <= 3:
            required_roles.extend(self._get_simple_task_roles())
        elif complexity == 'moderate' or participant_count <= 6:
            required_roles.extend(self._get_moderate_task_roles())
        else:
            required_roles.extend(self._get_complex_task_roles())
        
        # 基于特定需求添加专业角色
        domain_requirements = task_requirements.get('domain_requirements', [])
        for domain in domain_requirements:
            specialist_role = self._create_specialist_role(domain)
            if specialist_role:
                required_roles.append(specialist_role)
        
        # 基于协作模式调整角色
        collaboration_pattern = context.shared_state.get('collaboration_pattern')
        if collaboration_pattern:
            required_roles = self._adjust_roles_for_pattern(required_roles, collaboration_pattern)
        
        logger.info(f"为会话 {context.session_id} 分析出 {len(required_roles)} 个所需角色")
        return required_roles
    
    def assign_roles(self, agents: List[AgentProfile], required_roles: List[Dict[str, Any]], 
                    context: CollaborationContext) -> List[RoleAssignment]:
        """分配角色
        
        Args:
            agents: 可用智能体列表
            required_roles: 所需角色列表
            context: 协作上下文
            
        Returns:
            List[RoleAssignment]: 角色分配结果
        """
        assignments = []
        available_agents = [agent for agent in agents if agent.current_status != AgentStatus.OFFLINE]
        
        # 按角色重要性排序
        sorted_roles = sorted(required_roles, key=lambda r: r.get('priority', 5), reverse=True)
        
        for role in sorted_roles:
            best_assignment = self._find_best_agent_for_role(role, available_agents, context)
            if best_assignment:
                assignments.append(best_assignment)
                # 从可用列表中移除已分配的智能体（如果角色是独占的）
                if role.get('exclusive', True):
                    available_agents = [a for a in available_agents 
                                     if a.agent_id != best_assignment.agent_id]
        
        # 为未分配角色的智能体分配默认角色
        unassigned_agents = [a for a in available_agents]
        for agent in unassigned_agents:
            default_assignment = self._create_default_assignment(agent, context)
            if default_assignment:
                assignments.append(default_assignment)
        
        # 记录分配历史
        for assignment in assignments:
            self.assignment_history.append(assignment)
        
        logger.info(f"为会话 {context.session_id} 完成 {len(assignments)} 个角色分配")
        return assignments
    
    def reassign_roles(self, session_id: str, performance_data: Dict[str, Any], 
                      context: CollaborationContext) -> List[RoleAssignment]:
        """重新分配角色
        
        Args:
            session_id: 会话ID
            performance_data: 性能数据
            context: 协作上下文
            
        Returns:
            List[RoleAssignment]: 新的角色分配
        """
        # 分析当前角色执行效果
        underperforming_roles = self._identify_underperforming_roles(session_id, performance_data)
        
        if not underperforming_roles:
            logger.info(f"会话 {session_id} 的角色分配无需调整")
            return []
        
        # 获取当前分配
        current_assignments = [a for a in self.assignment_history 
                             if a.session_id == session_id and a.status == 'active']
        
        new_assignments = []
        
        for role_name in underperforming_roles:
            # 找到当前执行该角色的智能体
            current_assignment = next((a for a in current_assignments 
                                     if a.role_name == role_name), None)
            
            if current_assignment:
                # 寻找更好的替代者
                available_agents = self._get_available_agents_for_reassignment(context, current_assignment)
                
                if available_agents:
                    role_template = self.role_templates.get(role_name, {})
                    new_assignment = self._find_best_agent_for_role(role_template, available_agents, context)
                    
                    if new_assignment and new_assignment.agent_id != current_assignment.agent_id:
                        # 停用旧分配
                        current_assignment.status = 'reassigned'
                        current_assignment.end_time = datetime.now()
                        
                        # 创建新分配
                        new_assignment.session_id = session_id
                        new_assignment.reassignment_reason = f"性能不佳: {role_name}"
                        new_assignments.append(new_assignment)
                        
                        logger.info(f"重新分配角色 {role_name}: {current_assignment.agent_id} -> {new_assignment.agent_id}")
        
        return new_assignments
    
    def evaluate_role_performance(self, session_id: str, 
                                performance_data: Dict[str, Any]) -> Dict[str, float]:
        """评估角色执行效果
        
        Args:
            session_id: 会话ID
            performance_data: 性能数据
            
        Returns:
            Dict[str, float]: 角色性能评分
        """
        role_scores = {}
        
        # 获取会话的角色分配
        session_assignments = [a for a in self.assignment_history 
                             if a.session_id == session_id]
        
        for assignment in session_assignments:
            agent_id = assignment.agent_id
            role_name = assignment.role_name
            
            # 计算角色执行分数
            agent_performance = performance_data.get(agent_id, {})
            role_score = self._calculate_role_execution_score(assignment, agent_performance)
            
            role_scores[f"{agent_id}_{role_name}"] = role_score
            
            # 更新角色性能历史
            if role_name not in self.role_performance[agent_id]:
                self.role_performance[agent_id][role_name] = role_score
            else:
                # 使用指数移动平均更新
                alpha = 0.3
                self.role_performance[agent_id][role_name] = (
                    alpha * role_score + (1 - alpha) * self.role_performance[agent_id][role_name]
                )
        
        return role_scores
    
    def get_role_recommendations(self, agent_id: str, 
                               available_roles: List[str]) -> List[Tuple[str, float, str]]:
        """获取角色推荐
        
        Args:
            agent_id: 智能体ID
            available_roles: 可用角色列表
            
        Returns:
            List[Tuple[str, float, str]]: (角色名, 适合度, 推荐理由)
        """
        recommendations = []
        
        for role_name in available_roles:
            if role_name in self.role_templates:
                role_template = self.role_templates[role_name]
                
                # 计算适合度
                suitability_score, reasoning = self._calculate_role_suitability(
                    agent_id, role_template
                )
                
                if suitability_score > 0.3:  # 最低适合度阈值
                    recommendations.append((role_name, suitability_score, reasoning))
        
        # 按适合度排序
        recommendations.sort(key=lambda x: x[1], reverse=True)
        return recommendations
    
    def learn_from_assignments(self, session_id: str, outcomes: Dict[str, Any]):
        """从分配结果中学习
        
        Args:
            session_id: 会话ID
            outcomes: 协作结果
        """
        session_assignments = [a for a in self.assignment_history 
                             if a.session_id == session_id]
        
        for assignment in session_assignments:
            agent_id = assignment.agent_id
            role_name = assignment.role_name
            
            # 更新智能体-角色亲和度
            agent_outcome = outcomes.get(agent_id, {})
            success_rate = agent_outcome.get('success_rate', 0.5)
            
            if role_name not in self.agent_role_affinity[agent_id]:
                self.agent_role_affinity[agent_id][role_name] = success_rate
            else:
                # 使用指数移动平均更新亲和度
                alpha = 0.2
                self.agent_role_affinity[agent_id][role_name] = (
                    alpha * success_rate + 
                    (1 - alpha) * self.agent_role_affinity[agent_id][role_name]
                )
        
        # 学习角色模板优化
        self._optimize_role_templates(session_assignments, outcomes)
        
        logger.info(f"从会话 {session_id} 的角色分配结果中学习完成")
    
    def _initialize_role_templates(self):
        """初始化角色模板"""
        # 协调者角色
        coordinator_role = {
            'name': 'coordinator',
            'display_name': '协调者',
            'description': '负责协调各智能体的工作，确保协作顺利进行',
            'required_capabilities': ['communication', 'planning', 'monitoring'],
            'preferred_capabilities': ['leadership', 'conflict_resolution'],
            'responsibilities': [
                '制定协作计划',
                '分配和协调任务',
                '监控进度',
                '解决冲突',
                '确保目标达成'
            ],
            'priority': 9,
            'exclusive': True,
            'max_load': 0.8,
            'performance_metrics': ['coordination_efficiency', 'conflict_resolution_rate']
        }
        
        # 执行者角色
        executor_role = {
            'name': 'executor',
            'display_name': '执行者',
            'description': '负责具体任务的执行',
            'required_capabilities': ['task_execution'],
            'preferred_capabilities': ['domain_expertise', 'efficiency'],
            'responsibilities': [
                '执行分配的任务',
                '报告执行进度',
                '确保任务质量',
                '与其他智能体协作'
            ],
            'priority': 7,
            'exclusive': False,
            'max_load': 0.9,
            'performance_metrics': ['task_completion_rate', 'quality_score']
        }
        
        # 监督者角色
        supervisor_role = {
            'name': 'supervisor',
            'display_name': '监督者',
            'description': '负责质量控制和进度监督',
            'required_capabilities': ['monitoring', 'quality_control'],
            'preferred_capabilities': ['analysis', 'reporting'],
            'responsibilities': [
                '监督任务执行',
                '质量检查',
                '进度跟踪',
                '问题识别',
                '改进建议'
            ],
            'priority': 8,
            'exclusive': True,
            'max_load': 0.7,
            'performance_metrics': ['monitoring_coverage', 'issue_detection_rate']
        }
        
        # 专家角色
        expert_role = {
            'name': 'expert',
            'display_name': '专家',
            'description': '提供专业知识和技术支持',
            'required_capabilities': ['domain_expertise'],
            'preferred_capabilities': ['consultation', 'problem_solving'],
            'responsibilities': [
                '提供专业建议',
                '解决技术问题',
                '知识分享',
                '指导其他智能体'
            ],
            'priority': 6,
            'exclusive': False,
            'max_load': 0.6,
            'performance_metrics': ['expertise_utilization', 'problem_resolution_rate']
        }
        
        # 支持者角色
        supporter_role = {
            'name': 'supporter',
            'display_name': '支持者',
            'description': '提供辅助支持和资源协调',
            'required_capabilities': ['support'],
            'preferred_capabilities': ['resource_management', 'assistance'],
            'responsibilities': [
                '提供技术支持',
                '资源协调',
                '辅助其他角色',
                '信息收集和整理'
            ],
            'priority': 5,
            'exclusive': False,
            'max_load': 0.8,
            'performance_metrics': ['support_effectiveness', 'resource_utilization']
        }
        
        self.role_templates = {
            'coordinator': coordinator_role,
            'executor': executor_role,
            'supervisor': supervisor_role,
            'expert': expert_role,
            'supporter': supporter_role
        }
    
    def _get_simple_task_roles(self) -> List[Dict[str, Any]]:
        """获取简单任务所需角色"""
        return [
            self.role_templates['coordinator'],
            self.role_templates['executor']
        ]
    
    def _get_moderate_task_roles(self) -> List[Dict[str, Any]]:
        """获取中等复杂度任务所需角色"""
        return [
            self.role_templates['coordinator'],
            self.role_templates['executor'],
            self.role_templates['supervisor']
        ]
    
    def _get_complex_task_roles(self) -> List[Dict[str, Any]]:
        """获取复杂任务所需角色"""
        return [
            self.role_templates['coordinator'],
            self.role_templates['executor'],
            self.role_templates['supervisor'],
            self.role_templates['expert'],
            self.role_templates['supporter']
        ]
    
    def _create_specialist_role(self, domain: str) -> Optional[Dict[str, Any]]:
        """创建专业领域角色"""
        specialist_role = {
            'name': f'{domain}_specialist',
            'display_name': f'{domain}专家',
            'description': f'负责{domain}领域的专业工作',
            'required_capabilities': [domain, 'domain_expertise'],
            'preferred_capabilities': ['consultation', 'problem_solving'],
            'responsibilities': [
                f'处理{domain}相关任务',
                '提供专业建议',
                '质量保证',
                '知识传递'
            ],
            'priority': 7,
            'exclusive': False,
            'max_load': 0.8,
            'performance_metrics': ['domain_task_success_rate', 'expertise_quality']
        }
        
        return specialist_role
    
    def _adjust_roles_for_pattern(self, roles: List[Dict[str, Any]], 
                                pattern: str) -> List[Dict[str, Any]]:
        """根据协作模式调整角色"""
        if pattern == 'pipeline':
            # 流水线模式需要明确的输入、处理、输出角色
            pipeline_roles = []
            for i, role in enumerate(roles):
                adjusted_role = role.copy()
                if i == 0:
                    adjusted_role['pipeline_stage'] = 'input'
                elif i == len(roles) - 1:
                    adjusted_role['pipeline_stage'] = 'output'
                else:
                    adjusted_role['pipeline_stage'] = 'processing'
                pipeline_roles.append(adjusted_role)
            return pipeline_roles
        
        elif pattern == 'parallel':
            # 并行模式需要协调者和多个并行工作者
            parallel_roles = []
            coordinator_added = False
            
            for role in roles:
                if role['name'] == 'coordinator' and not coordinator_added:
                    coordinator_added = True
                    parallel_roles.append(role)
                elif role['name'] != 'coordinator':
                    adjusted_role = role.copy()
                    adjusted_role['parallel_capable'] = True
                    parallel_roles.append(adjusted_role)
            
            return parallel_roles
        
        elif pattern == 'hierarchical':
            # 层次模式需要明确的层级结构
            hierarchical_roles = []
            for i, role in enumerate(roles):
                adjusted_role = role.copy()
                adjusted_role['hierarchy_level'] = len(roles) - i
                hierarchical_roles.append(adjusted_role)
            return hierarchical_roles
        
        return roles
    
    def _find_best_agent_for_role(self, role: Dict[str, Any], 
                                 available_agents: List[AgentProfile], 
                                 context: CollaborationContext) -> Optional[RoleAssignment]:
        """为角色找到最佳智能体"""
        best_agent = None
        best_score = 0.0
        
        role_name = role['name']
        required_capabilities = role.get('required_capabilities', [])
        max_load = role.get('max_load', 1.0)
        
        for agent in available_agents:
            # 检查负载限制
            if agent.current_load > max_load:
                continue
            
            # 计算匹配分数
            score = self._calculate_agent_role_match_score(agent, role)
            
            if score > best_score:
                best_score = score
                best_agent = agent
        
        if best_agent and best_score > 0.4:  # 最低匹配阈值
            return RoleAssignment(
                assignment_id=f"assign_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{best_agent.agent_id}",
                session_id=context.session_id,
                agent_id=best_agent.agent_id,
                role=role_name,
                role_name=role_name,
                role_description=role.get('description', ''),
                responsibilities=role.get('responsibilities', []),
                expected_workload=0.7,
                assignment_reason=f"最佳匹配，分数: {best_score:.2f}",
                confidence_score=best_score,
                assignment_time=datetime.now(),
                estimated_duration=context.deadline,
                assignment_score=best_score,
                status='active'
            )
        
        return None
    
    def _calculate_agent_role_match_score(self, agent: AgentProfile, role: Dict[str, Any]) -> float:
        """计算智能体与角色的匹配分数"""
        score = 0.0
        
        # 必需能力匹配 (40%)
        required_capabilities = role.get('required_capabilities', [])
        agent_capabilities = [cap.name for cap in agent.capabilities]
        
        if required_capabilities:
            matched_required = set(required_capabilities) & set(agent_capabilities)
            required_score = len(matched_required) / len(required_capabilities)
            score += required_score * 0.4
        else:
            score += 0.2  # 无特定要求时给予基础分数
        
        # 偏好能力匹配 (20%)
        preferred_capabilities = role.get('preferred_capabilities', [])
        if preferred_capabilities:
            matched_preferred = set(preferred_capabilities) & set(agent_capabilities)
            preferred_score = len(matched_preferred) / len(preferred_capabilities)
            score += preferred_score * 0.2
        
        # 历史角色亲和度 (25%)
        role_name = role['name']
        if role_name in self.agent_role_affinity[agent.agent_id]:
            affinity_score = self.agent_role_affinity[agent.agent_id][role_name]
            score += affinity_score * 0.25
        else:
            score += 0.1  # 新角色默认分数
        
        # 当前负载适合度 (15%)
        max_load = role.get('max_load', 1.0)
        if agent.current_load <= max_load:
            load_score = 1.0 - (agent.current_load / max_load)
            score += load_score * 0.15
        
        return min(1.0, score)
    
    def _create_default_assignment(self, agent: AgentProfile, 
                                 context: CollaborationContext) -> Optional[RoleAssignment]:
        """为智能体创建默认角色分配"""
        # 基于智能体能力选择最适合的默认角色
        agent_capabilities = [cap.name for cap in agent.capabilities]
        
        # 优先选择支持者角色
        if 'support' in agent_capabilities or len(agent_capabilities) >= 3:
            role_name = 'supporter'
        else:
            role_name = 'executor'
        
        if role_name in self.role_templates:
            role = self.role_templates[role_name]
            return RoleAssignment(
                assignment_id=f"default_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{agent.agent_id}",
                session_id=context.session_id,
                agent_id=agent.agent_id,
                role=role_name,
                role_name=role_name,
                role_description=role.get('description', ''),
                responsibilities=role.get('responsibilities', []),
                expected_workload=0.5,
                assignment_reason="默认分配",
                confidence_score=0.5,
                assignment_time=datetime.now(),
                estimated_duration=context.deadline,
                assignment_score=0.5,
                status='active'
            )
        
        return None
    
    def _identify_underperforming_roles(self, session_id: str, 
                                      performance_data: Dict[str, Any]) -> List[str]:
        """识别表现不佳的角色"""
        underperforming = []
        
        session_assignments = [a for a in self.assignment_history 
                             if a.session_id == session_id and a.status == 'active']
        
        for assignment in session_assignments:
            agent_performance = performance_data.get(assignment.agent_id, {})
            
            # 检查多个性能指标
            success_rate = agent_performance.get('success_rate', 0.8)
            quality_score = agent_performance.get('quality_score', 0.8)
            efficiency = agent_performance.get('efficiency', 0.8)
            
            # 综合评分
            overall_score = (success_rate + quality_score + efficiency) / 3
            
            if overall_score < 0.6:  # 性能阈值
                underperforming.append(assignment.role_name)
        
        return underperforming
    
    def _get_available_agents_for_reassignment(self, context: CollaborationContext, 
                                             current_assignment: RoleAssignment) -> List[AgentProfile]:
        """获取可用于重新分配的智能体"""
        # 这里应该从实际的智能体管理器获取
        # 暂时返回空列表，实际实现时需要注入智能体管理器
        return []
    
    def _calculate_role_execution_score(self, assignment: RoleAssignment, 
                                      agent_performance: Dict[str, Any]) -> float:
        """计算角色执行分数"""
        # 基于角色特定的性能指标计算分数
        role_name = assignment.role_name
        
        if role_name == 'coordinator':
            coordination_efficiency = agent_performance.get('coordination_efficiency', 0.8)
            conflict_resolution_rate = agent_performance.get('conflict_resolution_rate', 0.8)
            return (coordination_efficiency + conflict_resolution_rate) / 2
        
        elif role_name == 'executor':
            task_completion_rate = agent_performance.get('task_completion_rate', 0.8)
            quality_score = agent_performance.get('quality_score', 0.8)
            return (task_completion_rate + quality_score) / 2
        
        elif role_name == 'supervisor':
            monitoring_coverage = agent_performance.get('monitoring_coverage', 0.8)
            issue_detection_rate = agent_performance.get('issue_detection_rate', 0.8)
            return (monitoring_coverage + issue_detection_rate) / 2
        
        else:
            # 默认计算方式
            success_rate = agent_performance.get('success_rate', 0.8)
            quality_score = agent_performance.get('quality_score', 0.8)
            return (success_rate + quality_score) / 2
    
    def _calculate_role_suitability(self, agent_id: str, 
                                  role_template: Dict[str, Any]) -> Tuple[float, str]:
        """计算角色适合度"""
        # 这里需要获取智能体信息，暂时使用模拟数据
        suitability_score = 0.7  # 模拟分数
        
        reasoning_parts = []
        
        # 历史亲和度
        role_name = role_template['name']
        if role_name in self.agent_role_affinity[agent_id]:
            affinity = self.agent_role_affinity[agent_id][role_name]
            reasoning_parts.append(f"历史亲和度: {affinity:.2f}")
        
        # 角色性能历史
        if role_name in self.role_performance[agent_id]:
            performance = self.role_performance[agent_id][role_name]
            reasoning_parts.append(f"历史性能: {performance:.2f}")
        
        reasoning = "; ".join(reasoning_parts) if reasoning_parts else "基于能力匹配"
        
        return suitability_score, reasoning
    
    def _optimize_role_templates(self, assignments: List[RoleAssignment], 
                               outcomes: Dict[str, Any]):
        """优化角色模板"""
        # 基于分配结果优化角色模板的逻辑
        # 这里可以调整角色的能力要求、优先级等
        
        role_success_rates = defaultdict(list)
        
        for assignment in assignments:
            agent_outcome = outcomes.get(assignment.agent_id, {})
            success_rate = agent_outcome.get('success_rate', 0.5)
            role_success_rates[assignment.role_name].append(success_rate)
        
        # 更新角色模板的优先级
        for role_name, success_rates in role_success_rates.items():
            if role_name in self.role_templates and success_rates:
                avg_success = sum(success_rates) / len(success_rates)
                
                # 根据成功率调整优先级
                if avg_success > 0.8:
                    self.role_templates[role_name]['priority'] = min(10, 
                        self.role_templates[role_name]['priority'] + 1)
                elif avg_success < 0.5:
                    self.role_templates[role_name]['priority'] = max(1, 
                        self.role_templates[role_name]['priority'] - 1)
        
        logger.info("角色模板优化完成")