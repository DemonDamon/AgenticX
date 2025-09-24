"""Base classes for AgenticX Knowledge Management System"""

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Union, AsyncIterator
from dataclasses import dataclass
from pathlib import Path

from ..retrieval.base import BaseRetriever


class KnowledgeError(Exception):
    """Base exception for knowledge management errors"""
    pass


class ChunkingError(KnowledgeError):
    """Exception raised during document chunking"""
    pass


class ReaderError(KnowledgeError):
    """Exception raised during document reading"""
    pass


@dataclass
class ChunkingConfig:
    """Configuration for document chunking"""
    chunk_size: int = 1000
    chunk_overlap: int = 200
    separator: str = "\n\n"
    keep_separator: bool = True
    add_start_index: bool = True
    strip_whitespace: bool = True
    

class BaseChunker(ABC):
    """Abstract base class for document chunkers"""
    
    def __init__(self, config: Optional[ChunkingConfig] = None):
        self.config = config or ChunkingConfig()
    
    @abstractmethod
    def chunk_text(self, text: str, metadata: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """Split text into chunks
        
        Args:
            text: Text to chunk
            metadata: Optional metadata to attach to chunks
            
        Returns:
            List of chunk dictionaries with 'content' and 'metadata' keys
        """
        pass
    
    @abstractmethod
    def chunk_document(self, document: "Document") -> List["Document"]:
        """Split document into chunk documents
        
        Args:
            document: Document to chunk
            
        Returns:
            List of chunk documents
        """
        pass


class BaseReader(ABC):
    """Abstract base class for document readers"""
    
    def __init__(self, name: Optional[str] = None, chunker: Optional[BaseChunker] = None):
        self.name = name or self.__class__.__name__
        self.chunker = chunker
    
    @abstractmethod
    def read(self, source: Union[str, Path], **kwargs) -> List["Document"]:
        """Read documents from source
        
        Args:
            source: Source path, URL, or identifier
            **kwargs: Additional reader-specific arguments
            
        Returns:
            List of documents
        """
        pass
    
    @abstractmethod
    async def read_async(self, source: Union[str, Path], **kwargs) -> AsyncIterator["Document"]:
        """Asynchronously read documents from source
        
        Args:
            source: Source path, URL, or identifier
            **kwargs: Additional reader-specific arguments
            
        Yields:
            Documents one by one
        """
        pass
    
    def supports_source(self, source: Union[str, Path]) -> bool:
        """Check if reader supports the given source
        
        Args:
            source: Source to check
            
        Returns:
            True if reader can handle this source
        """
        return True


class BaseKnowledge(ABC):
    """Abstract base class for knowledge management"""
    
    def __init__(
        self,
        name: str,
        description: Optional[str] = None,
        retriever: Optional[BaseRetriever] = None,
        **kwargs
    ):
        self.name = name
        self.description = description
        self.retriever = retriever
    
    @abstractmethod
    def add_content(
        self,
        content: Optional[str] = None,
        source: Optional[Union[str, Path]] = None,
        name: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        reader: Optional[BaseReader] = None,
        **kwargs
    ) -> List[str]:
        """Add content to knowledge base
        
        Args:
            content: Raw text content
            source: Source path, URL, or identifier
            name: Name for the content
            metadata: Additional metadata
            reader: Custom reader for the source
            **kwargs: Additional arguments
            
        Returns:
            List of document IDs that were added
        """
        pass
    
    @abstractmethod
    async def add_content_async(
        self,
        content: Optional[str] = None,
        source: Optional[Union[str, Path]] = None,
        name: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        reader: Optional[BaseReader] = None,
        **kwargs
    ) -> List[str]:
        """Asynchronously add content to knowledge base"""
        pass
    
    @abstractmethod
    def search(
        self,
        query: str,
        limit: int = 10,
        filters: Optional[Dict[str, Any]] = None,
        **kwargs
    ) -> List["Document"]:
        """Search knowledge base
        
        Args:
            query: Search query
            limit: Maximum number of results
            filters: Optional filters to apply
            **kwargs: Additional search arguments
            
        Returns:
            List of relevant documents
        """
        pass
    
    @abstractmethod
    async def search_async(
        self,
        query: str,
        limit: int = 10,
        filters: Optional[Dict[str, Any]] = None,
        **kwargs
    ) -> List["Document"]:
        """Asynchronously search knowledge base"""
        pass
    
    @abstractmethod
    def delete_content(
        self,
        document_ids: Optional[List[str]] = None,
        filters: Optional[Dict[str, Any]] = None,
        **kwargs
    ) -> int:
        """Delete content from knowledge base
        
        Args:
            document_ids: Specific document IDs to delete
            filters: Filters to select documents for deletion
            **kwargs: Additional arguments
            
        Returns:
            Number of documents deleted
        """
        pass
    
    @abstractmethod
    def get_stats(self) -> Dict[str, Any]:
        """Get knowledge base statistics
        
        Returns:
            Dictionary with statistics like document count, size, etc.
        """
        pass
    
    @abstractmethod
    def clear(self) -> None:
        """Clear all content from knowledge base"""
        pass