"""CSV Row Chunker for AgenticX Knowledge Management System

This module provides specialized chunking for CSV data that chunks by rows.
"""

import logging
import time
from typing import List, Optional

from ..base import ChunkingConfig
from ..document import Document, DocumentMetadata, ChunkMetadata
from .framework import AdvancedBaseChunker, ChunkingResult, ChunkMetrics

logger = logging.getLogger(__name__)


class CSVRowChunker(AdvancedBaseChunker):
    """Specialized chunker for CSV data that chunks by rows"""
    
    def __init__(self, config: Optional[ChunkingConfig] = None, **kwargs):
        super().__init__(config, **kwargs)
        self.rows_per_chunk = kwargs.get('rows_per_chunk', 100)
        self.include_header = kwargs.get('include_header', True)
        self.delimiter = kwargs.get('delimiter', ',')
    
    async def chunk_document_async(self, document: Document) -> ChunkingResult:
        """Chunk CSV document by rows"""
        start_time = time.time()
        
        try:
            chunks = self._chunk_csv_rows(document)
            metrics = await self._evaluate_chunks(chunks)
            
            return ChunkingResult(
                chunks=chunks,
                strategy_used="csv_row",
                processing_time=time.time() - start_time,
                metrics=metrics,
                metadata={
                    'rows_per_chunk': self.rows_per_chunk,
                    'include_header': self.include_header,
                    'delimiter': self.delimiter
                }
            )
            
        except Exception as e:
            logger.error(f"CSV row chunking failed: {e}")
            return ChunkingResult(
                strategy_used="csv_row",
                processing_time=time.time() - start_time,
                success=False,
                error=str(e)
            )
    
    def _chunk_csv_rows(self, document: Document) -> List[Document]:
        """Chunk CSV by rows"""
        lines = document.content.strip().split('\n')
        
        if not lines:
            return []
        
        chunks = []
        header = lines[0] if self.include_header and lines else None
        data_lines = lines[1:] if header else lines
        
        # Chunk data rows
        for i in range(0, len(data_lines), self.rows_per_chunk):
            chunk_lines = data_lines[i:i + self.rows_per_chunk]
            
            # Include header if specified
            if header and self.include_header:
                chunk_content = header + '\n' + '\n'.join(chunk_lines)
            else:
                chunk_content = '\n'.join(chunk_lines)
            
            chunk_metadata = ChunkMetadata(
                name=f"{document.metadata.name}_csv_{len(chunks)+1}",
                source=document.metadata.source,
                source_type=document.metadata.source_type,
                content_type=document.metadata.content_type,
                parent_id=document.metadata.document_id,
                chunk_index=len(chunks),
                chunker_name="CSVRowChunker"
            )
            chunk_metadata.custom.update({
                'row_start': i + (1 if header else 0),
                'row_end': min(i + self.rows_per_chunk, len(data_lines)) + (1 if header else 0),
                'row_count': len(chunk_lines),
                'has_header': header is not None and self.include_header
            })
            
            chunks.append(Document(content=chunk_content, metadata=chunk_metadata))
        
        return chunks
    
    async def _evaluate_chunks(self, chunks: List[Document]) -> ChunkMetrics:
        """Evaluate CSV chunk quality"""
        metrics = ChunkMetrics()
        
        if not chunks:
            return metrics
        
        # CSV chunking should have excellent structure preservation
        metrics.boundary_score = 1.0  # Perfect row boundaries
        metrics.completeness_score = 1.0  # Complete rows
        metrics.coherence_score = 0.9  # Related data rows
        metrics.overlap_score = 0.9 if self.include_header else 0.5  # Header overlap
        
        # Size evaluation based on row count rather than character count
        target_rows = self.rows_per_chunk
        size_scores = []
        for chunk in chunks:
            row_count = chunk.metadata.custom.get('row_count', 0)
            if row_count <= target_rows:
                size_scores.append(1.0)
            else:
                size_scores.append(target_rows / row_count)
        
        metrics.size_score = sum(size_scores) / len(size_scores)
        
        metrics.calculate_overall_score()
        return metrics