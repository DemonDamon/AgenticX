"""
LLM Hooks 系统

参考 crewAI Hooks 设计，提供 LLM 调用前后的钩子机制。
支持全局钩子和 Agent 级别钩子。

"""

from typing import Callable, List, Optional
import logging

from .types import LLMCallHookContext

logger = logging.getLogger(__name__)

# 钩子函数类型定义
# 返回 True 表示继续执行，返回 False 表示阻止执行
LLMHookFunction = Callable[[LLMCallHookContext], bool]

# 全局钩子注册表
_before_llm_call_hooks: List[LLMHookFunction] = []
_after_llm_call_hooks: List[LLMHookFunction] = []


def register_before_llm_call_hook(hook: LLMHookFunction) -> None:
    """注册全局 LLM 调用前钩子
    
    Args:
        hook: 钩子函数，接收 LLMCallHookContext，返回 bool
              返回 True 继续执行，返回 False 阻止执行
    
    Example:
        >>> def my_hook(ctx: LLMCallHookContext) -> bool:
        >>>     print(f"Calling LLM for agent {ctx.agent_id}")
        >>>     return True
        >>> register_before_llm_call_hook(my_hook)
    """
    if hook not in _before_llm_call_hooks:
        _before_llm_call_hooks.append(hook)
        logger.debug(f"Registered before LLM call hook: {hook.__name__}")


def register_after_llm_call_hook(hook: LLMHookFunction) -> None:
    """注册全局 LLM 调用后钩子
    
    Args:
        hook: 钩子函数，接收 LLMCallHookContext，返回 bool
              返回 True 继续执行，返回 False 表示处理失败
    
    Example:
        >>> def my_hook(ctx: LLMCallHookContext) -> bool:
        >>>     if ctx.error:
        >>>         print(f"LLM call failed: {ctx.error}")
        >>>     return True
        >>> register_after_llm_call_hook(my_hook)
    """
    if hook not in _after_llm_call_hooks:
        _after_llm_call_hooks.append(hook)
        logger.debug(f"Registered after LLM call hook: {hook.__name__}")


def unregister_before_llm_call_hook(hook: LLMHookFunction) -> None:
    """取消注册 LLM 调用前钩子"""
    if hook in _before_llm_call_hooks:
        _before_llm_call_hooks.remove(hook)
        logger.debug(f"Unregistered before LLM call hook: {hook.__name__}")


def unregister_after_llm_call_hook(hook: LLMHookFunction) -> None:
    """取消注册 LLM 调用后钩子"""
    if hook in _after_llm_call_hooks:
        _after_llm_call_hooks.remove(hook)
        logger.debug(f"Unregistered after LLM call hook: {hook.__name__}")


def execute_before_llm_call_hooks(
    context: LLMCallHookContext,
    agent_hooks: Optional[List[LLMHookFunction]] = None
) -> bool:
    """执行所有 LLM 调用前钩子
    
    先执行全局钩子，再执行 Agent 级别钩子。
    任何一个钩子返回 False 都会阻止后续执行。
    
    Args:
        context: LLM 调用上下文
        agent_hooks: Agent 级别的钩子列表（可选）
    
    Returns:
        bool: True 表示继续执行，False 表示阻止执行
    """
    # 执行全局钩子
    for hook in _before_llm_call_hooks:
        try:
            if not hook(context):
                logger.info(f"Before LLM call hook {hook.__name__} blocked execution")
                return False
        except Exception as e:
            logger.error(f"Error in before LLM call hook {hook.__name__}: {e}")
            # 继续执行其他钩子
    
    # 执行 Agent 级别钩子
    if agent_hooks:
        for hook in agent_hooks:
            try:
                if not hook(context):
                    logger.info(f"Agent-level before LLM call hook {hook.__name__} blocked execution")
                    return False
            except Exception as e:
                logger.error(f"Error in agent-level before LLM call hook {hook.__name__}: {e}")
    
    return True


def execute_after_llm_call_hooks(
    context: LLMCallHookContext,
    agent_hooks: Optional[List[LLMHookFunction]] = None
) -> bool:
    """执行所有 LLM 调用后钩子
    
    先执行全局钩子，再执行 Agent 级别钩子。
    
    Args:
        context: LLM 调用上下文（包含响应信息）
        agent_hooks: Agent 级别的钩子列表（可选）
    
    Returns:
        bool: True 表示继续执行，False 表示处理失败
    """
    # 执行全局钩子
    for hook in _after_llm_call_hooks:
        try:
            if not hook(context):
                logger.warning(f"After LLM call hook {hook.__name__} returned False")
        except Exception as e:
            logger.error(f"Error in after LLM call hook {hook.__name__}: {e}")
    
    # 执行 Agent 级别钩子
    if agent_hooks:
        for hook in agent_hooks:
            try:
                if not hook(context):
                    logger.warning(f"Agent-level after LLM call hook {hook.__name__} returned False")
            except Exception as e:
                logger.error(f"Error in agent-level after LLM call hook {hook.__name__}: {e}")
    
    return True


def clear_all_llm_hooks() -> None:
    """清除所有全局 LLM 钩子（主要用于测试）"""
    global _before_llm_call_hooks, _after_llm_call_hooks
    _before_llm_call_hooks.clear()
    _after_llm_call_hooks.clear()
    logger.debug("Cleared all global LLM hooks")


def get_registered_llm_hooks() -> dict:
    """获取已注册的钩子（主要用于调试）"""
    return {
        "before": [hook.__name__ for hook in _before_llm_call_hooks],
        "after": [hook.__name__ for hook in _after_llm_call_hooks],
    }
