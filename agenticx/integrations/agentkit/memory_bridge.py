#!/usr/bin/env python3
"""AgentKit Memory Bridge for AgenticX.

Bridges AgenticX BaseMemory interface to AgentKit managed memory service.
Uses the AgentKit SDK AgentkitMemory client for control-plane operations
and mem0/veadk MemoryBase protocol for data-plane read/write.

Author: Damon Li
"""

import logging
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from agenticx.memory.base import (
    BaseMemory,
    MemoryRecord,
    SearchResult,
    MemoryError,
    MemoryConnectionError,
)

logger = logging.getLogger(__name__)


class AgentkitMemoryBridge(BaseMemory):
    """Bridge AgenticX memory to AgentKit managed memory service.

    This implementation connects to the AgentKit platform's memory service,
    which provides persistent, managed memory storage with automatic scaling
    and backup.

    The bridge uses a two-layer architecture:
    - Control plane: AgentkitMemory SDK client for collection management.
    - Data plane: Direct mem0/HTTP protocol for actual read/write operations.

    Args:
        collection_name: Name of the memory collection on AgentKit platform.
        tenant_id: Tenant identifier for multi-tenant isolation.
        api_config: Optional API configuration dict for AgentkitMemory client.

    Example:
        >>> bridge = AgentkitMemoryBridge(
        ...     collection_name="my-agent-memory",
        ...     tenant_id="user-123",
        ... )
        >>> record_id = await bridge.add("Important fact about user")
        >>> results = await bridge.search("user preferences")
    """

    def __init__(
        self,
        collection_name: str = "default",
        tenant_id: str = "default",
        api_config: Optional[Dict[str, Any]] = None,
    ):
        """Initialize the AgentKit memory bridge.

        Args:
            collection_name: Memory collection name on AgentKit platform.
            tenant_id: Tenant ID for isolation.
            api_config: Optional API configuration for the SDK client.
        """
        super().__init__(tenant_id=tenant_id)
        self.collection_name = collection_name
        self.api_config = api_config or {}
        self._client = None
        self._connection_info = None
        self._initialized = False

    async def _ensure_initialized(self) -> None:
        """Lazily initialize the AgentKit memory client and connection.

        Raises:
            MemoryConnectionError: If initialization fails.
        """
        if self._initialized:
            return

        try:
            from agentkit.sdk.memory import AgentkitMemory

            self._client = AgentkitMemory(**self.api_config)
            self._connection_info = (
                self._client.get_memory_connection_info(
                    collection_name=self.collection_name
                )
            )
            self._initialized = True
            logger.info(
                f"AgentKit memory bridge initialized: "
                f"collection={self.collection_name}"
            )
        except ImportError:
            logger.warning(
                "agentkit-sdk-python not installed. "
                "Install with: pip install agentkit-sdk-python"
            )
            # Operate in standalone mode with in-memory fallback
            self._initialized = True
            self._records: Dict[str, MemoryRecord] = {}
            logger.info("AgentKit memory bridge in standalone (in-memory) mode")
        except Exception as e:
            raise MemoryConnectionError(
                f"Failed to initialize AgentKit memory: {e}"
            ) from e

    async def add(
        self,
        content: str,
        metadata: Optional[Dict[str, Any]] = None,
        record_id: Optional[str] = None,
    ) -> str:
        """Add a memory record.

        Args:
            content: Text content to store.
            metadata: Optional metadata dict.
            record_id: Optional explicit record ID.

        Returns:
            The record ID of the stored memory.
        """
        await self._ensure_initialized()

        record_id = record_id or self._generate_record_id()
        metadata = metadata or {}
        metadata["tenant_id"] = self.tenant_id

        if self._client and self._connection_info:
            try:
                # Use AgentKit data-plane API
                self._client.add_memories(
                    collection_name=self.collection_name,
                    memories=[{
                        "id": record_id,
                        "content": content,
                        "metadata": metadata,
                        "user_id": self.tenant_id,
                    }],
                )
            except Exception as e:
                logger.error(f"AgentKit memory add failed: {e}")
                raise MemoryError(f"Failed to add memory: {e}") from e
        else:
            # Standalone fallback
            record = MemoryRecord(
                id=record_id,
                content=content,
                metadata=metadata,
                tenant_id=self.tenant_id,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
            self._records[record_id] = record

        return record_id

    async def search(
        self,
        query: str,
        limit: int = 10,
        metadata_filter: Optional[Dict[str, Any]] = None,
        min_score: float = 0.0,
    ) -> List[SearchResult]:
        """Search memory records by semantic similarity.

        Args:
            query: Search query string.
            limit: Maximum number of results.
            metadata_filter: Optional metadata filters.
            min_score: Minimum relevance score threshold.

        Returns:
            List of SearchResult objects sorted by relevance.
        """
        await self._ensure_initialized()

        if self._client and self._connection_info:
            try:
                results = self._client.search_memory(
                    collection_name=self.collection_name,
                    query=query,
                    user_id=self.tenant_id,
                    limit=limit,
                )
                return [
                    SearchResult(
                        record=MemoryRecord(
                            id=r.get("id", ""),
                            content=r.get("content", ""),
                            metadata=r.get("metadata", {}),
                            tenant_id=self.tenant_id,
                        ),
                        score=r.get("score", 0.0),
                    )
                    for r in (results or [])
                    if r.get("score", 0.0) >= min_score
                ]
            except Exception as e:
                logger.error(f"AgentKit memory search failed: {e}")
                return []
        else:
            # Standalone: simple keyword matching
            results = []
            query_lower = query.lower()
            for record in self._records.values():
                if record.tenant_id != self.tenant_id:
                    continue
                score = 1.0 if query_lower in record.content.lower() else 0.0
                if score >= min_score:
                    results.append(SearchResult(record=record, score=score))
            results.sort(key=lambda r: r.score, reverse=True)
            return results[:limit]

    async def update(
        self,
        record_id: str,
        content: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """Update an existing memory record.

        Args:
            record_id: ID of the record to update.
            content: New content (optional).
            metadata: New metadata (optional).

        Returns:
            True if update succeeded, False otherwise.
        """
        await self._ensure_initialized()

        if self._client and self._connection_info:
            try:
                # AgentKit memory update via delete + re-add
                await self.delete(record_id)
                await self.add(
                    content=content or "",
                    metadata=metadata,
                    record_id=record_id,
                )
                return True
            except Exception as e:
                logger.error(f"AgentKit memory update failed: {e}")
                return False
        else:
            if record_id in self._records:
                record = self._records[record_id]
                if content is not None:
                    record.content = content
                if metadata is not None:
                    record.metadata.update(metadata)
                record.updated_at = datetime.utcnow()
                return True
            return False

    async def delete(self, record_id: str) -> bool:
        """Delete a memory record.

        Args:
            record_id: ID of the record to delete.

        Returns:
            True if deletion succeeded.
        """
        await self._ensure_initialized()

        if self._client and self._connection_info:
            try:
                self._client.delete_memory(
                    collection_name=self.collection_name,
                    memory_id=record_id,
                )
                return True
            except Exception as e:
                logger.error(f"AgentKit memory delete failed: {e}")
                return False
        else:
            return self._records.pop(record_id, None) is not None

    async def get(self, record_id: str) -> Optional[MemoryRecord]:
        """Get a specific memory record by ID.

        Args:
            record_id: The record identifier.

        Returns:
            MemoryRecord if found, None otherwise.
        """
        await self._ensure_initialized()

        if self._client and self._connection_info:
            try:
                results = self._client.search_memory(
                    collection_name=self.collection_name,
                    query="",
                    user_id=self.tenant_id,
                    limit=1,
                    filters={"id": record_id},
                )
                if results:
                    r = results[0]
                    return MemoryRecord(
                        id=r.get("id", ""),
                        content=r.get("content", ""),
                        metadata=r.get("metadata", {}),
                        tenant_id=self.tenant_id,
                    )
                return None
            except Exception:
                return None
        else:
            return self._records.get(record_id)

    async def list_all(
        self,
        limit: int = 100,
        offset: int = 0,
        metadata_filter: Optional[Dict[str, Any]] = None,
    ) -> List[MemoryRecord]:
        """List all memory records with pagination.

        Args:
            limit: Maximum number of records.
            offset: Offset for pagination.
            metadata_filter: Optional metadata filters.

        Returns:
            List of MemoryRecord objects.
        """
        await self._ensure_initialized()

        if self._client and self._connection_info:
            try:
                results = self._client.list_memories(
                    collection_name=self.collection_name,
                    user_id=self.tenant_id,
                    limit=limit,
                    offset=offset,
                )
                return [
                    MemoryRecord(
                        id=r.get("id", ""),
                        content=r.get("content", ""),
                        metadata=r.get("metadata", {}),
                        tenant_id=self.tenant_id,
                    )
                    for r in (results or [])
                ]
            except Exception as e:
                logger.error(f"AgentKit memory list failed: {e}")
                return []
        else:
            records = [
                r for r in self._records.values()
                if r.tenant_id == self.tenant_id
            ]
            return records[offset: offset + limit]

    async def clear(self) -> int:
        """Clear all memory records for this tenant.

        Returns:
            Number of records cleared.
        """
        await self._ensure_initialized()

        if self._client and self._connection_info:
            try:
                self._client.delete_all_memories(
                    collection_name=self.collection_name,
                    user_id=self.tenant_id,
                )
                return -1  # Unknown count from platform
            except Exception as e:
                logger.error(f"AgentKit memory clear failed: {e}")
                return 0
        else:
            count = sum(
                1 for r in self._records.values()
                if r.tenant_id == self.tenant_id
            )
            self._records = {
                k: v for k, v in self._records.items()
                if v.tenant_id != self.tenant_id
            }
            return count
