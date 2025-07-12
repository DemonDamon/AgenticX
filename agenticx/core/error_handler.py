"""
M5 的 ErrorHandler 系统实现了 ErrorClassifier, CircuitBreaker, ErrorHandler 三个组件，
分别用于分类错误、熔断错误和处理错误。

M5 的 ErrorHandler 将异常转化为 Agent “看得懂”的 ErrorEvent，使其有机会进行自我修复，
这是微观层面的自适应
"""

from typing import Optional, Dict, Any, List, Callable
from abc import ABC, abstractmethod
import traceback
import time
from .event import ErrorEvent, HumanRequestEvent, AnyEvent


class ErrorClassifier:
    """
    Classifies errors into different categories for appropriate handling.
    """
    
    def __init__(self):
        self.error_patterns = {
            "tool_error": ["Tool", "tool", "function", "execute"],
            "parsing_error": ["JSON", "parse", "format", "schema"],
            "llm_error": ["LLM", "model", "API", "rate", "quota"],
            "network_error": ["network", "connection", "timeout", "HTTP"],
            "validation_error": ["validation", "invalid", "required", "missing", "ValueError"],
            "permission_error": ["permission", "access", "unauthorized", "forbidden"]
        }
    
    def classify(self, error: Exception) -> str:
        """
        Classify an error into a category.
        
        Args:
            error: The exception to classify
            
        Returns:
            Error category string
        """
        error_str = str(error).lower()
        error_type = type(error).__name__.lower()
        
        for category, patterns in self.error_patterns.items():
            if any(pattern.lower() in error_str or pattern.lower() in error_type for pattern in patterns):
                return category
        
        return "unknown_error"
    
    def is_recoverable(self, error: Exception) -> bool:
        """
        Determine if an error is recoverable.
        
        Args:
            error: The exception to check
            
        Returns:
            True if the error is potentially recoverable
        """
        category = self.classify(error)
        
        # These error types are generally recoverable
        recoverable_categories = {
            "tool_error", 
            "parsing_error", 
            "network_error", 
            "validation_error"
        }
        
        # These are generally not recoverable
        non_recoverable_categories = {
            "permission_error"
        }
        
        if category in non_recoverable_categories:
            return False
        
        if category in recoverable_categories:
            return True
        
        # For unknown errors, be conservative but allow some recovery attempts
        return True


class CircuitBreaker:
    """
    Implements the circuit breaker pattern to prevent infinite error loops.
    """
    
    def __init__(self, failure_threshold: int = 3, recovery_timeout: int = 60):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.failure_count = 0
        self.last_failure_time = 0
        self.state = "closed"  # closed, open, half_open
    
    def call(self, func: Callable, *args, **kwargs):
        """
        Call a function through the circuit breaker.
        
        Args:
            func: Function to call
            *args: Function arguments
            **kwargs: Function keyword arguments
            
        Returns:
            Function result
            
        Raises:
            CircuitBreakerOpenError: If circuit breaker is open
        """
        if self.state == "open":
            if time.time() - self.last_failure_time > self.recovery_timeout:
                self.state = "half_open"
            else:
                raise CircuitBreakerOpenError("Circuit breaker is open")
        
        try:
            result = func(*args, **kwargs)
            self.on_success()
            return result
        except Exception as e:
            self.on_failure()
            raise e
    
    def on_success(self):
        """Handle successful call."""
        self.failure_count = 0
        self.state = "closed"
    
    def on_failure(self):
        """Handle failed call."""
        self.failure_count += 1
        self.last_failure_time = time.time()
        
        if self.failure_count >= self.failure_threshold:
            self.state = "open"
    
    def reset(self):
        """Reset the circuit breaker."""
        self.failure_count = 0
        self.last_failure_time = 0
        self.state = "closed"


class CircuitBreakerOpenError(Exception):
    """Exception raised when circuit breaker is open."""
    pass


class ErrorHandler:
    """
    Intelligent error handler that implements the "Compact Errors" principle
    from 12-Factor Agents. Converts exceptions into clean events and manages
    recovery strategies.
    """
    
    def __init__(self, max_consecutive_errors: int = 3):
        self.classifier = ErrorClassifier()
        self.circuit_breaker = CircuitBreaker(failure_threshold=max_consecutive_errors)
        self.consecutive_errors = 0
        self.max_consecutive_errors = max_consecutive_errors
        self.error_history: List[ErrorEvent] = []
    
    def handle(self, error: Exception, context: Optional[Dict[str, Any]] = None) -> ErrorEvent:
        """
        Handle an exception by converting it to a clean ErrorEvent.
        
        Args:
            error: The exception to handle
            context: Additional context about where the error occurred
            
        Returns:
            ErrorEvent with cleaned error information
        """
        # Classify the error
        error_type = self.classifier.classify(error)
        is_recoverable = self.classifier.is_recoverable(error)
        
        # Create a clean, human-readable error message
        clean_message = self._clean_error_message(error, error_type)
        
        # Create error event
        error_event = ErrorEvent(
            error_type=error_type,
            error_message=clean_message,
            recoverable=is_recoverable,
            data={
                "original_error": str(error),
                "error_class": type(error).__name__,
                "context": context or {}
            }
        )
        
        # Track error history
        self.error_history.append(error_event)
        
        # Update consecutive error count
        if is_recoverable:
            self.consecutive_errors += 1
        else:
            # Non-recoverable errors break the circuit immediately
            self.consecutive_errors = self.max_consecutive_errors
        
        # Check if we should trigger circuit breaker
        if self.consecutive_errors >= self.max_consecutive_errors:
            error_event.recoverable = False
            error_event.data["circuit_breaker_triggered"] = True
        
        return error_event
    
    def _clean_error_message(self, error: Exception, error_type: str) -> str:
        """
        Convert a raw exception into a clean, actionable error message.
        
        Args:
            error: The original exception
            error_type: The classified error type
            
        Returns:
            Clean error message
        """
        error_str = str(error)
        
        # Handle different error types with specific cleaning strategies
        if error_type == "tool_error":
            if "required" in error_str.lower():
                return f"Tool call failed: Missing required parameter. {error_str}"
            elif "invalid" in error_str.lower():
                return f"Tool call failed: Invalid parameter value. {error_str}"
            else:
                return f"Tool execution failed: {error_str}"
        
        elif error_type == "parsing_error":
            if "json" in error_str.lower():
                return f"Failed to parse JSON response. Please ensure your response is valid JSON format."
            else:
                return f"Failed to parse response: {error_str}"
        
        elif error_type == "llm_error":
            if "rate" in error_str.lower() or "quota" in error_str.lower():
                return f"LLM API rate limit exceeded. Please wait before retrying."
            elif "timeout" in error_str.lower():
                return f"LLM API request timed out. Please try again."
            else:
                return f"LLM API error: {error_str}"
        
        elif error_type == "network_error":
            return f"Network connection failed: {error_str}"
        
        elif error_type == "validation_error":
            return f"Data validation failed: {error_str}"
        
        elif error_type == "permission_error":
            return f"Access denied: {error_str}"
        
        else:
            # For unknown errors, provide the original message but clean it up
            return f"Unexpected error: {error_str}"
    
    def should_request_human_help(self) -> bool:
        """
        Determine if we should request human help based on error patterns.
        
        Returns:
            True if human help should be requested
        """
        return self.consecutive_errors >= self.max_consecutive_errors
    
    def create_human_help_request(self, recent_errors: List[ErrorEvent]) -> HumanRequestEvent:
        """
        Create a human help request based on recent errors.
        
        Args:
            recent_errors: List of recent error events
            
        Returns:
            HumanRequestEvent requesting help
        """
        if not recent_errors:
            question = "I'm encountering repeated errors and need assistance."
        else:
            error_summary = self._summarize_errors(recent_errors)
            question = f"I'm stuck due to repeated errors: {error_summary}. Can you help me resolve this or provide an alternative approach?"
        
        return HumanRequestEvent(
            question=question,
            context=f"Consecutive errors: {self.consecutive_errors}",
            urgency="high" if self.consecutive_errors >= self.max_consecutive_errors else "medium"
        )
    
    def _summarize_errors(self, errors: List[ErrorEvent]) -> str:
        """
        Create a concise summary of multiple errors.
        
        Args:
            errors: List of error events to summarize
            
        Returns:
            Concise error summary
        """
        if not errors:
            return "No specific errors"
        
        # Group errors by type
        error_types = {}
        for error in errors[-5:]:  # Only look at last 5 errors
            error_type = error.error_type
            if error_type not in error_types:
                error_types[error_type] = []
            error_types[error_type].append(error.error_message)
        
        # Create summary
        summary_parts = []
        for error_type, messages in error_types.items():
            if len(messages) == 1:
                summary_parts.append(f"{error_type}: {messages[0]}")
            else:
                summary_parts.append(f"{error_type} ({len(messages)} times): {messages[-1]}")
        
        return "; ".join(summary_parts)
    
    def reset(self):
        """Reset the error handler state."""
        self.consecutive_errors = 0
        self.circuit_breaker.reset()
        self.error_history.clear()
    
    def get_error_stats(self) -> Dict[str, Any]:
        """
        Get statistics about handled errors.
        
        Returns:
            Dictionary with error statistics
        """
        if not self.error_history:
            return {"total_errors": 0, "consecutive_errors": 0}
        
        error_types = {}
        for error in self.error_history:
            error_type = error.error_type
            error_types[error_type] = error_types.get(error_type, 0) + 1
        
        return {
            "total_errors": len(self.error_history),
            "consecutive_errors": self.consecutive_errors,
            "error_types": error_types,
            "circuit_breaker_state": self.circuit_breaker.state
        } 