"""Recursive Chunker for AgenticX Knowledge Management System

This module provides enhanced recursive chunking with multiple splitting strategies.
"""

import logging
import time
from typing import List, Optional, Dict, Any

from ..base import ChunkingConfig
from ..document import Document, DocumentMetadata, ChunkMetadata
from .framework import AdvancedBaseChunker, ChunkingResult, ChunkMetrics

logger = logging.getLogger(__name__)


class RecursiveChunker(AdvancedBaseChunker):
    """Enhanced recursive chunker with multiple splitting strategies"""
    
    def __init__(self, config: Optional[ChunkingConfig] = None, **kwargs):
        super().__init__(config, **kwargs)
        self.separators = kwargs.get('separators', ['\n\n', '\n', '. ', ' '])
        self.keep_separator = kwargs.get('keep_separator', True)
    
    def chunk_text(self, text: str, metadata: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """Split text into chunks using recursive splitting
        
        Args:
            text: Text to chunk
            metadata: Optional metadata to attach to chunks
            
        Returns:
            List of chunk dictionaries with 'content' and 'metadata' keys
        """
        # Create a temporary document for processing
        doc_metadata = DocumentMetadata(
            name=metadata.get('name', 'temp_doc') if metadata else 'temp_doc',
            source=metadata.get('source', 'text') if metadata else 'text',
            source_type='text'
        )
        document = Document(content=text, metadata=doc_metadata)
        
        # Use the async method synchronously
        chunks = self.chunk_document(document)
        
        # Convert to the expected format
        result = []
        for i, chunk in enumerate(chunks):
            chunk_metadata = metadata.copy() if metadata else {}
            chunk_metadata.update({
                'chunk_index': i,
                'chunk_size': len(chunk.content),
                'chunker': 'RecursiveChunker'
            })
            
            result.append({
                'content': chunk.content,
                'metadata': chunk_metadata
            })
        
        return result
    
    async def chunk_document_async(self, document: Document) -> ChunkingResult:
        """Recursively chunk document using multiple separators"""
        start_time = time.time()
        
        try:
            chunks = self._recursive_split(document.content, document)
            metrics = await self._evaluate_chunks(chunks)
            
            return ChunkingResult(
                chunks=chunks,
                strategy_used="recursive",
                processing_time=time.time() - start_time,
                metrics=metrics,
                metadata={
                    'separators_used': self.separators,
                    'keep_separator': self.keep_separator
                }
            )
            
        except Exception as e:
            logger.error(f"Recursive chunking failed: {e}")
            return ChunkingResult(
                strategy_used="recursive",
                processing_time=time.time() - start_time,
                success=False,
                error=str(e)
            )
    
    def _recursive_split(self, text: str, document: Document) -> List[Document]:
        """Recursively split text using different separators"""
        if len(text) <= self.config.chunk_size:
            chunk_metadata = ChunkMetadata(
                name=f"{document.metadata.name}_recursive_1",
                source=document.metadata.source,
                source_type=document.metadata.source_type,
                content_type=document.metadata.content_type,
                parent_id=document.metadata.document_id,
                chunk_index=0,
                chunker_name="RecursiveChunker"
            )
            return [Document(content=text, metadata=chunk_metadata)]
        
        # Try each separator in order
        for separator in self.separators:
            if separator in text:
                parts = text.split(separator)
                if len(parts) > 1:
                    return self._merge_parts(parts, separator, document)
        
        # If no separator works, split by character count
        return self._split_by_size(text, document)
    
    def _merge_parts(self, parts: List[str], separator: str, document: Document) -> List[Document]:
        """Merge parts into appropriately sized chunks"""
        chunks = []
        current_chunk = ""
        
        for part in parts:
            part_with_sep = part + (separator if self.keep_separator else "")
            
            if len(current_chunk) + len(part_with_sep) <= self.config.chunk_size:
                current_chunk += part_with_sep
            else:
                if current_chunk:
                    chunk_metadata = ChunkMetadata(
                        name=f"{document.metadata.name}_recursive_{len(chunks)+1}",
                        source=document.metadata.source,
                        source_type=document.metadata.source_type,
                        content_type=document.metadata.content_type,
                        parent_id=document.metadata.document_id,
                        chunk_index=len(chunks),
                        chunker_name="RecursiveChunker"
                    )
                    chunks.append(Document(content=current_chunk.strip(), metadata=chunk_metadata))
                
                # If part is still too large, recursively split it
                if len(part) > self.config.chunk_size:
                    sub_chunks = self._recursive_split(part, document)
                    for sub_chunk in sub_chunks:
                        sub_chunk.metadata.chunk_index = len(chunks)
                        chunks.append(sub_chunk)
                    current_chunk = ""
                else:
                    current_chunk = part_with_sep
        
        if current_chunk:
            chunk_metadata = ChunkMetadata(
                name=f"{document.metadata.name}_recursive_{len(chunks)+1}",
                source=document.metadata.source,
                source_type=document.metadata.source_type,
                content_type=document.metadata.content_type,
                parent_id=document.metadata.document_id,
                chunk_index=len(chunks),
                chunker_name="RecursiveChunker"
            )
            chunks.append(Document(content=current_chunk.strip(), metadata=chunk_metadata))
        
        return chunks
    
    def _split_by_size(self, text: str, document: Document) -> List[Document]:
        """Split text by character count as last resort"""
        chunks = []
        
        for i in range(0, len(text), self.config.chunk_size):
            chunk_content = text[i:i + self.config.chunk_size]
            
            chunk_metadata = ChunkMetadata(
                name=f"{document.metadata.name}_size_{len(chunks)+1}",
                source=document.metadata.source,
                source_type=document.metadata.source_type,
                content_type=document.metadata.content_type,
                parent_id=document.metadata.document_id,
                chunk_index=len(chunks),
                chunker_name="RecursiveChunker"
            )
            
            chunks.append(Document(content=chunk_content, metadata=chunk_metadata))
        
        return chunks
    
    async def _evaluate_chunks(self, chunks: List[Document]) -> ChunkMetrics:
        """Evaluate recursive chunk quality"""
        metrics = ChunkMetrics()
        
        if not chunks:
            return metrics
        
        # Size evaluation
        target_size = self.config.chunk_size
        size_scores = []
        for chunk in chunks:
            size = len(chunk.content)
            ratio = min(size, target_size) / max(size, target_size)
            size_scores.append(ratio)
        
        metrics.size_score = sum(size_scores) / len(size_scores)
        
        # Recursive chunking provides good boundaries
        metrics.boundary_score = 0.8
        metrics.coherence_score = 0.75
        metrics.completeness_score = 0.8
        metrics.overlap_score = 0.7
        
        metrics.calculate_overall_score()
        return metrics