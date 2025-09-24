"""
AgenticX Protocol Adapters

This module provides protocol adapters for various tool calling formats,
including OpenAI Function Calling and MCP (Model Context Protocol).
"""

import json
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Union, Callable, Type
from pydantic import BaseModel, Field

from .tool_v2 import BaseTool, ToolMetadata, ToolParameter, ToolResult
from .executor import ToolExecutor
from .registry import ToolRegistry


class ProtocolType(str, Enum):
    """Protocol type enumeration."""
    OPENAI = "openai"
    MCP = "mcp"
    ANTHROPIC = "anthropic"
    CUSTOM = "custom"


@dataclass
class ProtocolMessage:
    """Generic protocol message."""
    protocol: ProtocolType
    message_type: str
    content: Dict[str, Any]
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ToolCallRequest:
    """Tool call request."""
    tool_name: str
    parameters: Dict[str, Any]
    call_id: Optional[str] = None
    user_id: Optional[str] = None
    context: Optional[Dict[str, Any]] = None


@dataclass
class ToolCallResponse:
    """Tool call response."""
    success: bool
    result: Any
    error: Optional[str] = None
    call_id: Optional[str] = None
    execution_time: Optional[float] = None


class ProtocolAdapter(ABC):
    """Base protocol adapter."""
    
    def __init__(self, registry: Optional[ToolRegistry] = None, 
                 executor: Optional[ToolExecutor] = None):
        self._logger = logging.getLogger(f"agenticx.protocol.{self.__class__.__name__}")
        self._registry = registry or ToolRegistry()
        self._executor = executor or ToolExecutor()
    
    @abstractmethod
    def protocol_type(self) -> ProtocolType:
        """Get the protocol type."""
        pass
    
    @abstractmethod
    def convert_tool_metadata(self, tool_metadata: ToolMetadata) -> Dict[str, Any]:
        """Convert tool metadata to protocol-specific format."""
        pass
    
    @abstractmethod
    def parse_tool_call(self, message: Dict[str, Any]) -> ToolCallRequest:
        """Parse a tool call from protocol message."""
        pass
    
    @abstractmethod
    def format_tool_response(self, response: ToolCallResponse) -> Dict[str, Any]:
        """Format tool response for protocol."""
        pass
    
    def list_tools(self) -> List[Dict[str, Any]]:
        """List available tools in protocol format."""
        tools = []
        for tool_info in self._registry.list_tools():
            try:
                tool_metadata = self._registry.get_tool_metadata(tool_info.name)
                protocol_metadata = self.convert_tool_metadata(tool_metadata)
                tools.append(protocol_metadata)
            except Exception as e:
                self._logger.error(f"Failed to convert tool {tool_info.name}: {e}")
        
        return tools
    
    def execute_tool_call(self, request: ToolCallRequest) -> ToolCallResponse:
        """Execute a tool call."""
        try:
            # Get tool from registry
            tool = self._registry.get_tool(request.tool_name)
            if not tool:
                return ToolCallResponse(
                    success=False,
                    result=None,
                    error=f"Tool not found: {request.tool_name}",
                    call_id=request.call_id
                )
            
            # Execute tool
            result = self._executor.execute(
                tool=tool,
                parameters=request.parameters,
                user_id=request.user_id,
                context=request.context
            )
            
            return ToolCallResponse(
                success=result.success,
                result=result.data,
                error=result.error,
                call_id=request.call_id,
                execution_time=result.execution_time
            )
            
        except Exception as e:
            self._logger.error(f"Failed to execute tool {request.tool_name}: {e}")
            return ToolCallResponse(
                success=False,
                result=None,
                error=str(e),
                call_id=request.call_id
            )


# OpenAI Function Calling Adapter

class OpenAIFunctionDefinition(BaseModel):
    """OpenAI function definition."""
    name: str = Field(..., description="The name of the function")
    description: str = Field(..., description="A description of what the function does")
    parameters: Dict[str, Any] = Field(..., description="The parameters the function accepts")


class OpenAIFunctionCall(BaseModel):
    """OpenAI function call."""
    name: str = Field(..., description="The name of the function to call")
    arguments: str = Field(..., description="The arguments to call the function with, as a JSON string")


class OpenAIToolCall(BaseModel):
    """OpenAI tool call."""
    id: str = Field(..., description="The ID of the tool call")
    type: str = Field(default="function", description="The type of the tool call")
    function: OpenAIFunctionCall = Field(..., description="The function call")


class OpenAIAdapter(ProtocolAdapter):
    """OpenAI Function Calling protocol adapter."""
    
    def protocol_type(self) -> ProtocolType:
        return ProtocolType.OPENAI
    
    def convert_tool_metadata(self, tool_metadata: ToolMetadata) -> Dict[str, Any]:
        """Convert tool metadata to OpenAI function definition format."""
        # Convert parameters to OpenAI format
        properties = {}
        required = []
        
        for param in tool_metadata.parameters:
            param_schema = self._convert_parameter_to_openai(param)
            properties[param.name] = param_schema
            
            if param.required:
                required.append(param.name)
        
        function_def = OpenAIFunctionDefinition(
            name=tool_metadata.name,
            description=tool_metadata.description,
            parameters={
                "type": "object",
                "properties": properties,
                "required": required
            }
        )
        
        return function_def.dict()
    
    def _convert_parameter_to_openai(self, param: ToolParameter) -> Dict[str, Any]:
        """Convert ToolParameter to OpenAI parameter format."""
        schema = {
            "type": self._map_parameter_type(param.type),
            "description": param.description
        }
        
        if param.enum_values:
            schema["enum"] = param.enum_values
        
        if param.default is not None:
            schema["default"] = param.default
        
        if param.minimum is not None:
            schema["minimum"] = param.minimum
        
        if param.maximum is not None:
            schema["maximum"] = param.maximum
        
        return schema
    
    def _map_parameter_type(self, param_type: str) -> str:
        """Map parameter type to OpenAI type."""
        type_map = {
            "string": "string",
            "integer": "integer",
            "number": "number",
            "boolean": "boolean",
            "array": "array",
            "object": "object"
        }
        return type_map.get(param_type, "string")
    
    def parse_tool_call(self, message: Dict[str, Any]) -> ToolCallRequest:
        """Parse OpenAI tool call message."""
        try:
            # Handle OpenAI tool call format
            tool_calls = message.get("tool_calls", [])
            if not tool_calls:
                raise ValueError("No tool calls found in message")
            
            tool_call = tool_calls[0]  # Handle first tool call
            function_call = tool_call.get("function", {})
            
            tool_name = function_call.get("name")
            if not tool_name:
                raise ValueError("Tool name not found in function call")
            
            # Parse arguments
            arguments_str = function_call.get("arguments", "{}")
            try:
                parameters = json.loads(arguments_str)
            except json.JSONDecodeError:
                parameters = {}
            
            return ToolCallRequest(
                tool_name=tool_name,
                parameters=parameters,
                call_id=tool_call.get("id"),
                user_id=message.get("user_id"),
                context={"original_message": message}
            )
            
        except Exception as e:
            self._logger.error(f"Failed to parse OpenAI tool call: {e}")
            raise ValueError(f"Invalid OpenAI tool call format: {e}")
    
    def format_tool_response(self, response: ToolCallResponse) -> Dict[str, Any]:
        """Format tool response for OpenAI."""
        if response.success:
            return {
                "tool_call_id": response.call_id,
                "role": "tool",
                "content": str(response.result)
            }
        else:
            return {
                "tool_call_id": response.call_id,
                "role": "tool",
                "content": f"Error: {response.error}"
            }


# MCP (Model Context Protocol) Adapter

class MCPParameter(BaseModel):
    """MCP parameter definition."""
    type: str = Field(..., description="Parameter type")
    description: str = Field(..., description="Parameter description")
    required: bool = Field(default=True, description="Whether parameter is required")
    default: Any = Field(default=None, description="Default value")


class MCPToolDefinition(BaseModel):
    """MCP tool definition."""
    name: str = Field(..., description="Tool name")
    description: str = Field(..., description="Tool description")
    parameters: Dict[str, MCPParameter] = Field(default_factory=dict, description="Tool parameters")
    category: str = Field(default="general", description="Tool category")
    version: str = Field(default="1.0.0", description="Tool version")


class MCPToolCall(BaseModel):
    """MCP tool call."""
    tool_name: str = Field(..., description="Name of the tool to call")
    parameters: Dict[str, Any] = Field(default_factory=dict, description="Tool parameters")
    call_id: str = Field(..., description="Unique call identifier")


class MCPAdapter(ProtocolAdapter):
    """MCP (Model Context Protocol) adapter."""
    
    def protocol_type(self) -> ProtocolType:
        return ProtocolType.MCP
    
    def convert_tool_metadata(self, tool_metadata: ToolMetadata) -> Dict[str, Any]:
        """Convert tool metadata to MCP format."""
        # Convert parameters to MCP format
        parameters = {}
        
        for param in tool_metadata.parameters:
            parameters[param.name] = MCPParameter(
                type=self._map_parameter_type(param.type),
                description=param.description,
                required=param.required,
                default=param.default
            )
        
        tool_def = MCPToolDefinition(
            name=tool_metadata.name,
            description=tool_metadata.description,
            parameters=parameters,
            category=tool_metadata.category or "general",
            version=tool_metadata.version or "1.0.0"
        )
        
        return tool_def.dict()
    
    def _map_parameter_type(self, param_type: str) -> str:
        """Map parameter type to MCP type."""
        type_map = {
            "string": "string",
            "integer": "integer",
            "number": "number",
            "boolean": "boolean",
            "array": "array",
            "object": "object"
        }
        return type_map.get(param_type, "string")
    
    def parse_tool_call(self, message: Dict[str, Any]) -> ToolCallRequest:
        """Parse MCP tool call message."""
        try:
            # Handle MCP tool call format
            if "tool_call" not in message:
                raise ValueError("No tool_call found in message")
            
            tool_call = message["tool_call"]
            
            tool_name = tool_call.get("tool_name")
            if not tool_name:
                raise ValueError("Tool name not found in tool call")
            
            parameters = tool_call.get("parameters", {})
            call_id = tool_call.get("call_id")
            
            return ToolCallRequest(
                tool_name=tool_name,
                parameters=parameters,
                call_id=call_id,
                user_id=message.get("user_id"),
                context={"original_message": message}
            )
            
        except Exception as e:
            self._logger.error(f"Failed to parse MCP tool call: {e}")
            raise ValueError(f"Invalid MCP tool call format: {e}")
    
    def format_tool_response(self, response: ToolCallResponse) -> Dict[str, Any]:
        """Format tool response for MCP."""
        return {
            "call_id": response.call_id,
            "success": response.success,
            "result": response.result,
            "error": response.error,
            "execution_time": response.execution_time
        }


# Protocol Adapter Factory

class ProtocolAdapterFactory:
    """Factory for creating protocol adapters."""
    
    _adapters: Dict[ProtocolType, Type[ProtocolAdapter]] = {
        ProtocolType.OPENAI: OpenAIAdapter,
        ProtocolType.MCP: MCPAdapter,
    }
    
    @classmethod
    def create_adapter(cls, protocol_type: ProtocolType, 
                      registry: Optional[ToolRegistry] = None,
                      executor: Optional[ToolExecutor] = None) -> ProtocolAdapter:
        """
        Create a protocol adapter.
        
        Args:
            protocol_type: Type of protocol
            registry: Tool registry
            executor: Tool executor
            
        Returns:
            Protocol adapter instance
            
        Raises:
            ValueError: If protocol type is not supported
        """
        if protocol_type not in cls._adapters:
            raise ValueError(f"Unsupported protocol type: {protocol_type}")
        
        adapter_class = cls._adapters[protocol_type]
        return adapter_class(registry=registry, executor=executor)
    
    @classmethod
    def register_adapter(cls, protocol_type: ProtocolType, 
                        adapter_class: Type[ProtocolAdapter]) -> None:
        """Register a custom protocol adapter."""
        cls._adapters[protocol_type] = adapter_class
    
    @classmethod
    def supported_protocols(cls) -> List[ProtocolType]:
        """Get list of supported protocol types."""
        return list(cls._adapters.keys())


# Multi-Protocol Support

class MultiProtocolAdapter:
    """Multi-protocol adapter that can handle multiple protocols."""
    
    def __init__(self, registry: Optional[ToolRegistry] = None,
                 executor: Optional[ToolExecutor] = None):
        self._logger = logging.getLogger("agenticx.protocol.multi")
        self._registry = registry
        self._executor = executor
        self._adapters: Dict[ProtocolType, ProtocolAdapter] = {}
        
        # Initialize registry and executor if not provided
        if self._registry is None:
            from .registry import get_registry
            self._registry = get_registry()
        if self._executor is None:
            from .executor import get_executor
            self._executor = get_executor()
        
        # Initialize default adapters
        self._initialize_adapters()
    
    def _initialize_adapters(self):
        """Initialize default protocol adapters."""
        for protocol_type in [ProtocolType.OPENAI, ProtocolType.MCP]:
            try:
                adapter = ProtocolAdapterFactory.create_adapter(
                    protocol_type, self._registry, self._executor
                )
                self._adapters[protocol_type] = adapter
            except Exception as e:
                self._logger.error(f"Failed to initialize {protocol_type} adapter: {e}")
    
    def add_adapter(self, protocol_type: ProtocolType, adapter: ProtocolAdapter) -> None:
        """Add a protocol adapter."""
        self._adapters[protocol_type] = adapter
    
    def get_adapter(self, protocol_type: ProtocolType) -> Optional[ProtocolAdapter]:
        """Get a protocol adapter."""
        return self._adapters.get(protocol_type)
    
    def list_tools(self, protocol_type: Optional[ProtocolType] = None) -> Dict[str, List[Dict[str, Any]]]:
        """
        List tools for one or all protocols.
        
        Args:
            protocol_type: Specific protocol or None for all
            
        Returns:
            Dictionary mapping protocol type to tool list
        """
        if protocol_type:
            adapter = self.get_adapter(protocol_type)
            if adapter:
                return {protocol_type.value: adapter.list_tools()}
            return {}
        
        tools = {}
        for ptype, adapter in self._adapters.items():
            try:
                tools[ptype.value] = adapter.list_tools()
            except Exception as e:
                self._logger.error(f"Failed to list tools for {ptype}: {e}")
                tools[ptype.value] = []
        
        return tools
    
    def handle_message(self, message: Dict[str, Any], 
                      protocol_type: ProtocolType) -> Dict[str, Any]:
        """
        Handle a protocol message.
        
        Args:
            message: Protocol message
            protocol_type: Type of protocol
            
        Returns:
            Protocol response
        """
        adapter = self.get_adapter(protocol_type)
        if not adapter:
            raise ValueError(f"No adapter found for protocol: {protocol_type}")
        
        try:
            # Parse tool call
            tool_call = adapter.parse_tool_call(message)
            
            # Execute tool
            response = adapter.execute_tool_call(tool_call)
            
            # Format response
            return adapter.format_tool_response(response)
            
        except Exception as e:
            self._logger.error(f"Failed to handle {protocol_type} message: {e}")
            return {
                "success": False,
                "error": str(e)
            }


# Convenience functions

def create_openai_adapter(registry: Optional[ToolRegistry] = None,
                         executor: Optional[ToolExecutor] = None) -> OpenAIAdapter:
    """Create OpenAI adapter."""
    return OpenAIAdapter(registry=registry, executor=executor)


def create_mcp_adapter(registry: Optional[ToolRegistry] = None,
                      executor: Optional[ToolExecutor] = None) -> MCPAdapter:
    """Create MCP adapter."""
    return MCPAdapter(registry=registry, executor=executor)


def create_multi_protocol_adapter(registry: Optional[ToolRegistry] = None,
                                 executor: Optional[ToolExecutor] = None) -> MultiProtocolAdapter:
    """Create multi-protocol adapter."""
    return MultiProtocolAdapter(registry=registry, executor=executor)