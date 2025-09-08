"""
MCP Memory Implementation

Implements long-term memory via Model Context Protocol (MCP) servers.
Connects to OpenMemory or any compatible MCP memory service.
"""

import json
import logging
from typing import Any, Dict, List, Optional
from datetime import datetime

from ..tools import MCPClient, create_mcp_client
from .base import BaseMemory, MemoryRecord, SearchResult, MemoryError, MemoryConnectionError, MemoryNotFoundError
from .short_term import ShortTermMemory

logger = logging.getLogger(__name__)


class MCPMemory(BaseMemory):
    """
    MCP-based long-term memory implementation.
    
    Connects to any MCP-compatible memory service (like OpenMemory)
    and translates BaseMemory operations to MCP tool calls.
    """
    
    def __init__(
        self,
        tenant_id: str,
        mcp_client: MCPClient,
        fallback_to_short_term: bool = True,
        **kwargs
    ):
        """
        Initialize MCP memory.
        
        Args:
            tenant_id: Unique identifier for tenant isolation
            mcp_client: An initialized MCPClient instance
            fallback_to_short_term: Whether to use ShortTermMemory if MCP server is unavailable
            **kwargs: Additional configuration options
        """
        super().__init__(tenant_id, **kwargs)
        self._client = mcp_client
        self._tools_discovered = False
        self._fallback_memory: Optional[ShortTermMemory] = None
        self._use_fallback = False
        self.fallback_to_short_term = fallback_to_short_term
    
    async def _ensure_tools_discovered(self):
        """Ensure MCP client has discovered tools and memory tools are available."""
        if not self._tools_discovered:
            # Check if client is available
            if self._client is None:
                if self.fallback_to_short_term:
                    logger.warning("MCP client is not available, using ShortTermMemory as fallback.")
                    self._use_fallback = True
                    self._fallback_memory = ShortTermMemory(tenant_id=self.tenant_id)
                    return
                else:
                    raise MemoryConnectionError("MCP client is not available and fallback is disabled")
            
            try:
                tools = await self._client.discover_tools()
                tool_names = {tool.name for tool in tools}
                
                # Check for essential memory tools
                required_tools = {"add_memories", "search_memory"}
                if not required_tools.issubset(tool_names):
                    if self.fallback_to_short_term:
                        logger.warning(
                            f"MCP server '{self._client.server_config.name}' does not provide full memory API. "
                            f"Missing: {required_tools - tool_names}. Using ShortTermMemory as fallback."
                        )
                        self._use_fallback = True
                        self._fallback_memory = ShortTermMemory(tenant_id=self.tenant_id)
                    else:
                        raise MemoryConnectionError(
                            f"MCP server does not provide required memory tools: {required_tools - tool_names}"
                        )
                
                self._tools_discovered = True
                logger.info(f"Discovered {len(tools)} tools from MCP memory server '{self._client.server_config.name}'")
            except Exception as e:
                if self.fallback_to_short_term:
                    logger.warning(f"Failed to discover tools, using ShortTermMemory fallback: {e}")
                    self._use_fallback = True
                    self._fallback_memory = ShortTermMemory(tenant_id=self.tenant_id)
                else:
                    raise MemoryConnectionError(f"Failed to discover tools from MCP memory server: {str(e)}") from e
    
    async def _call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Any:
        """Call an MCP tool with error handling."""
        await self._ensure_tools_discovered()
        
        # Check if we're using fallback
        if self._use_fallback:
            raise MemoryError("Cannot call MCP tools when using fallback memory")
        
        # Check if client is available
        if self._client is None:
            raise MemoryError("MCP client is not available")
        
        try:
            tool = await self._client.create_tool(tool_name)
            result = await tool.arun(**arguments)
            return result
        except Exception as e:
            raise MemoryError(f"MCP tool '{tool_name}' call failed: {str(e)}") from e
    
    async def add(
        self,
        content: str,
        metadata: Optional[Dict[str, Any]] = None,
        record_id: Optional[str] = None
    ) -> str:
        """Add a new memory record via MCP."""
        await self._ensure_tools_discovered()
        if self._use_fallback:
            if self._fallback_memory is None:
                raise MemoryError("Fallback memory is not available")
            return await self._fallback_memory.add(content, metadata, record_id)
        
        try:
            # Ensure tenant isolation
            metadata = self._ensure_tenant_isolation(metadata)
            
            # Generate ID if not provided
            if record_id is None:
                record_id = self._generate_record_id()
            
            # Prepare memory data
            memory_data = {
                "id": record_id,
                "content": content,
                "metadata": metadata,
                "user_id": self.tenant_id  # OpenMemory uses user_id for isolation
            }
            
            # Call add_memories tool
            result = await self._call_tool("add_memories", {
                "memories": [memory_data]
            })
            
            # Extract record ID from result
            if isinstance(result, dict) and "results" in result:
                results = result["results"]
                if results and len(results) > 0:
                    return results[0].get("id", record_id)
            
            return record_id
            
        except Exception as e:
            if isinstance(e, MemoryError):
                raise
            raise MemoryError(f"Failed to add memory record: {str(e)}") from e
    
    async def search(
        self,
        query: str,
        limit: int = 10,
        metadata_filter: Optional[Dict[str, Any]] = None,
        min_score: float = 0.0
    ) -> List[SearchResult]:
        """Search for relevant memory records via MCP."""
        await self._ensure_tools_discovered()
        if self._use_fallback:
            if self._fallback_memory is None:
                raise MemoryError("Fallback memory is not available")
            return await self._fallback_memory.search(query, limit, metadata_filter, min_score)
        
        try:
            # Prepare search arguments
            search_args = {
                "query": query,
                "user_id": self.tenant_id,
                "limit": limit
            }
            
            # Add metadata filter if provided
            if metadata_filter:
                search_args["filters"] = metadata_filter
            
            # Call search_memory tool
            result = await self._call_tool("search_memory", search_args)
            
            # Parse results
            search_results = []
            if isinstance(result, dict) and "results" in result:
                for item in result["results"]:
                    # Extract memory data
                    memory_data = item.get("memory", {})
                    score = float(item.get("score", 0.0))
                    
                    # Skip results below minimum score
                    if score < min_score:
                        continue
                    
                    # Create MemoryRecord
                    record = self._parse_memory_record(memory_data)
                    if record:
                        search_results.append(SearchResult(record=record, score=score))
            
            # Sort by score (should already be sorted by MCP server)
            search_results.sort(key=lambda x: x.score, reverse=True)
            return search_results
            
        except Exception as e:
            if isinstance(e, MemoryError):
                raise
            raise MemoryError(f"Failed to search memory: {str(e)}") from e
    
    async def update(
        self,
        record_id: str,
        content: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> bool:
        """Update an existing memory record via MCP."""
        try:
            # First, get the existing record
            existing_record = await self.get(record_id)
            if not existing_record:
                return False
            
            # Prepare updated data
            updated_content = content if content is not None else existing_record.content
            updated_metadata = existing_record.metadata.copy()
            if metadata:
                updated_metadata.update(metadata)
                updated_metadata = self._ensure_tenant_isolation(updated_metadata)
            
            # For OpenMemory, we need to delete and re-add (no direct update)
            # This is a limitation of the current OpenMemory MCP interface
            await self.delete(record_id)
            
            # Re-add with updated data
            await self.add(
                content=updated_content,
                metadata=updated_metadata,
                record_id=record_id
            )
            
            return True
            
        except Exception as e:
            if isinstance(e, MemoryError):
                raise
            raise MemoryError(f"Failed to update memory record: {str(e)}") from e
    
    async def delete(self, record_id: str) -> bool:
        """Delete a memory record via MCP."""
        try:
            # OpenMemory doesn't have a direct delete by ID tool
            # We need to use delete_all_memories or implement a workaround
            # For now, we'll mark it as deleted in metadata
            
            # Get the record first
            record = await self.get(record_id)
            if not record:
                return False
            
            # Mark as deleted by updating metadata
            delete_metadata = record.metadata.copy()
            delete_metadata["_deleted"] = True
            delete_metadata["_deleted_at"] = datetime.now().isoformat()
            
            # Update the record to mark as deleted
            await self.update(record_id, metadata=delete_metadata)
            
            return True
            
        except Exception as e:
            if isinstance(e, MemoryError):
                raise
            raise MemoryError(f"Failed to delete memory record: {str(e)}") from e
    
    async def get(self, record_id: str) -> Optional[MemoryRecord]:
        """Get a specific memory record by ID via MCP."""
        try:
            # Search for the specific record by ID
            # OpenMemory doesn't have a direct get by ID, so we search
            search_results = await self.search(
                query=f"id:{record_id}",
                limit=1,
                metadata_filter={"id": record_id}
            )
            
            if search_results:
                record = search_results[0].record
                # Check if record is marked as deleted
                if record.metadata.get("_deleted"):
                    return None
                return record
            
            return None
            
        except Exception as e:
            if isinstance(e, MemoryError):
                raise
            raise MemoryError(f"Failed to get memory record: {str(e)}") from e
    
    async def list_all(
        self,
        limit: int = 100,
        offset: int = 0,
        metadata_filter: Optional[Dict[str, Any]] = None
    ) -> List[MemoryRecord]:
        """List all memory records for the current tenant via MCP."""
        try:
            # Call list_memories tool
            list_args = {
                "user_id": self.tenant_id,
                "limit": limit + offset  # Get more to handle offset
            }
            
            if metadata_filter:
                list_args["filters"] = metadata_filter
            
            result = await self._call_tool("list_memories", list_args)
            
            # Parse results
            records = []
            if isinstance(result, dict) and "memories" in result:
                for memory_data in result["memories"]:
                    record = self._parse_memory_record(memory_data)
                    if record and not record.metadata.get("_deleted"):
                        records.append(record)
            
            # Apply offset and limit
            return records[offset:offset + limit]
            
        except Exception as e:
            if isinstance(e, MemoryError):
                raise
            raise MemoryError(f"Failed to list memory records: {str(e)}") from e
    
    async def clear(self) -> int:
        """Clear all memory records for the current tenant via MCP."""
        try:
            # Get count of records before clearing
            all_records = await self.list_all(limit=10000)  # Large limit to get all
            count = len(all_records)
            
            # Call delete_all_memories tool
            await self._call_tool("delete_all_memories", {
                "user_id": self.tenant_id
            })
            
            return count
            
        except Exception as e:
            if isinstance(e, MemoryError):
                raise
            raise MemoryError(f"Failed to clear memory: {str(e)}") from e
    
    def _parse_memory_record(self, memory_data: Dict[str, Any]) -> Optional[MemoryRecord]:
        """Parse memory data from MCP response into MemoryRecord."""
        try:
            # Extract required fields
            record_id = memory_data.get("id")
            content = memory_data.get("content", memory_data.get("text", ""))
            metadata = memory_data.get("metadata", {})
            
            if not record_id or not content:
                return None
            
            # Parse timestamps
            created_at = memory_data.get("created_at")
            updated_at = memory_data.get("updated_at", created_at)
            
            if isinstance(created_at, str):
                created_at = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
            else:
                created_at = datetime.now()
            
            if isinstance(updated_at, str):
                updated_at = datetime.fromisoformat(updated_at.replace('Z', '+00:00'))
            else:
                updated_at = created_at
            
            return MemoryRecord(
                id=record_id,
                content=content,
                metadata=metadata,
                tenant_id=self.tenant_id,
                created_at=created_at,
                updated_at=updated_at
            )
            
        except Exception as e:
            logger.warning(f"Failed to parse memory record: {e}")
            return None
    
    async def close(self):
        """Close the MCP connection."""
        if self._client:
            # MCPClient doesn't have a close method, so we just set it to None
            self._client = None
    
    async def __aenter__(self):
        """Async context manager entry."""
        await self._ensure_tools_discovered()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        await self.close() 