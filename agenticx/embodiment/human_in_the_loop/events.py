"""人机协作事件定义"""

from typing import Dict, Any, Optional
from datetime import datetime
from pydantic import Field

from agenticx.core.event import Event
from .models import HumanInterventionRequest, HumanFeedback


class HumanInterventionRequestedEvent(Event):
    """人工干预请求事件
    
    当智能体遇到低置信度决策时发出此事件，请求人工协助。
    """
    
    @classmethod
    def create(cls, request: HumanInterventionRequest, context: Dict[str, Any], 
               screenshot_data: Optional[str] = None, urgency_level: str = "normal", **kwargs):
        return cls(
            type="human_intervention_requested",
            data={
                "request": request.model_dump(),
                "context": context,
                "screenshot_data": screenshot_data,
                "urgency_level": urgency_level
            },
            **kwargs
        )
    
    @property
    def request(self) -> HumanInterventionRequest:
        return HumanInterventionRequest(**self.data["request"])
    
    @property
    def context(self) -> Dict[str, Any]:
        return self.data["context"]
    
    @property
    def screenshot_data(self) -> Optional[str]:
        return self.data.get("screenshot_data")
    
    @property
    def urgency_level(self) -> str:
        return self.data.get("urgency_level", "normal")


class HumanFeedbackReceivedEvent(Event):
    """人工反馈接收事件
    
    当人工专家提供反馈时发出此事件。
    """
    
    @classmethod
    def create(cls, feedback: HumanFeedback, processing_time: float, 
               expert_confidence: float, **kwargs):
        return cls(
            type="human_feedback_received",
            data={
                "feedback": feedback.model_dump(),
                "processing_time": processing_time,
                "expert_confidence": expert_confidence
            },
            **kwargs
        )
    
    @property
    def feedback(self) -> HumanFeedback:
        return HumanFeedback(**self.data["feedback"])
    
    @property
    def processing_time(self) -> float:
        return self.data["processing_time"]
    
    @property
    def expert_confidence(self) -> float:
        return self.data["expert_confidence"]


class InterventionStatusChangedEvent(Event):
    """干预状态变更事件
    
    当干预请求状态发生变化时发出此事件。
    """
    
    @classmethod
    def create(cls, request_id: str, old_status: str, new_status: str, 
               changed_by: str, reason: Optional[str] = None, **kwargs):
        return cls(
            type="intervention_status_changed",
            data={
                "request_id": request_id,
                "old_status": old_status,
                "new_status": new_status,
                "changed_by": changed_by,
                "reason": reason
            },
            **kwargs
        )
    
    @property
    def request_id(self) -> str:
        return self.data["request_id"]
    
    @property
    def old_status(self) -> str:
        return self.data["old_status"]
    
    @property
    def new_status(self) -> str:
        return self.data["new_status"]
    
    @property
    def changed_by(self) -> str:
        return self.data["changed_by"]
    
    @property
    def reason(self) -> Optional[str]:
        return self.data.get("reason")


class LearningDataGeneratedEvent(Event):
    """学习数据生成事件
    
    当反馈被转换为学习数据时发出此事件。
    """
    
    @classmethod
    def create(cls, trajectory_id: str, feedback_id: str, agent_id: str, 
               data_quality_score: float, **kwargs):
        return cls(
            type="learning_data_generated",
            data={
                "trajectory_id": trajectory_id,
                "feedback_id": feedback_id,
                "agent_id": agent_id,
                "data_quality_score": data_quality_score
            },
            **kwargs
        )
    
    @property
    def trajectory_id(self) -> str:
        return self.data["trajectory_id"]
    
    @property
    def feedback_id(self) -> str:
        return self.data["feedback_id"]
    
    @property
    def learning_agent_id(self) -> str:
        return self.data["agent_id"]
    
    @property
    def data_quality_score(self) -> float:
        return self.data["data_quality_score"]