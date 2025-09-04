"""User Feedback Handler based on AgenticX

This module implements UserFeedbackHandler, responsible for handling user feedback and interactions,
strictly following the observability design of the AgenticX framework.
"""

from typing import Dict, List, Any, Optional, Callable, Union
from datetime import datetime, timedelta
import asyncio
import uuid
from dataclasses import dataclass, field
from enum import Enum
import json
from collections import defaultdict, deque
from agenticx.observability import BaseCallbackHandler, CallbackManager
from models import SearchResult, ResearchIteration, ResearchContext


class FeedbackType(Enum):
    """Feedback types"""
    RATING = "rating"                    # Rating feedback
    COMMENT = "comment"                  # Comment feedback
    SUGGESTION = "suggestion"            # Suggestion feedback
    COMPLAINT = "complaint"              # Complaint feedback
    QUESTION = "question"                # Question feedback
    PREFERENCE = "preference"            # Preference settings
    CORRECTION = "correction"            # Correction feedback
    APPROVAL = "approval"                # Approval feedback
    REJECTION = "rejection"              # Rejection feedback


class FeedbackTarget(Enum):
    """Feedback targets"""
    SEARCH_RESULT = "search_result"      # Search results
    RESEARCH_ITERATION = "research_iteration"  # Research iteration
    REPORT_SECTION = "report_section"    # Report section
    OVERALL_EXPERIENCE = "overall_experience"  # Overall experience
    SYSTEM_PERFORMANCE = "system_performance"  # System performance
    INTERFACE_USABILITY = "interface_usability"  # Interface usability
    CONTENT_QUALITY = "content_quality"  # Content quality
    RESEARCH_DIRECTION = "research_direction"  # Research direction


class FeedbackPriority(Enum):
    """Feedback priority levels"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    URGENT = "urgent"


class FeedbackStatus(Enum):
    """Feedback status"""
    PENDING = "pending"          # Pending
    PROCESSING = "processing"    # Processing
    PROCESSED = "processed"      # Processed
    APPLIED = "applied"          # Applied
    REJECTED = "rejected"        # Rejected
    ARCHIVED = "archived"        # Archived


@dataclass
class UserFeedback:
    """User feedback"""
    id: str
    user_id: str
    session_id: str
    feedback_type: FeedbackType
    target: FeedbackTarget
    target_id: Optional[str] = None
    content: str = ""
    rating: Optional[float] = None  # 1-5 rating
    priority: FeedbackPriority = FeedbackPriority.MEDIUM
    status: FeedbackStatus = FeedbackStatus.PENDING
    timestamp: datetime = field(default_factory=datetime.now)
    processed_at: Optional[datetime] = None
    response: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    tags: List[str] = field(default_factory=list)


@dataclass
class FeedbackSummary:
    """Feedback summary"""
    total_feedback: int
    average_rating: float
    feedback_by_type: Dict[str, int]
    feedback_by_target: Dict[str, int]
    recent_feedback: List[UserFeedback]
    trending_issues: List[str]
    satisfaction_score: float
    response_time_avg: float  # Average response time (hours)


@dataclass
class UserPreference:
    """User preferences"""
    user_id: str
    search_preferences: Dict[str, Any] = field(default_factory=dict)
    display_preferences: Dict[str, Any] = field(default_factory=dict)
    notification_preferences: Dict[str, Any] = field(default_factory=dict)
    research_preferences: Dict[str, Any] = field(default_factory=dict)
    updated_at: datetime = field(default_factory=datetime.now)


@dataclass
class InteractionEvent:
    """Interaction event"""
    id: str
    user_id: str
    session_id: str
    event_type: str
    event_data: Dict[str, Any]
    timestamp: datetime = field(default_factory=datetime.now)
    duration: Optional[float] = None  # Event duration (seconds)


class UserFeedbackHandler(BaseCallbackHandler):
    """User feedback handler
    
    Based on agenticx.observability.BaseCallbackHandler implementation, provides:
    1. User feedback collection and processing
    2. User preference management
    3. Interaction event tracking
    4. Feedback analysis and insights
    5. Automated responses and improvement suggestions
    """
    
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        
        # Feedback storage
        self.feedback_storage: Dict[str, UserFeedback] = {}
        self.feedback_by_user: Dict[str, List[str]] = defaultdict(list)
        self.feedback_by_session: Dict[str, List[str]] = defaultdict(list)
        self.feedback_by_target: Dict[FeedbackTarget, List[str]] = defaultdict(list)
        
        # User preferences
        self.user_preferences: Dict[str, UserPreference] = {}
        
        # Interaction events
        self.interaction_events: deque = deque(maxlen=10000)
        self.events_by_user: Dict[str, List[str]] = defaultdict(list)
        
        # Feedback processors
        self.feedback_processors: Dict[FeedbackType, Callable] = {}
        self.auto_response_rules: List[Dict[str, Any]] = []
        
        # Analytics data
        self.feedback_analytics: Dict[str, Any] = {
            "total_feedback": 0,
            "ratings_sum": 0.0,
            "ratings_count": 0,
            "response_times": deque(maxlen=1000)
        }
        
        # Callback functions
        self.feedback_callbacks: List[Callable] = []
        self.preference_callbacks: List[Callable] = []
        
        # Configuration
        self.auto_response_enabled = True
        self.feedback_retention_days = 90
        self.max_feedback_per_user = 1000
        
        # Initialize default processors
        self._setup_default_processors()
        self._setup_default_auto_responses()
    
    async def submit_feedback(self, user_id: str, session_id: str,
                            feedback_type: FeedbackType, target: FeedbackTarget,
                            content: str = "", rating: Optional[float] = None,
                            target_id: Optional[str] = None,
                            priority: FeedbackPriority = FeedbackPriority.MEDIUM,
                            metadata: Optional[Dict[str, Any]] = None,
                            tags: Optional[List[str]] = None) -> str:
        """Submit user feedback"""
        feedback_id = str(uuid.uuid4())
        
        feedback = UserFeedback(
            id=feedback_id,
            user_id=user_id,
            session_id=session_id,
            feedback_type=feedback_type,
            target=target,
            target_id=target_id,
            content=content,
            rating=rating,
            priority=priority,
            metadata=metadata or {},
            tags=tags or []
        )
        
        # Store feedback
        self.feedback_storage[feedback_id] = feedback
        self.feedback_by_user[user_id].append(feedback_id)
        self.feedback_by_session[session_id].append(feedback_id)
        self.feedback_by_target[target].append(feedback_id)
        
        # Update analytics data
        self.feedback_analytics["total_feedback"] += 1
        if rating is not None:
            self.feedback_analytics["ratings_sum"] += rating
            self.feedback_analytics["ratings_count"] += 1
        
        # Process feedback
        await self._process_feedback(feedback)
        
        # Notify callbacks
        await self._notify_feedback_submitted(feedback)
        
        return feedback_id
    
    async def update_feedback_status(self, feedback_id: str, 
                                   status: FeedbackStatus,
                                   response: Optional[str] = None) -> bool:
        """Update feedback status"""
        if feedback_id not in self.feedback_storage:
            return False
        
        feedback = self.feedback_storage[feedback_id]
        old_status = feedback.status
        
        feedback.status = status
        if response:
            feedback.response = response
        
        if status in [FeedbackStatus.PROCESSED, FeedbackStatus.APPLIED, FeedbackStatus.REJECTED]:
            feedback.processed_at = datetime.now()
            
            # Calculate response time
            response_time = (feedback.processed_at - feedback.timestamp).total_seconds() / 3600
            self.feedback_analytics["response_times"].append(response_time)
        
        # Notify status change
        await self._notify_feedback_status_changed(feedback, old_status)
        
        return True
    
    async def get_user_feedback(self, user_id: str, 
                              limit: Optional[int] = None,
                              feedback_type: Optional[FeedbackType] = None,
                              target: Optional[FeedbackTarget] = None) -> List[UserFeedback]:
        """Get user feedback"""
        feedback_ids = self.feedback_by_user.get(user_id, [])
        feedback_list = [self.feedback_storage[fid] for fid in feedback_ids 
                        if fid in self.feedback_storage]
        
        # Apply filters
        if feedback_type:
            feedback_list = [f for f in feedback_list if f.feedback_type == feedback_type]
        
        if target:
            feedback_list = [f for f in feedback_list if f.target == target]
        
        # Sort by time
        feedback_list.sort(key=lambda x: x.timestamp, reverse=True)
        
        # Limit count
        if limit:
            feedback_list = feedback_list[:limit]
        
        return feedback_list
    
    async def get_session_feedback(self, session_id: str) -> List[UserFeedback]:
        """Get session feedback"""
        feedback_ids = self.feedback_by_session.get(session_id, [])
        feedback_list = [self.feedback_storage[fid] for fid in feedback_ids 
                        if fid in self.feedback_storage]
        
        feedback_list.sort(key=lambda x: x.timestamp, reverse=True)
        return feedback_list
    
    async def get_feedback_summary(self, time_range: Optional[timedelta] = None) -> FeedbackSummary:
        """Get feedback summary"""
        if time_range is None:
            time_range = timedelta(days=7)
        
        cutoff_time = datetime.now() - time_range
        
        # Filter feedback within time range
        recent_feedback = [
            feedback for feedback in self.feedback_storage.values()
            if feedback.timestamp >= cutoff_time
        ]
        
        # Calculate statistics
        total_feedback = len(recent_feedback)
        
        # Average rating
        ratings = [f.rating for f in recent_feedback if f.rating is not None]
        average_rating = sum(ratings) / len(ratings) if ratings else 0.0
        
        # Group by type
        feedback_by_type = defaultdict(int)
        for feedback in recent_feedback:
            feedback_by_type[feedback.feedback_type.value] += 1
        
        # Group by target
        feedback_by_target = defaultdict(int)
        for feedback in recent_feedback:
            feedback_by_target[feedback.target.value] += 1
        
        # Recent feedback
        recent_feedback.sort(key=lambda x: x.timestamp, reverse=True)
        recent_feedback_list = recent_feedback[:10]
        
        # Trending issues
        trending_issues = self._identify_trending_issues(recent_feedback)
        
        # Satisfaction score
        satisfaction_score = self._calculate_satisfaction_score(recent_feedback)
        
        # Average response time
        response_times = list(self.feedback_analytics["response_times"])
        response_time_avg = sum(response_times) / len(response_times) if response_times else 0.0
        
        return FeedbackSummary(
            total_feedback=total_feedback,
            average_rating=average_rating,
            feedback_by_type=dict(feedback_by_type),
            feedback_by_target=dict(feedback_by_target),
            recent_feedback=recent_feedback_list,
            trending_issues=trending_issues,
            satisfaction_score=satisfaction_score,
            response_time_avg=response_time_avg
        )
    
    async def update_user_preferences(self, user_id: str, 
                                    preferences: Dict[str, Any],
                                    preference_type: str = "general") -> None:
        """Update user preferences"""
        if user_id not in self.user_preferences:
            self.user_preferences[user_id] = UserPreference(user_id=user_id)
        
        user_pref = self.user_preferences[user_id]
        
        if preference_type == "search":
            user_pref.search_preferences.update(preferences)
        elif preference_type == "display":
            user_pref.display_preferences.update(preferences)
        elif preference_type == "notification":
            user_pref.notification_preferences.update(preferences)
        elif preference_type == "research":
            user_pref.research_preferences.update(preferences)
        else:
            # General preference settings
            for key, value in preferences.items():
                if hasattr(user_pref, key):
                    setattr(user_pref, key, value)
        
        user_pref.updated_at = datetime.now()
        
        # Notify preference update
        await self._notify_preferences_updated(user_id, preference_type, preferences)
    
    async def get_user_preferences(self, user_id: str) -> Optional[UserPreference]:
        """Get user preferences"""
        return self.user_preferences.get(user_id)
    
    async def track_interaction(self, user_id: str, session_id: str,
                              event_type: str, event_data: Dict[str, Any],
                              duration: Optional[float] = None) -> str:
        """Track user interaction"""
        event_id = str(uuid.uuid4())
        
        interaction = InteractionEvent(
            id=event_id,
            user_id=user_id,
            session_id=session_id,
            event_type=event_type,
            event_data=event_data,
            duration=duration
        )
        
        self.interaction_events.append(interaction)
        self.events_by_user[user_id].append(event_id)
        
        # Analyze interaction patterns
        await self._analyze_interaction_patterns(user_id, interaction)
        
        return event_id
    
    async def get_user_interactions(self, user_id: str, 
                                  limit: Optional[int] = None,
                                  event_type: Optional[str] = None) -> List[InteractionEvent]:
        """Get user interaction records"""
        user_events = [
            event for event in self.interaction_events
            if event.user_id == user_id
        ]
        
        if event_type:
            user_events = [e for e in user_events if e.event_type == event_type]
        
        user_events.sort(key=lambda x: x.timestamp, reverse=True)
        
        if limit:
            user_events = user_events[:limit]
        
        return user_events
    
    def register_feedback_processor(self, feedback_type: FeedbackType, 
                                  processor: Callable) -> None:
        """Register feedback processor"""
        self.feedback_processors[feedback_type] = processor
    
    def add_auto_response_rule(self, rule: Dict[str, Any]) -> None:
        """Add auto response rule"""
        self.auto_response_rules.append(rule)
    
    def register_feedback_callback(self, callback: Callable) -> None:
        """Register feedback callback"""
        self.feedback_callbacks.append(callback)
    
    def register_preference_callback(self, callback: Callable) -> None:
        """Register preference callback"""
        self.preference_callbacks.append(callback)
    
    async def generate_improvement_suggestions(self, 
                                             time_range: Optional[timedelta] = None) -> List[Dict[str, Any]]:
        """Generate improvement suggestions"""
        if time_range is None:
            time_range = timedelta(days=30)
        
        cutoff_time = datetime.now() - time_range
        
        # Analyze feedback data
        recent_feedback = [
            feedback for feedback in self.feedback_storage.values()
            if feedback.timestamp >= cutoff_time
        ]
        
        suggestions = []
        
        # Suggestions based on ratings
        low_rating_feedback = [f for f in recent_feedback 
                              if f.rating is not None and f.rating < 3.0]
        
        if low_rating_feedback:
            common_issues = self._analyze_common_issues(low_rating_feedback)
            for issue, count in common_issues.items():
                suggestions.append({
                    "type": "quality_improvement",
                    "priority": "high" if count > 5 else "medium",
                    "description": f"Improve {issue} related functionality",
                    "affected_users": count,
                    "evidence": [f.id for f in low_rating_feedback if issue in f.content.lower()]
                })
        
        # Suggestions based on complaints
        complaints = [f for f in recent_feedback 
                     if f.feedback_type == FeedbackType.COMPLAINT]
        
        if complaints:
            complaint_categories = self._categorize_complaints(complaints)
            for category, items in complaint_categories.items():
                suggestions.append({
                    "type": "issue_resolution",
                    "priority": "urgent" if len(items) > 3 else "high",
                    "description": f"Resolve {category} related issues",
                    "affected_users": len(set(f.user_id for f in items)),
                    "evidence": [f.id for f in items]
                })
        
        # Improvements based on suggestions
        suggestions_feedback = [f for f in recent_feedback 
                               if f.feedback_type == FeedbackType.SUGGESTION]
        
        if suggestions_feedback:
            popular_suggestions = self._identify_popular_suggestions(suggestions_feedback)
            for suggestion, support in popular_suggestions.items():
                suggestions.append({
                    "type": "feature_enhancement",
                    "priority": "medium" if support > 2 else "low",
                    "description": suggestion,
                    "user_support": support,
                    "evidence": [f.id for f in suggestions_feedback if suggestion in f.content]
                })
        
        # Sort by priority
        priority_order = {"urgent": 0, "high": 1, "medium": 2, "low": 3}
        suggestions.sort(key=lambda x: priority_order.get(x["priority"], 4))
        
        return suggestions
    
    # User interaction tracking methods
    async def track_event_interaction(self, user_id: str, session_id: str, 
                                    event_type: str, event_data: Dict[str, Any]) -> None:
        """Track event-related user interactions"""
        await self.track_interaction(user_id, session_id, event_type, event_data)
    
    # Private methods
    async def _process_feedback(self, feedback: UserFeedback) -> None:
        """Process feedback"""
        # Use registered processors
        if feedback.feedback_type in self.feedback_processors:
            processor = self.feedback_processors[feedback.feedback_type]
            try:
                if asyncio.iscoroutinefunction(processor):
                    await processor(feedback)
                else:
                    processor(feedback)
            except Exception as e:
                print(f"Feedback processor execution failed: {e}")
        
        # Auto response
        if self.auto_response_enabled:
            await self._apply_auto_response_rules(feedback)
        
        # Update status
        feedback.status = FeedbackStatus.PROCESSING
    
    async def _apply_auto_response_rules(self, feedback: UserFeedback) -> None:
        """Apply auto response rules"""
        for rule in self.auto_response_rules:
            if self._matches_rule(feedback, rule):
                response = rule.get("response", "")
                status = FeedbackStatus[rule.get("status", "PROCESSED")]
                
                await self.update_feedback_status(feedback.id, status, response)
                break
    
    def _matches_rule(self, feedback: UserFeedback, rule: Dict[str, Any]) -> bool:
        """Check if feedback matches rule"""
        # Check feedback type
        if "feedback_type" in rule:
            if feedback.feedback_type.value != rule["feedback_type"]:
                return False
        
        # Check target
        if "target" in rule:
            if feedback.target.value != rule["target"]:
                return False
        
        # Check rating range
        if "rating_range" in rule and feedback.rating is not None:
            min_rating, max_rating = rule["rating_range"]
            if not (min_rating <= feedback.rating <= max_rating):
                return False
        
        # Check keywords
        if "keywords" in rule:
            keywords = rule["keywords"]
            content_lower = feedback.content.lower()
            if not any(keyword.lower() in content_lower for keyword in keywords):
                return False
        
        return True
    
    def _setup_default_processors(self) -> None:
        """Setup default processors"""
        async def rating_processor(feedback: UserFeedback):
            if feedback.rating is not None and feedback.rating <= 2.0:
                feedback.priority = FeedbackPriority.HIGH
        
        async def complaint_processor(feedback: UserFeedback):
            feedback.priority = FeedbackPriority.HIGH
        
        async def suggestion_processor(feedback: UserFeedback):
            # Analyze suggestion feasibility
            pass
        
        self.feedback_processors[FeedbackType.RATING] = rating_processor
        self.feedback_processors[FeedbackType.COMPLAINT] = complaint_processor
        self.feedback_processors[FeedbackType.SUGGESTION] = suggestion_processor
    
    def _setup_default_auto_responses(self) -> None:
        """Setup default auto responses"""
        self.auto_response_rules = [
            {
                "feedback_type": "rating",
                "rating_range": [4.0, 5.0],
                "response": "Thank you for your positive feedback! We will continue to work hard to provide quality service.",
                "status": "PROCESSED"
            },
            {
                "feedback_type": "rating",
                "rating_range": [1.0, 2.0],
                "response": "We are very sorry for the poor experience. We will take your feedback seriously and improve as soon as possible.",
                "status": "PROCESSING"
            },
            {
                "feedback_type": "question",
                "response": "Thank you for your question. We will provide you with a detailed answer as soon as possible.",
                "status": "PROCESSING"
            }
        ]
    
    def _identify_trending_issues(self, feedback_list: List[UserFeedback]) -> List[str]:
        """Identify trending issues"""
        # Simple keyword frequency analysis
        word_counts = defaultdict(int)
        
        for feedback in feedback_list:
            if feedback.feedback_type in [FeedbackType.COMPLAINT, FeedbackType.SUGGESTION]:
                words = feedback.content.lower().split()
                for word in words:
                    if len(word) > 3:  # Ignore short words
                        word_counts[word] += 1
        
        # Return most frequent words
        trending = sorted(word_counts.items(), key=lambda x: x[1], reverse=True)
        return [word for word, count in trending[:5] if count > 2]
    
    def _calculate_satisfaction_score(self, feedback_list: List[UserFeedback]) -> float:
        """Calculate satisfaction score"""
        ratings = [f.rating for f in feedback_list if f.rating is not None]
        
        if not ratings:
            return 0.0
        
        # Base rating
        avg_rating = sum(ratings) / len(ratings)
        base_score = (avg_rating / 5.0) * 100
        
        # Adjustment factors
        complaint_ratio = len([f for f in feedback_list 
                              if f.feedback_type == FeedbackType.COMPLAINT]) / len(feedback_list)
        
        suggestion_ratio = len([f for f in feedback_list 
                               if f.feedback_type == FeedbackType.SUGGESTION]) / len(feedback_list)
        
        # Complaints reduce satisfaction, suggestions indicate high user engagement
        adjustment = -complaint_ratio * 20 + suggestion_ratio * 5
        
        return max(0, min(100, base_score + adjustment))
    
    def _analyze_common_issues(self, feedback_list: List[UserFeedback]) -> Dict[str, int]:
        """Analyze common issues"""
        issues = defaultdict(int)
        
        # Predefined issue categories
        issue_keywords = {
            "Performance": ["slow", "lag", "delay", "response", "speed"],
            "Accuracy": ["error", "inaccurate", "wrong", "incorrect"],
            "Interface": ["interface", "UI", "display", "layout", "design"],
            "Functionality": ["function", "feature", "operation", "usage"],
            "Search": ["search", "find", "result", "relevance"]
        }
        
        for feedback in feedback_list:
            content_lower = feedback.content.lower()
            for issue, keywords in issue_keywords.items():
                if any(keyword in content_lower for keyword in keywords):
                    issues[issue] += 1
        
        return dict(issues)
    
    def _categorize_complaints(self, complaints: List[UserFeedback]) -> Dict[str, List[UserFeedback]]:
        """Categorize complaints"""
        categories = defaultdict(list)
        
        category_keywords = {
            "System Error": ["error", "bug", "crash", "exception"],
            "Performance Issue": ["slow", "lag", "delay", "timeout"],
            "Result Quality": ["inaccurate", "irrelevant", "poor quality"],
            "User Experience": ["difficult", "complex", "unfriendly", "confusing"]
        }
        
        for complaint in complaints:
            content_lower = complaint.content.lower()
            categorized = False
            
            for category, keywords in category_keywords.items():
                if any(keyword in content_lower for keyword in keywords):
                    categories[category].append(complaint)
                    categorized = True
                    break
            
            if not categorized:
                categories["Other"].append(complaint)
        
        return dict(categories)
    
    def _identify_popular_suggestions(self, suggestions: List[UserFeedback]) -> Dict[str, int]:
        """Identify popular suggestions"""
        suggestion_counts = defaultdict(int)
        
        # Simplified suggestion aggregation
        for suggestion in suggestions:
            # Extract key phrases (simplified processing)
            content = suggestion.content.lower()
            if "add" in content or "increase" in content:
                suggestion_counts["Add new features"] += 1
            elif "improve" in content or "optimize" in content:
                suggestion_counts["Improve existing features"] += 1
            elif "interface" in content or "UI" in content:
                suggestion_counts["Improve user interface"] += 1
            elif "search" in content:
                suggestion_counts["Improve search functionality"] += 1
            else:
                suggestion_counts["Other suggestions"] += 1
        
        return dict(suggestion_counts)
    
    async def _analyze_interaction_patterns(self, user_id: str, 
                                          interaction: InteractionEvent) -> None:
        """Analyze interaction patterns"""
        # Get user's recent interactions
        recent_interactions = await self.get_user_interactions(user_id, limit=10)
        
        # Analyze patterns (more complex analysis logic can be implemented here)
        # For example: detect if user is having difficulties, usage habits, etc.
        pass
    
    # BaseCallbackHandler interface implementation
    def on_agent_start(self, agent, **kwargs):
        """Callback when agent starts"""
        pass
    
    def on_agent_end(self, agent, **kwargs):
        """Callback when agent ends"""
        # Can request user feedback after agent ends
        pass
    
    def on_task_start(self, agent, task):
        """Callback when task starts"""
        pass
    
    def on_task_end(self, agent, task, result):
        """Callback when task ends"""
        # Can request user feedback after task ends
        pass
    
    def on_error(self, error: Exception, context: Dict[str, Any]):
        """Callback when error occurs"""
        # Can collect user feedback after error occurs
        pass
    
    async def _notify_feedback_submitted(self, feedback: UserFeedback) -> None:
        """Notify feedback submission"""
        notification_data = {
            "event_type": "feedback_submitted",
            "feedback_id": feedback.id,
            "user_id": feedback.user_id,
            "feedback_type": feedback.feedback_type.value,
            "target": feedback.target.value,
            "priority": feedback.priority.value,
            "timestamp": feedback.timestamp.isoformat()
        }
        
        await self._notify_callbacks(self.feedback_callbacks, notification_data)
    
    async def _notify_feedback_status_changed(self, feedback: UserFeedback, 
                                            old_status: FeedbackStatus) -> None:
        """Notify feedback status change"""
        notification_data = {
            "event_type": "feedback_status_changed",
            "feedback_id": feedback.id,
            "old_status": old_status.value,
            "new_status": feedback.status.value,
            "response": feedback.response,
            "timestamp": datetime.now().isoformat()
        }
        
        await self._notify_callbacks(self.feedback_callbacks, notification_data)
    
    async def _notify_preferences_updated(self, user_id: str, 
                                        preference_type: str,
                                        preferences: Dict[str, Any]) -> None:
        """Notify preference update"""
        notification_data = {
            "event_type": "preferences_updated",
            "user_id": user_id,
            "preference_type": preference_type,
            "preferences": preferences,
            "timestamp": datetime.now().isoformat()
        }
        
        await self._notify_callbacks(self.preference_callbacks, notification_data)
    
    async def _notify_callbacks(self, callbacks: List[Callable], 
                              data: Dict[str, Any]) -> None:
        """Notify callback functions"""
        for callback in callbacks:
            try:
                if asyncio.iscoroutinefunction(callback):
                    await callback(data)
                else:
                    callback(data)
            except Exception as e:
                print(f"Callback execution failed: {e}")