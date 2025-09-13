"""智能消息路由器

提供基于语义理解的智能消息路由功能。
"""

import logging
from typing import List, Dict, Any, Optional, Tuple, Set
from datetime import datetime, timedelta, UTC
from collections import defaultdict, deque
import hashlib
import json

from .models import (
    RoutingDecision,
    MessagePriority,
    CollaborationContext
)

logger = logging.getLogger(__name__)


class SemanticMessageRouter:
    """语义消息路由器
    
    核心功能：
    1. 基于消息内容的语义分析
    2. 智能路由决策
    3. 消息优先级管理
    4. 路由性能优化
    5. 消息流量控制
    """
    
    def __init__(self):
        self.routing_rules: Dict[str, Dict[str, Any]] = {}
        self.message_history: deque = deque(maxlen=1000)
        self.routing_performance: Dict[str, Dict[str, float]] = defaultdict(dict)
        self.agent_capabilities: Dict[str, Set[str]] = {}
        self.message_patterns: Dict[str, List[str]] = defaultdict(list)
        self.routing_cache: Dict[str, RoutingDecision] = {}
        
        # 初始化默认路由规则
        self._initialize_default_routing_rules()
        
        # 消息流量控制
        self.rate_limits: Dict[str, Dict[str, Any]] = defaultdict(dict)
        self.message_queues: Dict[str, deque] = defaultdict(lambda: deque(maxlen=100))
    
    def route_message(self, message: Dict[str, Any], 
                     context: CollaborationContext) -> RoutingDecision:
        """路由消息
        
        Args:
            message: 智能消息
            context: 协作上下文
            
        Returns:
            RoutingDecision: 路由决策
        """
        # 检查缓存
        cache_key = self._generate_cache_key(message)
        if cache_key in self.routing_cache:
            cached_decision = self.routing_cache[cache_key]
            if self._is_cache_valid(cached_decision):
                logger.debug(f"使用缓存的路由决策: {message.get('message_id', 'unknown')}")
                return cached_decision
        
        # 分析消息语义
        semantic_analysis = self._analyze_message_semantics(message)
        
        # 确定目标接收者
        target_recipients = self._determine_target_recipients(
            message, semantic_analysis, context
        )
        
        # 计算路由优先级
        routing_priority = self._calculate_routing_priority(message, semantic_analysis)
        
        # 选择最佳路由路径
        routing_path = self._select_optimal_routing_path(
            message, target_recipients, context
        )
        
        # 应用流量控制
        delivery_schedule = self._apply_flow_control(
            message, target_recipients, routing_priority
        )
        
        # 创建路由决策
        decision = RoutingDecision(
            message_id=message.get('message_id', 'unknown'),
            source_agent=message.get('sender_id', 'unknown'),
            target_agents=target_recipients,
            routing_strategy=self._determine_routing_strategy(semantic_analysis),
            priority=routing_priority,
            expected_latency=delivery_schedule.get('estimated_time', 1.0),
            reasoning=semantic_analysis.get('routing_reason', '基于语义分析'),
            confidence=semantic_analysis.get('confidence', 0.8)
        )
        
        # 缓存决策
        self.routing_cache[cache_key] = decision
        
        # 记录消息历史
        self.message_history.append({
            'message': message,
            'decision': decision,
            'timestamp': datetime.now()
        })
        
        logger.info(f"消息 {message.get('message_id', 'unknown')} 路由到 {len(target_recipients)} 个接收者")
        return decision
    
    def update_agent_capabilities(self, agent_id: str, capabilities: Set[str]):
        """更新智能体能力信息
        
        Args:
            agent_id: 智能体ID
            capabilities: 能力集合
        """
        self.agent_capabilities[agent_id] = capabilities
        
        # 清除相关缓存
        self._clear_agent_related_cache(agent_id)
        
        logger.debug(f"更新智能体 {agent_id} 的能力信息: {len(capabilities)} 个能力")
    
    def add_routing_rule(self, rule_name: str, rule_config: Dict[str, Any]):
        """添加路由规则
        
        Args:
            rule_name: 规则名称
            rule_config: 规则配置
        """
        self.routing_rules[rule_name] = {
            'config': rule_config,
            'created_time': datetime.now(),
            'usage_count': 0,
            'success_rate': 0.0,
            'enabled': True
        }
        
        logger.info(f"添加路由规则: {rule_name}")
    
    def optimize_routing_performance(self, feedback_data: Dict[str, Any]):
        """优化路由性能
        
        Args:
            feedback_data: 反馈数据
        """
        # 分析路由性能
        performance_analysis = self._analyze_routing_performance(feedback_data)
        
        # 优化路由规则
        self._optimize_routing_rules(performance_analysis)
        
        # 调整缓存策略
        self._optimize_cache_strategy(performance_analysis)
        
        # 更新流量控制参数
        self._update_flow_control_parameters(performance_analysis)
        
        logger.info("路由性能优化完成")
    
    def get_routing_statistics(self, time_window: timedelta = None) -> Dict[str, Any]:
        """获取路由统计信息
        
        Args:
            time_window: 时间窗口
            
        Returns:
            Dict[str, Any]: 统计信息
        """
        if time_window is None:
            time_window = timedelta(hours=24)
        
        cutoff_time = datetime.now() - time_window
        
        # 过滤时间窗口内的消息
        recent_messages = [
            entry for entry in self.message_history
            if entry['timestamp'] >= cutoff_time
        ]
        
        if not recent_messages:
            return {'total_messages': 0}
        
        # 计算统计信息
        total_messages = len(recent_messages)
        
        # 按优先级统计
        priority_stats = defaultdict(int)
        for entry in recent_messages:
            priority = entry['decision'].priority
            priority_stats[priority.value] += 1
        
        # 按路由策略统计
        strategy_stats = defaultdict(int)
        for entry in recent_messages:
            strategy = entry['decision'].routing_strategy
            strategy_stats[strategy] += 1
        
        # 计算平均置信度
        avg_confidence = sum(
            entry['decision'].confidence for entry in recent_messages
        ) / total_messages
        
        # 计算平均交付时间
        avg_delivery_time = sum(
            entry['decision'].expected_latency for entry in recent_messages
        ) / total_messages
        
        return {
            'total_messages': total_messages,
            'time_window_hours': time_window.total_seconds() / 3600,
            'priority_distribution': dict(priority_stats),
            'strategy_distribution': dict(strategy_stats),
            'average_confidence': avg_confidence,
            'average_delivery_time': avg_delivery_time,
            'cache_hit_rate': self._calculate_cache_hit_rate(),
            'active_routing_rules': len([r for r in self.routing_rules.values() if r['enabled']])
        }
    
    def handle_routing_feedback(self, message_id: str, feedback: Dict[str, Any]):
        """处理路由反馈
        
        Args:
            message_id: 消息ID
            feedback: 反馈信息
        """
        # 查找对应的路由决策
        routing_entry = None
        for entry in self.message_history:
            if entry['decision'].message_id == message_id:
                routing_entry = entry
                break
        
        if not routing_entry:
            logger.warning(f"未找到消息 {message_id} 的路由记录")
            return
        
        decision = routing_entry['decision']
        
        # 更新路由性能数据
        success = feedback.get('success', True)
        delivery_time = feedback.get('actual_delivery_time', decision.expected_latency)
        recipient_satisfaction = feedback.get('recipient_satisfaction', 0.8)
        
        # 更新性能统计
        strategy = decision.routing_strategy
        if strategy not in self.routing_performance:
            self.routing_performance[strategy] = {
                'success_count': 0,
                'total_count': 0,
                'avg_delivery_time': 0.0,
                'avg_satisfaction': 0.0
            }
        
        perf = self.routing_performance[strategy]
        perf['total_count'] += 1
        if success:
            perf['success_count'] += 1
        
        # 更新平均值
        alpha = 0.1  # 学习率
        perf['avg_delivery_time'] = (
            (1 - alpha) * perf['avg_delivery_time'] + alpha * delivery_time
        )
        perf['avg_satisfaction'] = (
            (1 - alpha) * perf['avg_satisfaction'] + alpha * recipient_satisfaction
        )
        
        logger.debug(f"处理消息 {message_id} 的路由反馈")
    
    def _analyze_message_semantics(self, message: Dict[str, Any]) -> Dict[str, Any]:
        """分析消息语义"""
        content = message.get('content', '')
        message_type = message.get('message_type', 'unknown')
        
        # 提取关键词
        keywords = self._extract_keywords(content)
        
        # 分析消息意图
        intent = self._analyze_message_intent(content, message_type)
        
        # 确定所需能力
        required_capabilities = self._determine_required_capabilities(content, keywords, intent)
        
        # 分析紧急程度
        urgency_level = self._analyze_urgency(content, message.get('priority', MessagePriority.NORMAL))
        
        # 计算语义置信度
        confidence = self._calculate_semantic_confidence(keywords, intent, required_capabilities)
        
        return {
            'keywords': keywords,
            'intent': intent,
            'required_capabilities': required_capabilities,
            'urgency_level': urgency_level,
            'confidence': confidence,
            'routing_reason': f"基于意图'{intent}'和能力需求{required_capabilities}"
        }
    
    def _extract_keywords(self, content: str) -> List[str]:
        """提取关键词"""
        # 简化的关键词提取逻辑
        # 实际实现可以使用更复杂的NLP技术
        
        # 预定义的关键词映射
        keyword_patterns = {
            '任务': ['task', 'job', 'work', '任务', '工作'],
            '数据': ['data', 'information', '数据', '信息'],
            '分析': ['analyze', 'analysis', '分析', '解析'],
            '报告': ['report', 'summary', '报告', '总结'],
            '问题': ['problem', 'issue', 'error', '问题', '错误'],
            '帮助': ['help', 'assist', 'support', '帮助', '协助'],
            '紧急': ['urgent', 'emergency', 'critical', '紧急', '重要'],
            '完成': ['complete', 'finish', 'done', '完成', '结束']
        }
        
        found_keywords = []
        content_lower = content.lower()
        
        for category, patterns in keyword_patterns.items():
            for pattern in patterns:
                if pattern.lower() in content_lower:
                    found_keywords.append(category)
                    break
        
        return found_keywords
    
    def _analyze_message_intent(self, content: str, message_type: str) -> str:
        """分析消息意图"""
        content_lower = content.lower()
        
        # 基于内容和类型分析意图
        if message_type == 'request':
            if any(word in content_lower for word in ['help', 'assist', '帮助', '协助']):
                return 'request_assistance'
            elif any(word in content_lower for word in ['data', 'information', '数据', '信息']):
                return 'request_information'
            else:
                return 'general_request'
        
        elif message_type == 'notification':
            if any(word in content_lower for word in ['complete', 'finish', '完成', '结束']):
                return 'task_completion'
            elif any(word in content_lower for word in ['error', 'problem', '错误', '问题']):
                return 'error_notification'
            else:
                return 'status_update'
        
        elif message_type == 'command':
            return 'execute_command'
        
        elif message_type == 'query':
            return 'information_query'
        
        else:
            return 'general_communication'
    
    def _determine_required_capabilities(self, content: str, keywords: List[str], 
                                       intent: str) -> List[str]:
        """确定所需能力"""
        required_capabilities = []
        
        # 基于关键词映射能力
        capability_mapping = {
            '数据': ['data_processing', 'data_analysis'],
            '分析': ['analysis', 'data_analysis'],
            '报告': ['reporting', 'documentation'],
            '问题': ['problem_solving', 'debugging'],
            '任务': ['task_execution', 'project_management']
        }
        
        for keyword in keywords:
            if keyword in capability_mapping:
                required_capabilities.extend(capability_mapping[keyword])
        
        # 基于意图添加能力
        intent_capability_mapping = {
            'request_assistance': ['support', 'consultation'],
            'request_information': ['information_retrieval', 'knowledge_base'],
            'task_completion': ['monitoring', 'validation'],
            'error_notification': ['debugging', 'problem_solving'],
            'execute_command': ['command_execution', 'system_control']
        }
        
        if intent in intent_capability_mapping:
            required_capabilities.extend(intent_capability_mapping[intent])
        
        # 去重并返回
        return list(set(required_capabilities))
    
    def _analyze_urgency(self, content: str, priority: MessagePriority) -> str:
        """分析紧急程度"""
        content_lower = content.lower()
        
        # 检查紧急关键词
        urgent_keywords = ['urgent', 'emergency', 'critical', 'asap', '紧急', '立即', '马上']
        has_urgent_keywords = any(keyword in content_lower for keyword in urgent_keywords)
        
        # 结合优先级和关键词
        if priority == MessagePriority.CRITICAL or has_urgent_keywords:
            return 'critical'
        elif priority == MessagePriority.HIGH:
            return 'high'
        elif priority == MessagePriority.LOW:
            return 'low'
        else:
            return 'normal'
    
    def _calculate_semantic_confidence(self, keywords: List[str], intent: str, 
                                     capabilities: List[str]) -> float:
        """计算语义置信度"""
        confidence = 0.5  # 基础置信度
        
        # 关键词数量影响置信度
        if keywords:
            confidence += min(0.3, len(keywords) * 0.1)
        
        # 意图明确性影响置信度
        if intent != 'general_communication':
            confidence += 0.1
        
        # 能力需求明确性影响置信度
        if capabilities:
            confidence += min(0.1, len(capabilities) * 0.02)
        
        return min(1.0, confidence)
    
    def _determine_target_recipients(self, message: Dict[str, Any], 
                                   semantic_analysis: Dict[str, Any], 
                                   context: CollaborationContext) -> List[str]:
        """确定目标接收者"""
        required_capabilities = semantic_analysis.get('required_capabilities', [])
        intent = semantic_analysis.get('intent', '')
        
        # 如果消息指定了接收者
        if message.get('target_agents'):
            return message.get('target_agents', [])
        
        target_recipients = []
        
        # 基于能力匹配
        if required_capabilities:
            for agent_id in context.participants:
                if agent_id in self.agent_capabilities:
                    agent_caps = self.agent_capabilities[agent_id]
                    if any(cap in agent_caps for cap in required_capabilities):
                        target_recipients.append(agent_id)
        
        # 基于意图的特殊路由
        if intent == 'request_assistance':
            # 寻找支持能力强的智能体
            for agent_id in context.participants:
                if agent_id in self.agent_capabilities:
                    agent_caps = self.agent_capabilities[agent_id]
                    if 'support' in agent_caps or 'consultation' in agent_caps:
                        target_recipients.append(agent_id)
        
        elif intent == 'error_notification':
            # 寻找有调试能力的智能体
            for agent_id in context.participants:
                if agent_id in self.agent_capabilities:
                    agent_caps = self.agent_capabilities[agent_id]
                    if 'debugging' in agent_caps or 'problem_solving' in agent_caps:
                        target_recipients.append(agent_id)
        
        # 如果没有找到合适的接收者，广播给所有参与者
        if not target_recipients:
            target_recipients = [aid for aid in context.participants if aid != message.get('sender_id')]
        
        # 去重
        return list(set(target_recipients))
    
    def _calculate_routing_priority(self, message: Dict[str, Any], 
                                  semantic_analysis: Dict[str, Any]) -> MessagePriority:
        """计算路由优先级"""
        base_priority = message.get('priority', MessagePriority.NORMAL)
        urgency_level = semantic_analysis.get('urgency_level', 'normal')
        
        # 基于紧急程度调整优先级
        if urgency_level == 'critical':
            return MessagePriority.CRITICAL
        elif urgency_level == 'high':
            # 确保base_priority是MessagePriority枚举类型
            if isinstance(base_priority, MessagePriority):
                priority_order = [MessagePriority.LOW, MessagePriority.NORMAL, MessagePriority.HIGH, MessagePriority.URGENT, MessagePriority.CRITICAL]
                if priority_order.index(base_priority) < priority_order.index(MessagePriority.HIGH):
                    return MessagePriority.HIGH
            return base_priority
        
        return base_priority
    
    def _select_optimal_routing_path(self, message: Dict[str, Any], 
                                   target_recipients: List[str], 
                                   context: CollaborationContext) -> List[str]:
        """选择最佳路由路径"""
        # 简化的路由路径选择
        # 实际实现可以考虑网络拓扑、负载等因素
        
        sender_id = message.get('sender_id', 'unknown')
        if len(target_recipients) == 1:
            return [sender_id, target_recipients[0]]
        elif len(target_recipients) <= 3:
            # 直接路由
            return [sender_id] + target_recipients
        else:
            # 通过协调者路由
            coordinator = self._find_coordinator(context)
            if coordinator and coordinator != sender_id:
                return [sender_id, coordinator] + target_recipients
            else:
                return [sender_id] + target_recipients
    
    def _find_coordinator(self, context: CollaborationContext) -> Optional[str]:
        """查找协调者"""
        # 寻找有协调能力的智能体
        for agent_id in context.participants:
            if agent_id in self.agent_capabilities:
                agent_caps = self.agent_capabilities[agent_id]
                if 'coordination' in agent_caps or 'leadership' in agent_caps:
                    return agent_id
        return None
    
    def _determine_routing_strategy(self, semantic_analysis: Dict[str, Any]) -> str:
        """确定路由策略"""
        intent = semantic_analysis.get('intent', '')
        urgency_level = semantic_analysis.get('urgency_level', 'normal')
        
        if urgency_level == 'critical':
            return 'immediate_broadcast'
        elif intent in ['request_assistance', 'error_notification']:
            return 'capability_based_routing'
        elif intent == 'task_completion':
            return 'status_update_routing'
        else:
            return 'semantic_routing'
    
    def _apply_flow_control(self, message: Dict[str, Any], 
                          target_recipients: List[str], 
                          priority: MessagePriority) -> Dict[str, Any]:
        """应用流量控制"""
        # 简化的流量控制逻辑
        base_delivery_time = 1.0  # 基础交付时间（秒）
        
        # 根据优先级调整
        priority_multipliers = {
            MessagePriority.CRITICAL: 0.1,
            MessagePriority.HIGH: 0.5,
            MessagePriority.NORMAL: 1.0,
            MessagePriority.LOW: 2.0
        }
        
        delivery_time = base_delivery_time * priority_multipliers.get(priority, 1.0)
        
        # 根据接收者数量调整
        if len(target_recipients) > 5:
            delivery_time *= 1.5
        
        return {
            'estimated_time': delivery_time,
            'batch_size': min(10, len(target_recipients)),
            'retry_count': 3 if priority == MessagePriority.CRITICAL else 1
        }
    
    def _generate_alternative_routes(self, target_recipients: List[str], 
                                   context: CollaborationContext) -> List[List[str]]:
        """生成备选路由"""
        alternatives = []
        
        # 直接路由作为备选
        if len(target_recipients) > 1:
            for recipient in target_recipients:
                alternatives.append([recipient])
        
        # 通过不同中介的路由
        potential_mediators = [aid for aid in context.participants 
                             if aid not in target_recipients]
        
        for mediator in potential_mediators[:2]:  # 最多2个备选
            alternative_route = [mediator] + target_recipients
            alternatives.append(alternative_route)
        
        return alternatives[:3]  # 最多返回3个备选路由
    
    def _generate_cache_key(self, message: Dict[str, Any]) -> str:
        """生成缓存键"""
        # 基于消息内容和类型生成缓存键
        content = message.get('content', '')
        content_hash = hashlib.md5(content.encode()).hexdigest()[:8]
        message_type = message.get('message_type', 'unknown')
        priority = message.get('priority', 'normal')
        priority_value = priority.value if hasattr(priority, 'value') else str(priority)
        return f"{message_type}_{content_hash}_{priority_value}"
    
    def _is_cache_valid(self, decision: RoutingDecision) -> bool:
        """检查缓存是否有效"""
        # 缓存有效期为5分钟
        cache_duration = timedelta(minutes=5)
        return datetime.now() - decision.timestamp < cache_duration
    
    def _clear_agent_related_cache(self, agent_id: str):
        """清除与特定智能体相关的缓存"""
        keys_to_remove = []
        for key, decision in self.routing_cache.items():
            if agent_id in decision.target_agents or decision.source_agent == agent_id:
                keys_to_remove.append(key)
        
        for key in keys_to_remove:
            del self.routing_cache[key]
    
    def _initialize_default_routing_rules(self):
        """初始化默认路由规则"""
        # 紧急消息规则
        self.add_routing_rule('urgent_broadcast', {
            'condition': 'priority == CRITICAL',
            'action': 'broadcast_to_all',
            'max_delay': 0.1
        })
        
        # 能力匹配规则
        self.add_routing_rule('capability_matching', {
            'condition': 'has_required_capabilities',
            'action': 'route_to_capable_agents',
            'min_match_score': 0.7
        })
        
        # 负载均衡规则
        self.add_routing_rule('load_balancing', {
            'condition': 'multiple_capable_agents',
            'action': 'distribute_by_load',
            'max_load_threshold': 0.8
        })
    
    def _analyze_routing_performance(self, feedback_data: Dict[str, Any]) -> Dict[str, Any]:
        """分析路由性能"""
        analysis = {
            'overall_success_rate': 0.0,
            'average_delivery_time': 0.0,
            'strategy_performance': {},
            'bottlenecks': [],
            'optimization_opportunities': []
        }
        
        if not self.routing_performance:
            return analysis
        
        # 计算整体成功率
        total_success = sum(perf['success_count'] for perf in self.routing_performance.values())
        total_attempts = sum(perf['total_count'] for perf in self.routing_performance.values())
        
        if total_attempts > 0:
            analysis['overall_success_rate'] = total_success / total_attempts
        
        # 计算平均交付时间
        delivery_times = [perf['avg_delivery_time'] for perf in self.routing_performance.values()]
        if delivery_times:
            analysis['average_delivery_time'] = sum(delivery_times) / len(delivery_times)
        
        # 分析各策略性能
        for strategy, perf in self.routing_performance.items():
            if perf['total_count'] > 0:
                success_rate = perf['success_count'] / perf['total_count']
                analysis['strategy_performance'][strategy] = {
                    'success_rate': success_rate,
                    'avg_delivery_time': perf['avg_delivery_time'],
                    'avg_satisfaction': perf['avg_satisfaction']
                }
                
                # 识别性能问题
                if success_rate < 0.8:
                    analysis['bottlenecks'].append(f"策略 {strategy} 成功率低")
                
                if perf['avg_delivery_time'] > 5.0:
                    analysis['bottlenecks'].append(f"策略 {strategy} 交付时间过长")
        
        return analysis
    
    def _optimize_routing_rules(self, performance_analysis: Dict[str, Any]):
        """优化路由规则"""
        # 基于性能分析调整路由规则
        for rule_name, rule_data in self.routing_rules.items():
            strategy_perf = performance_analysis['strategy_performance']
            
            # 如果某个策略性能不佳，降低对应规则的优先级
            if rule_name in strategy_perf:
                perf = strategy_perf[rule_name]
                if perf['success_rate'] < 0.7:
                    rule_data['enabled'] = False
                    logger.info(f"禁用性能不佳的路由规则: {rule_name}")
    
    def _optimize_cache_strategy(self, performance_analysis: Dict[str, Any]):
        """优化缓存策略"""
        # 根据性能调整缓存大小和过期时间
        cache_hit_rate = self._calculate_cache_hit_rate()
        
        if cache_hit_rate < 0.3:
            # 缓存命中率低，可能需要调整缓存策略
            logger.info(f"缓存命中率较低: {cache_hit_rate:.2f}，考虑调整缓存策略")
    
    def _update_flow_control_parameters(self, performance_analysis: Dict[str, Any]):
        """更新流量控制参数"""
        avg_delivery_time = performance_analysis.get('average_delivery_time', 1.0)
        
        # 如果平均交付时间过长，调整流量控制参数
        if avg_delivery_time > 3.0:
            logger.info(f"平均交付时间过长: {avg_delivery_time:.2f}s，调整流量控制参数")
    
    def _calculate_cache_hit_rate(self) -> float:
        """计算缓存命中率"""
        # 简化的缓存命中率计算
        # 实际实现需要跟踪缓存命中和未命中的次数
        return 0.6  # 模拟值