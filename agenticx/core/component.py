"""
Base Component Class

Provides a base class for all AgenticX components.
"""

from abc import ABC
from typing import Any, Dict, Optional


class Component(ABC):
    """
    Base class for all AgenticX components.
    
    Provides common functionality and interface for components
    like memory, tools, and other system parts.
    """
    
    def __init__(self, name: Optional[str] = None, **kwargs):
        """
        Initialize component.
        
        Args:
            name: Optional component name
            **kwargs: Additional configuration options
        """
        self.name = name or self.__class__.__name__
        self._config = kwargs
        self._initialized = False
    
    async def initialize(self):
        """Initialize the component."""
        if not self._initialized:
            await self._setup()
            self._initialized = True
    
    async def _setup(self):
        """Override this method to implement component-specific setup."""
        pass
    
    async def cleanup(self):
        """Cleanup component resources."""
        pass
    
    def get_config(self, key: str, default: Any = None) -> Any:
        """Get configuration value."""
        return self._config.get(key, default)
    
    def set_config(self, key: str, value: Any):
        """Set configuration value."""
        self._config[key] = value
    
    @property
    def is_initialized(self) -> bool:
        """Check if component is initialized."""
        return self._initialized
    
    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(name='{self.name}')" 