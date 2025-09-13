"""Edge Case Handler Component

This module implements the EdgeCaseHandler component that identifies, analyzes,
and handles edge cases in GUI automation to improve robustness and reliability.
"""

from typing import List, Dict, Any, Optional, Tuple, Set, Union
from pydantic import BaseModel, Field
from datetime import datetime, timedelta, UTC
from collections import defaultdict, Counter
from dataclasses import dataclass
import json
import statistics
from enum import Enum
import hashlib
import re

from agenticx.core.component import Component
from agenticx.memory.component import MemoryComponent
from agenticx.embodiment.core.models import GUITask, ScreenState, InteractionElement


class EdgeCaseType(str, Enum):
    """Types of edge cases that can be detected."""
    UI_ELEMENT_MISSING = "ui_element_missing"
    UNEXPECTED_DIALOG = "unexpected_dialog"
    SLOW_RESPONSE = "slow_response"
    NETWORK_ERROR = "network_error"
    PERMISSION_DENIED = "permission_denied"
    APPLICATION_CRASH = "application_crash"
    LAYOUT_CHANGE = "layout_change"
    DATA_VALIDATION_ERROR = "data_validation_error"
    TIMEOUT_ERROR = "timeout_error"
    AUTHENTICATION_FAILURE = "authentication_failure"
    RESOURCE_UNAVAILABLE = "resource_unavailable"
    UNEXPECTED_BEHAVIOR = "unexpected_behavior"


class EdgeCaseSeverity(str, Enum):
    """Severity levels for edge cases."""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class EdgeCaseStatus(str, Enum):
    """Status of edge case handling."""
    DETECTED = "detected"
    ANALYZING = "analyzing"
    HANDLED = "handled"
    UNRESOLVED = "unresolved"
    MONITORING = "monitoring"


class EdgeCase(BaseModel):
    """Represents an edge case occurrence."""
    
    case_id: str = Field(description="Unique identifier for the edge case")
    case_type: EdgeCaseType = Field(description="Type of edge case")
    severity: EdgeCaseSeverity = Field(description="Severity level")
    status: EdgeCaseStatus = Field(default=EdgeCaseStatus.DETECTED, description="Current status")
    task_id: Optional[str] = Field(default=None, description="Related task ID")
    application: str = Field(description="Application where edge case occurred")
    context: Dict[str, Any] = Field(default_factory=dict, description="Context when edge case occurred")
    error_details: Dict[str, Any] = Field(default_factory=dict, description="Detailed error information")
    screen_state: Optional[Dict[str, Any]] = Field(default=None, description="Screen state when edge case occurred")
    user_action: Optional[str] = Field(default=None, description="User action that triggered the edge case")
    frequency: int = Field(default=1, description="How often this edge case has occurred")
    first_occurrence: datetime = Field(default_factory=datetime.now)
    last_occurrence: datetime = Field(default_factory=datetime.now)
    resolution_attempts: List[Dict[str, Any]] = Field(default_factory=list, description="Attempts to resolve the edge case")
    success_rate: float = Field(default=0.0, description="Success rate of resolution attempts")
    impact_score: float = Field(default=0.0, description="Impact score on user experience")
    tags: List[str] = Field(default_factory=list, description="Tags for categorization")
    related_cases: List[str] = Field(default_factory=list, description="IDs of related edge cases")


class HandlingStrategy(BaseModel):
    """Represents a strategy for handling edge cases."""
    
    strategy_id: str = Field(description="Unique identifier for the strategy")
    name: str = Field(description="Human-readable name")
    description: str = Field(description="Description of the strategy")
    applicable_types: List[EdgeCaseType] = Field(description="Edge case types this strategy can handle")
    priority: int = Field(default=1, description="Priority level (1-10)")
    success_rate: float = Field(default=0.0, description="Historical success rate")
    execution_time: float = Field(default=0.0, description="Average execution time")
    prerequisites: List[str] = Field(default_factory=list, description="Prerequisites for using this strategy")
    parameters: Dict[str, Any] = Field(default_factory=dict, description="Strategy parameters")
    implementation_steps: List[str] = Field(default_factory=list, description="Steps to implement the strategy")
    fallback_strategies: List[str] = Field(default_factory=list, description="Fallback strategy IDs")
    created_at: datetime = Field(default_factory=datetime.now)
    last_updated: datetime = Field(default_factory=datetime.now)


class EdgeCasePattern(BaseModel):
    """Represents a pattern of edge cases."""
    
    pattern_id: str = Field(description="Unique identifier for the pattern")
    name: str = Field(description="Human-readable name")
    description: str = Field(description="Description of the pattern")
    case_types: List[EdgeCaseType] = Field(description="Types of edge cases in this pattern")
    trigger_conditions: List[str] = Field(description="Conditions that trigger this pattern")
    frequency: int = Field(default=1, description="How often this pattern occurs")
    applications: List[str] = Field(description="Applications where this pattern is observed")
    temporal_pattern: Optional[str] = Field(default=None, description="Temporal pattern (e.g., 'weekends', 'peak_hours')")
    environmental_factors: Dict[str, Any] = Field(default_factory=dict, description="Environmental factors")
    prevention_strategies: List[str] = Field(default_factory=list, description="Strategies to prevent this pattern")
    mitigation_strategies: List[str] = Field(default_factory=list, description="Strategies to mitigate this pattern")
    confidence_score: float = Field(default=0.0, description="Confidence in pattern identification")
    created_at: datetime = Field(default_factory=datetime.now)
    last_updated: datetime = Field(default_factory=datetime.now)


class EdgeCaseConfig(BaseModel):
    """Configuration for edge case handling."""
    
    detection_sensitivity: float = Field(default=0.7, description="Sensitivity for edge case detection")
    max_resolution_attempts: int = Field(default=3, description="Maximum resolution attempts per edge case")
    timeout_threshold: float = Field(default=30.0, description="Timeout threshold in seconds")
    pattern_detection_window_days: int = Field(default=7, description="Window for pattern detection")
    min_pattern_frequency: int = Field(default=3, description="Minimum frequency to consider a pattern")
    enable_auto_resolution: bool = Field(default=True, description="Enable automatic resolution")
    enable_learning: bool = Field(default=True, description="Enable learning from edge cases")
    severity_escalation_threshold: int = Field(default=5, description="Threshold for severity escalation")
    notification_threshold: EdgeCaseSeverity = Field(default=EdgeCaseSeverity.HIGH, description="Threshold for notifications")
    max_stored_cases: int = Field(default=1000, description="Maximum number of stored edge cases")


class EdgeCaseHandler(Component):
    """Edge Case Handler Component
    
    Identifies, analyzes, and handles edge cases in GUI automation to improve
    robustness and reliability of automated tasks.
    """
    
    def __init__(self, name: Optional[str] = None, **kwargs):
        """Initialize the EdgeCaseHandler.
        
        Args:
            name: Optional component name
            **kwargs: Additional configuration options
        """
        super().__init__(name=name, **kwargs)
        self._config = EdgeCaseConfig(**kwargs.get('edge_case_config', {}))
        self._edge_cases: Dict[str, EdgeCase] = {}
        self._handling_strategies: Dict[str, HandlingStrategy] = {}
        self._patterns: Dict[str, EdgeCasePattern] = {}
        self._resolution_history: List[Dict[str, Any]] = []
        
        # Initialize default strategies
        self._initialize_default_strategies()
    
    async def detect_edge_case(self, 
                             task: GUITask,
                             context: Dict[str, Any],
                             error_info: Optional[Dict[str, Any]] = None,
                             screen_state: Optional[ScreenState] = None) -> Optional[EdgeCase]:
        """Detect if an edge case has occurred.
        
        Args:
            task: The GUI task being executed
            context: Current execution context
            error_info: Optional error information
            screen_state: Optional current screen state
            
        Returns:
            EdgeCase object if detected, None otherwise
        """
        # Analyze context and error information to detect edge cases
        case_type = await self._classify_edge_case(task, context, error_info, screen_state)
        
        if case_type:
            # Create edge case record
            edge_case = await self._create_edge_case(
                case_type=case_type,
                task=task,
                context=context,
                error_info=error_info,
                screen_state=screen_state
            )
            
            # Store the edge case
            self._edge_cases[edge_case.case_id] = edge_case
            
            # Update patterns
            await self._update_patterns(edge_case)
            
            return edge_case
        
        return None
    
    async def handle_edge_case(self, 
                             edge_case: EdgeCase,
                             task: GUITask,
                             context: Dict[str, Any]) -> Dict[str, Any]:
        """Handle a detected edge case.
        
        Args:
            edge_case: The edge case to handle
            task: The GUI task being executed
            context: Current execution context
            
        Returns:
            Result of handling the edge case
        """
        # Find applicable strategies
        strategies = await self._find_applicable_strategies(edge_case)
        
        if not strategies:
            return {
                'success': False,
                'error': 'No applicable strategies found',
                'edge_case_id': edge_case.case_id
            }
        
        # Try strategies in order of priority
        for strategy in strategies:
            try:
                edge_case.status = EdgeCaseStatus.ANALYZING
                
                result = await self._execute_strategy(strategy, edge_case, task, context)
                
                # Record resolution attempt
                attempt = {
                    'strategy_id': strategy.strategy_id,
                    'timestamp': datetime.now(),
                    'success': result.get('success', False),
                    'details': result
                }
                edge_case.resolution_attempts.append(attempt)
                
                if result.get('success', False):
                    edge_case.status = EdgeCaseStatus.HANDLED
                    await self._update_strategy_success_rate(strategy.strategy_id, True)
                    
                    # Learn from successful resolution
                    if self._config.enable_learning:
                        await self._learn_from_resolution(edge_case, strategy, result)
                    
                    return result
                else:
                    await self._update_strategy_success_rate(strategy.strategy_id, False)
                    
                    # If this was the last strategy, mark as unresolved
                    if strategy == strategies[-1]:
                        edge_case.status = EdgeCaseStatus.UNRESOLVED
                        await self._escalate_edge_case(edge_case)
            
            except Exception as e:
                # Log strategy execution error
                attempt = {
                    'strategy_id': strategy.strategy_id,
                    'timestamp': datetime.now(),
                    'success': False,
                    'error': str(e)
                }
                edge_case.resolution_attempts.append(attempt)
                continue
        
        # All strategies failed
        edge_case.status = EdgeCaseStatus.UNRESOLVED
        await self._escalate_edge_case(edge_case)
        
        return {
            'success': False,
            'error': 'All resolution strategies failed',
            'edge_case_id': edge_case.case_id,
            'attempts': len(edge_case.resolution_attempts)
        }
    
    async def analyze_edge_case_patterns(self, 
                                       memory: MemoryComponent,
                                       time_window_days: Optional[int] = None) -> List[EdgeCasePattern]:
        """Analyze patterns in edge cases.
        
        Args:
            memory: Memory component for historical data
            time_window_days: Optional time window for analysis
            
        Returns:
            List of identified patterns
        """
        if time_window_days is None:
            time_window_days = self._config.pattern_detection_window_days
        
        # Get recent edge cases
        cutoff_date = datetime.now() - timedelta(days=time_window_days)
        recent_cases = [
            case for case in self._edge_cases.values()
            if case.last_occurrence >= cutoff_date
        ]
        
        # Group cases by various criteria
        patterns = []
        
        # Pattern by application and case type
        app_type_groups = defaultdict(list)
        for case in recent_cases:
            key = f"{case.application}_{case.case_type}"
            app_type_groups[key].append(case)
        
        for group_key, group_cases in app_type_groups.items():
            if len(group_cases) >= self._config.min_pattern_frequency:
                pattern = await self._create_pattern_from_group(group_key, group_cases, "app_type")
                if pattern:
                    patterns.append(pattern)
        
        # Pattern by temporal factors
        temporal_patterns = await self._analyze_temporal_patterns(recent_cases)
        patterns.extend(temporal_patterns)
        
        # Pattern by context similarity
        context_patterns = await self._analyze_context_patterns(recent_cases)
        patterns.extend(context_patterns)
        
        # Store patterns
        for pattern in patterns:
            self._patterns[pattern.pattern_id] = pattern
        
        return patterns
    
    async def predict_edge_cases(self, 
                               task: GUITask,
                               context: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Predict potential edge cases for a task.
        
        Args:
            task: The GUI task to analyze
            context: Current execution context
            
        Returns:
            List of potential edge cases with probabilities
        """
        predictions = []
        
        # Check against known patterns
        for pattern in self._patterns.values():
            probability = await self._calculate_edge_case_probability(pattern, task, context)
            
            if probability > self._config.detection_sensitivity:
                prediction = {
                    'pattern_id': pattern.pattern_id,
                    'case_types': pattern.case_types,
                    'probability': probability,
                    'prevention_strategies': pattern.prevention_strategies,
                    'mitigation_strategies': pattern.mitigation_strategies
                }
                predictions.append(prediction)
        
        # Sort by probability
        predictions.sort(key=lambda p: p['probability'], reverse=True)
        
        return predictions
    
    async def get_prevention_recommendations(self, 
                                           task: GUITask,
                                           context: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Get recommendations to prevent edge cases.
        
        Args:
            task: The GUI task to analyze
            context: Current execution context
            
        Returns:
            List of prevention recommendations
        """
        recommendations = []
        
        # Get edge case predictions
        predictions = await self.predict_edge_cases(task, context)
        
        for prediction in predictions:
            if prediction['probability'] > 0.5:  # High probability
                for strategy_id in prediction['prevention_strategies']:
                    if strategy_id in self._handling_strategies:
                        strategy = self._handling_strategies[strategy_id]
                        
                        recommendation = {
                            'type': 'prevention',
                            'strategy': strategy.name,
                            'description': strategy.description,
                            'probability_reduction': prediction['probability'] * 0.7,
                            'implementation_steps': strategy.implementation_steps,
                            'priority': strategy.priority
                        }
                        recommendations.append(recommendation)
        
        # Add general prevention recommendations
        general_recommendations = await self._get_general_prevention_recommendations(task, context)
        recommendations.extend(general_recommendations)
        
        # Sort by priority and probability reduction
        recommendations.sort(
            key=lambda r: (r.get('priority', 1), r.get('probability_reduction', 0)),
            reverse=True
        )
        
        return recommendations
    
    async def get_edge_case_insights(self, 
                                   time_range: Optional[Tuple[datetime, datetime]] = None) -> Dict[str, Any]:
        """Get insights about edge cases and their handling.
        
        Args:
            time_range: Optional time range for analysis
            
        Returns:
            Dictionary containing edge case insights
        """
        # Filter edge cases by time range
        cases_to_analyze = list(self._edge_cases.values())
        if time_range:
            start_time, end_time = time_range
            cases_to_analyze = [
                case for case in cases_to_analyze
                if start_time <= case.last_occurrence <= end_time
            ]
        
        insights = {
            'summary': await self._generate_summary_insights(cases_to_analyze),
            'trends': await self._analyze_trends(cases_to_analyze),
            'patterns': await self._analyze_pattern_insights(),
            'strategies': await self._analyze_strategy_effectiveness(),
            'recommendations': await self._generate_improvement_recommendations()
        }
        
        return insights
    
    async def _classify_edge_case(self, 
                                task: GUITask,
                                context: Dict[str, Any],
                                error_info: Optional[Dict[str, Any]],
                                screen_state: Optional[ScreenState]) -> Optional[EdgeCaseType]:
        """Classify the type of edge case based on available information."""
        if error_info:
            error_message = error_info.get('message', '').lower()
            error_type = error_info.get('type', '').lower()
            
            # Network-related errors
            if any(keyword in error_message for keyword in ['network', 'connection', 'timeout', 'unreachable']):
                return EdgeCaseType.NETWORK_ERROR
            
            # Permission errors
            if any(keyword in error_message for keyword in ['permission', 'access denied', 'unauthorized']):
                return EdgeCaseType.PERMISSION_DENIED
            
            # Authentication errors
            if any(keyword in error_message for keyword in ['authentication', 'login', 'credentials']):
                return EdgeCaseType.AUTHENTICATION_FAILURE
            
            # Timeout errors
            if 'timeout' in error_message or error_type == 'timeout':
                return EdgeCaseType.TIMEOUT_ERROR
            
            # Element not found
            if any(keyword in error_message for keyword in ['element not found', 'no such element']):
                return EdgeCaseType.UI_ELEMENT_MISSING
            
            # Application crash
            if any(keyword in error_message for keyword in ['crash', 'application error', 'fatal error']):
                return EdgeCaseType.APPLICATION_CRASH
        
        # Check context for other indicators
        if context:
            execution_time = context.get('execution_time', 0)
            if execution_time > self._config.timeout_threshold:
                return EdgeCaseType.SLOW_RESPONSE
            
            # Check for unexpected dialogs
            if context.get('unexpected_dialog', False):
                return EdgeCaseType.UNEXPECTED_DIALOG
            
            # Check for layout changes
            if context.get('layout_changed', False):
                return EdgeCaseType.LAYOUT_CHANGE
        
        # Check screen state
        if screen_state:
            # This would analyze the screen state for anomalies
            # For now, return None if no clear classification
            pass
        
        return None
    
    async def _create_edge_case(self, 
                              case_type: EdgeCaseType,
                              task: GUITask,
                              context: Dict[str, Any],
                              error_info: Optional[Dict[str, Any]],
                              screen_state: Optional[ScreenState]) -> EdgeCase:
        """Create an edge case record."""
        # Generate unique case ID
        case_data = f"{case_type}_{task.target_application}_{datetime.now().isoformat()}"
        case_id = hashlib.md5(case_data.encode()).hexdigest()[:12]
        
        # Determine severity
        severity = await self._determine_severity(case_type, context, error_info)
        
        # Calculate impact score
        impact_score = await self._calculate_impact_score(case_type, task, context)
        
        # Extract relevant context
        relevant_context = {
            'task_type': type(task).__name__,
            'target_application': task.target_application,
            'execution_time': context.get('execution_time', 0),
            'user_id': context.get('user_id'),
            'session_id': context.get('session_id')
        }
        
        edge_case = EdgeCase(
            case_id=case_id,
            case_type=case_type,
            severity=severity,
            task_id=task.id,
            application=task.target_application or "Unknown",
            context=relevant_context,
            error_details=error_info or {},
            screen_state=screen_state.model_dump() if screen_state else None,
            user_action=context.get('user_action'),
            impact_score=impact_score
        )
        
        return edge_case
    
    async def _determine_severity(self, 
                                case_type: EdgeCaseType,
                                context: Dict[str, Any],
                                error_info: Optional[Dict[str, Any]]) -> EdgeCaseSeverity:
        """Determine the severity of an edge case."""
        # Critical cases
        if case_type in [EdgeCaseType.APPLICATION_CRASH, EdgeCaseType.AUTHENTICATION_FAILURE]:
            return EdgeCaseSeverity.CRITICAL
        
        # High severity cases
        if case_type in [EdgeCaseType.PERMISSION_DENIED, EdgeCaseType.NETWORK_ERROR]:
            return EdgeCaseSeverity.HIGH
        
        # Medium severity cases
        if case_type in [EdgeCaseType.UI_ELEMENT_MISSING, EdgeCaseType.TIMEOUT_ERROR]:
            return EdgeCaseSeverity.MEDIUM
        
        # Check context for severity indicators
        if context:
            execution_time = context.get('execution_time', 0)
            if execution_time > 60:  # More than 1 minute
                return EdgeCaseSeverity.HIGH
            elif execution_time > 30:  # More than 30 seconds
                return EdgeCaseSeverity.MEDIUM
        
        return EdgeCaseSeverity.LOW
    
    async def _calculate_impact_score(self, 
                                    case_type: EdgeCaseType,
                                    task: GUITask,
                                    context: Dict[str, Any]) -> float:
        """Calculate the impact score of an edge case."""
        base_score = {
            EdgeCaseType.APPLICATION_CRASH: 1.0,
            EdgeCaseType.AUTHENTICATION_FAILURE: 0.9,
            EdgeCaseType.PERMISSION_DENIED: 0.8,
            EdgeCaseType.NETWORK_ERROR: 0.7,
            EdgeCaseType.TIMEOUT_ERROR: 0.6,
            EdgeCaseType.UI_ELEMENT_MISSING: 0.5,
            EdgeCaseType.SLOW_RESPONSE: 0.4,
            EdgeCaseType.UNEXPECTED_DIALOG: 0.3,
            EdgeCaseType.LAYOUT_CHANGE: 0.2
        }.get(case_type, 0.1)
        
        # Adjust based on task importance
        task_importance = getattr(task, 'metadata', {}).get('importance', 0.5) if hasattr(task, 'metadata') else 0.5
        
        # Adjust based on user impact
        user_impact = context.get('user_impact', 0.5)
        
        impact_score = base_score * (0.5 + 0.3 * task_importance + 0.2 * user_impact)
        
        return min(impact_score, 1.0)
    
    async def _find_applicable_strategies(self, edge_case: EdgeCase) -> List[HandlingStrategy]:
        """Find strategies applicable to an edge case."""
        applicable_strategies = []
        
        for strategy in self._handling_strategies.values():
            if edge_case.case_type in strategy.applicable_types:
                applicable_strategies.append(strategy)
        
        # Sort by priority and success rate
        applicable_strategies.sort(
            key=lambda s: (s.priority, s.success_rate),
            reverse=True
        )
        
        return applicable_strategies
    
    async def _execute_strategy(self, 
                              strategy: HandlingStrategy,
                              edge_case: EdgeCase,
                              task: GUITask,
                              context: Dict[str, Any]) -> Dict[str, Any]:
        """Execute a handling strategy."""
        # This is a simplified implementation
        # In practice, this would implement specific strategy logic
        
        strategy_result = {
            'success': True,
            'strategy_id': strategy.strategy_id,
            'execution_time': strategy.execution_time,
            'details': f"Executed {strategy.name} for {edge_case.case_type}"
        }
        
        # Simulate strategy execution based on historical success rate
        import random
        if random.random() > strategy.success_rate:
            strategy_result['success'] = False
            strategy_result['error'] = "Strategy execution failed"
        
        return strategy_result
    
    async def _update_strategy_success_rate(self, strategy_id: str, success: bool):
        """Update the success rate of a strategy."""
        if strategy_id in self._handling_strategies:
            strategy = self._handling_strategies[strategy_id]
            
            # Simple moving average update
            current_rate = strategy.success_rate
            new_rate = current_rate * 0.9 + (1.0 if success else 0.0) * 0.1
            strategy.success_rate = new_rate
            strategy.last_updated = datetime.now()
    
    async def _learn_from_resolution(self, 
                                   edge_case: EdgeCase,
                                   strategy: HandlingStrategy,
                                   result: Dict[str, Any]):
        """Learn from successful edge case resolution."""
        # Record successful resolution for future reference
        learning_record = {
            'edge_case_id': edge_case.case_id,
            'case_type': edge_case.case_type,
            'strategy_id': strategy.strategy_id,
            'success': result.get('success', False),
            'execution_time': result.get('execution_time', 0),
            'timestamp': datetime.now()
        }
        
        self._resolution_history.append(learning_record)
        
        # Update edge case success rate
        successful_attempts = sum(
            1 for attempt in edge_case.resolution_attempts
            if attempt.get('success', False)
        )
        edge_case.success_rate = successful_attempts / len(edge_case.resolution_attempts)
    
    async def _escalate_edge_case(self, edge_case: EdgeCase):
        """Escalate an unresolved edge case."""
        # Increase severity if multiple failures
        if len(edge_case.resolution_attempts) >= self._config.severity_escalation_threshold:
            if edge_case.severity == EdgeCaseSeverity.LOW:
                edge_case.severity = EdgeCaseSeverity.MEDIUM
            elif edge_case.severity == EdgeCaseSeverity.MEDIUM:
                edge_case.severity = EdgeCaseSeverity.HIGH
            elif edge_case.severity == EdgeCaseSeverity.HIGH:
                edge_case.severity = EdgeCaseSeverity.CRITICAL
        
        # Log escalation
        escalation_record = {
            'edge_case_id': edge_case.case_id,
            'old_severity': edge_case.severity,
            'new_severity': edge_case.severity,
            'timestamp': datetime.now(),
            'reason': 'multiple_resolution_failures'
        }
        
        self._resolution_history.append(escalation_record)
    
    async def _update_patterns(self, edge_case: EdgeCase):
        """Update patterns based on a new edge case."""
        # Check if this edge case fits existing patterns
        for pattern in self._patterns.values():
            if await self._edge_case_matches_pattern(edge_case, pattern):
                pattern.frequency += 1
                pattern.last_updated = datetime.now()
                
                if edge_case.application not in pattern.applications:
                    pattern.applications.append(edge_case.application)
    
    async def _edge_case_matches_pattern(self, edge_case: EdgeCase, pattern: EdgeCasePattern) -> bool:
        """Check if an edge case matches a pattern."""
        # Check case type match
        if edge_case.case_type not in pattern.case_types:
            return False
        
        # Check application match
        if edge_case.application not in pattern.applications:
            return False
        
        # Check context similarity
        context_similarity = await self._calculate_context_similarity(
            edge_case.context,
            pattern.environmental_factors
        )
        
        return context_similarity > 0.7
    
    async def _calculate_context_similarity(self, context1: Dict[str, Any], context2: Dict[str, Any]) -> float:
        """Calculate similarity between two contexts."""
        if not context1 or not context2:
            return 0.0
        
        common_keys = set(context1.keys()) & set(context2.keys())
        if not common_keys:
            return 0.0
        
        matches = sum(
            1 for key in common_keys
            if context1[key] == context2[key]
        )
        
        return matches / len(common_keys)
    
    async def _create_pattern_from_group(self, 
                                       group_key: str,
                                       cases: List[EdgeCase],
                                       pattern_type: str) -> Optional[EdgeCasePattern]:
        """Create a pattern from a group of edge cases."""
        if not cases:
            return None
        
        # Extract common characteristics
        case_types = list(set(case.case_type for case in cases))
        applications = list(set(case.application for case in cases))
        
        # Analyze trigger conditions
        trigger_conditions = await self._analyze_trigger_conditions(cases)
        
        # Generate pattern ID
        pattern_data = f"{pattern_type}_{group_key}_{len(cases)}"
        pattern_id = hashlib.md5(pattern_data.encode()).hexdigest()[:12]
        
        pattern = EdgeCasePattern(
            pattern_id=pattern_id,
            name=f"{pattern_type.title()} Pattern: {group_key}",
            description=f"Pattern identified from {len(cases)} edge cases",
            case_types=case_types,
            trigger_conditions=trigger_conditions,
            frequency=len(cases),
            applications=applications,
            confidence_score=min(len(cases) / 10.0, 1.0)  # Higher confidence with more cases
        )
        
        return pattern
    
    async def _analyze_trigger_conditions(self, cases: List[EdgeCase]) -> List[str]:
        """Analyze common trigger conditions from edge cases."""
        conditions = []
        
        # Analyze common context factors
        context_factors = defaultdict(list)
        for case in cases:
            for key, value in case.context.items():
                context_factors[key].append(value)
        
        # Find common patterns
        for key, values in context_factors.items():
            if len(set(values)) == 1:  # All cases have the same value
                conditions.append(f"{key}={values[0]}")
            elif len(set(values)) / len(values) < 0.5:  # Most cases have similar values
                most_common = Counter(values).most_common(1)[0][0]
                conditions.append(f"{key}={most_common}")
        
        return conditions
    
    async def _analyze_temporal_patterns(self, cases: List[EdgeCase]) -> List[EdgeCasePattern]:
        """Analyze temporal patterns in edge cases."""
        patterns = []
        
        # Group by hour of day
        hourly_groups = defaultdict(list)
        for case in cases:
            hour = case.last_occurrence.hour
            hourly_groups[hour].append(case)
        
        # Find peak hours
        for hour, hour_cases in hourly_groups.items():
            if len(hour_cases) >= self._config.min_pattern_frequency:
                pattern = await self._create_temporal_pattern(f"hour_{hour}", hour_cases, "hourly")
                if pattern:
                    patterns.append(pattern)
        
        return patterns
    
    async def _create_temporal_pattern(self, 
                                     time_key: str,
                                     cases: List[EdgeCase],
                                     temporal_type: str) -> Optional[EdgeCasePattern]:
        """Create a temporal pattern from edge cases."""
        if not cases:
            return None
        
        case_types = list(set(case.case_type for case in cases))
        applications = list(set(case.application for case in cases))
        
        pattern_id = f"temporal_{temporal_type}_{time_key}_{len(cases)}"
        
        pattern = EdgeCasePattern(
            pattern_id=pattern_id,
            name=f"Temporal Pattern: {temporal_type} {time_key}",
            description=f"Edge cases occurring during {temporal_type} {time_key}",
            case_types=case_types,
            trigger_conditions=[f"{temporal_type}={time_key}"],
            frequency=len(cases),
            applications=applications,
            temporal_pattern=f"{temporal_type}_{time_key}",
            confidence_score=min(len(cases) / 5.0, 1.0)
        )
        
        return pattern
    
    async def _analyze_context_patterns(self, cases: List[EdgeCase]) -> List[EdgeCasePattern]:
        """Analyze context-based patterns in edge cases."""
        patterns = []
        
        # Group by similar contexts
        context_groups = defaultdict(list)
        for case in cases:
            # Create a context signature
            context_signature = self._create_context_signature(case.context)
            context_groups[context_signature].append(case)
        
        for signature, group_cases in context_groups.items():
            if len(group_cases) >= self._config.min_pattern_frequency:
                pattern = await self._create_pattern_from_group(signature, group_cases, "context")
                if pattern:
                    patterns.append(pattern)
        
        return patterns
    
    def _create_context_signature(self, context: Dict[str, Any]) -> str:
        """Create a signature for context similarity grouping."""
        # Create a simplified signature based on key context factors
        signature_parts = []
        
        for key in ['task_type', 'target_application', 'user_id']:
            if key in context:
                signature_parts.append(f"{key}:{context[key]}")
        
        return "|".join(signature_parts)
    
    async def _calculate_edge_case_probability(self, 
                                             pattern: EdgeCasePattern,
                                             task: GUITask,
                                             context: Dict[str, Any]) -> float:
        """Calculate the probability of an edge case based on a pattern."""
        probability = 0.0
        
        # Check application match
        if task.target_application in pattern.applications:
            probability += 0.4
        
        # Check trigger conditions
        matching_conditions = 0
        for condition in pattern.trigger_conditions:
            if '=' in condition:
                key, value = condition.split('=', 1)
                if context.get(key) == value:
                    matching_conditions += 1
        
        if pattern.trigger_conditions:
            condition_match_ratio = matching_conditions / len(pattern.trigger_conditions)
            probability += condition_match_ratio * 0.4
        
        # Adjust by pattern confidence and frequency
        probability *= pattern.confidence_score
        probability *= min(pattern.frequency / 10.0, 1.0)
        
        return min(probability, 1.0)
    
    async def _get_general_prevention_recommendations(self, 
                                                    task: GUITask,
                                                    context: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Get general prevention recommendations."""
        recommendations = []
        
        # Always recommend timeout handling
        recommendations.append({
            'type': 'prevention',
            'strategy': 'Timeout Handling',
            'description': 'Implement proper timeout handling for all operations',
            'probability_reduction': 0.3,
            'implementation_steps': [
                'Set appropriate timeouts for all operations',
                'Implement graceful timeout handling',
                'Add retry logic with exponential backoff'
            ],
            'priority': 8
        })
        
        # Recommend element validation
        recommendations.append({
            'type': 'prevention',
            'strategy': 'Element Validation',
            'description': 'Validate UI elements before interaction',
            'probability_reduction': 0.4,
            'implementation_steps': [
                'Check element existence before interaction',
                'Validate element state (enabled, visible)',
                'Use multiple selector strategies'
            ],
            'priority': 9
        })
        
        return recommendations
    
    def _initialize_default_strategies(self):
        """Initialize default handling strategies."""
        # Retry strategy
        retry_strategy = HandlingStrategy(
            strategy_id="retry_with_backoff",
            name="Retry with Exponential Backoff",
            description="Retry the operation with exponential backoff",
            applicable_types=[
                EdgeCaseType.NETWORK_ERROR,
                EdgeCaseType.TIMEOUT_ERROR,
                EdgeCaseType.SLOW_RESPONSE
            ],
            priority=8,
            success_rate=0.7,
            execution_time=5.0,
            implementation_steps=[
                "Wait for initial delay",
                "Retry the operation",
                "Double the delay if failed",
                "Repeat until max retries reached"
            ]
        )
        self._handling_strategies[retry_strategy.strategy_id] = retry_strategy
        
        # Element search strategy
        element_search_strategy = HandlingStrategy(
            strategy_id="enhanced_element_search",
            name="Enhanced Element Search",
            description="Use multiple strategies to find missing UI elements",
            applicable_types=[EdgeCaseType.UI_ELEMENT_MISSING],
            priority=9,
            success_rate=0.8,
            execution_time=3.0,
            implementation_steps=[
                "Try alternative selectors",
                "Search in different contexts",
                "Wait for element to appear",
                "Use fuzzy matching"
            ]
        )
        self._handling_strategies[element_search_strategy.strategy_id] = element_search_strategy
        
        # Dialog handling strategy
        dialog_strategy = HandlingStrategy(
            strategy_id="dialog_handler",
            name="Unexpected Dialog Handler",
            description="Handle unexpected dialogs and popups",
            applicable_types=[EdgeCaseType.UNEXPECTED_DIALOG],
            priority=10,
            success_rate=0.9,
            execution_time=2.0,
            implementation_steps=[
                "Detect dialog presence",
                "Identify dialog type",
                "Choose appropriate action (dismiss, accept, etc.)",
                "Continue with original task"
            ]
        )
        self._handling_strategies[dialog_strategy.strategy_id] = dialog_strategy
    
    async def _generate_summary_insights(self, cases: List[EdgeCase]) -> Dict[str, Any]:
        """Generate summary insights from edge cases."""
        if not cases:
            return {}
        
        return {
            'total_cases': len(cases),
            'by_type': dict(Counter(case.case_type for case in cases)),
            'by_severity': dict(Counter(case.severity for case in cases)),
            'by_application': dict(Counter(case.application for case in cases)),
            'avg_impact_score': statistics.mean([case.impact_score for case in cases]) if cases else 0.0,
            'resolution_rate': sum(1 for case in cases if case.status == EdgeCaseStatus.HANDLED) / len(cases)
        }
    
    async def _analyze_trends(self, cases: List[EdgeCase]) -> Dict[str, Any]:
        """Analyze trends in edge cases."""
        # This would implement trend analysis
        # For now, return a simplified structure
        return {
            'frequency_trend': 'stable',
            'severity_trend': 'improving',
            'resolution_trend': 'improving'
        }
    
    async def _analyze_pattern_insights(self) -> Dict[str, Any]:
        """Analyze insights from patterns."""
        return {
            'total_patterns': len(self._patterns),
            'most_common_patterns': [p.name for p in sorted(self._patterns.values(), key=lambda x: x.frequency, reverse=True)[:5]]
        }
    
    async def _analyze_strategy_effectiveness(self) -> Dict[str, Any]:
        """Analyze the effectiveness of handling strategies."""
        if not self._handling_strategies:
            return {}
        
        return {
            'total_strategies': len(self._handling_strategies),
            'avg_success_rate': statistics.mean([s.success_rate for s in self._handling_strategies.values()]) if self._handling_strategies else 0.0,
            'most_effective': max(self._handling_strategies.values(), key=lambda s: s.success_rate).name
        }
    
    async def _generate_improvement_recommendations(self) -> List[Dict[str, Any]]:
        """Generate recommendations for improving edge case handling."""
        recommendations = []
        
        # Analyze strategy gaps
        unhandled_types = set(EdgeCaseType) - set(
            case_type for strategy in self._handling_strategies.values()
            for case_type in strategy.applicable_types
        )
        
        for case_type in unhandled_types:
            recommendations.append({
                'type': 'strategy_gap',
                'description': f"No handling strategy for {case_type}",
                'priority': 'high'
            })
        
        return recommendations