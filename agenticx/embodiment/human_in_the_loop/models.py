"""人机协作数据模型定义"""

from typing import Dict, List, Optional, Literal, Any
from uuid import uuid4
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict

from agenticx.embodiment.core.models import GUIAction


class HumanInterventionRequest(BaseModel):
    """人工干预请求数据模型"""
    
    request_id: str = Field(default_factory=lambda: str(uuid4()))
    agent_id: str = Field(..., description="智能体唯一标识")
    task_id: Optional[str] = Field(None, description="任务ID")
    intervention_type: Literal["validation", "correction", "demonstration"] = Field(
        ..., description="干预类型"
    )
    context: Dict[str, Any] = Field(..., description="智能体当前上下文")
    screenshot: Optional[str] = Field(None, description="屏幕截图base64编码")
    description: str = Field(..., description="问题描述")
    confidence_score: float = Field(..., ge=0, le=1, description="置信度分数")
    priority: Literal["low", "medium", "high"] = Field("medium", description="优先级")
    status: Literal["pending", "processing", "completed", "cancelled"] = Field(
        "pending", description="请求状态"
    )
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
    
    model_config = ConfigDict(
        json_encoders={
            datetime: lambda v: v.isoformat()
        }
    )


class HumanFeedback(BaseModel):
    """人工反馈数据模型"""
    
    feedback_id: str = Field(default_factory=lambda: str(uuid4()))
    request_id: str = Field(..., description="对应的干预请求ID")
    expert_id: str = Field(..., description="专家用户ID")
    feedback_type: Literal["validation", "correction", "demonstration"] = Field(
        ..., description="反馈类型"
    )
    approved: Optional[bool] = Field(None, description="是否批准(验证类型)")
    corrected_actions: Optional[List[GUIAction]] = Field(
        None, description="修正的动作序列"
    )
    demonstration_steps: Optional[List[Dict[str, Any]]] = Field(
        None, description="演示步骤"
    )
    confidence: float = Field(..., ge=0, le=1, description="反馈置信度")
    notes: Optional[str] = Field(None, description="备注说明")
    submitted_at: datetime = Field(default_factory=datetime.now)
    
    model_config = ConfigDict(
        json_encoders={
            datetime: lambda v: v.isoformat()
        }
    )


class TrajectoryData(BaseModel):
    """轨迹数据模型"""
    
    trajectory_id: str = Field(default_factory=lambda: str(uuid4()))
    feedback_id: str = Field(..., description="对应的反馈ID")
    agent_id: str = Field(..., description="智能体ID")
    state_before: Dict[str, Any] = Field(..., description="动作前状态")
    action_taken: Dict[str, Any] = Field(..., description="执行的动作")
    state_after: Dict[str, Any] = Field(..., description="动作后状态")
    reward: float = Field(..., description="奖励信号")
    created_at: datetime = Field(default_factory=datetime.now)
    
    model_config = ConfigDict(
        json_encoders={
            datetime: lambda v: v.isoformat()
        }
    )


class InterventionMetrics(BaseModel):
    """干预指标数据模型"""
    
    total_requests: int = Field(0, description="总请求数")
    pending_requests: int = Field(0, description="待处理请求数")
    completed_requests: int = Field(0, description="已完成请求数")
    average_response_time: float = Field(0.0, description="平均响应时间(秒)")
    success_rate: float = Field(0.0, ge=0, le=1, description="成功率")
    expert_utilization: Dict[str, float] = Field(
        default_factory=dict, description="专家利用率"
    )
    updated_at: datetime = Field(default_factory=datetime.now)
    
    model_config = ConfigDict(
        json_encoders={
            datetime: lambda v: v.isoformat()
        }
    )