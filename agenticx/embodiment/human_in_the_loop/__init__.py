"""人机协作与持续学习模块

该模块实现了智能体与人类专家的协作机制，包括：
- 人工干预请求和处理
- 反馈收集和质量评估
- 轨迹数据生成和存储
- 持续学习数据准备
"""

from .component import HumanInTheLoopComponent
from .collector import FeedbackCollector
from .events import (
    HumanInterventionRequestedEvent,
    HumanFeedbackReceivedEvent,
    InterventionStatusChangedEvent,
    LearningDataGeneratedEvent
)
from .models import (
    HumanInterventionRequest,
    HumanFeedback,
    TrajectoryData,
    InterventionMetrics
)

# 导入EventBus以便测试使用
from ...core.event_bus import EventBus

__all__ = [
    "HumanInTheLoopComponent",
    "FeedbackCollector",
    "HumanInterventionRequestedEvent",
    "HumanFeedbackReceivedEvent",
    "InterventionStatusChangedEvent",
    "LearningDataGeneratedEvent",
    "HumanInterventionRequest",
    "HumanFeedback",
    "TrajectoryData",
    "InterventionMetrics",
    "EventBus"
]