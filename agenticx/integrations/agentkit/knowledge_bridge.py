#!/usr/bin/env python3
"""AgentKit Knowledge Bridge for AgenticX.

Bridges AgenticX knowledge system to AgentKit managed VikingDB knowledge
service. Supports document ingestion, vector search, and knowledge base
management through the AgentKit platform.

Author: Damon Li
"""

import logging
import os
from typing import Any, Dict, List, Optional

from agenticx.knowledge.base import BaseKnowledge
from agenticx.knowledge.document import Document, DocumentMetadata

logger = logging.getLogger(__name__)


class AgentkitKnowledgeBridge(BaseKnowledge):
    """Bridge AgenticX knowledge to AgentKit VikingDB knowledge service.

    This implementation connects to the AgentKit platform's knowledge
    service, which uses VikingDB as the vector database backend for
    retrieval-augmented generation (RAG) applications.

    Args:
        collection_name: VikingDB collection name for this knowledge base.
        api_config: Optional API configuration for AgentkitKnowledge client.
        embedding_model: Embedding model name for vectorization.

    Example:
        >>> bridge = AgentkitKnowledgeBridge(
        ...     collection_name="product-docs",
        ... )
        >>> doc_ids = await bridge.add_content_async(
        ...     content="Product manual text...",
        ...     source="manual.txt"
        ... )
        >>> results = await bridge.search_async("How to configure?")
    """

    def __init__(
        self,
        collection_name: Optional[str] = None,
        api_config: Optional[Dict[str, Any]] = None,
        embedding_model: str = "doubao-embedding",
    ):
        """Initialize the AgentKit knowledge bridge.

        Args:
            collection_name: VikingDB collection name. Auto-detected from
                DATABASE_VIKING_COLLECTION env var if not provided.
            api_config: Optional API configuration for the SDK client.
            embedding_model: Embedding model for vectorization.
        """
        self.collection_name = (
            collection_name
            or os.getenv("DATABASE_VIKING_COLLECTION", "default")
        )
        self.api_config = api_config or {}
        self.embedding_model = embedding_model
        self._client = None
        self._connection_info = None
        self._initialized = False
        # Standalone fallback storage
        self._documents: Dict[str, Document] = {}

    async def _ensure_initialized(self) -> None:
        """Lazily initialize the knowledge client."""
        if self._initialized:
            return

        try:
            from agentkit.sdk.knowledge import AgentkitKnowledge

            self._client = AgentkitKnowledge(**self.api_config)
            self._connection_info = (
                self._client.get_knowledge_connection_info(
                    collection_name=self.collection_name
                )
            )
            self._initialized = True
            logger.info(
                f"AgentKit knowledge bridge initialized: "
                f"collection={self.collection_name}"
            )
        except ImportError:
            logger.warning(
                "agentkit-sdk-python not installed. "
                "Operating in standalone (in-memory) mode."
            )
            self._initialized = True
        except Exception as e:
            logger.error(f"Failed to init AgentKit knowledge: {e}")
            self._initialized = True

    def add_content(
        self,
        content: Any,
        source: str = "",
        name: str = "",
        metadata: Optional[Dict[str, Any]] = None,
        reader: Optional[Any] = None,
        **kwargs: Any,
    ) -> List[str]:
        """Add content to the knowledge base (sync).

        Args:
            content: Content to add (string, file path, etc.).
            source: Source identifier.
            name: Content name.
            metadata: Optional metadata.
            reader: Optional reader for file processing.
            **kwargs: Additional arguments.

        Returns:
            List of document IDs created.
        """
        import asyncio
        return asyncio.get_event_loop().run_until_complete(
            self.add_content_async(
                content, source, name, metadata, reader, **kwargs
            )
        )

    async def add_content_async(
        self,
        content: Any,
        source: str = "",
        name: str = "",
        metadata: Optional[Dict[str, Any]] = None,
        reader: Optional[Any] = None,
        **kwargs: Any,
    ) -> List[str]:
        """Add content to the knowledge base (async).

        Args:
            content: Content to add.
            source: Source identifier.
            name: Content name.
            metadata: Optional metadata.
            reader: Optional reader.
            **kwargs: Additional arguments.

        Returns:
            List of document IDs created.
        """
        await self._ensure_initialized()

        import uuid
        doc_id = str(uuid.uuid4())
        text = str(content) if not isinstance(content, str) else content

        doc = Document(
            id=doc_id,
            content=text,
            metadata=DocumentMetadata(
                source=source,
                name=name or source,
                extra=metadata or {},
            ),
        )

        if self._client and self._connection_info:
            try:
                self._client.add_document(
                    collection_name=self.collection_name,
                    document={
                        "id": doc_id,
                        "content": text,
                        "metadata": metadata or {},
                        "source": source,
                    },
                )
            except Exception as e:
                logger.error(f"AgentKit knowledge add failed: {e}")
                # Fall through to local storage
                self._documents[doc_id] = doc
        else:
            self._documents[doc_id] = doc

        return [doc_id]

    def search(
        self,
        query: str,
        limit: int = 5,
        filters: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> List[Document]:
        """Search the knowledge base (sync).

        Args:
            query: Search query.
            limit: Maximum results.
            filters: Optional filters.
            **kwargs: Additional arguments.

        Returns:
            List of matching Documents.
        """
        import asyncio
        return asyncio.get_event_loop().run_until_complete(
            self.search_async(query, limit, filters, **kwargs)
        )

    async def search_async(
        self,
        query: str,
        limit: int = 5,
        filters: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> List[Document]:
        """Search the knowledge base (async).

        Args:
            query: Search query.
            limit: Maximum results.
            filters: Optional filters.
            **kwargs: Additional arguments.

        Returns:
            List of matching Documents.
        """
        await self._ensure_initialized()

        if self._client and self._connection_info:
            try:
                results = self._client.search(
                    collection_name=self.collection_name,
                    query=query,
                    limit=limit,
                )
                return [
                    Document(
                        id=r.get("id", ""),
                        content=r.get("content", ""),
                        metadata=DocumentMetadata(
                            source=r.get("source", ""),
                            extra=r.get("metadata", {}),
                        ),
                    )
                    for r in (results or [])
                ]
            except Exception as e:
                logger.error(f"AgentKit knowledge search failed: {e}")
                return []
        else:
            # Simple keyword matching fallback
            query_lower = query.lower()
            matches = [
                doc for doc in self._documents.values()
                if query_lower in doc.content.lower()
            ]
            return matches[:limit]

    def delete_content(
        self,
        document_ids: Optional[List[str]] = None,
        filters: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> int:
        """Delete content from the knowledge base.

        Args:
            document_ids: IDs of documents to delete.
            filters: Optional filters for bulk deletion.
            **kwargs: Additional arguments.

        Returns:
            Number of documents deleted.
        """
        count = 0
        if document_ids:
            for doc_id in document_ids:
                if doc_id in self._documents:
                    del self._documents[doc_id]
                    count += 1
        return count

    def get_stats(self) -> Dict[str, Any]:
        """Get knowledge base statistics.

        Returns:
            Dictionary with knowledge base stats.
        """
        return {
            "collection_name": self.collection_name,
            "document_count": len(self._documents),
            "initialized": self._initialized,
            "connected": self._client is not None,
        }

    def clear(self) -> None:
        """Clear all content from the knowledge base."""
        self._documents.clear()
        if self._client:
            try:
                self._client.delete_knowledge_base(
                    collection_name=self.collection_name
                )
            except Exception as e:
                logger.error(f"AgentKit knowledge clear failed: {e}")
