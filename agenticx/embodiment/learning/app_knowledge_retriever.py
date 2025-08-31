"""应用知识检索器

负责从应用中提取和检索知识，包括UI模式、交互流程等。
"""

import time
import logging
from typing import Dict, List, Optional, Any, Tuple, Set
from abc import ABC, abstractmethod

from .models import (
    AppContext, UIPattern, ActionTrace, ExecutionTrace,
    Pattern, PatternType, KnowledgeItem, Experience
)
from agenticx.embodiment.core.models import ScreenState, InteractionElement, GUIAction
from agenticx.embodiment.core.agent import ActionResult


class AppKnowledgeRetriever(ABC):
    """应用知识检索器抽象基类"""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """初始化应用知识检索器
        
        Args:
            config: 配置参数
        """
        self.config = config or {}
        self.logger = logging.getLogger(self.__class__.__name__)
        self._knowledge_cache: Dict[str, Any] = {}
        self._pattern_cache: Dict[str, UIPattern] = {}
        self._app_contexts: Dict[str, AppContext] = {}
        
    @abstractmethod
    def extract_app_context(self, app_info: Dict[str, Any]) -> AppContext:
        """提取应用上下文信息
        
        Args:
            app_info: 应用信息
            
        Returns:
            AppContext: 应用上下文
        """
        pass
    
    @abstractmethod
    def discover_ui_patterns(self, screen_states: List[ScreenState]) -> List[UIPattern]:
        """发现UI模式
        
        Args:
            screen_states: 屏幕状态列表
            
        Returns:
            List[UIPattern]: UI模式列表
        """
        pass
    
    @abstractmethod
    def analyze_interaction_flows(self, action_traces: List[ActionTrace]) -> Dict[str, Any]:
        """分析交互流程
        
        Args:
            action_traces: 动作轨迹列表
            
        Returns:
            Dict[str, Any]: 交互流程分析结果
        """
        pass
    
    @abstractmethod
    def retrieve_similar_contexts(self, target_context: AppContext, 
                                similarity_threshold: float = 0.8) -> List[AppContext]:
        """检索相似应用上下文
        
        Args:
            target_context: 目标上下文
            similarity_threshold: 相似度阈值
            
        Returns:
            List[AppContext]: 相似上下文列表
        """
        pass
    
    @abstractmethod
    def extract_knowledge_from_traces(self, traces: List[ExecutionTrace]) -> List[KnowledgeItem]:
        """从执行轨迹中提取知识
        
        Args:
            traces: 执行轨迹列表
            
        Returns:
            List[KnowledgeItem]: 知识项列表
        """
        pass
    
    def cache_knowledge(self, key: str, knowledge: Any) -> None:
        """缓存知识
        
        Args:
            key: 缓存键
            knowledge: 知识内容
        """
        self._knowledge_cache[key] = {
            'data': knowledge,
            'timestamp': time.time()
        }
    
    def get_cached_knowledge(self, key: str, max_age: float = 3600) -> Optional[Any]:
        """获取缓存的知识
        
        Args:
            key: 缓存键
            max_age: 最大缓存时间（秒）
            
        Returns:
            Optional[Any]: 缓存的知识，如果不存在或过期则返回None
        """
        if key in self._knowledge_cache:
            cached = self._knowledge_cache[key]
            if time.time() - cached['timestamp'] <= max_age:
                return cached['data']
            else:
                del self._knowledge_cache[key]
        return None
    
    def clear_cache(self) -> None:
        """清空缓存"""
        self._knowledge_cache.clear()
        self._pattern_cache.clear()


class DefaultAppKnowledgeRetriever(AppKnowledgeRetriever):
    """默认应用知识检索器实现"""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """初始化默认应用知识检索器"""
        super().__init__(config)
        self.min_pattern_frequency = self.config.get('min_pattern_frequency', 3)
        self.similarity_threshold = self.config.get('similarity_threshold', 0.8)
        self.max_patterns_per_screen = self.config.get('max_patterns_per_screen', 10)
        
    def extract_app_context(self, app_info: Dict[str, Any]) -> AppContext:
        """提取应用上下文信息"""
        try:
            app_context = AppContext(
                app_name=app_info.get('name', 'Unknown'),
                app_package=app_info.get('package', 'unknown.package'),
                app_version=app_info.get('version', '1.0.0'),
                app_category=app_info.get('category', 'Unknown'),
                description=app_info.get('description', ''),
                common_features=app_info.get('features', []),
                ui_framework=app_info.get('ui_framework'),
                platform=app_info.get('platform', 'unknown'),
                metadata=app_info.get('metadata', {})
            )
            
            # 缓存应用上下文
            self._app_contexts[app_context.app_package] = app_context
            
            self.logger.info(f"提取应用上下文: {app_context.app_name}")
            return app_context
            
        except Exception as e:
            self.logger.error(f"提取应用上下文失败: {e}")
            raise
    
    def discover_ui_patterns(self, screen_states: List[ScreenState]) -> List[UIPattern]:
        """发现UI模式"""
        try:
            patterns = []
            element_groups = self._group_similar_elements(screen_states)
            
            for group_id, elements in element_groups.items():
                if len(elements) >= self.min_pattern_frequency:
                    pattern = self._create_ui_pattern(group_id, elements)
                    if pattern:
                        patterns.append(pattern)
                        self._pattern_cache[pattern.pattern_id] = pattern
            
            # 限制返回的模式数量
            patterns = sorted(patterns, key=lambda p: p.frequency, reverse=True)
            patterns = patterns[:self.max_patterns_per_screen]
            
            self.logger.info(f"发现 {len(patterns)} 个UI模式")
            return patterns
            
        except Exception as e:
            self.logger.error(f"发现UI模式失败: {e}")
            return []
    
    def analyze_interaction_flows(self, action_traces: List[ActionTrace]) -> Dict[str, Any]:
        """分析交互流程"""
        try:
            flow_analysis = {
                'common_sequences': [],
                'success_patterns': [],
                'failure_patterns': [],
                'efficiency_metrics': {},
                'user_preferences': {}
            }
            
            # 分析常见序列
            sequences = self._extract_action_sequences(action_traces)
            flow_analysis['common_sequences'] = self._find_common_sequences(sequences)
            
            # 分析成功和失败模式
            success_traces = [t for t in action_traces if t.success]
            failure_traces = [t for t in action_traces if not t.success]
            
            flow_analysis['success_patterns'] = self._analyze_success_patterns(success_traces)
            flow_analysis['failure_patterns'] = self._analyze_failure_patterns(failure_traces)
            
            # 计算效率指标
            flow_analysis['efficiency_metrics'] = self._calculate_efficiency_metrics(action_traces)
            
            # 分析用户偏好
            flow_analysis['user_preferences'] = self._analyze_user_preferences(action_traces)
            
            self.logger.info(f"分析了 {len(action_traces)} 个交互轨迹")
            return flow_analysis
            
        except Exception as e:
            self.logger.error(f"分析交互流程失败: {e}")
            return {}
    
    def retrieve_similar_contexts(self, target_context: AppContext, 
                                similarity_threshold: float = 0.8) -> List[AppContext]:
        """检索相似应用上下文"""
        try:
            similar_contexts = []
            
            for context in self._app_contexts.values():
                if context.app_package != target_context.app_package:
                    similarity = self._calculate_context_similarity(target_context, context)
                    if similarity >= similarity_threshold:
                        similar_contexts.append(context)
            
            # 按相似度排序
            similar_contexts.sort(
                key=lambda c: self._calculate_context_similarity(target_context, c),
                reverse=True
            )
            
            self.logger.info(f"找到 {len(similar_contexts)} 个相似上下文")
            return similar_contexts
            
        except Exception as e:
            self.logger.error(f"检索相似上下文失败: {e}")
            return []
    
    def extract_knowledge_from_traces(self, traces: List[ExecutionTrace]) -> List[KnowledgeItem]:
        """从执行轨迹中提取知识"""
        try:
            knowledge_items = []
            
            for trace in traces:
                # 提取动作模式知识
                action_knowledge = self._extract_action_knowledge(trace)
                knowledge_items.extend(action_knowledge)
                
                # 提取状态转换知识
                state_knowledge = self._extract_state_knowledge(trace)
                knowledge_items.extend(state_knowledge)
                
                # 提取错误处理知识
                if not trace.success:
                    error_knowledge = self._extract_error_knowledge(trace)
                    knowledge_items.extend(error_knowledge)
            
            # 去重和合并相似知识
            knowledge_items = self._deduplicate_knowledge(knowledge_items)
            
            self.logger.info(f"从 {len(traces)} 个轨迹中提取了 {len(knowledge_items)} 个知识项")
            return knowledge_items
            
        except Exception as e:
            self.logger.error(f"提取知识失败: {e}")
            return []
    
    def _group_similar_elements(self, screen_states: List[ScreenState]) -> Dict[str, List[InteractionElement]]:
        """将相似元素分组"""
        element_groups = {}
        
        for state in screen_states:
            for element in state.element_tree.elements.values():
                group_key = self._get_element_group_key(element)
                if group_key not in element_groups:
                    element_groups[group_key] = []
                element_groups[group_key].append(element)
        
        return element_groups
    
    def _get_element_group_key(self, element: InteractionElement) -> str:
        """获取元素分组键"""
        return f"{element.element_type.value}_{element.text[:20] if element.text else 'no_text'}"
    
    def _create_ui_pattern(self, group_id: str, elements: List[InteractionElement]) -> Optional[UIPattern]:
        """创建UI模式"""
        if not elements:
            return None
        
        # 分析元素的共同特征
        common_attributes = self._find_common_attributes(elements)
        
        pattern = UIPattern(
            pattern_id="",  # 将在__post_init__中生成
            pattern_type=PatternType.UI_PATTERN.value,
            elements=elements[:5],  # 限制元素数量
            layout_description=self._generate_layout_description(elements),
            interaction_flow=self._generate_interaction_flow(elements),
            frequency=len(elements),
            confidence=min(1.0, len(elements) / 10.0),  # 基于频率计算置信度
            metadata={
                'group_id': group_id,
                'common_attributes': common_attributes
            }
        )
        
        return pattern
    
    def _find_common_attributes(self, elements: List[InteractionElement]) -> Dict[str, Any]:
        """找到元素的共同属性"""
        if not elements:
            return {}
        
        common_attrs = {
            'element_type': elements[0].element_type.value,
            'common_text_patterns': [],
            'common_properties': {}
        }
        
        # 分析文本模式
        texts = [elem.text for elem in elements if elem.text]
        if texts:
            common_attrs['common_text_patterns'] = self._find_text_patterns(texts)
        
        return common_attrs
    
    def _find_text_patterns(self, texts: List[str]) -> List[str]:
        """找到文本模式"""
        patterns = []
        
        # 简单的模式检测
        if all(text.isdigit() for text in texts):
            patterns.append('numeric')
        if all('@' in text for text in texts):
            patterns.append('email')
        if all(len(text) > 10 for text in texts):
            patterns.append('long_text')
        
        return patterns
    
    def _generate_layout_description(self, elements: List[InteractionElement]) -> str:
        """生成布局描述"""
        if not elements:
            return "Empty layout"
        
        element_types = [elem.element_type.value for elem in elements]
        type_counts = {}
        for elem_type in element_types:
            type_counts[elem_type] = type_counts.get(elem_type, 0) + 1
        
        descriptions = []
        for elem_type, count in type_counts.items():
            descriptions.append(f"{count} {elem_type}(s)")
        
        return f"Layout with {', '.join(descriptions)}"
    
    def _generate_interaction_flow(self, elements: List[InteractionElement]) -> List[str]:
        """生成交互流程"""
        flow = []
        
        for element in elements[:5]:  # 限制流程步骤数量
            if element.clickable:
                flow.append(f"Click {element.element_type.value}")
            elif element.element_type.value == 'text_input':
                flow.append(f"Input text in {element.element_type.value}")
            else:
                flow.append(f"Interact with {element.element_type.value}")
        
        return flow
    
    def _extract_action_sequences(self, action_traces: List[ActionTrace]) -> List[List[str]]:
        """提取动作序列"""
        sequences = []
        
        for trace in action_traces:
            sequence = [action.action_type.value for action in trace.actions]
            sequences.append(sequence)
        
        return sequences
    
    def _find_common_sequences(self, sequences: List[List[str]]) -> List[Dict[str, Any]]:
        """找到常见序列"""
        sequence_counts = {}
        
        for sequence in sequences:
            for i in range(len(sequence)):
                for j in range(i + 2, min(i + 6, len(sequence) + 1)):  # 2-5长度的子序列
                    subseq = tuple(sequence[i:j])
                    sequence_counts[subseq] = sequence_counts.get(subseq, 0) + 1
        
        # 过滤频繁序列
        common_sequences = []
        for subseq, count in sequence_counts.items():
            if count >= self.min_pattern_frequency:
                common_sequences.append({
                    'sequence': list(subseq),
                    'frequency': count,
                    'confidence': min(1.0, count / len(sequences))
                })
        
        return sorted(common_sequences, key=lambda x: x['frequency'], reverse=True)
    
    def _analyze_success_patterns(self, success_traces: List[ActionTrace]) -> List[Dict[str, Any]]:
        """分析成功模式"""
        patterns = []
        
        if not success_traces:
            return patterns
        
        # 分析成功轨迹的共同特征
        avg_duration = sum(trace.duration or 0 for trace in success_traces) / len(success_traces)
        avg_actions = sum(trace.action_count for trace in success_traces) / len(success_traces)
        
        patterns.append({
            'pattern_type': 'duration',
            'description': f'Successful tasks typically take {avg_duration:.2f} seconds',
            'value': avg_duration,
            'confidence': 0.8
        })
        
        patterns.append({
            'pattern_type': 'action_count',
            'description': f'Successful tasks typically require {avg_actions:.1f} actions',
            'value': avg_actions,
            'confidence': 0.8
        })
        
        return patterns
    
    def _analyze_failure_patterns(self, failure_traces: List[ActionTrace]) -> List[Dict[str, Any]]:
        """分析失败模式"""
        patterns = []
        
        if not failure_traces:
            return patterns
        
        # 分析失败的常见原因
        failure_reasons = {}
        for trace in failure_traces:
            reason = trace.metadata.get('failure_reason', 'unknown')
            failure_reasons[reason] = failure_reasons.get(reason, 0) + 1
        
        for reason, count in failure_reasons.items():
            patterns.append({
                'pattern_type': 'failure_reason',
                'description': f'Common failure: {reason}',
                'frequency': count,
                'confidence': count / len(failure_traces)
            })
        
        return patterns
    
    def _calculate_efficiency_metrics(self, action_traces: List[ActionTrace]) -> Dict[str, float]:
        """计算效率指标"""
        if not action_traces:
            return {}
        
        success_traces = [t for t in action_traces if t.success]
        
        metrics = {
            'success_rate': len(success_traces) / len(action_traces),
            'avg_duration': sum(t.duration or 0 for t in action_traces) / len(action_traces),
            'avg_actions': sum(t.action_count for t in action_traces) / len(action_traces)
        }
        
        if success_traces:
            metrics['avg_success_duration'] = sum(t.duration or 0 for t in success_traces) / len(success_traces)
            metrics['avg_success_actions'] = sum(t.action_count for t in success_traces) / len(success_traces)
        
        return metrics
    
    def _analyze_user_preferences(self, action_traces: List[ActionTrace]) -> Dict[str, Any]:
        """分析用户偏好"""
        preferences = {
            'preferred_actions': {},
            'preferred_sequences': [],
            'interaction_style': 'unknown'
        }
        
        # 分析偏好的动作类型
        action_counts = {}
        for trace in action_traces:
            for action in trace.actions:
                action_type = action.action_type.value
                action_counts[action_type] = action_counts.get(action_type, 0) + 1
        
        total_actions = sum(action_counts.values())
        if total_actions > 0:
            for action_type, count in action_counts.items():
                preferences['preferred_actions'][action_type] = count / total_actions
        
        return preferences
    
    def _calculate_context_similarity(self, context1: AppContext, context2: AppContext) -> float:
        """计算上下文相似度"""
        similarity_score = 0.0
        
        # 应用类别相似度
        if context1.app_category == context2.app_category:
            similarity_score += 0.3
        
        # 功能相似度
        common_features = set(context1.common_features) & set(context2.common_features)
        if context1.common_features and context2.common_features:
            feature_similarity = len(common_features) / max(len(context1.common_features), len(context2.common_features))
            similarity_score += 0.4 * feature_similarity
        
        # 平台相似度
        if context1.platform == context2.platform:
            similarity_score += 0.2
        
        # UI框架相似度
        if context1.ui_framework and context2.ui_framework:
            if context1.ui_framework == context2.ui_framework:
                similarity_score += 0.1
        
        return min(1.0, similarity_score)
    
    def _extract_action_knowledge(self, trace: ExecutionTrace) -> List[KnowledgeItem]:
        """提取动作知识"""
        knowledge_items = []
        
        for i, action in enumerate(trace.action_sequence):
            knowledge = KnowledgeItem(
                item_id="",  # 将在__post_init__中生成
                item_type="action_pattern",
                content={
                    'action_type': action.action_type.value,
                    'context': action.to_dict(),
                    'position_in_sequence': i,
                    'success': trace.success
                },
                source=f"trace_{trace.trace_id}",
                confidence=0.8 if trace.success else 0.4,
                relevance=1.0
            )
            knowledge_items.append(knowledge)
        
        return knowledge_items
    
    def _extract_state_knowledge(self, trace: ExecutionTrace) -> List[KnowledgeItem]:
        """提取状态知识"""
        knowledge_items = []
        
        for i, state in enumerate(trace.state_sequence):
            knowledge = KnowledgeItem(
                item_id="",  # 将在__post_init__中生成
                item_type="state_pattern",
                content={
                    'state_info': state.to_dict(),
                    'position_in_sequence': i,
                    'element_count': len(state.element_tree.elements)
                },
                source=f"trace_{trace.trace_id}",
                confidence=0.7,
                relevance=0.8
            )
            knowledge_items.append(knowledge)
        
        return knowledge_items
    
    def _extract_error_knowledge(self, trace: ExecutionTrace) -> List[KnowledgeItem]:
        """提取错误知识"""
        knowledge_items = []
        
        if trace.result_sequence:
            for result in trace.result_sequence:
                if not result.success:
                    knowledge = KnowledgeItem(
                        item_id="",  # 将在__post_init__中生成
                        item_type="error_pattern",
                        content={
                            'error_info': result.to_dict(),
                            'context': trace.metadata
                        },
                        source=f"trace_{trace.trace_id}",
                        confidence=0.9,
                        relevance=1.0
                    )
                    knowledge_items.append(knowledge)
        
        return knowledge_items
    
    def _deduplicate_knowledge(self, knowledge_items: List[KnowledgeItem]) -> List[KnowledgeItem]:
        """去重知识项"""
        unique_items = []
        seen_contents = set()
        
        for item in knowledge_items:
            content_hash = hash(str(sorted(item.content.items())))
            if content_hash not in seen_contents:
                seen_contents.add(content_hash)
                unique_items.append(item)
        
        return unique_items