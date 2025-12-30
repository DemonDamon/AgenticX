"""
FlowState 状态管理

提供 Flow 执行过程中的状态管理机制。
参考自 crewAI FlowState

Usage:
    from agenticx.flow import Flow, FlowState, start, listen
    from pydantic import BaseModel
    
    # 方式 1: 使用字典状态
    class SimpleFlow(Flow[dict]):
        @start()
        def begin(self):
            self.state["count"] = 0
            return "started"
        
        @listen("begin")
        def increment(self):
            self.state["count"] += 1
    
    # 方式 2: 使用 Pydantic 模型状态
    class MyState(FlowState):
        count: int = 0
        message: str = ""
    
    class TypedFlow(Flow[MyState]):
        @start()
        def begin(self):
            self.state.count = 0
            self.state.message = "started"
"""

from __future__ import annotations

from typing import Any, Dict, Optional
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field


class FlowState(BaseModel):
    """Flow 状态基类
    
    所有 Flow 状态的基类，确保每个状态都有唯一 ID。
    可以继承此类创建自定义状态模型。
    
    Attributes:
        id: 状态唯一标识符
        
    Example:
        >>> class MyState(FlowState):
        ...     count: int = 0
        ...     items: list = []
        ...     status: str = "pending"
        
        >>> state = MyState()
        >>> state.count = 10
        >>> state.id  # UUID 字符串
    """
    
    model_config = ConfigDict(
        arbitrary_types_allowed=True,
        extra="allow",  # 允许额外字段，便于动态添加状态
    )
    
    id: str = Field(
        default_factory=lambda: str(uuid4()),
        description="状态唯一标识符"
    )


class FlowExecutionState:
    """Flow 执行状态追踪器
    
    追踪 Flow 执行过程中的内部状态，包括：
    - 已完成的方法
    - 方法输出
    - 待处理的监听器
    
    这是内部使用的类，不对外暴露。
    
    Attributes:
        flow_id: Flow 实例 ID
        completed_methods: 已完成的方法集合
        method_outputs: 方法输出映射
        pending_triggers: 待触发的方法 -> 已满足的条件
    """
    
    def __init__(self, flow_id: Optional[str] = None):
        """初始化执行状态
        
        Args:
            flow_id: Flow 实例 ID，默认自动生成
        """
        self.flow_id = flow_id or str(uuid4())
        self.completed_methods: set[str] = set()
        self.method_outputs: Dict[str, Any] = {}
        self.pending_triggers: Dict[str, set[str]] = {}
        self.execution_count: Dict[str, int] = {}
        self._status: str = "pending"
    
    @property
    def status(self) -> str:
        """获取执行状态"""
        return self._status
    
    @status.setter
    def status(self, value: str):
        """设置执行状态"""
        if value not in ("pending", "running", "paused", "completed", "failed"):
            raise ValueError(f"无效的执行状态: {value}")
        self._status = value
    
    def mark_completed(self, method_name: str, output: Any = None) -> None:
        """标记方法为已完成
        
        Args:
            method_name: 方法名称
            output: 方法输出（可选）
        """
        self.completed_methods.add(method_name)
        self.method_outputs[method_name] = output
        self.execution_count[method_name] = self.execution_count.get(method_name, 0) + 1
    
    def is_completed(self, method_name: str) -> bool:
        """检查方法是否已完成
        
        Args:
            method_name: 方法名称
            
        Returns:
            True 如果方法已完成
        """
        return method_name in self.completed_methods
    
    def get_output(self, method_name: str) -> Any:
        """获取方法输出
        
        Args:
            method_name: 方法名称
            
        Returns:
            方法输出，如果未找到返回 None
        """
        return self.method_outputs.get(method_name)
    
    def check_or_condition(self, trigger_methods: list[str]) -> bool:
        """检查 OR 条件是否满足
        
        任意一个触发方法完成即满足条件。
        
        Args:
            trigger_methods: 触发方法列表
            
        Returns:
            True 如果条件满足
        """
        return any(self.is_completed(m) for m in trigger_methods)
    
    def check_and_condition(self, trigger_methods: list[str]) -> bool:
        """检查 AND 条件是否满足
        
        所有触发方法都完成才满足条件。
        
        Args:
            trigger_methods: 触发方法列表
            
        Returns:
            True 如果条件满足
        """
        return all(self.is_completed(m) for m in trigger_methods)
    
    def reset(self) -> None:
        """重置执行状态"""
        self.completed_methods.clear()
        self.method_outputs.clear()
        self.pending_triggers.clear()
        self.execution_count.clear()
        self._status = "pending"
    
    def to_dict(self) -> Dict[str, Any]:
        """导出状态为字典
        
        Returns:
            状态字典
        """
        return {
            "flow_id": self.flow_id,
            "status": self._status,
            "completed_methods": list(self.completed_methods),
            "method_outputs": self.method_outputs.copy(),
            "execution_count": self.execution_count.copy(),
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "FlowExecutionState":
        """从字典恢复状态
        
        Args:
            data: 状态字典
            
        Returns:
            FlowExecutionState 实例
        """
        state = cls(flow_id=data.get("flow_id"))
        state._status = data.get("status", "pending")
        state.completed_methods = set(data.get("completed_methods", []))
        state.method_outputs = data.get("method_outputs", {}).copy()
        state.execution_count = data.get("execution_count", {}).copy()
        return state


__all__ = [
    "FlowState",
    "FlowExecutionState",
]

