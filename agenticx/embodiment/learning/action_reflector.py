"""
ActionReflector - 动作反思组件
基于 MobileAgent ActionReflector 设计

职责：
- 对比执行前后的屏幕状态
- 判断动作是否成功执行（A/B/C 分类）
- 支持 VLM 视觉反思和启发式快速反思
- 集成到 Hooks 系统实现自动触发

来源：MobileAgent 框架
"""

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional
from datetime import datetime, timezone
import hashlib
import logging

from agenticx.core.component import Component
from agenticx.embodiment.core.models import (
    ActionOutcome,
    ScreenState,
    GUIAction,
)

logger = logging.getLogger(__name__)


@dataclass
class ActionContext:
    """动作执行上下文
    
    包含动作执行前后的完整信息，用于反思判断。
    
    Attributes:
        action_type: 动作类型（click, type, scroll 等）
        action_params: 动作参数
        screen_state_before: 执行前屏幕状态
        screen_state_after: 执行后屏幕状态
        expected_change: 预期变化描述（可选）
        task_goal: 当前任务目标（可选）
        step_index: 当前步骤索引
    """
    action_type: str
    action_params: Dict[str, Any]
    screen_state_before: Optional[ScreenState] = None
    screen_state_after: Optional[ScreenState] = None
    expected_change: Optional[str] = None
    task_goal: Optional[str] = None
    step_index: int = 0
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class ActionReflectionResult:
    """反思结果
    
    Attributes:
        outcome: 动作结果分类（SUCCESS/WRONG_STATE/NO_CHANGE/UNKNOWN）
        confidence: 判断置信度 [0, 1]
        error_description: 失败原因描述
        suggestions: 改进建议列表
        reflection_method: 使用的反思方法（heuristic/visual/hybrid）
        latency_ms: 反思耗时（毫秒）
    """
    outcome: ActionOutcome
    confidence: float = 0.0
    error_description: Optional[str] = None
    suggestions: List[str] = field(default_factory=list)
    reflection_method: str = "heuristic"
    latency_ms: Optional[float] = None
    
    @property
    def is_successful(self) -> bool:
        """判断动作是否成功"""
        return self.outcome == ActionOutcome.SUCCESS
    
    @property
    def needs_rollback(self) -> bool:
        """判断是否需要回退"""
        return self.outcome == ActionOutcome.WRONG_STATE
    
    @property
    def needs_retry(self) -> bool:
        """判断是否需要重试"""
        return self.outcome == ActionOutcome.NO_CHANGE
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "outcome": self.outcome.value,
            "confidence": self.confidence,
            "error_description": self.error_description,
            "suggestions": self.suggestions,
            "reflection_method": self.reflection_method,
            "latency_ms": self.latency_ms,
        }


class ActionReflector(Component):
    """
    动作反思组件 - 继承自 Component
    
    基于 MobileAgent 的动作反思机制，支持：
    1. 启发式快速反思：基于屏幕状态哈希和元素变化
    2. VLM 视觉反思：使用视觉语言模型对比截图
    3. 混合反思：先启发式，低置信度时升级到 VLM
    
    与 AgenticX 架构集成点：
    - 继承 Component 基类，支持生命周期管理
    - 通过 Hooks 系统注入到工具调用流程
    - 结果记录到 EventLog
    
    Example:
        >>> reflector = ActionReflector(llm_provider=my_vlm)
        >>> result = await reflector.reflect(action_context)
        >>> 
        >>> # 或作为 Hook 自动触发
        >>> reflector.register_as_hook()
    
    A/B/C 分类规则（借鉴 MobileAgent）:
        - A (SUCCESS): 屏幕状态发生预期变化
        - B (WRONG_STATE): 屏幕状态变化但不符合预期，需回退
        - C (NO_CHANGE): 屏幕状态无变化，操作无效
    """
    
    # 反思 Prompt 模板（用于 VLM 视觉反思）
    REFLECTION_PROMPT_TEMPLATE = """你是一个 GUI 动作反思专家。请对比执行前后的屏幕截图，判断动作是否成功。

## 动作信息
- 动作类型: {action_type}
- 动作参数: {action_params}
- 任务目标: {task_goal}
- 预期变化: {expected_change}

## 判断标准
- A (SUCCESS): 屏幕发生了预期的变化，动作成功
- B (WRONG_STATE): 屏幕发生了变化，但不是预期的变化，可能需要回退
- C (NO_CHANGE): 屏幕没有任何变化，动作可能无效

## 输出格式
请以 JSON 格式输出判断结果：
{{"outcome": "A/B/C", "confidence": 0.0-1.0, "reason": "判断理由", "suggestions": ["建议1", "建议2"]}}
"""
    
    def __init__(
        self,
        name: str = "action_reflector",
        llm_provider: Optional[Any] = None,
        event_log: Optional[Any] = None,
        use_visual_comparison: bool = True,
        use_element_comparison: bool = True,
        confidence_threshold: float = 0.7,
        auto_upgrade_to_vlm: bool = True,
        **kwargs,
    ):
        """初始化动作反思器
        
        Args:
            name: 组件名称
            llm_provider: VLM 提供者（用于视觉反思）
            event_log: 事件日志（用于记录反思结果）
            use_visual_comparison: 是否使用视觉对比
            use_element_comparison: 是否使用元素对比
            confidence_threshold: 置信度阈值，低于此值时升级到 VLM
            auto_upgrade_to_vlm: 启发式反思低置信度时是否自动升级到 VLM
        """
        super().__init__(name=name, **kwargs)
        self.llm_provider = llm_provider
        self.event_log = event_log
        self.use_visual_comparison = use_visual_comparison
        self.use_element_comparison = use_element_comparison
        self.confidence_threshold = confidence_threshold
        self.auto_upgrade_to_vlm = auto_upgrade_to_vlm
        
        # 统计信息
        self._stats = {
            "total_reflections": 0,
            "success_count": 0,
            "wrong_state_count": 0,
            "no_change_count": 0,
            "unknown_count": 0,
            "vlm_calls": 0,
            "heuristic_calls": 0,
        }
        
        # Hook 回调
        self._hooks: List[Callable] = []
    
    async def reflect(self, context: ActionContext) -> ActionReflectionResult:
        """执行动作反思 - 核心方法
        
        反思流程：
        1. 先使用启发式方法快速判断
        2. 如果置信度低于阈值，且配置了 VLM，则升级到视觉反思
        3. 记录反思结果到事件日志
        
        Args:
            context: 动作执行上下文
            
        Returns:
            ActionReflectionResult: 反思结果
        """
        import time
        start_time = time.time()
        
        self._stats["total_reflections"] += 1
        
        # 1. 启发式快速反思
        result = self._compare_screen_states(
            context.screen_state_before,
            context.screen_state_after,
            context.action_type,
            context.action_params,
        )
        self._stats["heuristic_calls"] += 1
        
        # 2. 如果置信度低，升级到 VLM 视觉反思
        if (
            result.confidence < self.confidence_threshold
            and self.auto_upgrade_to_vlm
            and self.llm_provider is not None
        ):
            vlm_result = await self._visual_reflect(context)
            self._stats["vlm_calls"] += 1
            
            # 如果 VLM 结果置信度更高，使用 VLM 结果
            if vlm_result.confidence > result.confidence:
                result = vlm_result
        
        # 3. 计算耗时
        result.latency_ms = (time.time() - start_time) * 1000
        
        # 4. 更新统计
        self._update_stats(result.outcome)
        
        # 5. 记录到事件日志
        if self.event_log:
            try:
                self.event_log.log_event(
                    event_type="action_reflection",
                    data={
                        "action_type": context.action_type,
                        "outcome": result.outcome.value,
                        "confidence": result.confidence,
                        "method": result.reflection_method,
                    }
                )
            except Exception as e:
                logger.warning(f"Failed to log reflection event: {e}")
        
        # 6. 触发 Hooks
        for hook in self._hooks:
            try:
                hook(context, result)
            except Exception as e:
                logger.warning(f"Hook execution failed: {e}")
        
        return result
    
    def _compare_screen_states(
        self,
        before: Optional[ScreenState],
        after: Optional[ScreenState],
        action_type: str,
        action_params: Dict[str, Any],
    ) -> ActionReflectionResult:
        """基于 ScreenState 的启发式快速反思
        
        使用多种信号判断动作结果：
        1. 状态哈希变化
        2. 交互元素数量变化
        3. OCR 文本变化
        4. 特定动作的预期结果
        
        Args:
            before: 执行前屏幕状态
            after: 执行后屏幕状态
            action_type: 动作类型
            action_params: 动作参数
            
        Returns:
            ActionReflectionResult: 启发式反思结果
        """
        # 边界情况处理
        if before is None or after is None:
            return ActionReflectionResult(
                outcome=ActionOutcome.UNKNOWN,
                confidence=0.0,
                error_description="Missing screen state for comparison",
                reflection_method="heuristic",
            )
        
        # 信号收集
        signals: List[tuple[str, float, ActionOutcome]] = []
        
        # 信号 1: 状态哈希变化
        hash_changed = self._check_hash_change(before, after)
        if hash_changed:
            signals.append(("hash_changed", 0.6, ActionOutcome.SUCCESS))
        else:
            signals.append(("hash_unchanged", 0.7, ActionOutcome.NO_CHANGE))
        
        # 信号 2: 元素数量变化
        element_diff = self._check_element_change(before, after)
        if element_diff > 0:
            signals.append(("elements_added", 0.5, ActionOutcome.SUCCESS))
        elif element_diff < 0:
            signals.append(("elements_removed", 0.4, ActionOutcome.SUCCESS))
        
        # 信号 3: OCR 文本变化
        text_changed = self._check_text_change(before, after)
        if text_changed:
            signals.append(("text_changed", 0.5, ActionOutcome.SUCCESS))
        
        # 信号 4: 动作特定判断
        action_signal = self._check_action_specific(action_type, action_params, before, after)
        if action_signal:
            signals.append(action_signal)
        
        # 综合判断
        return self._aggregate_signals(signals)
    
    def _check_hash_change(self, before: ScreenState, after: ScreenState) -> bool:
        """检查状态哈希是否变化"""
        if before.state_hash and after.state_hash:
            return before.state_hash != after.state_hash
        
        # 如果没有哈希，尝试计算截图哈希
        if before.screenshot and after.screenshot:
            return self._compute_screenshot_hash(before.screenshot) != self._compute_screenshot_hash(after.screenshot)
        
        return False
    
    def _compute_screenshot_hash(self, screenshot: str) -> str:
        """计算截图哈希（简化版，只取前 1000 字符）"""
        return hashlib.md5(screenshot[:1000].encode()).hexdigest()
    
    def _check_element_change(self, before: ScreenState, after: ScreenState) -> int:
        """检查元素数量变化"""
        before_count = len(before.interactive_elements)
        after_count = len(after.interactive_elements)
        return after_count - before_count
    
    def _check_text_change(self, before: ScreenState, after: ScreenState) -> bool:
        """检查 OCR 文本变化"""
        if before.ocr_text and after.ocr_text:
            return before.ocr_text != after.ocr_text
        return False
    
    def _check_action_specific(
        self,
        action_type: str,
        action_params: Dict[str, Any],
        before: ScreenState,
        after: ScreenState,
    ) -> Optional[tuple[str, float, ActionOutcome]]:
        """动作特定的判断逻辑"""
        action_type_lower = action_type.lower()
        
        if action_type_lower == "type":
            # 输入动作：检查是否有新文本出现
            text = action_params.get("text", "")
            if after.ocr_text and text and text in after.ocr_text:
                return ("text_appeared", 0.8, ActionOutcome.SUCCESS)
            elif after.ocr_text and text and text not in after.ocr_text:
                return ("text_not_found", 0.5, ActionOutcome.NO_CHANGE)
        
        elif action_type_lower == "click":
            # 点击动作：检查是否有状态变化
            if self._check_hash_change(before, after):
                return ("click_state_changed", 0.7, ActionOutcome.SUCCESS)
        
        elif action_type_lower == "scroll":
            # 滚动动作：检查元素是否变化
            if self._check_element_change(before, after) != 0:
                return ("scroll_content_changed", 0.7, ActionOutcome.SUCCESS)
        
        return None
    
    def _aggregate_signals(
        self,
        signals: List[tuple[str, float, ActionOutcome]],
    ) -> ActionReflectionResult:
        """综合多个信号得出最终判断"""
        if not signals:
            return ActionReflectionResult(
                outcome=ActionOutcome.UNKNOWN,
                confidence=0.0,
                reflection_method="heuristic",
            )
        
        # 按置信度加权投票
        outcome_scores: Dict[ActionOutcome, float] = {
            ActionOutcome.SUCCESS: 0.0,
            ActionOutcome.WRONG_STATE: 0.0,
            ActionOutcome.NO_CHANGE: 0.0,
            ActionOutcome.UNKNOWN: 0.0,
        }
        
        for signal_name, confidence, outcome in signals:
            outcome_scores[outcome] += confidence
        
        # 选择得分最高的结果
        best_outcome = max(outcome_scores, key=outcome_scores.get)
        total_score = sum(outcome_scores.values())
        
        if total_score > 0:
            confidence = outcome_scores[best_outcome] / total_score
        else:
            confidence = 0.0
        
        # 收集信号名称作为建议
        signal_names = [s[0] for s in signals]
        
        return ActionReflectionResult(
            outcome=best_outcome,
            confidence=min(1.0, confidence),
            suggestions=[f"Based on signals: {', '.join(signal_names)}"],
            reflection_method="heuristic",
        )
    
    async def _visual_reflect(self, context: ActionContext) -> ActionReflectionResult:
        """基于 VLM 的视觉反思
        
        使用视觉语言模型对比执行前后的截图，判断动作结果。
        
        Args:
            context: 动作执行上下文
            
        Returns:
            ActionReflectionResult: 视觉反思结果
        """
        if self.llm_provider is None:
            return ActionReflectionResult(
                outcome=ActionOutcome.UNKNOWN,
                confidence=0.0,
                error_description="No LLM provider configured for visual reflection",
                reflection_method="visual",
            )
        
        # 构建 Prompt
        prompt = self.REFLECTION_PROMPT_TEMPLATE.format(
            action_type=context.action_type,
            action_params=context.action_params,
            task_goal=context.task_goal or "未指定",
            expected_change=context.expected_change or "屏幕应该发生变化",
        )
        
        try:
            # 构建消息
            messages = [{"role": "user", "content": prompt}]
            
            # 如果有截图，添加到消息中
            screenshots = []
            if context.screen_state_before and context.screen_state_before.screenshot:
                screenshots.append(context.screen_state_before.screenshot)
            if context.screen_state_after and context.screen_state_after.screenshot:
                screenshots.append(context.screen_state_after.screenshot)
            
            # 调用 VLM
            response = await self.llm_provider.generate(
                messages=messages,
                screenshots=screenshots if screenshots else None,
            )
            
            # 解析响应
            return self._parse_vlm_response(response)
            
        except Exception as e:
            logger.error(f"Visual reflection failed: {e}")
            return ActionReflectionResult(
                outcome=ActionOutcome.UNKNOWN,
                confidence=0.0,
                error_description=f"VLM reflection failed: {str(e)}",
                reflection_method="visual",
            )
    
    def _parse_vlm_response(self, response: Any) -> ActionReflectionResult:
        """解析 VLM 响应"""
        import json
        
        try:
            # 尝试从响应中提取内容
            content = ""
            if hasattr(response, "content"):
                content = response.content
            elif hasattr(response, "text"):
                content = response.text
            elif isinstance(response, str):
                content = response
            elif isinstance(response, dict):
                content = response.get("content", "") or response.get("text", "")
            
            # 尝试解析 JSON
            # 查找 JSON 块
            import re
            json_match = re.search(r'\{[^{}]*\}', content)
            if json_match:
                result_json = json.loads(json_match.group())
                
                # 解析 outcome
                outcome_str = result_json.get("outcome", "C").upper()
                outcome_map = {
                    "A": ActionOutcome.SUCCESS,
                    "B": ActionOutcome.WRONG_STATE,
                    "C": ActionOutcome.NO_CHANGE,
                    "SUCCESS": ActionOutcome.SUCCESS,
                    "WRONG_STATE": ActionOutcome.WRONG_STATE,
                    "NO_CHANGE": ActionOutcome.NO_CHANGE,
                }
                outcome = outcome_map.get(outcome_str, ActionOutcome.UNKNOWN)
                
                return ActionReflectionResult(
                    outcome=outcome,
                    confidence=float(result_json.get("confidence", 0.8)),
                    error_description=result_json.get("reason"),
                    suggestions=result_json.get("suggestions", []),
                    reflection_method="visual",
                )
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            logger.warning(f"Failed to parse VLM response: {e}")
        
        return ActionReflectionResult(
            outcome=ActionOutcome.UNKNOWN,
            confidence=0.0,
            error_description="Failed to parse VLM response",
            reflection_method="visual",
        )
    
    def _update_stats(self, outcome: ActionOutcome) -> None:
        """更新统计信息"""
        if outcome == ActionOutcome.SUCCESS:
            self._stats["success_count"] += 1
        elif outcome == ActionOutcome.WRONG_STATE:
            self._stats["wrong_state_count"] += 1
        elif outcome == ActionOutcome.NO_CHANGE:
            self._stats["no_change_count"] += 1
        else:
            self._stats["unknown_count"] += 1
    
    def register_hook(self, hook: Callable[[ActionContext, ActionReflectionResult], None]) -> None:
        """注册反思结果回调 Hook
        
        Args:
            hook: 回调函数，接收 (context, result) 参数
        """
        self._hooks.append(hook)
    
    def unregister_hook(self, hook: Callable) -> bool:
        """取消注册 Hook
        
        Args:
            hook: 要取消的回调函数
            
        Returns:
            是否成功取消
        """
        if hook in self._hooks:
            self._hooks.remove(hook)
            return True
        return False
    
    def get_statistics(self) -> Dict[str, Any]:
        """获取统计信息
        
        Returns:
            统计信息字典
        """
        stats = self._stats.copy()
        
        # 计算成功率
        total = stats["total_reflections"]
        if total > 0:
            stats["success_rate"] = stats["success_count"] / total
            stats["failure_rate"] = (stats["wrong_state_count"] + stats["no_change_count"]) / total
        else:
            stats["success_rate"] = 0.0
            stats["failure_rate"] = 0.0
        
        return stats
    
    def reset_statistics(self) -> None:
        """重置统计信息"""
        self._stats = {
            "total_reflections": 0,
            "success_count": 0,
            "wrong_state_count": 0,
            "no_change_count": 0,
            "unknown_count": 0,
            "vlm_calls": 0,
            "heuristic_calls": 0,
        }
