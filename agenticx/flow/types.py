"""
Flow 类型定义

定义 Flow 系统使用的核心类型。
参考自 crewAI flow/types.py 和 flow/flow_wrappers.py
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, NewType, Sequence, Union

from typing_extensions import Required, TypedDict  # type: ignore


# ============================================================================
# Basic Types
# ============================================================================


# 方法名称类型
FlowMethodName = NewType("FlowMethodName", str)

# 条件类型
FlowConditionType = Literal["OR", "AND"]

# 简单条件：(type, [method_names])
SimpleFlowCondition = tuple[FlowConditionType, List[FlowMethodName]]


# ============================================================================
# Flow Condition TypedDict
# ============================================================================


class FlowCondition(TypedDict, total=False):
    """Flow 触发条件定义
    
    这是一个递归结构，条件可以包含嵌套的 FlowConditions。
    
    Attributes:
        type: 条件类型（"OR" 或 "AND"）
        conditions: 条件列表（可以是方法名或嵌套条件）
        methods: 方法名列表（简化形式）
        
    Examples:
        # 简单 OR 条件
        {"type": "OR", "methods": ["method1", "method2"]}
        
        # 嵌套条件
        {
            "type": "AND",
            "conditions": [
                {"type": "OR", "methods": ["step1", "step2"]},
                "step3"
            ]
        }
    """
    type: Required[FlowConditionType]
    conditions: Sequence[Union[FlowMethodName, "FlowCondition"]]
    methods: List[FlowMethodName]


# 条件列表类型
FlowConditions = List[Union[FlowMethodName, FlowCondition]]


# ============================================================================
# Flow Execution Types
# ============================================================================


class PendingListenerKey(TypedDict):
    """待执行监听器的键
    
    用于追踪等待触发条件满足的监听器。
    """
    listener_name: str
    trigger_methods: List[FlowMethodName]
    condition_type: FlowConditionType


class FlowExecutionData(TypedDict, total=False):
    """Flow 执行数据
    
    存储 Flow 执行过程中的状态信息。
    
    Attributes:
        flow_id: Flow 实例 ID
        state: 当前状态数据
        method_outputs: 各方法的输出结果
        pending_listeners: 待执行的监听器
        completed_methods: 已完成的方法列表
        execution_status: 执行状态
    """
    flow_id: str
    state: Dict[str, Any]
    method_outputs: Dict[str, Any]
    pending_listeners: Dict[str, PendingListenerKey]
    completed_methods: List[str]
    execution_status: Literal["pending", "running", "paused", "completed", "failed"]


# ============================================================================
# Constants
# ============================================================================


# 条件类型常量
OR_CONDITION: FlowConditionType = "OR"
AND_CONDITION: FlowConditionType = "AND"


__all__ = [
    # Types
    "FlowMethodName",
    "FlowConditionType",
    "SimpleFlowCondition",
    "FlowCondition",
    "FlowConditions",
    "PendingListenerKey",
    "FlowExecutionData",
    # Constants
    "OR_CONDITION",
    "AND_CONDITION",
]

