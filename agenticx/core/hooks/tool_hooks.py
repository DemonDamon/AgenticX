"""
Tool Hooks 系统

参考 crewAI Hooks 设计，提供工具调用前后的钩子机制。
支持全局钩子和 Agent 级别钩子。

"""

from pathlib import Path
from typing import Callable, List, Optional
import logging

import yaml  # type: ignore[import-untyped]

from agenticx.core.config_watcher import ConfigWatcher
from agenticx.tools.policy import ToolPolicyLayer
from agenticx.tools.policy import ToolPolicyStack
from .types import ToolCallHookContext

logger = logging.getLogger(__name__)

# 钩子函数类型定义
# 返回 True 表示继续执行，返回 False 表示阻止执行
ToolHookFunction = Callable[[ToolCallHookContext], bool]

# 全局钩子注册表
_before_tool_call_hooks: List[ToolHookFunction] = []
_after_tool_call_hooks: List[ToolHookFunction] = []


def register_before_tool_call_hook(hook: ToolHookFunction) -> None:
    """注册全局工具调用前钩子
    
    Args:
        hook: 钩子函数，接收 ToolCallHookContext，返回 bool
              返回 True 继续执行，返回 False 阻止执行
    
    Example:
        >>> def my_hook(ctx: ToolCallHookContext) -> bool:
        >>>     print(f"Calling tool {ctx.tool_name}")
        >>>     return True
        >>> register_before_tool_call_hook(my_hook)
    """
    if hook not in _before_tool_call_hooks:
        _before_tool_call_hooks.append(hook)
        logger.debug(f"Registered before tool call hook: {hook.__name__}")


def register_after_tool_call_hook(hook: ToolHookFunction) -> None:
    """注册全局工具调用后钩子
    
    Args:
        hook: 钩子函数，接收 ToolCallHookContext，返回 bool
              返回 True 继续执行，返回 False 表示处理失败
    
    Example:
        >>> def my_hook(ctx: ToolCallHookContext) -> bool:
        >>>     if ctx.error:
        >>>         print(f"Tool call failed: {ctx.error}")
        >>>     return True
        >>> register_after_tool_call_hook(my_hook)
    """
    if hook not in _after_tool_call_hooks:
        _after_tool_call_hooks.append(hook)
        logger.debug(f"Registered after tool call hook: {hook.__name__}")


def unregister_before_tool_call_hook(hook: ToolHookFunction) -> None:
    """取消注册工具调用前钩子"""
    if hook in _before_tool_call_hooks:
        _before_tool_call_hooks.remove(hook)
        logger.debug(f"Unregistered before tool call hook: {hook.__name__}")


def unregister_after_tool_call_hook(hook: ToolHookFunction) -> None:
    """取消注册工具调用后钩子"""
    if hook in _after_tool_call_hooks:
        _after_tool_call_hooks.remove(hook)
        logger.debug(f"Unregistered after tool call hook: {hook.__name__}")


def execute_before_tool_call_hooks(
    context: ToolCallHookContext,
    agent_hooks: Optional[List[ToolHookFunction]] = None
) -> bool:
    """执行所有工具调用前钩子
    
    先执行全局钩子，再执行 Agent 级别钩子。
    任何一个钩子返回 False 都会阻止后续执行。
    
    Args:
        context: 工具调用上下文
        agent_hooks: Agent 级别的钩子列表（可选）
    
    Returns:
        bool: True 表示继续执行，False 表示阻止执行
    """
    # 执行全局钩子
    for hook in _before_tool_call_hooks:
        try:
            if not hook(context):
                logger.info(f"Before tool call hook {hook.__name__} blocked execution")
                return False
        except Exception as e:
            logger.error(f"Error in before tool call hook {hook.__name__}: {e}")
            # 继续执行其他钩子
    
    # 执行 Agent 级别钩子
    if agent_hooks:
        for hook in agent_hooks:
            try:
                if not hook(context):
                    logger.info(f"Agent-level before tool call hook {hook.__name__} blocked execution")
                    return False
            except Exception as e:
                logger.error(f"Error in agent-level before tool call hook {hook.__name__}: {e}")
    
    return True


def execute_after_tool_call_hooks(
    context: ToolCallHookContext,
    agent_hooks: Optional[List[ToolHookFunction]] = None
) -> bool:
    """执行所有工具调用后钩子
    
    先执行全局钩子，再执行 Agent 级别钩子。
    
    Args:
        context: 工具调用上下文（包含结果信息）
        agent_hooks: Agent 级别的钩子列表（可选）
    
    Returns:
        bool: True 表示继续执行，False 表示处理失败
    """
    # 执行全局钩子
    for hook in _after_tool_call_hooks:
        try:
            if not hook(context):
                logger.warning(f"After tool call hook {hook.__name__} returned False")
        except Exception as e:
            logger.error(f"Error in after tool call hook {hook.__name__}: {e}")
    
    # 执行 Agent 级别钩子
    if agent_hooks:
        for hook in agent_hooks:
            try:
                if not hook(context):
                    logger.warning(f"Agent-level after tool call hook {hook.__name__} returned False")
            except Exception as e:
                logger.error(f"Error in agent-level after tool call hook {hook.__name__}: {e}")
    
    return True


def clear_all_tool_hooks() -> None:
    """清除所有全局工具钩子（主要用于测试）"""
    global _before_tool_call_hooks, _after_tool_call_hooks
    _before_tool_call_hooks.clear()
    _after_tool_call_hooks.clear()
    logger.debug("Cleared all global tool hooks")


def get_registered_tool_hooks() -> dict:
    """获取已注册的钩子（主要用于调试）"""
    return {
        "before": [hook.__name__ for hook in _before_tool_call_hooks],
        "after": [hook.__name__ for hook in _after_tool_call_hooks],
    }


def load_policy_from_yaml(path: Path, default_allow: bool = False) -> ToolPolicyStack:
    """Load a ToolPolicyStack from a YAML file."""
    if not path.exists():
        return ToolPolicyStack(default_allow=default_allow)
    with open(path, "r", encoding="utf-8") as handle:
        raw = yaml.safe_load(handle) or {}

    if isinstance(raw, dict):
        layers_data = raw.get("layers", [])
    elif isinstance(raw, list):
        layers_data = raw
    else:
        raise ValueError("Policy YAML must be a mapping or list")

    layers: List[ToolPolicyLayer] = []

    def _coerce_patterns(value: object, field_name: str, layer_name: str) -> List[str]:
        if value is None:
            return []
        if isinstance(value, list):
            return [str(item) for item in value]
        if isinstance(value, str):
            raise ValueError(
                f"Layer '{layer_name}' field '{field_name}' must be a list, not string"
            )
        raise ValueError(
            f"Layer '{layer_name}' field '{field_name}' must be list[str], got {type(value).__name__}"
        )

    if isinstance(layers_data, list):
        for layer in layers_data:
            if not isinstance(layer, dict):
                continue
            layer_name = str(layer.get("name", "unnamed"))
            layers.append(
                ToolPolicyLayer(
                    name=layer_name,
                    allow=_coerce_patterns(layer.get("allow"), "allow", layer_name),
                    deny=_coerce_patterns(layer.get("deny"), "deny", layer_name),
                )
            )

    if isinstance(raw, dict) and "default_allow" in raw:
        raw_default_allow = raw.get("default_allow")
        if isinstance(raw_default_allow, bool):
            default_allow = raw_default_allow
        else:
            raise ValueError("Field 'default_allow' must be a boolean")
    return ToolPolicyStack(layers=layers, default_allow=default_allow)


def enable_policy_hot_reload(
    policy_stack: ToolPolicyStack,
    policy_yaml_path: Path,
    watcher: ConfigWatcher,
) -> None:
    """Enable hot reload for tool policy YAML."""

    def _on_change(changed_path: Path) -> None:
        try:
            if changed_path.resolve() != policy_yaml_path.resolve():
                return
        except Exception:
            return

        try:
            refreshed = load_policy_from_yaml(policy_yaml_path)
            policy_stack._layers = refreshed.layers  # pylint: disable=protected-access
            policy_stack._default_allow = refreshed._default_allow  # pylint: disable=protected-access
            logger.info("Reloaded tool policy from %s", policy_yaml_path)
        except Exception as exc:
            logger.warning("Failed to reload tool policy from %s: %s", policy_yaml_path, exc)

    watcher.on_change(_on_change)
