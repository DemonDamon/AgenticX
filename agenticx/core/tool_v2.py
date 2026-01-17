"""
AgenticX Tool System v2 - Core Tool Infrastructure

This module provides the foundational classes for the AgenticX tool system,
including base tool interface, metadata models, and execution framework.
"""

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Union, Type, TypeVar, Generic, Callable
from enum import Enum
from dataclasses import dataclass, field
from datetime import datetime
import asyncio
import logging
from pydantic import BaseModel, Field, validator, ValidationError  # type: ignore


class ToolStatus(str, Enum):
    """Tool execution status enumeration."""
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    TIMEOUT = "timeout"
    CANCELLED = "cancelled"


class ParameterType(str, Enum):
    """Parameter type enumeration."""
    STRING = "string"
    INTEGER = "integer"
    FLOAT = "float"
    BOOLEAN = "boolean"
    ARRAY = "array"
    OBJECT = "object"
    FILE = "file"
    SECRET = "secret"


class ToolCategory(str, Enum):
    """Tool category enumeration."""
    DATA_ACCESS = "data_access"
    API_INTEGRATION = "api_integration"
    AUTOMATION = "automation"
    ANALYTICS = "analytics"
    COMMUNICATION = "communication"
    DEVELOPMENT = "development"
    SECURITY = "security"
    UTILITY = "utility"


@dataclass
class ToolParameter:
    """Tool parameter metadata."""
    name: str
    type: ParameterType
    description: str
    required: bool = True
    default: Any = None
    enum: Optional[List[Any]] = None
    minimum: Optional[Union[int, float]] = None
    maximum: Optional[Union[int, float]] = None
    pattern: Optional[str] = None
    
    def validate_value(self, value: Any) -> Any:
        """Validate and transform parameter value."""
        if value is None and self.required:
            raise ValueError(f"Parameter '{self.name}' is required")
        
        if value is None and self.default is not None:
            value = self.default
        
        # Type validation and conversion
        if self.type == ParameterType.STRING and not isinstance(value, str):
            value = str(value)
        elif self.type == ParameterType.INTEGER:
            if not isinstance(value, int):
                try:
                    value = int(value)
                except (ValueError, TypeError):
                    raise ValueError(f"Parameter '{self.name}' must be an integer")
        elif self.type == ParameterType.FLOAT:
            if not isinstance(value, (int, float)):
                try:
                    value = float(value)
                except (ValueError, TypeError):
                    raise ValueError(f"Parameter '{self.name}' must be a number")
        elif self.type == ParameterType.BOOLEAN:
            if isinstance(value, str):
                value = value.lower() in ('true', '1', 'yes', 'on')
            else:
                value = bool(value)
        
        # Range validation
        if self.minimum is not None and value < self.minimum:
            raise ValueError(f"Parameter '{self.name}' must be >= {self.minimum}")
        
        if self.maximum is not None and value > self.maximum:
            raise ValueError(f"Parameter '{self.name}' must be <= {self.maximum}")
        
        # Pattern validation
        if self.pattern and isinstance(value, str):
            import re
            if not re.match(self.pattern, value):
                raise ValueError(f"Parameter '{self.name}' does not match pattern '{self.pattern}'")
        
        # Enum validation
        if self.enum and value not in self.enum:
            raise ValueError(f"Parameter '{self.name}' must be one of {self.enum}")
        
        return value


class ToolMetadata(BaseModel):
    """Tool metadata model."""
    name: str = Field(..., description="Tool name", pattern=r"^[a-zA-Z][a-zA-Z0-9_]*$")
    version: str = Field(default="1.0.0", description="Tool version")
    description: str = Field(..., description="Tool description")
    category: ToolCategory = Field(..., description="Tool category")
    author: str = Field(default="AgenticX", description="Tool author")
    tags: List[str] = Field(default_factory=list, description="Tool tags")
    
    # Execution configuration
    timeout: int = Field(default=30, description="Execution timeout in seconds")
    max_retries: int = Field(default=3, description="Maximum retry attempts")
    retry_delay: float = Field(default=1.0, description="Delay between retries in seconds")
    
    # Security configuration
    requires_credentials: bool = Field(default=False, description="Requires credentials")
    allowed_roles: List[str] = Field(default_factory=list, description="Allowed roles")
    sandbox_required: bool = Field(default=False, description="Requires sandbox execution")
    
    # Performance configuration
    rate_limit: Optional[int] = Field(default=None, description="Rate limit per minute")
    cache_ttl: Optional[int] = Field(default=None, description="Cache TTL in seconds")
    
    # Documentation
    documentation_url: Optional[str] = Field(default=None, description="Documentation URL")
    source_url: Optional[str] = Field(default=None, description="Source code URL")
    
    @validator('name')
    def validate_name(cls, v):
        if len(v) < 2 or len(v) > 50:
            raise ValueError('Tool name must be between 2 and 50 characters')
        return v
    
    @validator('timeout')
    def validate_timeout(cls, v):
        if v <= 0:
            raise ValueError('Timeout must be positive')
        return v
    
    @validator('max_retries')
    def validate_retries(cls, v):
        if v < 0:
            raise ValueError('Max retries cannot be negative')
        return v


class ToolResult(BaseModel):
    """Tool execution result model."""
    status: ToolStatus = Field(..., description="Execution status")
    data: Optional[Any] = Field(default=None, description="Result data")
    error: Optional[str] = Field(default=None, description="Error message")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Execution metadata")
    
    # Execution metrics
    execution_time: float = Field(default=0.0, description="Execution time in seconds")
    start_time: datetime = Field(default_factory=datetime.now, description="Start time")
    end_time: Optional[datetime] = Field(default=None, description="End time")
    
    # Resource usage
    memory_usage: Optional[int] = Field(default=None, description="Memory usage in bytes")
    cpu_time: Optional[float] = Field(default=None, description="CPU time in seconds")
    
    def is_success(self) -> bool:
        """Check if execution was successful."""
        return self.status == ToolStatus.SUCCESS
    
    def get_error_message(self) -> Optional[str]:
        """Get error message if execution failed."""
        return self.error
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert result to dictionary."""
        return self.dict()


class ToolContext(BaseModel):
    """Tool execution context."""
    execution_id: str = Field(..., description="Unique execution identifier")
    user_id: Optional[str] = Field(default=None, description="User identifier")
    session_id: Optional[str] = Field(default=None, description="Session identifier")
    tenant_id: Optional[str] = Field(default=None, description="Tenant identifier")
    
    # Runtime configuration
    timeout: Optional[int] = Field(default=None, description="Override timeout")
    max_retries: Optional[int] = Field(default=None, description="Override max retries")
    
    # Security context
    roles: List[str] = Field(default_factory=list, description="User roles")
    permissions: List[str] = Field(default_factory=list, description="User permissions")
    
    # Resource limits
    max_memory: Optional[int] = Field(default=None, description="Memory limit in bytes")
    max_cpu_time: Optional[float] = Field(default=None, description="CPU time limit")
    
    # Custom data
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Custom metadata")


@dataclass
class ValidationFeedback:
    """
    Structured feedback when tool parameter validation fails.
    
    This class captures validation errors from Pydantic and provides
    a structured format for retry mechanisms.
    
    Inspired by Pydantic AI's RetryPromptPart mechanism.
    Source: pydantic-ai/pydantic_ai/_parts_manager.py
    """
    tool_name: str
    errors: List[Dict[str, Any]]  # Pydantic error dictionaries
    original_params: Dict[str, Any]
    retry_count: int = 0
    timestamp: datetime = field(default_factory=datetime.now)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert feedback to dictionary format."""
        return {
            "tool_name": self.tool_name,
            "errors": self.errors,
            "original_params": self.original_params,
            "retry_count": self.retry_count,
            "timestamp": self.timestamp.isoformat()
        }


class ValidationErrorHandler:
    """
    Handler for Pydantic validation errors in tool execution.
    
    This class intercepts ValidationError exceptions and converts them
    into structured feedback that can be used for automatic retry with LLMs.
    
    Inspired by Pydantic AI's error handling in _tool_manager.py
    """
    
    def __init__(self):
        self._logger = logging.getLogger("agenticx.tool.validation")
    
    def handle(
        self, 
        error: ValidationError, 
        tool_name: str, 
        parameters: Dict[str, Any],
        retry_count: int = 0
    ) -> ValidationFeedback:
        """
        Handle a Pydantic validation error.
        
        Args:
            error: The Pydantic ValidationError
            tool_name: Name of the tool being executed
            parameters: Original parameters that failed validation
            retry_count: Current retry attempt number
            
        Returns:
            ValidationFeedback object with structured error information
        """
        errors = []
        for err in error.errors():
            errors.append({
                "loc": err.get("loc", ()),
                "msg": err.get("msg", "Unknown error"),
                "type": err.get("type", "unknown"),
            })
        
        self._logger.warning(
            f"Validation failed for tool '{tool_name}' (retry {retry_count}): "
            f"{len(errors)} error(s)"
        )
        
        return ValidationFeedback(
            tool_name=tool_name,
            errors=errors,
            original_params=parameters,
            retry_count=retry_count
        )


class ValidationErrorTranslator:
    """
    Translates Pydantic validation errors into natural language prompts for LLMs.
    
    This translator converts structured validation errors into human-readable
    messages that help LLMs understand what went wrong and how to fix it.
    
    Inspired by Pydantic AI's retry prompt generation mechanism.
    """
    
    @staticmethod
    def translate(feedback: ValidationFeedback) -> str:
        """
        Translate validation feedback into natural language.
        
        Args:
            feedback: ValidationFeedback object
            
        Returns:
            Natural language description of the validation errors
            
        Example output:
            "Tool 'search_api' parameter validation failed:
             - Field 'query' is required but was not provided.
             - Field 'limit' must be <= 100, but you provided 200.
             Please correct these parameters and try again."
        """
        lines = [f"Tool '{feedback.tool_name}' parameter validation failed:"]
        
        for err in feedback.errors:
            loc = err.get("loc", ())
            msg = err.get("msg", "Unknown error")
            
            # Format location path
            if loc:
                field_path = ".".join(str(part) for part in loc)
                lines.append(f" - Field '{field_path}': {msg}")
            else:
                lines.append(f" - {msg}")
        
        lines.append("\nPlease correct these parameters and try again.")
        
        if feedback.retry_count > 0:
            lines.append(f"(Retry attempt {feedback.retry_count})")
        
        return "\n".join(lines)


T = TypeVar('T')


class BaseTool(ABC, Generic[T]):
    """
    Abstract base class for all AgenticX tools.
    
    This class provides the unified interface for tool execution,
    parameter validation, and lifecycle management.
    """
    
    def __init__(self, metadata: ToolMetadata, enable_auto_retry: bool = False):
        """Initialize tool with metadata."""
        self._metadata = metadata
        self._logger = logging.getLogger(f"agenticx.tool.{metadata.name}")
        self._parameters: Dict[str, ToolParameter] = {}
        self._enable_auto_retry = enable_auto_retry
        self._validation_handler = ValidationErrorHandler()
        self._error_translator = ValidationErrorTranslator()
        self._setup_parameters()
    
    @property
    def metadata(self) -> ToolMetadata:
        """Get tool metadata."""
        return self._metadata
    
    @property
    def name(self) -> str:
        """Get tool name."""
        return self._metadata.name
    
    @property
    def description(self) -> str:
        """Get tool description."""
        return self._metadata.description
    
    @property
    def parameters(self) -> Dict[str, ToolParameter]:
        """Get tool parameters."""
        return self._parameters.copy()
    
    def get_parameter(self, name: str) -> Optional[ToolParameter]:
        """Get specific parameter by name."""
        return self._parameters.get(name)
    
    @abstractmethod
    def _setup_parameters(self) -> None:
        """Setup tool parameters. Must be implemented by subclasses."""
        pass
    
    def validate_parameters(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """Validate input parameters."""
        validated = {}
        errors = []
        
        # Validate provided parameters
        for name, value in parameters.items():
            param = self._parameters.get(name)
            if not param:
                errors.append(f"Unknown parameter: {name}")
                continue
            
            try:
                validated[name] = param.validate_value(value)
            except ValueError as e:
                errors.append(str(e))
        
        # Check required parameters
        for name, param in self._parameters.items():
            if param.required and name not in validated:
                if param.default is not None:
                    validated[name] = param.default
                else:
                    errors.append(f"Missing required parameter: {name}")
        
        if errors:
            raise ValueError(f"Parameter validation failed: {'; '.join(errors)}")
        
        return validated
    
    async def validate_parameters_async(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """Asynchronously validate input parameters."""
        # For now, delegate to sync version
        # Can be overridden for async validation
        return self.validate_parameters(parameters)
    
    @abstractmethod
    def execute(self, parameters: Dict[str, Any], context: ToolContext) -> ToolResult:
        """Execute tool synchronously."""
        pass
    
    @abstractmethod
    async def aexecute(self, parameters: Dict[str, Any], context: ToolContext) -> ToolResult:
        """Execute tool asynchronously."""
        pass
    
    def can_execute(self, context: ToolContext) -> bool:
        """Check if tool can be executed in given context."""
        # Check roles
        if self._metadata.allowed_roles:
            if not any(role in context.roles for role in self._metadata.allowed_roles):
                return False
        
        # Check permissions
        # This is a placeholder for more sophisticated permission checking
        return True
    
    def get_schema(self) -> Dict[str, Any]:
        """Get tool schema for API documentation."""
        return {
            "name": self._metadata.name,
            "description": self._metadata.description,
            "category": self._metadata.category.value,
            "version": self._metadata.version,
            "parameters": {
                name: {
                    "type": param.type.value,
                    "description": param.description,
                    "required": param.required,
                    "default": param.default,
                    "enum": param.enum,
                    "minimum": param.minimum,
                    "maximum": param.maximum,
                    "pattern": param.pattern
                }
                for name, param in self._parameters.items()
            },
            "metadata": self._metadata.dict()
        }
    
    def __str__(self) -> str:
        """String representation."""
        return f"{self.__class__.__name__}(name='{self.name}', version='{self._metadata.version}')"
    
    def __repr__(self) -> str:
        """Detailed representation."""
        return f"{self.__class__.__name__}(metadata={self._metadata!r})"
    
    async def aexecute_with_retry(
        self,
        parameters: Dict[str, Any],
        context: ToolContext,
        retry_callback: Optional[Callable[[str], Dict[str, Any]]] = None
    ) -> ToolResult:
        """
        Execute tool with automatic retry on validation failures.
        
        This method implements the core self-healing mechanism inspired by
        Pydantic AI's validation feedback loop. When parameter validation fails,
        it generates natural language feedback and allows retry with corrected parameters.
        
        Args:
            parameters: Initial parameters for tool execution
            context: Execution context
            retry_callback: Optional callback to simulate LLM correction.
                            Takes error message (str), returns corrected parameters (Dict).
                            If None, no retry will be attempted.
            
        Returns:
            ToolResult with execution outcome
            
        Raises:
            ValueError: If max retries exceeded
            
        Inspired by: pydantic-ai/pydantic_ai/_tool_manager.py
        """
        max_retries = context.max_retries or self._metadata.max_retries
        retry_count = 0
        current_params = parameters.copy()
        
        while retry_count <= max_retries:
            try:
                # Attempt validation
                validated_params = await self.validate_parameters_async(current_params)
                
                # Execute if validation passed
                result = await self.aexecute(validated_params, context)
                
                # Add retry metadata if retries occurred
                if retry_count > 0:
                    result.metadata["retry_count"] = retry_count
                    result.metadata["auto_corrected"] = True
                
                return result
                
            except ValidationError as e:
                # Handle validation failure
                feedback = self._validation_handler.handle(
                    error=e,
                    tool_name=self.name,
                    parameters=current_params,
                    retry_count=retry_count
                )
                
                # Check if retry is enabled and possible
                if not self._enable_auto_retry or retry_callback is None:
                    # No retry - return failure result
                    error_msg = self._error_translator.translate(feedback)
                    return ToolResult(
                        status=ToolStatus.FAILED,
                        error=error_msg,
                        metadata=feedback.to_dict()
                    )
                
                if retry_count >= max_retries:
                    # Max retries exceeded
                    error_msg = self._error_translator.translate(feedback)
                    error_msg += f"\n\nMax retries ({max_retries}) exceeded."
                    return ToolResult(
                        status=ToolStatus.FAILED,
                        error=error_msg,
                        metadata=feedback.to_dict()
                    )
                
                # Generate feedback for LLM
                feedback_text = self._error_translator.translate(feedback)
                
                try:
                    # Simulate LLM correction via callback
                    corrected_params = retry_callback(feedback_text)
                    current_params = corrected_params
                    retry_count += 1
                    
                    self._logger.info(
                        f"Retry {retry_count}/{max_retries} for tool '{self.name}' "
                        f"with corrected parameters"
                    )
                    
                except Exception as callback_err:
                    # Callback failed - return error
                    return ToolResult(
                        status=ToolStatus.FAILED,
                        error=f"Retry callback failed: {str(callback_err)}",
                        metadata=feedback.to_dict()
                    )
        
        # Should not reach here
        return ToolResult(
            status=ToolStatus.FAILED,
            error="Unexpected retry loop exit"
        )