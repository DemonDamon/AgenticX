"""Fixed Size Chunker for AgenticX Knowledge Management System

This module provides fixed size chunking with smart boundary detection.
"""

import logging
import time
from typing import List, Optional, Dict, Any

from ..base import ChunkingConfig
from ..document import Document, DocumentMetadata, ChunkMetadata
from .framework import AdvancedBaseChunker, ChunkingResult, ChunkMetrics

logger = logging.getLogger(__name__)


class FixedSizeChunker(AdvancedBaseChunker):
    """Fixed size chunker with smart boundary detection"""
    
    def __init__(self, config: Optional[ChunkingConfig] = None, **kwargs):
        super().__init__(config, **kwargs)
        self.respect_word_boundaries = kwargs.get('respect_word_boundaries', True)
        self.overlap_size = kwargs.get('overlap_size', self.config.chunk_overlap)
    
    def chunk_text(self, text: str, metadata: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """Split text into fixed-size chunks
        
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
                'chunker': 'FixedSizeChunker'
            })
            
            result.append({
                'content': chunk.content,
                'metadata': chunk_metadata
            })
        
        return result
    
    async def chunk_document_async(self, document: Document) -> ChunkingResult:
        """Chunk document into fixed-size chunks"""
        start_time = time.time()
        
        try:
            chunks = self._create_fixed_chunks(document)
            metrics = await self._evaluate_chunks(chunks)
            
            return ChunkingResult(
                chunks=chunks,
                strategy_used="fixed_size",
                processing_time=time.time() - start_time,
                metrics=metrics,
                metadata={
                    'chunk_size': self.config.chunk_size,
                    'overlap_size': self.overlap_size,
                    'respect_word_boundaries': self.respect_word_boundaries
                }
            )
            
        except Exception as e:
            logger.error(f"Fixed size chunking failed: {e}")
            return ChunkingResult(
                strategy_used="fixed_size",
                processing_time=time.time() - start_time,
                success=False,
                error=str(e)
            )
    
    def _create_fixed_chunks(self, document: Document) -> List[Document]:
        """Create fixed-size chunks with optional overlap"""
        text = document.content
        chunks = []
        
        step_size = self.config.chunk_size - self.overlap_size
        
        for i in range(0, len(text), step_size):
            chunk_end = min(i + self.config.chunk_size, len(text))
            chunk_content = text[i:chunk_end]
            
            # Respect word boundaries if enabled
            if self.respect_word_boundaries and chunk_end < len(text):
                # Find the last complete word
                last_space = chunk_content.rfind(' ')
                if last_space > len(chunk_content) * 0.8:  # Only if we don't lose too much
                    chunk_content = chunk_content[:last_space]
            
            if chunk_content.strip():
                chunk_metadata = ChunkMetadata(
                    name=f"{document.metadata.name}_fixed_{len(chunks)+1}",
                    source=document.metadata.source,
                    source_type=document.metadata.source_type,
                    content_type=document.metadata.content_type,
                    parent_id=document.metadata.document_id,
                    chunk_index=len(chunks),
                    start_index=i,
                    end_index=i + len(chunk_content),
                    chunk_size=len(chunk_content),
                    overlap_size=self.overlap_size if len(chunks) > 0 else 0,
                    chunker_name="FixedSizeChunker"
                )
                
                chunks.append(Document(content=chunk_content, metadata=chunk_metadata))
        
        return chunks
    
    async def _evaluate_chunks(self, chunks: List[Document]) -> ChunkMetrics:
        """Evaluate fixed size chunk quality"""
        metrics = ChunkMetrics()
        
        if not chunks:
            return metrics
        
        # Size evaluation (should be very good for fixed size)
        target_size = self.config.chunk_size
        size_scores = []
        for chunk in chunks:
            size = len(chunk.content)
            ratio = min(size, target_size) / max(size, target_size)
            size_scores.append(ratio)
        
        metrics.size_score = sum(size_scores) / len(size_scores)
        
        # Overlap evaluation
        if self.overlap_size > 0:
            metrics.overlap_score = 0.9  # Good overlap by design
        else:
            metrics.overlap_score = 0.5  # No overlap
        
        # Other scores depend on word boundary respect
        if self.respect_word_boundaries:
            metrics.boundary_score = 0.8
            metrics.completeness_score = 0.75
        else:
            metrics.boundary_score = 0.5
            metrics.completeness_score = 0.6
        
        metrics.coherence_score = 0.6  # Fixed size may break coherence
        
        metrics.calculate_overall_score()
        return metrics