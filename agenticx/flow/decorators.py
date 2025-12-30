"""
Flow 装饰器

提供 @start, @listen, @router, or_, and_ 装饰器用于定义 Flow 工作流。
参考自 crewAI flow/flow.py 装饰器部分

Usage:
    from agenticx.flow import Flow, start, listen, router, or_, and_
    
    class MyFlow(Flow):
        @start()
        def begin(self):
            return "started"
        
        @listen("begin")
        def process(self, result):
            return f"processed: {result}"
        
        @router("process")
        def decide(self, result):
            if "error" in result:
                return "ERROR"
            return "SUCCESS"
        
        @listen(or_("decide", "fallback"))
        def handle_result(self):
            pass
        
        @listen(and_("step1", "step2"))
        def combine_results(self):
            pass
"""

from __future__ import annotations

import functools
import inspect
from typing import Any, Callable, Generic, List, Optional, ParamSpec, TypeVar

from .types import (
    FlowCondition,
    FlowConditions,
    FlowConditionType,
    FlowMethodName,
    OR_CONDITION,
    AND_CONDITION,
)


P = ParamSpec("P")
R = TypeVar("R")


# ============================================================================
# Utility Functions
# ============================================================================


def is_flow_method_name(condition: Any) -> bool:
    """检查是否为方法名（字符串）"""
    return isinstance(condition, str)


def is_flow_condition_dict(condition: Any) -> bool:
    """检查是否为条件字典"""
    return isinstance(condition, dict) and "type" in condition


def is_flow_method_callable(condition: Any) -> bool:
    """检查是否为可调用的方法引用"""
    return callable(condition) and hasattr(condition, "__name__")


def extract_all_methods(condition: FlowCondition) -> List[FlowMethodName]:
    """从嵌套条件中提取所有方法名
    
    递归遍历条件结构，收集所有引用的方法名。
    
    Args:
        condition: FlowCondition 字典
        
    Returns:
        所有方法名的列表
    """
    methods: List[FlowMethodName] = []
    
    if "methods" in condition:
        methods.extend(condition["methods"])
    
    if "conditions" in condition:
        for cond in condition["conditions"]:
            if isinstance(cond, str):
                methods.append(FlowMethodName(cond))
            elif isinstance(cond, dict):
                methods.extend(extract_all_methods(cond))
    
    return methods


# ============================================================================
# Flow Method Wrappers
# ============================================================================


class FlowMethod(Generic[P, R]):
    """Flow 方法的基础包装器
    
    提供类型安全的方式为方法添加元数据，同时保留其可调用签名和属性。
    支持绑定（实例）和未绑定（类）方法状态。
    
    Attributes:
        __name__: 方法名称
        __is_flow_method__: 标记为 Flow 方法
    """
    
    __is_flow_method__: bool = True
    
    def __init__(self, meth: Callable[P, R], instance: Any = None) -> None:
        """初始化 Flow 方法包装器
        
        Args:
            meth: 要包装的方法
            instance: 绑定的实例（None 表示未绑定）
        """
        self._meth = meth
        self._instance = instance
        functools.update_wrapper(self, meth, updated=[])
        self.__name__: FlowMethodName = FlowMethodName(getattr(meth, "__name__", "unknown"))
        self.__signature__ = inspect.signature(meth)
        
        if instance is not None:
            self.__self__ = instance
        
        # 处理异步方法
        if inspect.iscoroutinefunction(meth):
            try:
                inspect.markcoroutinefunction(self)
            except AttributeError:
                import asyncio.coroutines
                self._is_coroutine = asyncio.coroutines._is_coroutine  # type: ignore
        
        # 保留 Flow 相关属性
        for attr in [
            "__is_router__",
            "__router_paths__",
            "__trigger_methods__",
            "__condition_type__",
            "__trigger_condition__",
        ]:
            if hasattr(meth, attr):
                setattr(self, attr, getattr(meth, attr))
    
    def __call__(self, *args: P.args, **kwargs: P.kwargs) -> R:
        """调用包装的方法"""
        if self._instance is not None:
            return self._meth(self._instance, *args, **kwargs)
        return self._meth(*args, **kwargs)
    
    def unwrap(self) -> Callable[P, R]:
        """获取原始未包装的方法"""
        return self._meth
    
    def __get__(self, instance: Any, owner: type | None = None) -> "FlowMethod[P, R]":
        """支持描述符协议，用于方法绑定"""
        if instance is None:
            return self
        
        bound = type(self)(self._meth, instance)
        
        # 复制元数据属性
        skip = {
            "_meth", "_instance", "__name__", "__doc__", "__signature__",
            "__self__", "_is_coroutine", "__module__", "__qualname__",
            "__annotations__", "__type_params__", "__wrapped__",
        }
        for attr, value in self.__dict__.items():
            if attr not in skip:
                setattr(bound, attr, value)
        
        return bound


class StartMethod(FlowMethod[P, R]):
    """标记为 Flow 起点的方法包装器
    
    Attributes:
        __is_start_method__: True，标记为起始方法
        __trigger_methods__: 触发此方法的方法列表（可选）
        __condition_type__: 条件类型（OR/AND）
        __trigger_condition__: 完整的触发条件（嵌套条件时使用）
    """
    __is_start_method__: bool = True
    __trigger_methods__: Optional[List[FlowMethodName]] = None
    __condition_type__: Optional[FlowConditionType] = None
    __trigger_condition__: Optional[FlowCondition] = None


class ListenMethod(FlowMethod[P, R]):
    """标记为 Flow 监听器的方法包装器
    
    Attributes:
        __trigger_methods__: 触发此方法的方法列表
        __condition_type__: 条件类型（OR/AND）
        __trigger_condition__: 完整的触发条件（嵌套条件时使用）
    """
    __trigger_methods__: Optional[List[FlowMethodName]] = None
    __condition_type__: Optional[FlowConditionType] = None
    __trigger_condition__: Optional[FlowCondition] = None


class RouterMethod(FlowMethod[P, R]):
    """标记为 Flow 路由器的方法包装器
    
    路由器方法根据返回值决定下一步执行路径。
    
    Attributes:
        __is_router__: True，标记为路由器
        __trigger_methods__: 触发此方法的方法列表
        __condition_type__: 条件类型（OR/AND）
        __trigger_condition__: 完整的触发条件（嵌套条件时使用）
    """
    __is_router__: bool = True
    __trigger_methods__: Optional[List[FlowMethodName]] = None
    __condition_type__: Optional[FlowConditionType] = None
    __trigger_condition__: Optional[FlowCondition] = None


# ============================================================================
# Decorators
# ============================================================================


def start(
    condition: str | FlowCondition | Callable[..., Any] | None = None,
) -> Callable[[Callable[P, R]], StartMethod[P, R]]:
    """标记方法为 Flow 的起点
    
    此装饰器将方法指定为 Flow 执行的入口点。
    可以选择性地指定触发条件。
    
    Args:
        condition: 定义何时执行起始方法。可以是：
            - str: 触发此起始的方法名
            - FlowCondition: or_() 或 and_() 的结果，包括嵌套条件
            - Callable: 触发此起始的方法引用
            - None: 无条件起始（默认）
    
    Returns:
        装饰器函数，将方法包装为 Flow 起点
    
    Raises:
        ValueError: 如果条件格式无效
    
    Examples:
        >>> @start()  # 无条件起始
        >>> def begin_flow(self):
        ...     pass
        
        >>> @start("init_complete")  # 在特定方法后起始
        >>> def conditional_start(self):
        ...     pass
        
        >>> @start(and_("step1", "step2"))  # 在多个方法完成后起始
        >>> def complex_start(self):
        ...     pass
    """
    def decorator(func: Callable[P, R]) -> StartMethod[P, R]:
        wrapper = StartMethod(func)
        
        if condition is not None:
            if is_flow_method_name(condition):
                wrapper.__trigger_methods__ = [FlowMethodName(condition)]
                wrapper.__condition_type__ = OR_CONDITION
            elif is_flow_condition_dict(condition):
                if "conditions" in condition:
                    wrapper.__trigger_condition__ = condition
                    wrapper.__trigger_methods__ = extract_all_methods(condition)
                    wrapper.__condition_type__ = condition["type"]
                elif "methods" in condition:
                    wrapper.__trigger_methods__ = condition["methods"]
                    wrapper.__condition_type__ = condition["type"]
                else:
                    raise ValueError(
                        "条件字典必须包含 'conditions' 或 'methods'"
                    )
            elif is_flow_method_callable(condition):
                wrapper.__trigger_methods__ = [FlowMethodName(condition.__name__)]
                wrapper.__condition_type__ = OR_CONDITION
            else:
                raise ValueError(
                    "条件必须是方法名、字符串、或 or_()/and_() 的结果"
                )
        return wrapper
    
    return decorator


def listen(
    condition: str | FlowCondition | Callable[..., Any],
) -> Callable[[Callable[P, R]], ListenMethod[P, R]]:
    """创建监听器，在指定条件满足时执行
    
    此装饰器设置方法响应 Flow 中其他方法的执行。
    支持简单和复杂的触发条件。
    
    Args:
        condition: 指定监听器何时执行。可以是：
            - str: 触发监听器的方法名
            - FlowCondition: or_() 或 and_() 的结果
            - Callable: 触发监听器的方法引用
    
    Returns:
        装饰器函数，将方法包装为 Flow 监听器
    
    Raises:
        ValueError: 如果条件格式无效
    
    Examples:
        >>> @listen("process_data")
        >>> def handle_processed_data(self, result):
        ...     pass
        
        >>> @listen(or_("success", "fallback"))
        >>> def handle_completion(self):
        ...     pass
    """
    def decorator(func: Callable[P, R]) -> ListenMethod[P, R]:
        wrapper = ListenMethod(func)
        
        if is_flow_method_name(condition):
            wrapper.__trigger_methods__ = [FlowMethodName(condition)]
            wrapper.__condition_type__ = OR_CONDITION
        elif is_flow_condition_dict(condition):
            if "conditions" in condition:
                wrapper.__trigger_condition__ = condition
                wrapper.__trigger_methods__ = extract_all_methods(condition)
                wrapper.__condition_type__ = condition["type"]
            elif "methods" in condition:
                wrapper.__trigger_methods__ = condition["methods"]
                wrapper.__condition_type__ = condition["type"]
            else:
                raise ValueError(
                    "条件字典必须包含 'conditions' 或 'methods'"
                )
        elif is_flow_method_callable(condition):
            wrapper.__trigger_methods__ = [FlowMethodName(condition.__name__)]
            wrapper.__condition_type__ = OR_CONDITION
        else:
            raise ValueError(
                "条件必须是方法名、字符串、或 or_()/and_() 的结果"
            )
        return wrapper
    
    return decorator


def router(
    condition: str | FlowCondition | Callable[..., Any],
) -> Callable[[Callable[P, R]], RouterMethod[P, R]]:
    """创建路由方法，根据条件指导 Flow 执行
    
    此装饰器将方法标记为路由器，可根据返回值动态决定
    Flow 的下一步。路由器由指定条件触发，返回常量决定执行路径。
    
    Args:
        condition: 指定路由器何时执行。可以是：
            - str: 触发路由器的方法名
            - FlowCondition: or_() 或 and_() 的结果
            - Callable: 触发路由器的方法引用
    
    Returns:
        装饰器函数，将方法包装为路由器
    
    Raises:
        ValueError: 如果条件格式无效
    
    Examples:
        >>> @router("check_status")
        >>> def route_by_status(self):
        ...     if self.state.status == "success":
        ...         return "SUCCESS"
        ...     return "FAILURE"
        
        >>> @router(and_("validate", "process"))
        >>> def complex_routing(self):
        ...     return "CONTINUE" if self.state.valid else "STOP"
    """
    def decorator(func: Callable[P, R]) -> RouterMethod[P, R]:
        wrapper = RouterMethod(func)
        
        if is_flow_method_name(condition):
            wrapper.__trigger_methods__ = [FlowMethodName(condition)]
            wrapper.__condition_type__ = OR_CONDITION
        elif is_flow_condition_dict(condition):
            if "conditions" in condition:
                wrapper.__trigger_condition__ = condition
                wrapper.__trigger_methods__ = extract_all_methods(condition)
                wrapper.__condition_type__ = condition["type"]
            elif "methods" in condition:
                wrapper.__trigger_methods__ = condition["methods"]
                wrapper.__condition_type__ = condition["type"]
            else:
                raise ValueError(
                    "条件字典必须包含 'conditions' 或 'methods'"
                )
        elif is_flow_method_callable(condition):
            wrapper.__trigger_methods__ = [FlowMethodName(condition.__name__)]
            wrapper.__condition_type__ = OR_CONDITION
        else:
            raise ValueError(
                "条件必须是方法名、字符串、或 or_()/and_() 的结果"
            )
        return wrapper
    
    return decorator


# ============================================================================
# Condition Combinators
# ============================================================================


def or_(*conditions: str | FlowCondition | Callable[..., Any]) -> FlowCondition:
    """使用 OR 逻辑组合多个条件
    
    创建一个在任意指定条件满足时激活的条件。
    与 @start, @listen, @router 装饰器配合使用。
    
    Args:
        *conditions: 可变数量的条件，可以是方法名、现有条件字典或方法引用
    
    Returns:
        条件字典，格式为 {"type": "OR", "conditions": [...]}
    
    Raises:
        ValueError: 如果条件格式无效
    
    Examples:
        >>> @listen(or_("success", "timeout"))
        >>> def handle_completion(self):
        ...     pass
        
        >>> @listen(or_(and_("step1", "step2"), "step3"))
        >>> def handle_nested(self):
        ...     pass
    """
    processed_conditions: FlowConditions = []
    for condition in conditions:
        if is_flow_condition_dict(condition):
            processed_conditions.append(condition)
        elif is_flow_method_name(condition):
            processed_conditions.append(FlowMethodName(condition))
        elif is_flow_method_callable(condition):
            processed_conditions.append(FlowMethodName(condition.__name__))
        else:
            raise ValueError(f"or_() 中的条件无效: {condition}")
    return {"type": OR_CONDITION, "conditions": processed_conditions}


def and_(*conditions: str | FlowCondition | Callable[..., Any]) -> FlowCondition:
    """使用 AND 逻辑组合多个条件
    
    创建一个仅在所有指定条件满足时激活的条件。
    与 @start, @listen, @router 装饰器配合使用。
    
    Args:
        *conditions: 可变数量的条件，可以是方法名、现有条件字典或方法引用
    
    Returns:
        条件字典，格式为 {"type": "AND", "conditions": [...]}
    
    Raises:
        ValueError: 如果条件格式无效
    
    Examples:
        >>> @listen(and_("validated", "processed"))
        >>> def handle_complete_data(self):
        ...     pass
        
        >>> @listen(and_(or_("step1", "step2"), "step3"))
        >>> def handle_nested(self):
        ...     pass
    """
    processed_conditions: FlowConditions = []
    for condition in conditions:
        if is_flow_condition_dict(condition):
            processed_conditions.append(condition)
        elif is_flow_method_name(condition):
            processed_conditions.append(FlowMethodName(condition))
        elif is_flow_method_callable(condition):
            processed_conditions.append(FlowMethodName(condition.__name__))
        else:
            raise ValueError(f"and_() 中的条件无效: {condition}")
    return {"type": AND_CONDITION, "conditions": processed_conditions}


__all__ = [
    # Utility functions
    "is_flow_method_name",
    "is_flow_condition_dict",
    "is_flow_method_callable",
    "extract_all_methods",
    # Wrapper classes
    "FlowMethod",
    "StartMethod",
    "ListenMethod",
    "RouterMethod",
    # Decorators
    "start",
    "listen",
    "router",
    # Condition combinators
    "or_",
    "and_",
]

