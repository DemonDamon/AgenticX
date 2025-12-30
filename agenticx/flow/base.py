"""
Flow 基类与执行器

提供 Flow 工作流的基类和执行引擎。
参考自 crewAI Flow 基类

Usage:
    from agenticx.flow import Flow, FlowState, start, listen, router
    
    class DataPipeline(Flow):
        @start()
        def fetch_data(self):
            return {"data": [1, 2, 3]}
        
        @listen("fetch_data")
        def process_data(self, result):
            return {"processed": [x * 2 for x in result["data"]]}
        
        @router("process_data")
        def check_result(self, result):
            if len(result["processed"]) > 0:
                return "SUCCESS"
            return "EMPTY"
        
        @listen("SUCCESS")
        def on_success(self):
            print("Pipeline succeeded!")
    
    # 执行
    flow = DataPipeline()
    result = flow.kickoff()
"""

from __future__ import annotations

import asyncio
import inspect
import logging
from abc import ABCMeta
from typing import Any, ClassVar, Dict, Generic, List, Optional, Set, Type, TypeVar, Union
from uuid import uuid4

from pydantic import BaseModel

from .decorators import (
    FlowMethod,
    StartMethod,
    ListenMethod,
    RouterMethod,
    extract_all_methods,
)
from .state import FlowState, FlowExecutionState
from .types import (
    FlowCondition,
    FlowConditionType,
    FlowMethodName,
    OR_CONDITION,
    AND_CONDITION,
)


logger = logging.getLogger(__name__)


T = TypeVar("T", bound=Union[Dict[str, Any], BaseModel])


class FlowMeta(ABCMeta):
    """Flow 元类
    
    在类创建时扫描并注册所有 Flow 方法（@start, @listen, @router）。
    """
    
    def __new__(
        mcs,
        name: str,
        bases: tuple[type, ...],
        namespace: Dict[str, Any],
        **kwargs: Any,
    ) -> type:
        cls = super().__new__(mcs, name, bases, namespace)
        
        start_methods: List[str] = []
        listeners: Dict[str, FlowCondition | tuple] = {}
        routers: Set[str] = set()
        router_paths: Dict[str, List[str]] = {}
        
        # 从基类继承
        for base in bases:
            if hasattr(base, "_start_methods"):
                start_methods.extend(getattr(base, "_start_methods", []))
            if hasattr(base, "_listeners"):
                listeners.update(getattr(base, "_listeners", {}))
            if hasattr(base, "_routers"):
                routers.update(getattr(base, "_routers", set()))
            if hasattr(base, "_router_paths"):
                router_paths.update(getattr(base, "_router_paths", {}))
        
        # 扫描当前类的方法
        for attr_name, attr_value in namespace.items():
            if not _is_flow_method(attr_value):
                continue
            
            # 注册起始方法
            if hasattr(attr_value, "__is_start_method__") and attr_value.__is_start_method__:
                if attr_name not in start_methods:
                    start_methods.append(attr_name)
            
            # 注册监听器和路由器
            if (
                hasattr(attr_value, "__trigger_methods__")
                and attr_value.__trigger_methods__ is not None
            ):
                methods = attr_value.__trigger_methods__
                condition_type = getattr(attr_value, "__condition_type__", OR_CONDITION)
                
                if (
                    hasattr(attr_value, "__trigger_condition__")
                    and attr_value.__trigger_condition__ is not None
                ):
                    listeners[attr_name] = attr_value.__trigger_condition__
                else:
                    listeners[attr_name] = (condition_type, methods)
                
                # 注册路由器
                if hasattr(attr_value, "__is_router__") and attr_value.__is_router__:
                    routers.add(attr_name)
                    # 尝试提取可能的返回路径
                    possible_returns = _get_possible_return_constants(attr_value)
                    router_paths[attr_name] = possible_returns or []
        
        cls._start_methods = start_methods  # type: ignore
        cls._listeners = listeners  # type: ignore
        cls._routers = routers  # type: ignore
        cls._router_paths = router_paths  # type: ignore
        
        return cls


def _is_flow_method(obj: Any) -> bool:
    """检查对象是否为 Flow 方法"""
    return (
        hasattr(obj, "__is_flow_method__")
        or hasattr(obj, "__is_start_method__")
        or hasattr(obj, "__trigger_methods__")
        or hasattr(obj, "__is_router__")
    )


def _get_possible_return_constants(func: Any) -> List[str]:
    """尝试从函数源码中提取可能的返回常量"""
    try:
        source = inspect.getsource(func.unwrap() if hasattr(func, "unwrap") else func)
        import re
        # 匹配 return "CONSTANT" 或 return 'CONSTANT'
        matches = re.findall(r'return\s+["\']([A-Z_]+)["\']', source)
        return list(set(matches))
    except Exception:
        return []


class Flow(Generic[T], metaclass=FlowMeta):
    """Flow 工作流基类
    
    提供事件驱动的工作流执行能力。使用装饰器定义工作流拓扑：
    - @start: 标记起始方法
    - @listen: 标记监听方法
    - @router: 标记路由方法
    
    Type Parameters:
        T: 状态类型，可以是 dict 或 Pydantic BaseModel
    
    Attributes:
        state: 工作流状态
        
    Example:
        >>> class MyFlow(Flow[dict]):
        ...     @start()
        ...     def begin(self):
        ...         self.state["step"] = 1
        ...         return "started"
        ...     
        ...     @listen("begin")
        ...     def next_step(self, result):
        ...         self.state["step"] = 2
        ...         return f"completed: {result}"
        
        >>> flow = MyFlow()
        >>> result = flow.kickoff()
    """
    
    # 类级别属性（由元类填充）
    _start_methods: ClassVar[List[str]] = []
    _listeners: ClassVar[Dict[str, Any]] = {}
    _routers: ClassVar[Set[str]] = set()
    _router_paths: ClassVar[Dict[str, List[str]]] = {}
    
    def __init__(
        self,
        state: Optional[T] = None,
        flow_id: Optional[str] = None,
    ):
        """初始化 Flow
        
        Args:
            state: 初始状态（可选）
            flow_id: Flow ID（可选，默认自动生成）
        """
        self._flow_id = flow_id or str(uuid4())
        self._execution_state = FlowExecutionState(flow_id=self._flow_id)
        
        # 初始化状态
        if state is not None:
            self._state = state
        else:
            # 尝试从类型注解获取状态类型
            self._state = self._create_default_state()
    
    def _create_default_state(self) -> T:
        """创建默认状态"""
        # 尝试从泛型参数获取状态类型
        orig_bases = getattr(self.__class__, "__orig_bases__", ())
        for base in orig_bases:
            if hasattr(base, "__args__"):
                state_type = base.__args__[0]
                if isinstance(state_type, type):
                    if issubclass(state_type, dict):
                        return {}  # type: ignore
                    elif issubclass(state_type, BaseModel):
                        return state_type()  # type: ignore
        return {}  # type: ignore
    
    @property
    def flow_id(self) -> str:
        """获取 Flow ID"""
        return self._flow_id
    
    @property
    def state(self) -> T:
        """获取当前状态"""
        return self._state
    
    @state.setter
    def state(self, value: T) -> None:
        """设置状态"""
        self._state = value
    
    @property
    def execution_state(self) -> FlowExecutionState:
        """获取执行状态"""
        return self._execution_state
    
    def kickoff(self, inputs: Optional[Dict[str, Any]] = None) -> Any:
        """同步执行 Flow
        
        Args:
            inputs: 传递给起始方法的输入参数
            
        Returns:
            最终执行结果
        """
        try:
            loop = asyncio.get_running_loop()
            # 如果已在异步上下文中，使用 run_until_complete 会出错
            # 创建任务并等待
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                future = pool.submit(asyncio.run, self.kickoff_async(inputs))
                return future.result()
        except RuntimeError:
            # 没有运行中的事件循环，可以直接使用 asyncio.run
            return asyncio.run(self.kickoff_async(inputs))
    
    async def kickoff_async(self, inputs: Optional[Dict[str, Any]] = None) -> Any:
        """异步执行 Flow
        
        Args:
            inputs: 传递给起始方法的输入参数
            
        Returns:
            最终执行结果
        """
        self._execution_state.status = "running"
        logger.debug(f"Flow {self._flow_id} 开始执行")
        
        try:
            # 执行所有起始方法
            results = []
            for method_name in self._start_methods:
                method = getattr(self, method_name)
                # 检查是否有触发条件（条件起始）
                if (
                    hasattr(method, "__trigger_methods__")
                    and method.__trigger_methods__ is not None
                ):
                    # 条件起始方法，跳过直接执行
                    continue
                
                result = await self._execute_method(method_name, inputs)
                results.append(result)
            
            # 处理监听器执行直到没有更多任务
            while True:
                triggered = await self._process_listeners()
                if not triggered:
                    break
            
            self._execution_state.status = "completed"
            logger.debug(f"Flow {self._flow_id} 执行完成")
            
            # 返回最后一个结果
            if results:
                return results[-1] if len(results) == 1 else results
            
            # 如果没有起始方法的结果，返回最后完成的方法结果
            if self._execution_state.completed_methods:
                last_method = list(self._execution_state.completed_methods)[-1]
                return self._execution_state.get_output(last_method)
            
            return None
            
        except Exception as e:
            self._execution_state.status = "failed"
            logger.error(f"Flow {self._flow_id} 执行失败: {e}")
            raise
    
    async def _execute_method(
        self,
        method_name: str,
        inputs: Optional[Dict[str, Any]] = None,
    ) -> Any:
        """执行单个方法
        
        Args:
            method_name: 方法名称
            inputs: 输入参数
            
        Returns:
            方法执行结果
        """
        method = getattr(self, method_name)
        logger.debug(f"执行方法: {method_name}")
        
        try:
            # 检查方法签名，过滤只传递方法接受的参数
            filtered_inputs = self._filter_method_args(method, inputs)
            
            # 准备参数
            if filtered_inputs:
                if inspect.iscoroutinefunction(method):
                    result = await method(**filtered_inputs)
                else:
                    result = method(**filtered_inputs)
            else:
                if inspect.iscoroutinefunction(method):
                    result = await method()
                else:
                    result = method()
            
            # 标记完成
            self._execution_state.mark_completed(method_name, result)
            
            # 如果是路由器，处理路由结果
            if method_name in self._routers and isinstance(result, str):
                # 路由结果作为虚拟方法完成
                self._execution_state.mark_completed(result, result)
            
            return result
            
        except Exception as e:
            logger.error(f"方法 {method_name} 执行失败: {e}")
            raise
    
    async def _process_listeners(self) -> bool:
        """处理待执行的监听器
        
        Returns:
            True 如果有监听器被触发执行
        """
        triggered = False
        
        for listener_name, condition in self._listeners.items():
            # 检查是否已执行
            if self._execution_state.is_completed(listener_name):
                continue
            
            # 检查条件是否满足
            should_execute = self._check_condition(condition)
            
            if should_execute:
                # 获取触发方法的输出作为参数
                trigger_methods = self._get_trigger_methods(condition)
                inputs = self._collect_trigger_outputs(trigger_methods)
                
                await self._execute_method(listener_name, inputs)
                triggered = True
        
        return triggered
    
    def _check_condition(
        self,
        condition: FlowCondition | tuple,
    ) -> bool:
        """检查条件是否满足
        
        Args:
            condition: 条件定义
            
        Returns:
            True 如果条件满足
        """
        if isinstance(condition, tuple):
            # 简单条件: (type, [methods])
            condition_type, methods = condition
            if condition_type == OR_CONDITION:
                return self._execution_state.check_or_condition(methods)
            else:
                return self._execution_state.check_and_condition(methods)
        
        elif isinstance(condition, dict):
            # 复杂条件
            return self._check_complex_condition(condition)
        
        return False
    
    def _check_complex_condition(self, condition: FlowCondition) -> bool:
        """检查复杂嵌套条件
        
        Args:
            condition: FlowCondition 字典
            
        Returns:
            True 如果条件满足
        """
        condition_type = condition["type"]
        
        if "methods" in condition:
            # 简单方法列表
            methods = condition["methods"]
            if condition_type == OR_CONDITION:
                return self._execution_state.check_or_condition(methods)
            else:
                return self._execution_state.check_and_condition(methods)
        
        if "conditions" in condition:
            # 嵌套条件
            results = []
            for cond in condition["conditions"]:
                if isinstance(cond, str):
                    results.append(self._execution_state.is_completed(cond))
                elif isinstance(cond, dict):
                    results.append(self._check_complex_condition(cond))
            
            if condition_type == OR_CONDITION:
                return any(results)
            else:
                return all(results)
        
        return False
    
    def _get_trigger_methods(
        self,
        condition: FlowCondition | tuple,
    ) -> List[str]:
        """从条件中提取触发方法列表
        
        Args:
            condition: 条件定义
            
        Returns:
            方法名列表
        """
        if isinstance(condition, tuple):
            return list(condition[1])
        elif isinstance(condition, dict):
            return extract_all_methods(condition)
        return []
    
    def _collect_trigger_outputs(
        self,
        trigger_methods: List[str],
    ) -> Optional[Dict[str, Any]]:
        """收集触发方法的输出
        
        Args:
            trigger_methods: 触发方法列表
            
        Returns:
            包含方法输出的字典，如果只有一个则直接返回输出值
        """
        outputs = {}
        for method in trigger_methods:
            if self._execution_state.is_completed(method):
                outputs[method] = self._execution_state.get_output(method)
        
        if len(outputs) == 1:
            # 单个触发方法，直接传递输出
            return {"result": list(outputs.values())[0]}
        elif len(outputs) > 1:
            return outputs
        
        return None
    
    def _filter_method_args(
        self,
        method: Any,
        inputs: Optional[Dict[str, Any]],
    ) -> Optional[Dict[str, Any]]:
        """根据方法签名过滤输入参数
        
        只保留方法接受的参数，避免 unexpected keyword argument 错误。
        
        Args:
            method: 方法对象
            inputs: 输入参数字典
            
        Returns:
            过滤后的参数字典，如果方法不接受参数则返回 None
        """
        if not inputs:
            return None
        
        try:
            # 获取原始方法（如果是 FlowMethod 包装器）
            unwrapped = method.unwrap() if hasattr(method, 'unwrap') else method
            sig = inspect.signature(unwrapped)
            params = sig.parameters
            
            # 检查是否有 **kwargs
            has_var_keyword = any(
                p.kind == inspect.Parameter.VAR_KEYWORD
                for p in params.values()
            )
            
            if has_var_keyword:
                # 方法接受任意关键字参数
                return inputs
            
            # 获取方法接受的参数名（排除 self）
            accepted_params = {
                name for name, param in params.items()
                if param.kind in (
                    inspect.Parameter.POSITIONAL_OR_KEYWORD,
                    inspect.Parameter.KEYWORD_ONLY,
                )
            }
            
            if not accepted_params:
                return None
            
            # 过滤只保留接受的参数
            filtered = {k: v for k, v in inputs.items() if k in accepted_params}
            return filtered if filtered else None
            
        except (ValueError, TypeError):
            # 无法获取签名，尝试传递所有参数
            return inputs
    
    def reset(self) -> None:
        """重置 Flow 状态"""
        self._execution_state.reset()
        self._state = self._create_default_state()
    
    def get_execution_summary(self) -> Dict[str, Any]:
        """获取执行摘要
        
        Returns:
            执行状态摘要字典
        """
        return {
            "flow_id": self._flow_id,
            "status": self._execution_state.status,
            "completed_methods": list(self._execution_state.completed_methods),
            "start_methods": self._start_methods,
            "listeners": list(self._listeners.keys()),
            "routers": list(self._routers),
        }


__all__ = [
    "FlowMeta",
    "Flow",
]

