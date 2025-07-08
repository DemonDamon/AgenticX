"""
Mem0 Synchronous Wrapper

Provides a synchronous interface for the Mem0 memory component.
"""

from typing import Any, Dict, List, Optional
import asyncio
from concurrent.futures import ThreadPoolExecutor

from agenticx.llms.base import BaseLLMProvider
from agenticx.memory.mem0_memory import Mem0 as AsyncMem0


class Mem0:
    """
    Synchronous wrapper for Mem0 memory component.
    
    This wrapper provides backward compatibility for code that expects
    synchronous add/get/clear methods.
    """
    
    def __init__(self, llm: BaseLLMProvider, tenant_id: str = "default", config: Optional[Dict[str, Any]] = None):
        """Initialize the synchronous Mem0 wrapper."""
        self._async_mem0 = AsyncMem0(llm=llm, tenant_id=tenant_id, config=config)
        self._executor = ThreadPoolExecutor(max_workers=1)
    
    def _run_async(self, coro):
        """Run an async coroutine in a thread pool."""
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            return loop.run_until_complete(coro)
        finally:
            loop.close()
    
    def add(self, content: str, metadata: Optional[Dict[str, Any]] = None) -> str:
        """Add a memory synchronously."""
        return self._run_async(self._async_mem0.add(content, metadata))
    
    def get(self, query: str, metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Search memories synchronously."""
        results = self._run_async(self._async_mem0.search(query, metadata_filter=metadata))
        # Convert back to mem0-style format
        return {
            "results": [
                {"memory": r.record.content, "id": r.record.id, "score": r.score}
                for r in results
            ]
        }
    
    def search(self, query: str, **kwargs) -> Dict[str, Any]:
        """Alias for get method for compatibility."""
        metadata = {k: v for k, v in kwargs.items() if k in ['user_id', 'agent_id']}
        return self.get(query, metadata)
    
    def clear(self) -> int:
        """Clear all memories synchronously."""
        return self._run_async(self._async_mem0.clear())
    
    def reset(self):
        """Alias for clear method for compatibility."""
        self.clear()
    
    def __del__(self):
        """Cleanup thread pool executor."""
        if hasattr(self, '_executor'):
            self._executor.shutdown(wait=False) 