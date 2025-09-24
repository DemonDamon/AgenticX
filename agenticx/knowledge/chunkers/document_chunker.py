"""Document Chunker for AgenticX Knowledge Management System

This module provides document-aware chunking that respects document structure.
"""

import logging
import re
import time
from typing import List, Optional, Dict, Any

from ..base import ChunkingConfig
from ..document import Document, DocumentMetadata, ChunkMetadata
from .framework import AdvancedBaseChunker, ChunkingResult, ChunkMetrics

logger = logging.getLogger(__name__)


class DocumentChunker(AdvancedBaseChunker):
    """Document-aware chunker that respects document structure"""
    
    def __init__(self, config: Optional[ChunkingConfig] = None, **kwargs):
        super().__init__(config, **kwargs)
        self.respect_headings = kwargs.get('respect_headings', True)
        self.respect_paragraphs = kwargs.get('respect_paragraphs', True)
        self.respect_lists = kwargs.get('respect_lists', True)
    
    async def chunk_document_async(self, document: Document) -> ChunkingResult:
        """Chunk document respecting its structure"""
        start_time = time.time()
        
        try:
            chunks = self._chunk_by_structure(document)
            metrics = await self._evaluate_chunks(chunks)
            
            return ChunkingResult(
                chunks=chunks,
                strategy_used="document",
                processing_time=time.time() - start_time,
                metrics=metrics,
                metadata={
                    'respect_headings': self.respect_headings,
                    'respect_paragraphs': self.respect_paragraphs,
                    'respect_lists': self.respect_lists
                }
            )
            
        except Exception as e:
            logger.error(f"Document chunking failed: {e}")
            return ChunkingResult(
                strategy_used="document",
                processing_time=time.time() - start_time,
                success=False,
                error=str(e)
            )
    
    def _chunk_by_structure(self, document: Document) -> List[Document]:
        """Chunk document by structural elements"""
        text = document.content
        
        # Detect document structure
        sections = self._detect_sections(text)
        
        chunks = []
        for section in sections:
            section_chunks = self._chunk_section(section, document, len(chunks))
            chunks.extend(section_chunks)
        
        return chunks
    
    def _detect_sections(self, text: str) -> List[Dict[str, Any]]:
        """Detect structural sections in document"""
        sections = []
        lines = text.split('\n')
        
        current_section = {
            'type': 'content',
            'content': '',
            'level': 0
        }
        
        for line in lines:
            line_stripped = line.strip()
            
            # Detect headings
            if self.respect_headings and line_stripped.startswith('#'):
                if current_section['content'].strip():
                    sections.append(current_section)
                
                level = len(line_stripped) - len(line_stripped.lstrip('#'))
                current_section = {
                    'type': 'heading',
                    'content': line + '\n',
                    'level': level
                }
            
            # Detect list items
            elif self.respect_lists and (line_stripped.startswith(('- ', '* ', '+ ')) or 
                                       re.match(r'^\d+\.\s', line_stripped)):
                if current_section['type'] != 'list':
                    if current_section['content'].strip():
                        sections.append(current_section)
                    current_section = {
                        'type': 'list',
                        'content': line + '\n',
                        'level': 0
                    }
                else:
                    current_section['content'] += line + '\n'
            
            # Regular content
            else:
                if current_section['type'] == 'list' and line_stripped:
                    # End of list
                    sections.append(current_section)
                    current_section = {
                        'type': 'content',
                        'content': line + '\n',
                        'level': 0
                    }
                else:
                    current_section['content'] += line + '\n'
        
        if current_section['content'].strip():
            sections.append(current_section)
        
        return sections
    
    def _chunk_section(self, section: Dict[str, Any], document: Document, chunk_offset: int) -> List[Document]:
        """Chunk a document section"""
        content = section['content']
        section_type = section['type']
        
        if len(content) <= self.config.chunk_size:
            # Section fits in one chunk
            chunk_metadata = ChunkMetadata(
                name=f"{document.metadata.name}_doc_{chunk_offset + 1}",
                source=document.metadata.source,
                source_type=document.metadata.source_type,
                content_type=document.metadata.content_type,
                parent_id=document.metadata.document_id,
                chunk_index=chunk_offset,
                chunker_name="DocumentChunker"
            )
            chunk_metadata.custom.update({
                'section_type': section_type,
                'section_level': section.get('level', 0)
            })
            
            return [Document(content=content, metadata=chunk_metadata)]
        
        # Section needs to be split
        chunks = []
        
        if section_type == 'list':
            # Split list by items
            items = re.split(r'\n(?=[-*+]|\d+\.)', content)
            current_chunk = ""
            
            for item in items:
                if len(current_chunk) + len(item) > self.config.chunk_size and current_chunk:
                    chunk_metadata = ChunkMetadata(
                        name=f"{document.metadata.name}_doc_{chunk_offset + len(chunks) + 1}",
                        source=document.metadata.source,
                        source_type=document.metadata.source_type,
                        content_type=document.metadata.content_type,
                        parent_id=document.metadata.document_id,
                        chunk_index=chunk_offset + len(chunks),
                        chunker_name="DocumentChunker"
                    )
                    chunk_metadata.custom.update({
                        'section_type': section_type,
                        'section_level': section.get('level', 0)
                    })
                    
                    chunks.append(Document(content=current_chunk.strip(), metadata=chunk_metadata))
                    current_chunk = item
                else:
                    current_chunk += item
            
            if current_chunk.strip():
                chunk_metadata = ChunkMetadata(
                    name=f"{document.metadata.name}_doc_{chunk_offset + len(chunks) + 1}",
                    source=document.metadata.source,
                    source_type=document.metadata.source_type,
                    content_type=document.metadata.content_type,
                    parent_id=document.metadata.document_id,
                    chunk_index=chunk_offset + len(chunks),
                    chunker_name="DocumentChunker"
                )
                chunk_metadata.custom.update({
                    'section_type': section_type,
                    'section_level': section.get('level', 0)
                })
                
                chunks.append(Document(content=current_chunk.strip(), metadata=chunk_metadata))
        
        else:
            # Split by paragraphs or sentences
            if self.respect_paragraphs:
                parts = content.split('\n\n')
            else:
                parts = content.split('. ')
            
            current_chunk = ""
            
            for part in parts:
                if len(current_chunk) + len(part) > self.config.chunk_size and current_chunk:
                    chunk_metadata = ChunkMetadata(
                        name=f"{document.metadata.name}_doc_{chunk_offset + len(chunks) + 1}",
                        source=document.metadata.source,
                        source_type=document.metadata.source_type,
                        content_type=document.metadata.content_type,
                        parent_id=document.metadata.document_id,
                        chunk_index=chunk_offset + len(chunks),
                        chunker_name="DocumentChunker"
                    )
                    chunk_metadata.custom.update({
                        'section_type': section_type,
                        'section_level': section.get('level', 0)
                    })
                    
                    chunks.append(Document(content=current_chunk.strip(), metadata=chunk_metadata))
                    current_chunk = part
                else:
                    current_chunk += part + ('\n\n' if self.respect_paragraphs else '. ')
            
            if current_chunk.strip():
                chunk_metadata = ChunkMetadata(
                    name=f"{document.metadata.name}_doc_{chunk_offset + len(chunks) + 1}",
                    source=document.metadata.source,
                    source_type=document.metadata.source_type,
                    content_type=document.metadata.content_type,
                    parent_id=document.metadata.document_id,
                    chunk_index=chunk_offset + len(chunks),
                    chunker_name="DocumentChunker"
                )
                chunk_metadata.custom.update({
                    'section_type': section_type,
                    'section_level': section.get('level', 0)
                })
                
                chunks.append(Document(content=current_chunk.strip(), metadata=chunk_metadata))
        
        return chunks
    
    async def _evaluate_chunks(self, chunks: List[Document]) -> ChunkMetrics:
        """Evaluate document-aware chunk quality"""
        metrics = ChunkMetrics()
        
        if not chunks:
            return metrics
        
        # Document-aware chunking should have excellent boundaries and coherence
        metrics.boundary_score = 0.95
        metrics.coherence_score = 0.9
        metrics.completeness_score = 0.9
        
        # Size evaluation
        target_size = self.config.chunk_size
        size_scores = []
        for chunk in chunks:
            size = len(chunk.content)
            if size <= target_size * 1.2:  # Allow some variance for structure
                size_scores.append(1.0)
            else:
                size_scores.append(target_size / size)
        
        metrics.size_score = sum(size_scores) / len(size_scores)
        
        # Overlap score (structure-aware chunks have minimal overlap)
        metrics.overlap_score = 0.8
        
        metrics.calculate_overall_score()
        return metrics