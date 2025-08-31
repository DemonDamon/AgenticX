"""GUI探索器

负责自动探索GUI界面，发现新的交互元素和模式。
"""

import time
import logging
import random
from typing import Dict, List, Optional, Any, Tuple, Set, Callable
from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum

from .models import (
    UIPattern, ExecutionTrace, Anomaly, AnomalyType,
    Pattern, PatternType, EFSM
)
from agenticx.embodiment.core.models import (
    ScreenState, InteractionElement, GUIAction, ActionType,
    ElementType, BoundingBox
)
from agenticx.embodiment.core.agent import ActionResult


class ExplorationStrategy(Enum):
    """探索策略枚举"""
    RANDOM = "random"
    SYSTEMATIC = "systematic"
    GUIDED = "guided"
    ADAPTIVE = "adaptive"


class ExplorationMode(Enum):
    """探索模式枚举"""
    BREADTH_FIRST = "breadth_first"
    DEPTH_FIRST = "depth_first"
    PRIORITY_BASED = "priority_based"
    COVERAGE_BASED = "coverage_based"


@dataclass
class ExplorationState:
    """探索状态"""
    current_screen: ScreenState
    visited_screens: Set[str]
    action_history: List[GUIAction]
    discovered_elements: Set[str]
    exploration_depth: int
    coverage_score: float
    timestamp: float = 0.0
    
    def __post_init__(self):
        if self.timestamp == 0.0:
            self.timestamp = time.time()


@dataclass
class ExplorationResult:
    """探索结果"""
    discovered_patterns: List[UIPattern]
    new_elements: List[InteractionElement]
    state_transitions: Dict[str, List[str]]
    anomalies: List[Anomaly]
    coverage_metrics: Dict[str, float]
    execution_time: float
    success: bool
    metadata: Dict[str, Any]


class GUIExplorer(ABC):
    """GUI探索器抽象基类"""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """初始化GUI探索器
        
        Args:
            config: 配置参数
        """
        self.config = config or {}
        self.logger = logging.getLogger(self.__class__.__name__)
        self._exploration_history: List[ExplorationState] = []
        self._discovered_patterns: Dict[str, UIPattern] = {}
        self._state_graph: Dict[str, Set[str]] = {}
        self._element_registry: Dict[str, InteractionElement] = {}
        
    @abstractmethod
    def explore_interface(self, initial_state: ScreenState, 
                         strategy: ExplorationStrategy = ExplorationStrategy.ADAPTIVE,
                         max_depth: int = 10) -> Dict[str, Any]:
        """探索界面
        
        Args:
            initial_state: 初始屏幕状态
            strategy: 探索策略
            max_depth: 最大探索深度
            
        Returns:
            ExplorationResult: 探索结果
        """
        pass
    
    @abstractmethod
    def discover_new_elements(self, screen_state: ScreenState) -> List[InteractionElement]:
        """发现新元素
        
        Args:
            screen_state: 屏幕状态
            
        Returns:
            List[InteractionElement]: 新发现的元素列表
        """
        pass
    
    @abstractmethod
    def generate_exploration_actions(self, current_state: ScreenState,
                                   strategy: ExplorationStrategy) -> List[GUIAction]:
        """生成探索动作
        
        Args:
            current_state: 当前状态
            strategy: 探索策略
            
        Returns:
            List[GUIAction]: 探索动作列表
        """
        pass
    
    @abstractmethod
    def build_state_model(self, exploration_traces: List[ExecutionTrace]) -> EFSM:
        """构建状态模型
        
        Args:
            exploration_traces: 探索轨迹列表
            
        Returns:
            EFSM: 扩展有限状态机模型
        """
        pass
    
    @abstractmethod
    def detect_ui_anomalies(self, screen_states: List[ScreenState]) -> List[Anomaly]:
        """检测UI异常
        
        Args:
            screen_states: 屏幕状态列表
            
        Returns:
            List[Anomaly]: 异常列表
        """
        pass
    
    def get_exploration_statistics(self) -> Dict[str, Any]:
        """获取探索统计信息"""
        return {
            'total_explorations': len(self._exploration_history),
            'discovered_patterns': len(self._discovered_patterns),
            'state_graph_size': len(self._state_graph),
            'element_registry_size': len(self._element_registry)
        }
    
    def reset_exploration_state(self) -> None:
        """重置探索状态"""
        self._exploration_history.clear()
        self._discovered_patterns.clear()
        self._state_graph.clear()
        self._element_registry.clear()


class DefaultGUIExplorer(GUIExplorer):
    """默认GUI探索器实现"""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """初始化默认GUI探索器"""
        super().__init__(config)
        self.max_exploration_time = self.config.get('max_exploration_time', 300)  # 5分钟
        self.min_coverage_threshold = self.config.get('min_coverage_threshold', 0.8)
        self.anomaly_detection_threshold = self.config.get('anomaly_detection_threshold', 0.7)
        self.max_actions_per_exploration = self.config.get('max_actions_per_exploration', 50)
        
    def explore_interface(self, initial_state: ScreenState, 
                         strategy: ExplorationStrategy = ExplorationStrategy.ADAPTIVE,
                         max_depth: int = 10) -> ExplorationResult:
        """探索界面"""
        start_time = time.time()
        
        try:
            exploration_state = ExplorationState(
                current_screen=initial_state,
                visited_screens=set(),
                action_history=[],
                discovered_elements=set(),
                exploration_depth=0,
                coverage_score=0.0
            )
            
            discovered_patterns = []
            new_elements = []
            state_transitions = {}
            anomalies = []
            
            # 执行探索
            self._perform_exploration(exploration_state, strategy, max_depth)
            
            # 分析探索结果
            discovered_patterns = self._analyze_discovered_patterns()
            new_elements = self._get_new_elements()
            state_transitions = self._build_state_transitions()
            anomalies = self._detect_exploration_anomalies()
            
            # 计算覆盖率指标
            coverage_metrics = self._calculate_coverage_metrics(exploration_state)
            
            execution_time = time.time() - start_time
            
            result = {
                'discovered_patterns': discovered_patterns,
                'new_elements': new_elements,
                'state_transitions': state_transitions,
                'anomalies': anomalies,
                'coverage_metrics': coverage_metrics,
                'execution_time': execution_time,
                'success': True,
                'metadata': {
                    'strategy': strategy.value,
                    'max_depth': max_depth,
                    'total_actions': len(exploration_state.action_history)
                }
            }
            
            self.logger.info(f"界面探索完成，发现 {len(discovered_patterns)} 个模式")
            return result
            
        except Exception as e:
            self.logger.error(f"界面探索失败: {e}")
            return {
                'discovered_patterns': [],
                'new_elements': [],
                'state_transitions': {},
                'anomalies': [],
                'coverage_metrics': {},
                'execution_time': time.time() - start_time,
                'success': False,
                'metadata': {'error': str(e)}
            }
    
    def discover_new_elements(self, screen_state: ScreenState) -> List[InteractionElement]:
        """发现新元素"""
        new_elements = []
        
        for element in screen_state.element_tree.elements.values():
            element_id = self._get_element_id(element)
            if element_id not in self._element_registry:
                new_elements.append(element)
                self._element_registry[element_id] = element
        
        self.logger.info(f"发现 {len(new_elements)} 个新元素")
        return new_elements
    
    def generate_exploration_actions(self, current_state: ScreenState,
                                   strategy: ExplorationStrategy) -> List[GUIAction]:
        """生成探索动作"""
        actions = []
        
        if strategy == ExplorationStrategy.RANDOM:
            actions = self._generate_random_actions(current_state)
        elif strategy == ExplorationStrategy.SYSTEMATIC:
            actions = self._generate_systematic_actions(current_state)
        elif strategy == ExplorationStrategy.GUIDED:
            actions = self._generate_guided_actions(current_state)
        elif strategy == ExplorationStrategy.ADAPTIVE:
            actions = self._generate_adaptive_actions(current_state)
        
        return actions
    
    def build_state_model(self, exploration_traces: List[ExecutionTrace]) -> EFSM:
        """构建状态模型"""
        try:
            states = set()
            transitions = {}
            initial_state = None
            final_states = []
            
            # 从轨迹中提取状态和转换
            for trace in exploration_traces:
                for i, state in enumerate(trace.state_sequence):
                    state_id = self._get_state_id(state)
                    states.add(state_id)
                    
                    if i == 0 and initial_state is None:
                        initial_state = state_id
                    
                    if i == len(trace.state_sequence) - 1:
                        final_states.append(state_id)
                    
                    # 记录状态转换
                    if i < len(trace.action_sequence):
                        action = trace.action_sequence[i]
                        next_state_id = self._get_state_id(trace.state_sequence[i + 1]) if i + 1 < len(trace.state_sequence) else state_id
                        
                        if state_id not in transitions:
                            transitions[state_id] = {}
                        transitions[state_id][action.action_type.value] = next_state_id
            
            # 创建EFSM
            efsm = EFSM(
                fsm_id="",  # 将在__post_init__中生成
                name="GUI_State_Model",
                states=list(states),
                transitions=transitions,
                initial_state=initial_state or "unknown",
                final_states=list(set(final_states)),
                metadata={
                    'trace_count': len(exploration_traces),
                    'created_from': 'gui_exploration'
                }
            )
            
            self.logger.info(f"构建状态模型，包含 {len(states)} 个状态")
            return efsm
            
        except Exception as e:
            self.logger.error(f"构建状态模型失败: {e}")
            raise
    
    def detect_ui_anomalies(self, screen_states: List[ScreenState]) -> List[Anomaly]:
        """检测UI异常"""
        anomalies = []
        
        try:
            # 检测元素异常
            element_anomalies = self._detect_element_anomalies(screen_states)
            anomalies.extend(element_anomalies)
            
            # 检测布局异常
            layout_anomalies = self._detect_layout_anomalies(screen_states)
            anomalies.extend(layout_anomalies)
            
            # 检测交互异常
            interaction_anomalies = self._detect_interaction_anomalies(screen_states)
            anomalies.extend(interaction_anomalies)
            
            self.logger.info(f"检测到 {len(anomalies)} 个UI异常")
            return anomalies
            
        except Exception as e:
            self.logger.error(f"检测UI异常失败: {e}")
            return []
    
    def _perform_exploration(self, exploration_state: ExplorationState,
                           strategy: ExplorationStrategy, max_depth: int) -> None:
        """执行探索"""
        start_time = time.time()
        
        while (exploration_state.exploration_depth < max_depth and
               len(exploration_state.action_history) < self.max_actions_per_exploration and
               time.time() - start_time < self.max_exploration_time):
            
            # 生成探索动作
            actions = self.generate_exploration_actions(exploration_state.current_screen, strategy)
            
            if not actions:
                break
            
            # 选择并执行动作
            action = self._select_best_action(actions, exploration_state)
            if action:
                self._execute_exploration_action(action, exploration_state)
            else:
                break
    
    def _select_best_action(self, actions: List[GUIAction], 
                          exploration_state: ExplorationState) -> Optional[GUIAction]:
        """选择最佳动作"""
        if not actions:
            return None
        
        # 简单的启发式选择：优先选择未探索的元素
        for action in actions:
            element_id = self._get_action_element_id(action)
            if element_id not in exploration_state.discovered_elements:
                return action
        
        # 如果所有元素都已探索，随机选择
        return random.choice(actions)
    
    def _execute_exploration_action(self, action: GUIAction, 
                                  exploration_state: ExplorationState) -> None:
        """执行探索动作"""
        # 记录动作
        exploration_state.action_history.append(action)
        
        # 模拟动作执行（实际实现中需要与真实GUI交互）
        # 这里只是更新探索状态
        element_id = self._get_action_element_id(action)
        exploration_state.discovered_elements.add(element_id)
        exploration_state.exploration_depth += 1
        
        # 更新覆盖率
        exploration_state.coverage_score = self._calculate_current_coverage(exploration_state)
    
    def _generate_random_actions(self, current_state: ScreenState) -> List[GUIAction]:
        """生成随机动作"""
        actions = []
        
        for element in current_state.element_tree.elements.values():
            if element.clickable:
                action = GUIAction(
                    action_type=ActionType.CLICK,
                    target_element_id=element.element_id,
                    coordinates=(element.bounds.x + element.bounds.width // 2,
                               element.bounds.y + element.bounds.height // 2),
                    parameters={'exploration_type': 'random'}
                )
                actions.append(action)
        
        # 随机打乱动作顺序
        random.shuffle(actions)
        return actions[:10]  # 限制动作数量
    
    def _generate_systematic_actions(self, current_state: ScreenState) -> List[GUIAction]:
        """生成系统性动作"""
        actions = []
        
        # 按元素类型和位置系统性生成动作
        sorted_elements = sorted(current_state.element_tree.elements.values(), 
                               key=lambda e: (e.element_type.value, e.bounds.y, e.bounds.x))
        
        for element in sorted_elements:
            if element.clickable:
                action = GUIAction(
                    action_type=ActionType.CLICK,
                    target_element_id=element.element_id,
                    coordinates=(element.bounds.x + element.bounds.width // 2,
                               element.bounds.y + element.bounds.height // 2),
                    parameters={'exploration_type': 'systematic'}
                )
                actions.append(action)
        
        return actions
    
    def _generate_guided_actions(self, current_state: ScreenState) -> List[GUIAction]:
        """生成引导式动作"""
        actions = []
        
        # 基于已知模式生成动作
        for element in current_state.element_tree.elements.values():
            if self._is_interesting_element(element):
                action = GUIAction(
                    action_type=ActionType.CLICK,
                    target_element_id=element.element_id,
                    coordinates=(element.bounds.x + element.bounds.width // 2,
                               element.bounds.y + element.bounds.height // 2),
                    parameters={'exploration_type': 'guided'}
                )
                actions.append(action)
        
        return actions
    
    def _generate_adaptive_actions(self, current_state: ScreenState) -> List[GUIAction]:
        """生成自适应动作"""
        # 结合多种策略
        random_actions = self._generate_random_actions(current_state)
        systematic_actions = self._generate_systematic_actions(current_state)
        guided_actions = self._generate_guided_actions(current_state)
        
        # 合并并去重
        all_actions = random_actions + systematic_actions + guided_actions
        unique_actions = self._deduplicate_actions(all_actions)
        
        return unique_actions[:15]  # 限制动作数量
    
    def _is_interesting_element(self, element: InteractionElement) -> bool:
        """判断元素是否有趣"""
        # 简单的启发式规则
        if element.element_type in [ElementType.BUTTON, ElementType.LINK]:
            return True
        if element.text and len(element.text) > 0:
            return True
        if element.clickable:
            return True
        return False
    
    def _deduplicate_actions(self, actions: List[GUIAction]) -> List[GUIAction]:
        """去重动作"""
        unique_actions = []
        seen_targets = set()
        
        for action in actions:
            target_id = self._get_action_element_id(action)
            if target_id not in seen_targets:
                seen_targets.add(target_id)
                unique_actions.append(action)
        
        return unique_actions
    
    def _get_element_id(self, element: InteractionElement) -> str:
        """获取元素ID"""
        return f"{element.element_type.value}_{element.bounds.x}_{element.bounds.y}_{element.text[:10] if element.text else 'no_text'}"
    
    def _get_action_element_id(self, action: GUIAction) -> str:
        """获取动作目标元素ID"""
        if action.target_element_id:
            return action.target_element_id
        return f"action_{action.coordinates[0]}_{action.coordinates[1]}"
    
    def _get_state_id(self, state: ScreenState) -> str:
        """获取状态ID"""
        # 基于元素数量和类型生成状态ID
        element_summary = {}
        for element in state.element_tree.elements.values():
            elem_type = element.element_type.value
            element_summary[elem_type] = element_summary.get(elem_type, 0) + 1
        
        summary_str = "_".join(f"{k}:{v}" for k, v in sorted(element_summary.items()))
        return f"state_{hash(summary_str) % 10000}"
    
    def _calculate_current_coverage(self, exploration_state: ExplorationState) -> float:
        """计算当前覆盖率"""
        total_elements = len(exploration_state.current_screen.element_tree.elements)
        discovered_elements = len(exploration_state.discovered_elements)
        
        if total_elements == 0:
            return 1.0
        
        return discovered_elements / total_elements
    
    def _analyze_discovered_patterns(self) -> List[UIPattern]:
        """分析发现的模式"""
        patterns = []
        
        # 基于元素注册表分析模式
        element_groups = self._group_similar_elements()
        
        for group_name, elements in element_groups.items():
            if len(elements) >= 3:  # 至少3个相似元素才构成模式
                pattern = UIPattern(
                    pattern_id="",  # 将在__post_init__中生成
                    pattern_type=PatternType.UI_PATTERN.value,
                    elements=elements[:5],  # 限制元素数量
                    layout_description=f"Pattern of {group_name} elements",
                    interaction_flow=[f"Interact with {group_name}"],
                    frequency=len(elements),
                    confidence=min(1.0, len(elements) / 10.0)
                )
                patterns.append(pattern)
                self._discovered_patterns[pattern.pattern_id] = pattern
        
        return patterns
    
    def _group_similar_elements(self) -> Dict[str, List[InteractionElement]]:
        """将相似元素分组"""
        groups = {}
        
        for element in self._element_registry.values():
            group_key = f"{element.element_type.value}_{element.text[:10] if element.text else 'no_text'}"
            if group_key not in groups:
                groups[group_key] = []
            groups[group_key].append(element)
        
        return groups
    
    def _get_new_elements(self) -> List[InteractionElement]:
        """获取新发现的元素"""
        # 返回最近发现的元素
        return list(self._element_registry.values())[-10:]  # 最近10个
    
    def _build_state_transitions(self) -> Dict[str, List[str]]:
        """构建状态转换"""
        return dict(self._state_graph)
    
    def _detect_exploration_anomalies(self) -> List[Anomaly]:
        """检测探索异常"""
        anomalies = []
        
        # 检测重复动作异常
        if self._exploration_history:
            last_state = self._exploration_history[-1]
            action_counts = {}
            
            for action in last_state.action_history:
                action_key = f"{action.action_type.value}_{self._get_action_element_id(action)}"
                action_counts[action_key] = action_counts.get(action_key, 0) + 1
            
            for action_key, count in action_counts.items():
                if count > 5:  # 同一动作重复超过5次
                    anomaly = Anomaly(
                        anomaly_id="",  # 将在__post_init__中生成
                        anomaly_type=AnomalyType.EXECUTION_FAILURE,
                        description=f"Repeated action detected: {action_key}",
                        context={'action_key': action_key, 'count': count},
                        severity="medium",
                        frequency=count
                    )
                    anomalies.append(anomaly)
        
        return anomalies
    
    def _detect_element_anomalies(self, screen_states: List[ScreenState]) -> List[Anomaly]:
        """检测元素异常"""
        anomalies = []
        
        for state in screen_states:
            # 检测重叠元素
            overlapping_elements = self._find_overlapping_elements(list(state.element_tree.elements.values()))
            if overlapping_elements:
                anomaly = Anomaly(
                    anomaly_id="",  # 将在__post_init__中生成
                    anomaly_type=AnomalyType.UNEXPECTED_STATE,
                    description="Overlapping UI elements detected",
                    context={'overlapping_count': len(overlapping_elements)},
                    severity="low"
                )
                anomalies.append(anomaly)
        
        return anomalies
    
    def _detect_layout_anomalies(self, screen_states: List[ScreenState]) -> List[Anomaly]:
        """检测布局异常"""
        anomalies = []
        
        for state in screen_states:
            # 检测元素过多
            if len(state.element_tree.elements) > 100:
                anomaly = Anomaly(
                    anomaly_id="",  # 将在__post_init__中生成
                    anomaly_type=AnomalyType.UNEXPECTED_STATE,
                    description="Too many UI elements in single screen",
                    context={'element_count': len(state.element_tree.elements)},
                    severity="medium"
                )
                anomalies.append(anomaly)
        
        return anomalies
    
    def _detect_interaction_anomalies(self, screen_states: List[ScreenState]) -> List[Anomaly]:
        """检测交互异常"""
        anomalies = []
        
        for state in screen_states:
            # 检测无可交互元素
            interactive_elements = [e for e in state.element_tree.elements.values() if e.clickable]
            if not interactive_elements:
                anomaly = Anomaly(
                    anomaly_id="",  # 将在__post_init__中生成
                    anomaly_type=AnomalyType.ELEMENT_NOT_FOUND,
                    description="No interactive elements found",
                    context={'total_elements': len(state.element_tree.elements)},
                    severity="high"
                )
                anomalies.append(anomaly)
        
        return anomalies
    
    def _find_overlapping_elements(self, elements: List[InteractionElement]) -> List[Tuple[InteractionElement, InteractionElement]]:
        """找到重叠的元素"""
        overlapping = []
        
        for i, elem1 in enumerate(elements):
            for elem2 in elements[i+1:]:
                if self._elements_overlap(elem1, elem2):
                    overlapping.append((elem1, elem2))
        
        return overlapping
    
    def _elements_overlap(self, elem1: InteractionElement, elem2: InteractionElement) -> bool:
        """检查两个元素是否重叠"""
        b1, b2 = elem1.bounds, elem2.bounds
        
        return not (b1.x + b1.width <= b2.x or
                   b2.x + b2.width <= b1.x or
                   b1.y + b1.height <= b2.y or
                   b2.y + b2.height <= b1.y)
    
    def _calculate_coverage_metrics(self, exploration_state: ExplorationState) -> Dict[str, float]:
        """计算覆盖率指标"""
        return {
            'element_coverage': exploration_state.coverage_score,
            'action_coverage': len(exploration_state.action_history) / self.max_actions_per_exploration,
            'depth_coverage': exploration_state.exploration_depth / 10.0,
            'screen_coverage': len(exploration_state.visited_screens) / max(1, len(exploration_state.visited_screens))
        }