"""
GUIAction Schema - 紧凑 GUI 动作 Schema
基于 AgentCPM-GUI 设计

特点：
- 0-1000 归一化坐标
- 紧凑 JSON 格式（平均 9.7 tokens）
- STATUS 字段映射到 InterventionState/SubtaskStatus

来源：AgentCPM-GUI 框架
"""

from enum import Enum
from typing import Any, Dict, List, Optional, Union
from pydantic import BaseModel, Field, field_validator  # type: ignore
import json

from agenticx.embodiment.core.models import NormalizedCoordinate


class GUIActionType(str, Enum):
    """GUI 动作类型枚举
    
    定义了 GUI 自动化中支持的基本动作类型。
    """
    CLICK = "click"
    LONG_PRESS = "long_press"
    SWIPE = "swipe"
    TYPE = "type"
    PRESS = "press"
    WAIT = "wait"
    STATUS = "status"


class GUIActionCompact(BaseModel):
    """紧凑 GUI 动作模型 - 基于 AgentCPM-GUI 设计
    
    使用紧凑 JSON 格式减少 token 消耗，同时保持可读性。
    
    Attributes:
        thought: 思考过程
        action_type: 动作类型
        point: 点击坐标 [x, y]，范围 0-1000（归一化）
        to: 滑动方向（up/down/left/right）或目标坐标 [x, y]
        text: 输入文本
        press: 特殊按键 (HOME/BACK/ENTER)
        duration_ms: 执行时间（毫秒）
        status: 任务状态
    
    Example:
        >>> # 点击动作
        >>> action = GUIActionCompact(
        ...     thought="点击搜索按钮",
        ...     action_type=GUIActionType.CLICK,
        ...     point=[500, 300]
        ... )
        >>> 
        >>> # 滑动动作
        >>> action = GUIActionCompact(
        ...     thought="向下滚动",
        ...     action_type=GUIActionType.SWIPE,
        ...     point=[500, 500],
        ...     to="down"
        ... )
        >>> 
        >>> # 输入文本
        >>> action = GUIActionCompact(
        ...     thought="输入搜索关键词",
        ...     action_type=GUIActionType.TYPE,
        ...     text="AgenticX"
        ... )
    """
    thought: Optional[str] = Field(default=None, description="思考过程")
    action_type: GUIActionType = Field(description="动作类型")
    point: Optional[List[int]] = Field(
        default=None, 
        description="点击坐标 [x, y]，范围 0-1000"
    )
    to: Optional[Union[str, List[int]]] = Field(
        default=None,
        description="滑动方向（up/down/left/right）或目标坐标 [x, y]"
    )
    text: Optional[str] = Field(default=None, description="输入文本")
    press: Optional[str] = Field(default=None, description="特殊按键 (HOME/BACK/ENTER)")
    duration_ms: int = Field(default=200, description="执行时间（毫秒）")
    status: Optional[str] = Field(default=None, description="任务状态")
    
    @field_validator('point', 'to')
    @classmethod
    def validate_coordinates(cls, v):
        """验证坐标范围 [0-1000]"""
        if v is None:
            return v
        if isinstance(v, list) and len(v) == 2:
            x, y = v
            if not (0 <= x <= 1000 and 0 <= y <= 1000):
                raise ValueError(f"Coordinates must be in [0-1000] range, got [{x}, {y}]")
        return v
    
    def to_compact_json(self) -> str:
        """转换为紧凑 JSON 字符串
        
        只包含非空字段，减少 token 消耗。
        
        Returns:
            紧凑的 JSON 字符串
        """
        data = {}
        
        if self.thought:
            data["thought"] = self.thought
        
        # action_type 总是包含
        data["action_type"] = self.action_type.value
        
        if self.point:
            data["POINT"] = self.point
        if self.to:
            data["to"] = self.to
        if self.text:
            data["TYPE"] = self.text
        if self.press:
            data["PRESS"] = self.press
        if self.duration_ms != 200:  # 只在非默认值时包含
            data["duration_ms"] = self.duration_ms
        if self.status:
            data["STATUS"] = self.status
        
        return json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    
    @classmethod
    def from_compact_json(cls, json_str: str) -> "GUIActionCompact":
        """从紧凑 JSON 字符串解析
        
        Args:
            json_str: JSON 字符串
            
        Returns:
            GUIActionCompact 实例
        """
        data = json.loads(json_str)
        
        # 映射字段名
        action_type = data.get("action_type", "click")
        
        return cls(
            thought=data.get("thought"),
            action_type=GUIActionType(action_type),
            point=data.get("POINT"),
            to=data.get("to"),
            text=data.get("TYPE"),
            press=data.get("PRESS"),
            duration_ms=data.get("duration_ms", 200),
            status=data.get("STATUS"),
        )
    
    def get_normalized_point(self) -> Optional[NormalizedCoordinate]:
        """获取归一化坐标点
        
        Returns:
            NormalizedCoordinate 或 None
        """
        if self.point and len(self.point) == 2:
            return NormalizedCoordinate(x=self.point[0], y=self.point[1])
        return None
    
    def to_absolute_point(self, screen_width: int, screen_height: int) -> Optional[tuple[int, int]]:
        """转换为绝对坐标
        
        Args:
            screen_width: 屏幕宽度
            screen_height: 屏幕高度
            
        Returns:
            (x, y) 绝对坐标或 None
        """
        norm_point = self.get_normalized_point()
        if norm_point:
            return norm_point.to_absolute(screen_width, screen_height)
        return None
    
    def validate_action(self) -> List[str]:
        """验证动作是否合法
        
        Returns:
            错误消息列表，为空表示合法
        """
        errors = []
        
        if self.action_type == GUIActionType.CLICK:
            if not self.point:
                errors.append("Click action requires 'point'")
        elif self.action_type == GUIActionType.LONG_PRESS:
            if not self.point:
                errors.append("Long press action requires 'point'")
        elif self.action_type == GUIActionType.SWIPE:
            if not self.point:
                errors.append("Swipe action requires 'point'")
            if not self.to:
                errors.append("Swipe action requires 'to' (direction or target)")
        elif self.action_type == GUIActionType.TYPE:
            if not self.text:
                errors.append("Type action requires 'text'")
        elif self.action_type == GUIActionType.PRESS:
            if not self.press:
                errors.append("Press action requires 'press' (HOME/BACK/ENTER)")
        elif self.action_type == GUIActionType.STATUS:
            if not self.status:
                errors.append("Status action requires 'status'")
        
        return errors


# JSON Schema 常量
GUI_ACTION_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "thought": {"type": "string", "description": "思考过程"},
        "action_type": {
            "type": "string",
            "enum": ["click", "long_press", "swipe", "type", "press", "wait", "status"],
            "description": "动作类型"
        },
        "POINT": {
            "$ref": "#/$defs/Location",
            "description": "点击坐标 [x, y]，范围 0-1000"
        },
        "to": {
            "oneOf": [
                {"enum": ["up", "down", "left", "right"], "description": "滑动方向"},
                {"$ref": "#/$defs/Location", "description": "滑动目标坐标"}
            ]
        },
        "TYPE": {"type": "string", "description": "输入文本"},
        "PRESS": {"enum": ["HOME", "BACK", "ENTER"], "description": "特殊按键"},
        "duration_ms": {"type": "integer", "default": 200, "description": "执行时间（毫秒）"},
        "STATUS": {
            "enum": ["continue", "finish", "satisfied", "impossible", "interrupt", "need_feedback"],
            "description": "任务状态"
        },
    },
    "required": ["action_type"],
    "$defs": {
        "Location": {
            "type": "array",
            "items": {"type": "integer", "minimum": 0, "maximum": 1000},
            "minItems": 2,
            "maxItems": 2,
            "description": "归一化坐标 [x, y]"
        }
    }
}


# 常用动作状态枚举
class ActionStatus(str, Enum):
    """动作状态枚举 - 映射到 STATUS 字段"""
    CONTINUE = "continue"           # 继续执行
    FINISH = "finish"               # 任务完成
    SATISFIED = "satisfied"         # 用户满意
    IMPOSSIBLE = "impossible"       # 任务不可能完成
    INTERRUPT = "interrupt"         # 需要中断
    NEED_FEEDBACK = "need_feedback" # 需要用户反馈
