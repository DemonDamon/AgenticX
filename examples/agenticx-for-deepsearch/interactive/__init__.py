"""Interactive Experience Layer

This module implements interactive experience functionality based on AgenticX, including:
- InteractiveResearchInterface: Interactive research interface
- ProgressTracker: Progress tracker
- RealTimeMonitor: Real-time monitor
- UserFeedbackHandler: User feedback handler

Interactive experience layer based on AgenticX framework, providing real-time research interface and user interaction functionality.
"""

from .research_interface import (
    InteractiveResearchInterface,
    InterfaceEvent,
    UserInteraction,
    ResearchProgress
)
from .progress_tracker import (
    ProgressTracker,
    ProgressPhase,
    ProgressStatus,
    PhaseProgress,
    IterationProgress,
    OverallProgress
)
from .real_time_monitor import (
    RealTimeMonitor,
    MonitorLevel,
    MetricType,
    SystemMetrics,
    PerformanceMetrics,
    BusinessMetrics,
    QualityMetrics,
    AlertRule,
    Alert
)
from .user_feedback_handler import (
    UserFeedbackHandler,
    FeedbackType,
    FeedbackTarget,
    FeedbackPriority,
    FeedbackStatus,
    UserFeedback,
    FeedbackSummary,
    UserPreference,
    InteractionEvent
)

__all__ = [
    # Main components
    "InteractiveResearchInterface",
    "ProgressTracker", 
    "RealTimeMonitor",
    "UserFeedbackHandler",
    
    # Research interface related
    "InterfaceEvent",
    "UserInteraction",
    "ResearchProgress",
    
    # Progress tracking related
    "ProgressPhase",
    "ProgressStatus",
    "PhaseProgress",
    "IterationProgress",
    "OverallProgress",
    
    # Real-time monitoring related
    "MonitorLevel",
    "MetricType",
    "SystemMetrics",
    "PerformanceMetrics",
    "BusinessMetrics",
    "QualityMetrics",
    "AlertRule",
    "Alert",
    
    # User feedback related
    "FeedbackType",
    "FeedbackTarget",
    "FeedbackPriority",
    "FeedbackStatus",
    "UserFeedback",
    "FeedbackSummary",
    "UserPreference",
    "InteractionEvent"
]