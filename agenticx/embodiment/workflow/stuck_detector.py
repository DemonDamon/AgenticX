"""
StuckDetector - 卡住检测器
基于 MobileAgent 错误恢复机制设计

职责：
- 监控动作执行结果序列
- 检测连续失败和重复动作模式
- 推荐恢复策略（重试/回滚/重规划/人工介入）
- 集成 DiscoveryBus 发布卡住状态

来源：MobileAgent 框架
"""

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple
from enum import Enum
from collections import deque
from datetime import datetime, timezone
import logging

from agenticx.core.component import Component
from agenticx.embodiment.core.models import ActionOutcome
from agenticx.embodiment.learning.action_reflector import ActionReflectionResult

logger = logging.getLogger(__name__)


class RecoveryStrategy(str, Enum):
    """恢复策略 - 对齐 ExecutionPlan 的 InterventionState
    
    定义了当检测到卡住时的恢复策略选项。
    """
    RETRY = "retry"           # 重试当前动作
    ROLLBACK = "rollback"     # 回退到上一状态
    REPLAN = "replan"         # 触发上层重规划
    ESCALATE = "escalate"     # 升级到人工介入
    SKIP = "skip"             # 跳过当前步骤
    ABORT = "abort"           # 中止任务


@dataclass
class ActionRecord:
    """动作执行记录
    
    记录单次动作的执行情况，用于模式检测。
    """
    action_type: str
    action_params: Dict[str, Any]
    outcome: ActionOutcome
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    step_index: int = 0
    
    def get_signature(self) -> str:
        """获取动作签名（用于重复检测）
        
        只包含动作类型和关键参数，忽略时间戳等。
        """
        # 简化参数，只保留关键字段
        key_params = {}
        if "element_id" in self.action_params:
            key_params["element_id"] = self.action_params["element_id"]
        if "text" in self.action_params:
            # 截断长文本
            text = str(self.action_params["text"])
            key_params["text"] = text[:20] if len(text) > 20 else text
        if "direction" in self.action_params:
            key_params["direction"] = self.action_params["direction"]
        if "x" in self.action_params and "y" in self.action_params:
            # 坐标粗粒度化（减少噪声）
            key_params["pos"] = (
                self.action_params["x"] // 10,
                self.action_params["y"] // 10,
            )
        
        return f"{self.action_type}:{key_params}"
    
    def is_failure(self) -> bool:
        """判断是否为失败"""
        return self.outcome.is_failure if isinstance(self.outcome, ActionOutcome) else False


@dataclass
class StuckState:
    """卡住状态
    
    描述当前是否卡住，以及相关信息。
    """
    is_stuck: bool = False
    consecutive_failures: int = 0
    failure_pattern: Optional[str] = None
    recommended_strategy: RecoveryStrategy = RecoveryStrategy.RETRY
    context: Dict[str, Any] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "is_stuck": self.is_stuck,
            "consecutive_failures": self.consecutive_failures,
            "failure_pattern": self.failure_pattern,
            "recommended_strategy": self.recommended_strategy.value if isinstance(self.recommended_strategy, RecoveryStrategy) else self.recommended_strategy,
            "context": self.context,
            "timestamp": self.timestamp.isoformat(),
        }


class StuckDetector(Component):
    """
    卡住检测器 - 继承自 Component，集成 DiscoveryBus
    
    卡住判定规则（借鉴 MobileAgent）:
    1. 连续 N 次失败（NO_CHANGE 或 WRONG_STATE）
    2. 检测到重复动作模式（相同动作在短时间内重复执行）
    3. 超过最大步数限制
    
    与 AgenticX 现有架构的集成：
    - 继承 Component 基类，支持生命周期管理
    - 与 ActionReflector 配合使用，接收动作结果
    - 通过 DiscoveryBus 发布卡住事件
    - 支持回调函数通知外部系统
    
    Example:
        >>> detector = StuckDetector(
        ...     failure_threshold=2,
        ...     discovery_bus=bus
        ... )
        >>> detector.record_outcome("click", {}, reflection_result)
        >>> stuck_state = detector.check_stuck()
        >>> if stuck_state.is_stuck:
        ...     print(f"检测到卡住: {stuck_state.recommended_strategy}")
    """
    
    def __init__(
        self,
        name: str = "stuck_detector",
        failure_threshold: int = 2,
        repeat_threshold: int = 3,
        max_history_size: int = 20,
        max_step_limit: int = 50,
        discovery_bus: Optional[Any] = None,
        on_stuck_callback: Optional[Callable[[StuckState], None]] = None,
        **kwargs,
    ):
        """初始化卡住检测器
        
        Args:
            name: 组件名称
            failure_threshold: 连续失败阈值（默认 2 次）
            repeat_threshold: 重复动作阈值（默认 3 次）
            max_history_size: 历史记录最大长度
            max_step_limit: 最大步数限制
            discovery_bus: 发现总线（用于发布卡住事件）
            on_stuck_callback: 卡住时的回调函数
        """
        super().__init__(name=name, **kwargs)
        self.failure_threshold = failure_threshold
        self.repeat_threshold = repeat_threshold
        self.max_history_size = max_history_size
        self.max_step_limit = max_step_limit
        self.discovery_bus = discovery_bus
        self.on_stuck_callback = on_stuck_callback
        
        # 历史记录（使用 deque 自动限制大小）
        self._history: deque[ActionRecord] = deque(maxlen=max_history_size)
        self._total_steps = 0
        self._consecutive_failures = 0
        
        # 统计信息
        self._stats = {
            "total_actions": 0,
            "total_failures": 0,
            "stuck_count": 0,
            "recovery_attempts": 0,
        }
        
        # 当前卡住状态
        self._current_stuck_state: Optional[StuckState] = None
    
    def record_outcome(
        self,
        action_type: str,
        action_params: Dict[str, Any],
        reflection_result: ActionReflectionResult,
    ) -> None:
        """记录动作执行结果
        
        Args:
            action_type: 动作类型
            action_params: 动作参数
            reflection_result: 反思结果
        """
        # 创建动作记录
        record = ActionRecord(
            action_type=action_type,
            action_params=action_params,
            outcome=reflection_result.outcome,
            step_index=self._total_steps,
        )
        
        # 添加到历史
        self._history.append(record)
        self._total_steps += 1
        
        # 更新统计
        self._stats["total_actions"] += 1
        
        # 更新连续失败计数
        if record.is_failure():
            self._consecutive_failures += 1
            self._stats["total_failures"] += 1
        else:
            self._consecutive_failures = 0
        
        logger.debug(
            f"记录动作: {action_type}, 结果: {reflection_result.outcome.value}, "
            f"连续失败: {self._consecutive_failures}"
        )
    
    def check_stuck(self) -> StuckState:
        """检查是否卡住
        
        执行多种卡住检测规则，返回卡住状态。
        
        Returns:
            StuckState: 卡住状态
        """
        # 规则 1: 连续失败
        if self._consecutive_failures >= self.failure_threshold:
            pattern = f"连续 {self._consecutive_failures} 次失败"
            strategy = self._recommend_strategy(pattern)
            stuck_state = StuckState(
                is_stuck=True,
                consecutive_failures=self._consecutive_failures,
                failure_pattern=pattern,
                recommended_strategy=strategy,
                context={
                    "rule": "consecutive_failures",
                    "threshold": self.failure_threshold,
                }
            )
            self._handle_stuck(stuck_state)
            return stuck_state
        
        # 规则 2: 重复动作模式
        repeat_pattern = self._detect_repeat_pattern()
        if repeat_pattern:
            pattern_desc, repeat_count = repeat_pattern
            strategy = self._recommend_strategy(pattern_desc)
            stuck_state = StuckState(
                is_stuck=True,
                consecutive_failures=self._consecutive_failures,
                failure_pattern=pattern_desc,
                recommended_strategy=strategy,
                context={
                    "rule": "repeat_pattern",
                    "repeat_count": repeat_count,
                    "threshold": self.repeat_threshold,
                }
            )
            self._handle_stuck(stuck_state)
            return stuck_state
        
        # 规则 3: 超过最大步数
        if self._total_steps >= self.max_step_limit:
            pattern = f"超过最大步数限制 ({self.max_step_limit})"
            strategy = RecoveryStrategy.REPLAN
            stuck_state = StuckState(
                is_stuck=True,
                consecutive_failures=self._consecutive_failures,
                failure_pattern=pattern,
                recommended_strategy=strategy,
                context={
                    "rule": "max_steps",
                    "total_steps": self._total_steps,
                    "limit": self.max_step_limit,
                }
            )
            self._handle_stuck(stuck_state)
            return stuck_state
        
        # 未卡住
        return StuckState(is_stuck=False)
    
    def _detect_repeat_pattern(self) -> Optional[Tuple[str, int]]:
        """检测重复动作模式
        
        Returns:
            如果检测到重复，返回 (模式描述, 重复次数)，否则返回 None
        """
        if len(self._history) < self.repeat_threshold:
            return None
        
        # 统计最近动作的签名
        recent_actions = list(self._history)[-self.repeat_threshold * 2:]
        signature_counts: Dict[str, int] = {}
        
        for record in recent_actions:
            sig = record.get_signature()
            signature_counts[sig] = signature_counts.get(sig, 0) + 1
        
        # 检查是否有动作重复超过阈值
        for sig, count in signature_counts.items():
            if count >= self.repeat_threshold:
                return (f"重复动作模式: {sig} (重复 {count} 次)", count)
        
        # 检测简单循环模式 (A-B-A-B-A-B)
        if len(recent_actions) >= 4:
            # 检查最后 4 个动作是否形成 A-B-A-B 模式
            last_4 = [r.get_signature() for r in recent_actions[-4:]]
            if last_4[0] == last_4[2] and last_4[1] == last_4[3] and last_4[0] != last_4[1]:
                return (f"循环模式: {last_4[0]} <-> {last_4[1]}", 2)
        
        return None
    
    def _recommend_strategy(self, pattern: str) -> RecoveryStrategy:
        """根据失败模式推荐恢复策略
        
        Args:
            pattern: 失败模式描述
            
        Returns:
            推荐的恢复策略
        """
        pattern_lower = pattern.lower()
        
        # 根据模式匹配策略
        if "连续" in pattern_lower and self._consecutive_failures >= self.failure_threshold * 2:
            # 多次连续失败，升级到人工介入
            return RecoveryStrategy.ESCALATE
        elif "连续" in pattern_lower:
            # 首次连续失败，尝试回退
            return RecoveryStrategy.ROLLBACK
        elif "重复" in pattern_lower or "循环" in pattern_lower:
            # 重复模式，需要重新规划
            return RecoveryStrategy.REPLAN
        elif "最大步数" in pattern_lower:
            # 超过最大步数，重新规划
            return RecoveryStrategy.REPLAN
        else:
            # 默认：重试
            return RecoveryStrategy.RETRY
    
    def _handle_stuck(self, stuck_state: StuckState) -> None:
        """处理卡住状态
        
        Args:
            stuck_state: 卡住状态
        """
        self._current_stuck_state = stuck_state
        self._stats["stuck_count"] += 1
        
        logger.warning(
            f"检测到卡住: {stuck_state.failure_pattern}, "
            f"推荐策略: {stuck_state.recommended_strategy.value}"
        )
        
        # 发布到 DiscoveryBus
        if self.discovery_bus:
            try:
                self.discovery_bus.publish(
                    event_type="stuck_detected",
                    data=stuck_state.to_dict(),
                )
            except Exception as e:
                logger.warning(f"Failed to publish stuck event to DiscoveryBus: {e}")
        
        # 触发回调
        if self.on_stuck_callback:
            try:
                self.on_stuck_callback(stuck_state)
            except Exception as e:
                logger.warning(f"Stuck callback failed: {e}")
    
    def apply_recovery(self, strategy: Optional[RecoveryStrategy] = None) -> None:
        """应用恢复策略
        
        Args:
            strategy: 恢复策略，如果为 None 则使用推荐策略
        """
        if not self._current_stuck_state:
            logger.warning("No stuck state to recover from")
            return
        
        strategy = strategy or self._current_stuck_state.recommended_strategy
        self._stats["recovery_attempts"] += 1
        
        logger.info(f"应用恢复策略: {strategy.value}")
        
        # 根据策略执行不同的恢复操作
        if strategy == RecoveryStrategy.RETRY:
            # 重试：不做特殊处理，由外部重新执行
            pass
        elif strategy == RecoveryStrategy.ROLLBACK:
            # 回退：清除最近的失败记录
            if self._history:
                self._history.pop()
                self._total_steps = max(0, self._total_steps - 1)
        elif strategy == RecoveryStrategy.REPLAN:
            # 重新规划：重置状态
            self.reset()
        elif strategy == RecoveryStrategy.SKIP:
            # 跳过：重置连续失败计数
            self._consecutive_failures = 0
        elif strategy == RecoveryStrategy.ESCALATE:
            # 升级到人工介入：记录日志，等待外部处理
            logger.error("Task escalated to human intervention")
        elif strategy == RecoveryStrategy.ABORT:
            # 中止：清空历史
            self.reset()
        
        # 清除当前卡住状态
        self._current_stuck_state = None
    
    def reset(self) -> None:
        """重置检测器状态"""
        self._history.clear()
        self._total_steps = 0
        self._consecutive_failures = 0
        self._current_stuck_state = None
        logger.info("StuckDetector reset")
    
    def get_statistics(self) -> Dict[str, Any]:
        """获取统计信息
        
        Returns:
            统计信息字典
        """
        stats = self._stats.copy()
        stats["total_steps"] = self._total_steps
        stats["consecutive_failures"] = self._consecutive_failures
        stats["current_stuck"] = self._current_stuck_state is not None
        
        # 计算失败率
        if stats["total_actions"] > 0:
            stats["failure_rate"] = stats["total_failures"] / stats["total_actions"]
        else:
            stats["failure_rate"] = 0.0
        
        return stats
    
    def get_recent_history(self, n: int = 10) -> List[Dict[str, Any]]:
        """获取最近的动作历史
        
        Args:
            n: 获取最近 n 条记录
            
        Returns:
            动作记录列表
        """
        recent = list(self._history)[-n:]
        return [
            {
                "action_type": r.action_type,
                "action_params": r.action_params,
                "outcome": r.outcome.value if isinstance(r.outcome, ActionOutcome) else r.outcome,
                "step_index": r.step_index,
                "signature": r.get_signature(),
            }
            for r in recent
        ]
    
    @property
    def is_currently_stuck(self) -> bool:
        """当前是否处于卡住状态"""
        return self._current_stuck_state is not None and self._current_stuck_state.is_stuck
    
    @property
    def current_stuck_state(self) -> Optional[StuckState]:
        """获取当前卡住状态"""
        return self._current_stuck_state
