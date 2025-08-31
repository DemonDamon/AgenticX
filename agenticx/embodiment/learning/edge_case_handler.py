"""边缘情况处理器

负责识别、处理和学习GUI自动化中的边缘情况和异常场景。
"""

import time
import logging
from typing import Dict, List, Optional, Any, Tuple, Set
from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum
import json

from .models import (
    Anomaly, AnomalyType, EdgeCase, RecoveryStrategy, ExecutionTrace,
    Pattern, PatternType, AppContext
)
from agenticx.embodiment.core.models import GUIAction, ScreenState
from agenticx.embodiment.core.agent import ActionResult
from agenticx.embodiment.core.agent import GUITask


class EdgeCaseSeverity(Enum):
    """边缘情况严重程度枚举"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class RecoveryStatus(Enum):
    """恢复状态枚举"""
    NOT_ATTEMPTED = "not_attempted"
    IN_PROGRESS = "in_progress"
    SUCCESSFUL = "successful"
    FAILED = "failed"
    PARTIAL = "partial"


class HandlingStrategy(Enum):
    """处理策略枚举"""
    RETRY = "retry"
    FALLBACK = "fallback"
    SKIP = "skip"
    ABORT = "abort"
    ADAPTIVE = "adaptive"


@dataclass
class EdgeCaseDetectionResult:
    """边缘情况检测结果"""
    detected_cases: List[EdgeCase]
    anomalies: List[Anomaly]
    severity_distribution: Dict[EdgeCaseSeverity, int]
    confidence_scores: Dict[str, float]
    metadata: Dict[str, Any]


@dataclass
class RecoveryResult:
    """恢复结果"""
    recovery_strategies: List[RecoveryStrategy]
    success_rate: float
    recovery_time: float
    applied_strategy: Optional[RecoveryStrategy]
    final_status: RecoveryStatus
    metadata: Dict[str, Any]


class EdgeCaseHandler(ABC):
    """边缘情况处理器抽象基类"""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """初始化边缘情况处理器
        
        Args:
            config: 配置参数
        """
        self.config = config or {}
        self.logger = logging.getLogger(self.__class__.__name__)
        self._edge_cases: Dict[str, EdgeCase] = {}
        self._recovery_strategies: Dict[str, RecoveryStrategy] = {}
        self._anomaly_patterns: Dict[str, Pattern] = {}
        self._handling_history: List[Dict[str, Any]] = []
        
    @abstractmethod
    def detect_edge_cases(self, execution_traces: List[ExecutionTrace],
                         context: Optional[AppContext] = None) -> EdgeCaseDetectionResult:
        """检测边缘情况
        
        Args:
            execution_traces: 执行轨迹列表
            context: 应用上下文
            
        Returns:
            EdgeCaseDetectionResult: 检测结果
        """
        pass
    
    @abstractmethod
    def handle_anomaly(self, anomaly: Anomaly, context: Optional[AppContext] = None) -> RecoveryResult:
        """处理异常
        
        Args:
            anomaly: 异常对象
            context: 应用上下文
            
        Returns:
            RecoveryResult: 恢复结果
        """
        pass
    
    @abstractmethod
    def generate_recovery_strategies(self, edge_case: EdgeCase) -> List[RecoveryStrategy]:
        """生成恢复策略
        
        Args:
            edge_case: 边缘情况
            
        Returns:
            List[RecoveryStrategy]: 恢复策略列表
        """
        pass
    
    @abstractmethod
    def learn_from_failures(self, failed_traces: List[ExecutionTrace]) -> List[Pattern]:
        """从失败中学习
        
        Args:
            failed_traces: 失败的执行轨迹列表
            
        Returns:
            List[Pattern]: 学习到的模式列表
        """
        pass
    
    @abstractmethod
    def predict_edge_cases(self, current_state: ScreenState, planned_actions: List[GUIAction]) -> List[EdgeCase]:
        """预测边缘情况
        
        Args:
            current_state: 当前屏幕状态
            planned_actions: 计划执行的动作列表
            
        Returns:
            List[EdgeCase]: 预测的边缘情况列表
        """
        pass
    
    def get_handling_statistics(self) -> Dict[str, Any]:
        """获取处理统计信息"""
        return {
            'edge_cases_count': len(self._edge_cases),
            'recovery_strategies_count': len(self._recovery_strategies),
            'anomaly_patterns_count': len(self._anomaly_patterns),
            'handling_history_count': len(self._handling_history)
        }


class DefaultEdgeCaseHandler(EdgeCaseHandler):
    """默认边缘情况处理器实现"""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """初始化默认边缘情况处理器"""
        super().__init__(config)
        self.anomaly_threshold = self.config.get('anomaly_threshold', 0.7)
        self.max_retry_attempts = self.config.get('max_retry_attempts', 3)
        self.recovery_timeout = self.config.get('recovery_timeout', 30.0)
        self.learning_rate = self.config.get('learning_rate', 0.1)
        self.prediction_confidence_threshold = self.config.get('prediction_confidence_threshold', 0.6)
        
    def detect_edge_cases(self, execution_traces: List[ExecutionTrace],
                         context: Optional[AppContext] = None) -> EdgeCaseDetectionResult:
        """检测边缘情况"""
        try:
            detected_cases = []
            anomalies = []
            severity_distribution = {severity: 0 for severity in EdgeCaseSeverity}
            confidence_scores = {}
            
            # 检测执行异常
            execution_anomalies = self._detect_execution_anomalies(execution_traces)
            anomalies.extend(execution_anomalies)
            
            # 检测性能异常
            performance_anomalies = self._detect_performance_anomalies(execution_traces)
            anomalies.extend(performance_anomalies)
            
            # 检测UI异常
            ui_anomalies = self._detect_ui_anomalies(execution_traces)
            anomalies.extend(ui_anomalies)
            
            # 从异常中提取边缘情况
            for anomaly in anomalies:
                edge_case = self._anomaly_to_edge_case(anomaly)
                if edge_case:
                    detected_cases.append(edge_case)
                    self._edge_cases[edge_case.case_id] = edge_case
                    
                    # 更新严重程度分布
                    severity = self._determine_severity(edge_case)
                    severity_distribution[severity] += 1
                    
                    # 计算置信度
                    confidence_scores[edge_case.case_id] = self._calculate_detection_confidence(edge_case, anomaly)
            
            # 检测模式异常
            pattern_anomalies = self._detect_pattern_anomalies(execution_traces)
            for pattern_anomaly in pattern_anomalies:
                edge_case = self._pattern_to_edge_case(pattern_anomaly)
                if edge_case:
                    detected_cases.append(edge_case)
                    self._edge_cases[edge_case.case_id] = edge_case
            
            result = EdgeCaseDetectionResult(
                detected_cases=detected_cases,
                anomalies=anomalies,
                severity_distribution=severity_distribution,
                confidence_scores=confidence_scores,
                metadata={
                    'trace_count': len(execution_traces),
                    'detection_time': time.time(),
                    'context_id': context.context_id if context else None
                }
            )
            
            self.logger.info(f"检测到 {len(detected_cases)} 个边缘情况和 {len(anomalies)} 个异常")
            return result
            
        except Exception as e:
            self.logger.error(f"边缘情况检测失败: {e}")
            return EdgeCaseDetectionResult(
                detected_cases=[],
                anomalies=[],
                severity_distribution={severity: 0 for severity in EdgeCaseSeverity},
                confidence_scores={},
                metadata={'error': str(e)}
            )
    
    def handle_anomaly(self, anomaly: Anomaly, context: Optional[AppContext] = None) -> RecoveryResult:
        """处理异常"""
        try:
            start_time = time.time()
            
            # 生成恢复策略
            edge_case = self._anomaly_to_edge_case(anomaly)
            if not edge_case:
                return RecoveryResult(
                    recovery_strategies=[],
                    success_rate=0.0,
                    recovery_time=0.0,
                    applied_strategy=None,
                    final_status=RecoveryStatus.FAILED,
                    metadata={'error': 'Cannot convert anomaly to edge case'}
                )
            
            recovery_strategies = self.generate_recovery_strategies(edge_case)
            
            # 选择最佳策略
            best_strategy = self._select_best_strategy(recovery_strategies, anomaly)
            
            # 应用恢复策略
            recovery_status = self._apply_recovery_strategy(best_strategy, anomaly, context)
            
            # 计算成功率
            success_rate = self._calculate_recovery_success_rate(recovery_strategies)
            
            recovery_time = time.time() - start_time
            
            result = RecoveryResult(
                recovery_strategies=recovery_strategies,
                success_rate=success_rate,
                recovery_time=recovery_time,
                applied_strategy=best_strategy,
                final_status=recovery_status,
                metadata={
                    'anomaly_id': anomaly.anomaly_id,
                    'edge_case_id': edge_case.case_id,
                    'context_id': context.context_id if context else None
                }
            )
            
            # 记录处理历史
            self._record_handling_history(anomaly, result)
            
            self.logger.info(f"异常处理完成，状态: {recovery_status.value}")
            return result
            
        except Exception as e:
            self.logger.error(f"异常处理失败: {e}")
            return RecoveryResult(
                recovery_strategies=[],
                success_rate=0.0,
                recovery_time=0.0,
                applied_strategy=None,
                final_status=RecoveryStatus.FAILED,
                metadata={'error': str(e)}
            )
    
    def generate_recovery_strategies(self, edge_case: EdgeCase) -> List[RecoveryStrategy]:
        """生成恢复策略"""
        try:
            strategies = []
            
            # 基于边缘情况类型生成策略
            if 'timeout' in edge_case.description.lower():
                strategies.extend(self._generate_timeout_strategies(edge_case))
            
            if 'element_not_found' in edge_case.description.lower():
                strategies.extend(self._generate_element_strategies(edge_case))
            
            if 'network' in edge_case.description.lower():
                strategies.extend(self._generate_network_strategies(edge_case))
            
            if 'permission' in edge_case.description.lower():
                strategies.extend(self._generate_permission_strategies(edge_case))
            
            # 通用策略
            strategies.extend(self._generate_generic_strategies(edge_case))
            
            # 去重和排序
            unique_strategies = self._deduplicate_strategies(strategies)
            sorted_strategies = self._sort_strategies_by_priority(unique_strategies)
            
            # 存储策略
            for strategy in sorted_strategies:
                self._recovery_strategies[strategy.strategy_id] = strategy
            
            self.logger.info(f"为边缘情况 {edge_case.case_id} 生成了 {len(sorted_strategies)} 个恢复策略")
            return sorted_strategies
            
        except Exception as e:
            self.logger.error(f"恢复策略生成失败: {e}")
            return []
    
    def learn_from_failures(self, failed_traces: List[ExecutionTrace]) -> List[Pattern]:
        """从失败中学习"""
        try:
            learned_patterns = []
            
            # 分析失败原因
            failure_reasons = self._analyze_failure_reasons(failed_traces)
            
            # 识别失败模式
            failure_patterns = self._identify_failure_patterns(failed_traces)
            learned_patterns.extend(failure_patterns)
            
            # 识别环境相关模式
            environment_patterns = self._identify_environment_patterns(failed_traces)
            learned_patterns.extend(environment_patterns)
            
            # 识别时序相关模式
            temporal_patterns = self._identify_temporal_patterns(failed_traces)
            learned_patterns.extend(temporal_patterns)
            
            # 更新异常模式库
            for pattern in learned_patterns:
                self._anomaly_patterns[pattern.pattern_id] = pattern
            
            # 更新学习统计
            self._update_learning_statistics(failed_traces, learned_patterns)
            
            self.logger.info(f"从 {len(failed_traces)} 个失败轨迹中学习到 {len(learned_patterns)} 个模式")
            return learned_patterns
            
        except Exception as e:
            self.logger.error(f"失败学习过程失败: {e}")
            return []
    
    def predict_edge_cases(self, current_state: ScreenState, planned_actions: List[GUIAction]) -> List[EdgeCase]:
        """预测边缘情况"""
        try:
            predicted_cases = []
            
            # 基于当前状态预测
            state_predictions = self._predict_from_state(current_state)
            predicted_cases.extend(state_predictions)
            
            # 基于计划动作预测
            action_predictions = self._predict_from_actions(planned_actions)
            predicted_cases.extend(action_predictions)
            
            # 基于历史模式预测
            pattern_predictions = self._predict_from_patterns(current_state, planned_actions)
            predicted_cases.extend(pattern_predictions)
            
            # 基于环境因素预测
            environment_predictions = self._predict_from_environment(current_state)
            predicted_cases.extend(environment_predictions)
            
            # 过滤低置信度预测
            high_confidence_predictions = [
                case for case in predicted_cases
                if self._calculate_prediction_confidence(case) >= self.prediction_confidence_threshold
            ]
            
            # 去重
            unique_predictions = self._deduplicate_edge_cases(high_confidence_predictions)
            
            self.logger.info(f"预测了 {len(unique_predictions)} 个潜在边缘情况")
            return unique_predictions
            
        except Exception as e:
            self.logger.error(f"边缘情况预测失败: {e}")
            return []
    
    def _detect_execution_anomalies(self, traces: List[ExecutionTrace]) -> List[Anomaly]:
        """检测执行异常"""
        anomalies = []
        
        for trace in traces:
            # 检测执行失败
            if not trace.success:
                anomaly = Anomaly(
                    anomaly_id="",  # 将在__post_init__中生成
                    anomaly_type=AnomalyType.EXECUTION_FAILURE,
                    description=f"Execution failed for trace {trace.trace_id}",
                    severity=0.8,
                    context={'trace_id': trace.trace_id, 'error_info': trace.error_info},
                    detection_time=time.time(),
                    metadata={'trace': trace.to_dict()}
                )
                anomalies.append(anomaly)
            
            # 检测超时
            execution_time = trace.end_time - trace.start_time
            if execution_time and execution_time > 60.0:  # 超过60秒视为超时
                anomaly = Anomaly(
                    anomaly_id="",  # 将在__post_init__中生成
                    anomaly_type=AnomalyType.TIMEOUT,
                    description=f"Execution timeout for trace {trace.trace_id}",
                    severity=0.6,
                    context={'trace_id': trace.trace_id, 'execution_time': execution_time},
                    detection_time=time.time(),
                    metadata={'timeout_threshold': 60.0}
                )
                anomalies.append(anomaly)
        
        return anomalies
    
    def _detect_performance_anomalies(self, traces: List[ExecutionTrace]) -> List[Anomaly]:
        """检测性能异常"""
        anomalies = []
        
        # 计算平均执行时间
        execution_times = []
        for t in traces:
            if t.start_time and t.end_time:
                execution_time = t.end_time - t.start_time
                execution_times.append(execution_time)
        
        if not execution_times:
            return anomalies
        
        avg_time = sum(execution_times) / len(execution_times)
        threshold = avg_time * 2.0  # 超过平均时间2倍视为性能异常
        
        for trace in traces:
            if trace.start_time and trace.end_time:
                execution_time = trace.end_time - trace.start_time
                if execution_time > threshold:
                    anomaly = Anomaly(
                        anomaly_id="",  # 将在__post_init__中生成
                        anomaly_type=AnomalyType.PERFORMANCE_DEGRADATION,
                        description=f"Performance degradation detected for trace {trace.trace_id}",
                        severity=min(1.0, execution_time / threshold - 1.0),
                        context={'trace_id': trace.trace_id, 'execution_time': execution_time, 'threshold': threshold},
                        detection_time=time.time(),
                        metadata={'avg_time': avg_time}
                    )
                    anomalies.append(anomaly)
        
        return anomalies
    
    def _detect_ui_anomalies(self, traces: List[ExecutionTrace]) -> List[Anomaly]:
        """检测UI异常"""
        anomalies = []
        
        for trace in traces:
            # 检测UI状态异常
            if trace.state_sequence:
                for i, state in enumerate(trace.state_sequence):
                    if i > 0:  # 比较相邻状态
                        prev_state = trace.state_sequence[i-1]
                        if self._is_unexpected_ui_change(state, prev_state):
                            anomaly = Anomaly(
                                anomaly_id="",  # 将在__post_init__中生成
                                anomaly_type=AnomalyType.UI_STATE_INCONSISTENCY,
                                description=f"Unexpected UI state change in trace {trace.trace_id}",
                                severity=0.5,
                                context={'trace_id': trace.trace_id, 'current_state': state, 'prev_state': prev_state},
                                detection_time=time.time(),
                                metadata={'change_type': 'unexpected'}
                            )
                            anomalies.append(anomaly)
        
        return anomalies
    
    def _detect_pattern_anomalies(self, traces: List[ExecutionTrace]) -> List[Pattern]:
        """检测模式异常"""
        patterns = []
        
        # 统计动作序列
        sequence_counts = {}
        for trace in traces:
            if trace.action_sequence:
                sequence_key = json.dumps([action.get('type', 'unknown') for action in trace.action_sequence])
                sequence_counts[sequence_key] = sequence_counts.get(sequence_key, 0) + 1
        
        # 识别异常模式（出现频率很低的序列）
        total_traces = len(traces)
        for sequence, count in sequence_counts.items():
            frequency = count / total_traces
            if frequency < 0.05:  # 出现频率低于5%视为异常模式
                pattern = Pattern(
                    pattern_id="",  # 将在__post_init__中生成
                    pattern_type=PatternType.ANOMALY_PATTERN,
                    pattern_name=f"Rare sequence pattern",
                    description=f"Sequence appears only {count} times out of {total_traces}",
                    structure={'sequence': json.loads(sequence), 'frequency': frequency},
                    examples=[{'count': count, 'total': total_traces}],
                    frequency=count,
                    confidence=1.0 - frequency  # 频率越低，异常置信度越高
                )
                patterns.append(pattern)
        
        return patterns
    
    def _anomaly_to_edge_case(self, anomaly: Anomaly) -> Optional[EdgeCase]:
        """将异常转换为边缘情况"""
        try:
            # 生成触发条件
            trigger_conditions = self._extract_trigger_conditions(anomaly)
            
            # 生成预期行为
            expected_behavior = self._infer_expected_behavior(anomaly)
            
            # 生成实际行为
            actual_behavior = self._extract_actual_behavior(anomaly)
            
            edge_case = EdgeCase(
                case_id="",  # 将在__post_init__中生成
                case_name=f"Edge case from {anomaly.anomaly_type.value}",
                description=anomaly.description,
                trigger_conditions=trigger_conditions,
                expected_behavior=expected_behavior,
                actual_behavior=actual_behavior,
                frequency=1,
                severity=anomaly.severity,
                metadata={
                    'source_anomaly_id': anomaly.anomaly_id,
                    'anomaly_type': anomaly.anomaly_type.value,
                    'detection_time': anomaly.detection_time
                }
            )
            
            return edge_case
            
        except Exception as e:
            self.logger.error(f"异常转换为边缘情况失败: {e}")
            return None
    
    def _pattern_to_edge_case(self, pattern: Pattern) -> Optional[EdgeCase]:
        """将模式转换为边缘情况"""
        try:
            edge_case = EdgeCase(
                case_id="",  # 将在__post_init__中生成
                case_name=f"Edge case from pattern {pattern.pattern_name}",
                description=pattern.description,
                trigger_conditions=[f"Pattern: {pattern.pattern_name}"],
                expected_behavior=["Normal execution flow"],
                actual_behavior=["Anomalous pattern detected"],
                frequency=pattern.frequency,
                severity=1.0 - pattern.confidence,  # 置信度越低，严重程度越高
                metadata={
                    'source_pattern_id': pattern.pattern_id,
                    'pattern_type': pattern.pattern_type.value
                }
            )
            
            return edge_case
            
        except Exception as e:
            self.logger.error(f"模式转换为边缘情况失败: {e}")
            return None
    
    def _determine_severity(self, edge_case: EdgeCase) -> EdgeCaseSeverity:
        """确定边缘情况严重程度"""
        if edge_case.severity >= 0.8:
            return EdgeCaseSeverity.CRITICAL
        elif edge_case.severity >= 0.6:
            return EdgeCaseSeverity.HIGH
        elif edge_case.severity >= 0.4:
            return EdgeCaseSeverity.MEDIUM
        else:
            return EdgeCaseSeverity.LOW
    
    def _calculate_detection_confidence(self, edge_case: EdgeCase, anomaly: Anomaly) -> float:
        """计算检测置信度"""
        # 基于异常严重程度和边缘情况频率计算置信度
        base_confidence = anomaly.severity
        frequency_factor = min(1.0, edge_case.frequency / 10.0)
        
        return min(1.0, base_confidence * 0.7 + frequency_factor * 0.3)
    
    def _select_best_strategy(self, strategies: List[RecoveryStrategy], anomaly: Anomaly) -> Optional[RecoveryStrategy]:
        """选择最佳恢复策略"""
        if not strategies:
            return None
        
        # 基于成功率和适用性选择策略
        best_strategy = None
        best_score = 0.0
        
        for strategy in strategies:
            # 计算策略分数
            score = strategy.success_rate * 0.6 + strategy.confidence * 0.4
            
            # 考虑策略与异常类型的匹配度
            if self._strategy_matches_anomaly(strategy, anomaly):
                score *= 1.2
            
            if score > best_score:
                best_score = score
                best_strategy = strategy
        
        return best_strategy
    
    def _apply_recovery_strategy(self, strategy: Optional[RecoveryStrategy], 
                               anomaly: Anomaly, context: Optional[AppContext]) -> RecoveryStatus:
        """应用恢复策略"""
        if not strategy:
            return RecoveryStatus.FAILED
        
        try:
            # 模拟策略应用
            if strategy.strategy_type == HandlingStrategy.RETRY.value:
                return self._apply_retry_strategy(strategy, anomaly)
            elif strategy.strategy_type == HandlingStrategy.FALLBACK.value:
                return self._apply_fallback_strategy(strategy, anomaly)
            elif strategy.strategy_type == HandlingStrategy.SKIP.value:
                return self._apply_skip_strategy(strategy, anomaly)
            elif strategy.strategy_type == HandlingStrategy.ABORT.value:
                return self._apply_abort_strategy(strategy, anomaly)
            else:
                return self._apply_adaptive_strategy(strategy, anomaly)
                
        except Exception as e:
            self.logger.error(f"策略应用失败: {e}")
            return RecoveryStatus.FAILED
    
    def _calculate_recovery_success_rate(self, strategies: List[RecoveryStrategy]) -> float:
        """计算恢复成功率"""
        if not strategies:
            return 0.0
        
        total_success_rate = sum(strategy.success_rate for strategy in strategies)
        return min(1.0, total_success_rate / len(strategies))
    
    def _record_handling_history(self, anomaly: Anomaly, result: RecoveryResult):
        """记录处理历史"""
        history_entry = {
            'timestamp': time.time(),
            'anomaly_id': anomaly.anomaly_id,
            'anomaly_type': anomaly.anomaly_type.value,
            'recovery_status': result.final_status.value,
            'success_rate': result.success_rate,
            'recovery_time': result.recovery_time,
            'applied_strategy_id': result.applied_strategy.strategy_id if result.applied_strategy else None
        }
        
        self._handling_history.append(history_entry)
        
        # 限制历史记录数量
        if len(self._handling_history) > 1000:
            self._handling_history = self._handling_history[-1000:]
    
    def _generate_timeout_strategies(self, edge_case: EdgeCase) -> List[RecoveryStrategy]:
        """生成超时相关的恢复策略"""
        strategies = []
        
        # 重试策略
        retry_strategy = RecoveryStrategy(
            strategy_id="",  # 将在__post_init__中生成
            strategy_name="Timeout Retry",
            strategy_type=HandlingStrategy.RETRY.value,
            description="Retry the operation with increased timeout",
            steps=["Increase timeout value", "Retry operation", "Monitor execution"],
            conditions=["Timeout detected", "Retry count < max_retries"],
            success_rate=0.7,
            estimated_time=30.0,
            confidence=0.8
        )
        strategies.append(retry_strategy)
        
        # 分步执行策略
        stepwise_strategy = RecoveryStrategy(
            strategy_id="",  # 将在__post_init__中生成
            strategy_name="Stepwise Execution",
            strategy_type=HandlingStrategy.FALLBACK.value,
            description="Break down the operation into smaller steps",
            steps=["Analyze operation", "Split into sub-operations", "Execute step by step"],
            conditions=["Complex operation timeout"],
            success_rate=0.8,
            estimated_time=45.0,
            confidence=0.9
        )
        strategies.append(stepwise_strategy)
        
        return strategies
    
    def _generate_element_strategies(self, edge_case: EdgeCase) -> List[RecoveryStrategy]:
        """生成元素相关的恢复策略"""
        strategies = []
        
        # 等待策略
        wait_strategy = RecoveryStrategy(
            strategy_id="",  # 将在__post_init__中生成
            strategy_name="Wait for Element",
            strategy_type=HandlingStrategy.RETRY.value,
            description="Wait for the element to appear",
            steps=["Wait for element", "Check element presence", "Retry action"],
            conditions=["Element not found"],
            success_rate=0.6,
            estimated_time=15.0,
            confidence=0.7
        )
        strategies.append(wait_strategy)
        
        # 替代元素策略
        alternative_strategy = RecoveryStrategy(
            strategy_id="",  # 将在__post_init__中生成
            strategy_name="Alternative Element",
            strategy_type=HandlingStrategy.FALLBACK.value,
            description="Use alternative element selector",
            steps=["Search for alternative selectors", "Try alternative element", "Execute action"],
            conditions=["Primary element not found"],
            success_rate=0.5,
            estimated_time=20.0,
            confidence=0.6
        )
        strategies.append(alternative_strategy)
        
        return strategies
    
    def _generate_network_strategies(self, edge_case: EdgeCase) -> List[RecoveryStrategy]:
        """生成网络相关的恢复策略"""
        strategies = []
        
        # 重连策略
        reconnect_strategy = RecoveryStrategy(
            strategy_id="",  # 将在__post_init__中生成
            strategy_name="Network Reconnect",
            strategy_type=HandlingStrategy.RETRY.value,
            description="Reconnect to the network and retry",
            steps=["Check network status", "Reconnect if needed", "Retry operation"],
            conditions=["Network error detected"],
            success_rate=0.8,
            estimated_time=25.0,
            confidence=0.9
        )
        strategies.append(reconnect_strategy)
        
        return strategies
    
    def _generate_permission_strategies(self, edge_case: EdgeCase) -> List[RecoveryStrategy]:
        """生成权限相关的恢复策略"""
        strategies = []
        
        # 权限请求策略
        permission_strategy = RecoveryStrategy(
            strategy_id="",  # 将在__post_init__中生成
            strategy_name="Request Permission",
            strategy_type=HandlingStrategy.FALLBACK.value,
            description="Request necessary permissions",
            steps=["Identify required permissions", "Request permissions", "Retry operation"],
            conditions=["Permission denied"],
            success_rate=0.7,
            estimated_time=35.0,
            confidence=0.8
        )
        strategies.append(permission_strategy)
        
        return strategies
    
    def _generate_generic_strategies(self, edge_case: EdgeCase) -> List[RecoveryStrategy]:
        """生成通用恢复策略"""
        strategies = []
        
        # 跳过策略
        skip_strategy = RecoveryStrategy(
            strategy_id="",  # 将在__post_init__中生成
            strategy_name="Skip Operation",
            strategy_type=HandlingStrategy.SKIP.value,
            description="Skip the problematic operation",
            steps=["Mark operation as skipped", "Continue with next operation"],
            conditions=["Non-critical operation"],
            success_rate=0.9,
            estimated_time=5.0,
            confidence=0.5
        )
        strategies.append(skip_strategy)
        
        # 中止策略
        abort_strategy = RecoveryStrategy(
            strategy_id="",  # 将在__post_init__中生成
            strategy_name="Abort Execution",
            strategy_type=HandlingStrategy.ABORT.value,
            description="Abort the entire execution",
            steps=["Save current state", "Clean up resources", "Abort execution"],
            conditions=["Critical failure"],
            success_rate=1.0,
            estimated_time=10.0,
            confidence=1.0
        )
        strategies.append(abort_strategy)
        
        return strategies
    
    def _deduplicate_strategies(self, strategies: List[RecoveryStrategy]) -> List[RecoveryStrategy]:
        """去重策略"""
        unique_strategies = []
        seen_names = set()
        
        for strategy in strategies:
            if strategy.strategy_name not in seen_names:
                seen_names.add(strategy.strategy_name)
                unique_strategies.append(strategy)
        
        return unique_strategies
    
    def _sort_strategies_by_priority(self, strategies: List[RecoveryStrategy]) -> List[RecoveryStrategy]:
        """按优先级排序策略"""
        # 按成功率和置信度排序
        return sorted(strategies, key=lambda s: (s.success_rate * s.confidence), reverse=True)
    
    def _analyze_failure_reasons(self, failed_traces: List[ExecutionTrace]) -> Dict[str, int]:
        """分析失败原因"""
        failure_reasons = {}
        
        for trace in failed_traces:
            if trace.error_info:
                error_type = trace.error_info.get('type', 'unknown')
                failure_reasons[error_type] = failure_reasons.get(error_type, 0) + 1
        
        return failure_reasons
    
    def _identify_failure_patterns(self, failed_traces: List[ExecutionTrace]) -> List[Pattern]:
        """识别失败模式"""
        patterns = []
        
        # 按错误类型分组
        error_groups = {}
        for trace in failed_traces:
            if trace.error_info:
                error_type = trace.error_info.get('type', 'unknown')
                if error_type not in error_groups:
                    error_groups[error_type] = []
                error_groups[error_type].append(trace)
        
        # 为每个错误类型创建模式
        for error_type, traces in error_groups.items():
            if len(traces) >= 3:  # 至少3个相同错误才认为是模式
                pattern = Pattern(
                    pattern_id="",  # 将在__post_init__中生成
                    pattern_type=PatternType.FAILURE_PATTERN,
                    pattern_name=f"Failure pattern: {error_type}",
                    description=f"Common failure pattern with error type {error_type}",
                    structure={'error_type': error_type, 'frequency': len(traces)},
                    examples=[{'trace_id': t.trace_id} for t in traces[:3]],
                    frequency=len(traces),
                    confidence=min(1.0, len(traces) / len(failed_traces))
                )
                patterns.append(pattern)
        
        return patterns
    
    def _identify_environment_patterns(self, failed_traces: List[ExecutionTrace]) -> List[Pattern]:
        """识别环境相关模式"""
        patterns = []
        
        # 分析环境因素
        env_factors = {}
        for trace in failed_traces:
            if trace.environment_info:
                for factor, value in trace.environment_info.items():
                    if factor not in env_factors:
                        env_factors[factor] = {}
                    env_factors[factor][str(value)] = env_factors[factor].get(str(value), 0) + 1
        
        # 为显著的环境因素创建模式
        for factor, values in env_factors.items():
            for value, count in values.items():
                if count >= 2:  # 至少出现2次
                    pattern = Pattern(
                        pattern_id="",  # 将在__post_init__中生成
                        pattern_type=PatternType.ENVIRONMENT_PATTERN,
                        pattern_name=f"Environment pattern: {factor}={value}",
                        description=f"Failures associated with {factor}={value}",
                        structure={'factor': factor, 'value': value, 'frequency': count},
                        examples=[{'factor': factor, 'value': value}],
                        frequency=count,
                        confidence=count / len(failed_traces)
                    )
                    patterns.append(pattern)
        
        return patterns
    
    def _identify_temporal_patterns(self, failed_traces: List[ExecutionTrace]) -> List[Pattern]:
        """识别时序相关模式"""
        patterns = []
        
        # 分析执行时间分布
        execution_times = []
        for t in failed_traces:
            if t.start_time and t.end_time:
                execution_time = t.end_time - t.start_time
                execution_times.append(execution_time)
        
        if execution_times:
            avg_time = sum(execution_times) / len(execution_times)
            
            # 识别长时间执行的失败模式
            long_executions = [t for t in execution_times if t > avg_time * 1.5]
            if len(long_executions) >= 2:
                pattern = Pattern(
                    pattern_id="",  # 将在__post_init__中生成
                    pattern_type=PatternType.TEMPORAL_PATTERN,
                    pattern_name="Long execution failure pattern",
                    description="Failures associated with long execution times",
                    structure={'avg_time': avg_time, 'long_execution_count': len(long_executions)},
                    examples=[{'execution_time': t} for t in long_executions[:3]],
                    frequency=len(long_executions),
                    confidence=len(long_executions) / len(execution_times)
                )
                patterns.append(pattern)
        
        return patterns
    
    def _update_learning_statistics(self, failed_traces: List[ExecutionTrace], patterns: List[Pattern]):
        """更新学习统计"""
        # 简单的学习统计更新
        learning_stats = {
            'total_failed_traces': len(failed_traces),
            'patterns_learned': len(patterns),
            'learning_timestamp': time.time()
        }
        
        # 存储到配置中
        if 'learning_stats' not in self.config:
            self.config['learning_stats'] = []
        
        self.config['learning_stats'].append(learning_stats)
    
    def _predict_from_state(self, state: ScreenState) -> List[EdgeCase]:
        """基于状态预测边缘情况"""
        predictions = []
        
        # 检查状态中的潜在问题
        if not state.element_tree.elements:
            prediction = EdgeCase(
                case_id="",  # 将在__post_init__中生成
                case_name="Empty screen state",
                description="Screen state contains no elements",
                trigger_conditions=["Empty element list"],
                expected_behavior=["Screen should contain interactive elements"],
                actual_behavior=["No elements detected"],
                frequency=1,
                severity=0.6,
                metadata={'prediction_source': 'state_analysis'}
            )
            predictions.append(prediction)
        
        return predictions
    
    def _predict_from_actions(self, actions: List[GUIAction]) -> List[EdgeCase]:
        """基于动作预测边缘情况"""
        predictions = []
        
        # 检查动作序列中的潜在问题
        if len(actions) > 10:
            prediction = EdgeCase(
                case_id="",  # 将在__post_init__中生成
                case_name="Complex action sequence",
                description="Action sequence is very complex",
                trigger_conditions=[f"Action count > 10 (actual: {len(actions)})"],
                expected_behavior=["Simple action sequences"],
                actual_behavior=["Complex action sequence detected"],
                frequency=1,
                severity=0.4,
                metadata={'prediction_source': 'action_analysis', 'action_count': len(actions)}
            )
            predictions.append(prediction)
        
        return predictions
    
    def _predict_from_patterns(self, state: ScreenState, actions: List[GUIAction]) -> List[EdgeCase]:
        """基于模式预测边缘情况"""
        predictions = []
        
        # 基于已知的异常模式进行预测
        for pattern in self._anomaly_patterns.values():
            if self._pattern_matches_context(pattern, state, actions):
                prediction = EdgeCase(
                    case_id="",  # 将在__post_init__中生成
                    case_name=f"Predicted from pattern: {pattern.pattern_name}",
                    description=f"Edge case predicted based on pattern {pattern.pattern_name}",
                    trigger_conditions=[f"Pattern match: {pattern.pattern_name}"],
                    expected_behavior=["Normal execution"],
                    actual_behavior=["Pattern-based anomaly predicted"],
                    frequency=pattern.frequency,
                    severity=1.0 - pattern.confidence,
                    metadata={'prediction_source': 'pattern_analysis', 'source_pattern_id': pattern.pattern_id}
                )
                predictions.append(prediction)
        
        return predictions
    
    def _predict_from_environment(self, state: ScreenState) -> List[EdgeCase]:
        """基于环境预测边缘情况"""
        predictions = []
        
        # 基于屏幕状态的环境因素预测
        if hasattr(state, 'metadata') and state.metadata:
            screen_size = state.metadata.get('screen_size')
            if screen_size and isinstance(screen_size, dict):
                width = screen_size.get('width', 0)
                height = screen_size.get('height', 0)
                
                # 检查屏幕尺寸异常
                if width < 800 or height < 600:
                    prediction = EdgeCase(
                        case_id="",  # 将在__post_init__中生成
                        case_name="Small screen size",
                        description="Screen size may cause layout issues",
                        trigger_conditions=[f"Screen size: {width}x{height}"],
                        expected_behavior=["Standard screen size (>=800x600)"],
                        actual_behavior=["Small screen detected"],
                        frequency=1,
                        severity=0.3,
                        metadata={'prediction_source': 'environment_analysis', 'screen_size': screen_size}
                    )
                    predictions.append(prediction)
        
        return predictions
    
    def _calculate_prediction_confidence(self, edge_case: EdgeCase) -> float:
        """计算预测置信度"""
        # 基于严重程度和频率计算置信度
        base_confidence = edge_case.severity
        frequency_factor = min(1.0, edge_case.frequency / 5.0)
        
        return min(1.0, base_confidence * 0.6 + frequency_factor * 0.4)
    
    def _deduplicate_edge_cases(self, edge_cases: List[EdgeCase]) -> List[EdgeCase]:
        """去重边缘情况"""
        unique_cases = []
        seen_names = set()
        
        for case in edge_cases:
            if case.case_name not in seen_names:
                seen_names.add(case.case_name)
                unique_cases.append(case)
        
        return unique_cases
    
    def _is_unexpected_ui_change(self, state_change: Dict[str, Any]) -> bool:
        """检查是否为意外的UI变化"""
        # 简单的启发式检查
        change_type = state_change.get('type', '')
        return change_type in ['unexpected_popup', 'element_disappeared', 'layout_changed']
    
    def _extract_trigger_conditions(self, anomaly: Anomaly) -> List[str]:
        """提取触发条件"""
        conditions = []
        
        if anomaly.anomaly_type == AnomalyType.TIMEOUT:
            conditions.append("Long execution time detected")
        elif anomaly.anomaly_type == AnomalyType.EXECUTION_FAILURE:
            conditions.append("Execution failure occurred")
        elif anomaly.anomaly_type == AnomalyType.UI_STATE_INCONSISTENCY:
            conditions.append("UI state inconsistency detected")
        else:
            conditions.append(f"Anomaly type: {anomaly.anomaly_type.value}")
        
        return conditions
    
    def _infer_expected_behavior(self, anomaly: Anomaly) -> List[str]:
        """推断预期行为"""
        behaviors = []
        
        if anomaly.anomaly_type == AnomalyType.TIMEOUT:
            behaviors.append("Operation should complete within reasonable time")
        elif anomaly.anomaly_type == AnomalyType.EXECUTION_FAILURE:
            behaviors.append("Operation should execute successfully")
        elif anomaly.anomaly_type == AnomalyType.UI_STATE_INCONSISTENCY:
            behaviors.append("UI state should remain consistent")
        else:
            behaviors.append("Normal operation execution")
        
        return behaviors
    
    def _extract_actual_behavior(self, anomaly: Anomaly) -> List[str]:
        """提取实际行为"""
        behaviors = []
        
        behaviors.append(anomaly.description)
        
        if anomaly.context:
            for key, value in anomaly.context.items():
                behaviors.append(f"{key}: {value}")
        
        return behaviors
    
    def _strategy_matches_anomaly(self, strategy: RecoveryStrategy, anomaly: Anomaly) -> bool:
        """检查策略是否匹配异常"""
        # 简单的匹配逻辑
        strategy_type = strategy.strategy_type.lower()
        anomaly_type = anomaly.anomaly_type.value.lower()
        
        if 'timeout' in anomaly_type and 'retry' in strategy_type:
            return True
        if 'failure' in anomaly_type and 'fallback' in strategy_type:
            return True
        if 'inconsistency' in anomaly_type and 'skip' in strategy_type:
            return True
        
        return False
    
    def _apply_retry_strategy(self, strategy: RecoveryStrategy, anomaly: Anomaly) -> RecoveryStatus:
        """应用重试策略"""
        # 模拟重试逻辑
        if anomaly.severity < 0.7:
            return RecoveryStatus.SUCCESSFUL
        else:
            return RecoveryStatus.PARTIAL
    
    def _apply_fallback_strategy(self, strategy: RecoveryStrategy, anomaly: Anomaly) -> RecoveryStatus:
        """应用回退策略"""
        # 模拟回退逻辑
        return RecoveryStatus.SUCCESSFUL
    
    def _apply_skip_strategy(self, strategy: RecoveryStrategy, anomaly: Anomaly) -> RecoveryStatus:
        """应用跳过策略"""
        # 模拟跳过逻辑
        return RecoveryStatus.SUCCESSFUL
    
    def _apply_abort_strategy(self, strategy: RecoveryStrategy, anomaly: Anomaly) -> RecoveryStatus:
        """应用中止策略"""
        # 模拟中止逻辑
        return RecoveryStatus.SUCCESSFUL
    
    def _apply_adaptive_strategy(self, strategy: RecoveryStrategy, anomaly: Anomaly) -> RecoveryStatus:
        """应用自适应策略"""
        # 模拟自适应逻辑
        if anomaly.severity < 0.5:
            return RecoveryStatus.SUCCESSFUL
        else:
            return RecoveryStatus.PARTIAL
    
    def _pattern_matches_context(self, pattern: Pattern, state: ScreenState, actions: List[GUIAction]) -> bool:
        """检查模式是否匹配当前上下文"""
        # 简单的模式匹配逻辑
        if pattern.pattern_type == PatternType.FAILURE_PATTERN:
            # 检查是否有相似的失败条件
            return len(actions) > 5  # 复杂动作序列更容易失败
        elif pattern.pattern_type == PatternType.ENVIRONMENT_PATTERN:
            # 检查环境因素
            return True  # 简化实现
        elif pattern.pattern_type == PatternType.TEMPORAL_PATTERN:
            # 检查时序因素
            return len(actions) > 3  # 多步骤操作更容易有时序问题
        
        return False