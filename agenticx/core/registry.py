"""
AgenticX Tool Registry and Factory

This module provides tool registration, discovery, and factory functionality
for the AgenticX tool system.
"""

import asyncio
import logging
import threading
from typing import Dict, List, Optional, Type, Any, Callable, Union
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
import json
import hashlib

from .tool_v2 import BaseTool, ToolMetadata, ToolResult, ToolContext, ToolCategory


class ToolRegistrationError(Exception):
    """Raised when tool registration fails."""
    pass


class ToolNotFoundError(Exception):
    """Raised when tool is not found."""
    pass


class ToolValidationError(Exception):
    """Raised when tool validation fails."""
    pass


@dataclass
class ToolInfo:
    """Tool information structure."""
    tool_class: Type[BaseTool]
    metadata: ToolMetadata
    instance: Optional[BaseTool] = None
    registration_time: datetime = field(default_factory=datetime.now)
    usage_count: int = 0
    last_used: Optional[datetime] = None
    tags: List[str] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "name": self.metadata.name,
            "version": self.metadata.version,
            "description": self.metadata.description,
            "category": self.metadata.category.value,
            "author": self.metadata.author,
            "registration_time": self.registration_time.isoformat(),
            "usage_count": self.usage_count,
            "last_used": self.last_used.isoformat() if self.last_used else None,
            "tags": self.tags,
            "requires_credentials": self.metadata.requires_credentials,
            "sandbox_required": self.metadata.sandbox_required,
            "rate_limit": self.metadata.rate_limit,
            "timeout": self.metadata.timeout
        }


class ToolRegistry:
    """
    Central registry for managing all tools in the AgenticX system.
    
    Provides thread-safe tool registration, discovery, and lifecycle management.
    """
    
    def __init__(self):
        self._tools: Dict[str, ToolInfo] = {}
        self._categories: Dict[ToolCategory, List[str]] = defaultdict(list)
        self._tags: Dict[str, List[str]] = defaultdict(list)
        self._lock = threading.RLock()
        self._logger = logging.getLogger("agenticx.registry")
        self._initialized = False
    
    def initialize(self) -> None:
        """Initialize the registry."""
        with self._lock:
            if self._initialized:
                return
            
            self._logger.info("Initializing ToolRegistry")
            self._initialized = True
            
            # Register built-in tools
            self._register_builtin_tools()
    
    def _register_builtin_tools(self) -> None:
        """Register built-in tools."""
        # This will be implemented when we create the built-in tools
        self._logger.info("Registering built-in tools")
    
    def register_tool(self, tool_class: Type[BaseTool], 
                     metadata: Optional[ToolMetadata] = None,
                     tags: Optional[List[str]] = None) -> None:
        """
        Register a tool class.
        
        Args:
            tool_class: The tool class to register
            metadata: Optional metadata override
            tags: Optional tags for categorization
        """
        with self._lock:
            if not issubclass(tool_class, BaseTool):
                raise ToolRegistrationError(f"Tool class must inherit from BaseTool: {tool_class}")
            
            # Get metadata from class if not provided
            if metadata is None:
                # Try to get metadata from class method
                if hasattr(tool_class, 'get_metadata'):
                    metadata = tool_class.get_metadata()
                else:
                    # Create instance to get metadata
                    try:
                        instance = tool_class.__new__(tool_class)
                        if hasattr(instance, 'metadata'):
                            metadata = instance.metadata
                        else:
                            raise ToolRegistrationError(f"Cannot determine metadata for tool: {tool_class.__name__}")
                    except Exception as e:
                        raise ToolRegistrationError(f"Failed to create tool instance for metadata: {e}")
            
            tool_name = metadata.name
            
            # Check for existing registration
            if tool_name in self._tools:
                existing = self._tools[tool_name]
                if existing.metadata.version == metadata.version:
                    self._logger.warning(f"Tool '{tool_name}' v{metadata.version} already registered")
                    return
                else:
                    self._logger.info(f"Updating tool '{tool_name}' from v{existing.metadata.version} to v{metadata.version}")
            
            # Validate tool class
            self._validate_tool_class(tool_class)
            
            # Create tool info
            tool_info = ToolInfo(
                tool_class=tool_class,
                metadata=metadata,
                tags=tags or []
            )
            
            # Register tool
            self._tools[tool_name] = tool_info
            self._categories[metadata.category].append(tool_name)
            
            # Register tags
            for tag in (tags or []):
                self._tags[tag].append(tool_name)
            
            self._logger.info(f"Registered tool '{tool_name}' v{metadata.version} in category {metadata.category.value}")
    
    def _validate_tool_class(self, tool_class: Type[BaseTool]) -> None:
        """Validate tool class implementation."""
        # Check required methods
        required_methods = ['execute', 'aexecute', '_setup_parameters']
        for method in required_methods:
            if not hasattr(tool_class, method):
                raise ToolValidationError(f"Tool class missing required method: {method}")
        
        # Try to instantiate the class
        try:
            instance = tool_class.__new__(tool_class)
            # This will be called during initialization
        except Exception as e:
            raise ToolValidationError(f"Failed to validate tool class: {e}")
    
    def unregister_tool(self, tool_name: str) -> bool:
        """
        Unregister a tool.
        
        Args:
            tool_name: Name of the tool to unregister
            
        Returns:
            True if tool was unregistered, False if not found
        """
        with self._lock:
            if tool_name not in self._tools:
                return False
            
            tool_info = self._tools.pop(tool_name)
            
            # Remove from categories
            category = tool_info.metadata.category
            if tool_name in self._categories[category]:
                self._categories[category].remove(tool_name)
            
            # Remove from tags
            for tag in tool_info.tags:
                if tool_name in self._tags[tag]:
                    self._tags[tag].remove(tool_name)
            
            self._logger.info(f"Unregistered tool '{tool_name}'")
            return True
    
    def get_tool(self, tool_name: str) -> Optional[BaseTool]:
        """
        Get a tool instance by name.
        
        Args:
            tool_name: Name of the tool
            
        Returns:
            Tool instance or None if not found
        """
        with self._lock:
            tool_info = self._tools.get(tool_name)
            if not tool_info:
                return None
            
            # Create instance if not cached
            if tool_info.instance is None:
                try:
                    tool_info.instance = tool_info.tool_class.__new__(tool_info.tool_class)
                    tool_info.tool_class.__init__(tool_info.instance)
                except Exception as e:
                    self._logger.error(f"Failed to create tool instance '{tool_name}': {e}")
                    return None
            
            # Update usage statistics
            tool_info.usage_count += 1
            tool_info.last_used = datetime.now()
            
            return tool_info.instance
    
    def get_tool_info(self, tool_name: str) -> Optional[ToolInfo]:
        """Get tool information without creating an instance."""
        with self._lock:
            return self._tools.get(tool_name)
    
    def list_tools(self, 
                   category: Optional[ToolCategory] = None,
                   tags: Optional[List[str]] = None,
                   include_metadata: bool = False) -> List[Union[str, Dict[str, Any]]]:
        """
        List available tools.
        
        Args:
            category: Filter by category
            tags: Filter by tags
            include_metadata: Include full metadata
            
        Returns:
            List of tool names or tool information dictionaries
        """
        with self._lock:
            if category:
                tool_names = self._categories.get(category, [])
            elif tags:
                # Intersection of all tags
                tool_names = set()
                for tag in tags:
                    tool_names.update(self._tags.get(tag, []))
                tool_names = list(tool_names)
            else:
                tool_names = list(self._tools.keys())
            
            if include_metadata:
                return [self._tools[name].to_dict() for name in tool_names]
            else:
                return tool_names
    
    def search_tools(self, query: str, 
                    category: Optional[ToolCategory] = None,
                    limit: int = 10) -> List[Dict[str, Any]]:
        """
        Search tools by name, description, or tags.
        
        Args:
            query: Search query
            category: Optional category filter
            limit: Maximum number of results
            
        Returns:
            List of matching tool information
        """
        with self._lock:
            query = query.lower()
            results = []
            
            for tool_name, tool_info in self._tools.items():
                # Category filter
                if category and tool_info.metadata.category != category:
                    continue
                
                # Search in name, description, and tags
                score = 0
                if query in tool_name.lower():
                    score += 3
                if query in tool_info.metadata.description.lower():
                    score += 2
                for tag in tool_info.tags:
                    if query in tag.lower():
                        score += 1
                
                if score > 0:
                    tool_data = tool_info.to_dict()
                    tool_data['search_score'] = score
                    results.append(tool_data)
            
            # Sort by score and return top results
            results.sort(key=lambda x: x['search_score'], reverse=True)
            return results[:limit]
    
    def get_categories(self) -> List[str]:
        """Get list of available categories."""
        with self._lock:
            return [cat.value for cat in self._categories.keys()]
    
    def get_tags(self) -> List[str]:
        """Get list of available tags."""
        with self._lock:
            return list(self._tags.keys())
    
    def get_statistics(self) -> Dict[str, Any]:
        """Get registry statistics."""
        with self._lock:
            total_tools = len(self._tools)
            category_counts = {cat.value: len(tools) for cat, tools in self._categories.items()}
            total_usage = sum(info.usage_count for info in self._tools.values())
            
            return {
                "total_tools": total_tools,
                "category_counts": category_counts,
                "total_usage": total_usage,
                "categories": len(self._categories),
                "tags": len(self._tags),
                "initialized": self._initialized
            }
    
    def clear(self) -> None:
        """Clear all registered tools."""
        with self._lock:
            self._tools.clear()
            self._categories.clear()
            self._tags.clear()
            self._initialized = False
            self._logger.info("Cleared ToolRegistry")
    
    def export_registry(self, file_path: str) -> None:
        """Export registry to JSON file."""
        with self._lock:
            data = {
                "tools": {name: info.to_dict() for name, info in self._tools.items()},
                "statistics": self.get_statistics(),
                "export_time": datetime.now().isoformat()
            }
            
            with open(file_path, 'w') as f:
                json.dump(data, f, indent=2)
            
            self._logger.info(f"Exported registry to {file_path}")
    
    def import_registry(self, file_path: str) -> None:
        """Import registry from JSON file."""
        with open(file_path, 'r') as f:
            data = json.load(f)
        
        # This would require the tool classes to be available
        # Implementation depends on how tools are loaded
        self._logger.info(f"Imported registry from {file_path}")


class ToolFactory:
    """
    Factory for creating tool instances with various configurations.
    
    Provides convenient methods for creating tools from functions,
    classes, and other sources.
    """
    
    def __init__(self, registry: ToolRegistry):
        self._registry = registry
        self._logger = logging.getLogger("agenticx.factory")
    
    def create_tool(self, tool_name: str, **kwargs) -> Optional[BaseTool]:
        """
        Create a tool instance by name.
        
        Args:
            tool_name: Name of the tool
            **kwargs: Additional arguments for tool creation
            
        Returns:
            Tool instance or None if not found
        """
        tool_info = self._registry.get_tool_info(tool_name)
        if not tool_info:
            return None
        
        try:
            # Create new instance with custom configuration
            instance = tool_info.tool_class.__new__(tool_info.tool_class)
            
            # Apply custom configuration if provided
            if hasattr(instance, 'configure') and kwargs:
                instance.configure(**kwargs)
            
            # Initialize the instance
            tool_info.tool_class.__init__(instance)
            
            return instance
        except Exception as e:
            self._logger.error(f"Failed to create tool instance '{tool_name}': {e}")
            return None
    
    def create_tools_from_category(self, category: ToolCategory, **kwargs) -> List[BaseTool]:
        """Create instances of all tools in a category."""
        tool_names = self._registry.list_tools(category=category)
        tools = []
        
        for tool_name in tool_names:
            tool = self.create_tool(tool_name, **kwargs)
            if tool:
                tools.append(tool)
        
        return tools
    
    def create_tools_with_tags(self, tags: List[str], **kwargs) -> List[BaseTool]:
        """Create instances of tools with specific tags."""
        tool_names = self._registry.list_tools(tags=tags)
        tools = []
        
        for tool_name in tool_names:
            tool = self.create_tool(tool_name, **kwargs)
            if tool:
                tools.append(tool)
        
        return tools
    
    @staticmethod
    def create_metadata_from_function(func: Callable, **kwargs) -> ToolMetadata:
        """
        Create ToolMetadata from a function.
        
        Args:
            func: The function to create metadata from
            **kwargs: Additional metadata fields
            
        Returns:
            ToolMetadata instance
        """
        import inspect
        
        # Get function name
        name = kwargs.get('name', func.__name__)
        
        # Get description
        description = kwargs.get('description', func.__doc__ or f"Function tool: {name}")
        
        # Get category
        category = kwargs.get('category', ToolCategory.UTILITY)
        
        # Create metadata
        metadata = ToolMetadata(
            name=name,
            description=description,
            category=category,
            **{k: v for k, v in kwargs.items() if k not in ['name', 'description', 'category']}
        )
        
        return metadata


# Global registry instance
_global_registry = ToolRegistry()
_global_factory = ToolFactory(_global_registry)


def get_registry() -> ToolRegistry:
    """Get the global tool registry."""
    return _global_registry


def get_factory() -> ToolFactory:
    """Get the global tool factory."""
    return _global_factory


def register_tool(tool_class: Type[BaseTool], **kwargs) -> None:
    """Register a tool class with the global registry."""
    _global_registry.register_tool(tool_class, **kwargs)


def get_tool(tool_name: str) -> Optional[BaseTool]:
    """Get a tool from the global registry."""
    return _global_registry.get_tool(tool_name)


def list_tools(**kwargs) -> List[str]:
    """List tools from the global registry."""
    return _global_registry.list_tools(**kwargs)