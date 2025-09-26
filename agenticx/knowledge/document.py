"""Document models for AgenticX Knowledge Management System"""

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Union
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class DocumentMetadata:
    """Metadata for documents in the knowledge base"""

    # Core identification
    document_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    name: Optional[str] = None
    source: Optional[str] = None
    source_type: Optional[str] = None  # 'file', 'url', 'text', etc.
    
    # Content information
    content_type: Optional[str] = None  # 'text/plain', 'application/pdf', etc.
    language: Optional[str] = None
    encoding: Optional[str] = None
    size: Optional[int] = None  # Content size in bytes
    
    # Timestamps
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: Optional[datetime] = None
    indexed_at: Optional[datetime] = None
    
    # Processing information
    reader_name: Optional[str] = None
    chunker_name: Optional[str] = None
    embedding_model: Optional[str] = None
    
    # Custom metadata
    tags: List[str] = field(default_factory=list)
    custom: Dict[str, Any] = field(default_factory=dict)
    
    # Relationships
    parent_id: Optional[str] = None  # For chunks, reference to parent document
    chunk_index: Optional[int] = None  # Position in parent document
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert metadata to dictionary"""
        result = {
            'document_id': self.document_id,
            'name': self.name,
            'source': self.source,
            'source_type': self.source_type,
            'content_type': self.content_type,
            'language': self.language,
            'encoding': self.encoding,
            'size': self.size,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'indexed_at': self.indexed_at.isoformat() if self.indexed_at else None,
            'reader_name': self.reader_name,
            'chunker_name': self.chunker_name,
            'embedding_model': self.embedding_model,
            'tags': self.tags,
            'custom': self.custom,
            'parent_id': self.parent_id,
            'chunk_index': self.chunk_index,
        }
        return {k: v for k, v in result.items() if v is not None}
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'DocumentMetadata':
        """Create metadata from dictionary"""
        # Handle datetime parsing
        for field_name in ['created_at', 'updated_at', 'indexed_at']:
            if field_name in data and isinstance(data[field_name], str):
                data[field_name] = datetime.fromisoformat(data[field_name])
        
        # Extract known fields
        known_fields = {
            'document_id', 'name', 'source', 'source_type', 'content_type',
            'language', 'encoding', 'size', 'created_at', 'updated_at', 'indexed_at',
            'reader_name', 'chunker_name', 'embedding_model', 'tags', 'custom',
            'parent_id', 'chunk_index'
        }
        
        kwargs = {k: v for k, v in data.items() if k in known_fields}
        
        # Handle missing defaults
        if 'tags' not in kwargs:
            kwargs['tags'] = []
        if 'custom' not in kwargs:
            kwargs['custom'] = {}
            
        return cls(**kwargs)


@dataclass
class ChunkMetadata(DocumentMetadata):
    """Specialized metadata for document chunks"""
    
    # Chunk-specific information
    start_index: Optional[int] = None  # Character start position in parent
    end_index: Optional[int] = None    # Character end position in parent
    chunk_size: Optional[int] = None   # Size of this chunk
    overlap_size: Optional[int] = None # Overlap with adjacent chunks
    
    # Chunk relationships
    previous_chunk_id: Optional[str] = None
    next_chunk_id: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert chunk metadata to dictionary"""
        result = super().to_dict()
        result.update({
            'start_index': self.start_index,
            'end_index': self.end_index,
            'chunk_size': self.chunk_size,
            'overlap_size': self.overlap_size,
            'previous_chunk_id': self.previous_chunk_id,
            'next_chunk_id': self.next_chunk_id,
        })
        return {k: v for k, v in result.items() if v is not None}


class Document:
    """Document class for the knowledge management system"""
    
    def __init__(
        self,
        content: str,
        metadata: Optional[Union[DocumentMetadata, Dict[str, Any]]] = None,
        embedding: Optional[List[float]] = None,
        score: Optional[float] = None
    ):
        self.content = content
        
        # Handle metadata
        if metadata is None:
            self.metadata = DocumentMetadata()
        elif isinstance(metadata, dict):
            self.metadata = DocumentMetadata.from_dict(metadata)
        else:
            self.metadata = metadata
            
        self.embedding = embedding
        self.score = score  # Relevance score from search
        
        # Update size if not set
        if self.metadata.size is None:
            self.metadata.size = len(content.encode('utf-8'))
    
    @property
    def id(self) -> str:
        """Get document ID"""
        return self.metadata.document_id
    
    @property
    def name(self) -> Optional[str]:
        """Get document name"""
        return self.metadata.name
    
    @property
    def source(self) -> Optional[str]:
        """Get document source"""
        return self.metadata.source
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert document to dictionary"""
        result = {
            'content': self.content,
            'metadata': self.metadata.to_dict(),
        }
        
        if self.embedding is not None:
            result['embedding'] = self.embedding
        if self.score is not None:
            result['score'] = self.score
            
        return result
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'Document':
        """Create document from dictionary"""
        return cls(
            content=data['content'],
            metadata=data.get('metadata'),
            embedding=data.get('embedding'),
            score=data.get('score')
        )
    
    def create_chunk(
        self,
        chunk_content: str,
        chunk_index: int,
        start_index: Optional[int] = None,
        end_index: Optional[int] = None,
        **kwargs
    ) -> 'Document':
        """Create a chunk document from this document"""
        
        # Create chunk metadata based on parent metadata
        chunk_metadata = ChunkMetadata(
            name=f"{self.metadata.name}_chunk_{chunk_index}" if self.metadata.name else None,
            source=self.metadata.source,
            source_type=self.metadata.source_type,
            content_type=self.metadata.content_type,
            language=self.metadata.language,
            encoding=self.metadata.encoding,
            reader_name=self.metadata.reader_name,
            chunker_name=self.metadata.chunker_name,
            embedding_model=self.metadata.embedding_model,
            tags=self.metadata.tags.copy(),
            custom=self.metadata.custom.copy(),
            parent_id=self.metadata.document_id,
            chunk_index=chunk_index,
            start_index=start_index,
            end_index=end_index,
            **kwargs
        )
        
        return Document(
            content=chunk_content,
            metadata=chunk_metadata
        )
    
    def update_metadata(self, **kwargs) -> None:
        """Update document metadata"""
        for key, value in kwargs.items():
            if hasattr(self.metadata, key):
                setattr(self.metadata, key, value)
            else:
                self.metadata.custom[key] = value
        
        self.metadata.updated_at = datetime.now(timezone.utc)
    
    def add_tag(self, tag: str) -> None:
        """Add a tag to the document"""
        if tag not in self.metadata.tags:
            self.metadata.tags.append(tag)
            self.metadata.updated_at = datetime.now(timezone.utc)
    
    def remove_tag(self, tag: str) -> None:
        """Remove a tag from the document"""
        if tag in self.metadata.tags:
            self.metadata.tags.remove(tag)
            self.metadata.updated_at = datetime.now(timezone.utc)
    
    def has_tag(self, tag: str) -> bool:
        """Check if document has a specific tag"""
        return tag in self.metadata.tags
    
    def is_chunk(self) -> bool:
        """Check if this document is a chunk of another document"""
        return self.metadata.parent_id is not None
    
    def __str__(self) -> str:
        return f"Document(id={self.id}, name={self.name}, size={len(self.content)})"
    
    def __repr__(self) -> str:
        return self.__str__()