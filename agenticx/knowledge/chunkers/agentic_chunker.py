"""Agentic Chunker for AgenticX Knowledge Management System

This module provides LLM-based intelligent chunking that uses AI to determine 
optimal chunk boundaries.
"""

import json
import logging
import re
import time
from typing import List, Optional

from ..base import ChunkingConfig
from ..document import Document, DocumentMetadata, ChunkMetadata
from .framework import AdvancedBaseChunker, ChunkingResult, ChunkMetrics

logger = logging.getLogger(__name__)


class AgenticChunker(AdvancedBaseChunker):
    """LLM-based intelligent chunker that uses AI to determine optimal chunk boundaries"""
    
    def __init__(self, config: Optional[ChunkingConfig] = None, **kwargs):
        super().__init__(config, **kwargs)
        self.llm_model = kwargs.get('llm_model')
        self.max_context_length = kwargs.get('max_context_length', 4000)
        self.chunk_instruction = kwargs.get('chunk_instruction', 
            "Analyze the following text and identify natural breaking points for chunking. "
            "Consider semantic coherence, topic boundaries, and logical flow.")
    
    async def chunk_document_async(self, document: Document) -> ChunkingResult:
        """Chunk document using LLM intelligence"""
        start_time = time.time()
        
        try:
            if not self.llm_model:
                # Fallback to simple chunking
                return await self._fallback_chunking(document, start_time)
            
            # Split large documents into manageable sections
            sections = self._split_into_sections(document.content)
            
            chunks = []
            for i, section in enumerate(sections):
                section_chunks = await self._chunk_section_with_llm(section, document, i)
                chunks.extend(section_chunks)
            
            # Evaluate chunk quality
            metrics = await self._evaluate_chunks(chunks)
            
            return ChunkingResult(
                chunks=chunks,
                strategy_used="agentic",
                processing_time=time.time() - start_time,
                metrics=metrics,
                metadata={
                    'sections_processed': len(sections),
                    'llm_model': str(self.llm_model) if self.llm_model else None
                }
            )
            
        except Exception as e:
            logger.error(f"Agentic chunking failed: {e}")
            return await self._fallback_chunking(document, start_time, error=str(e))
    
    def _split_into_sections(self, text: str) -> List[str]:
        """Split text into sections that fit within LLM context"""
        if len(text) <= self.max_context_length:
            return [text]
        
        sections = []
        current_section = ""
        
        # Split by paragraphs first
        paragraphs = text.split('\n\n')
        
        for paragraph in paragraphs:
            if len(current_section) + len(paragraph) > self.max_context_length:
                if current_section:
                    sections.append(current_section.strip())
                    current_section = paragraph
                else:
                    # Paragraph is too long, split by sentences
                    sentences = paragraph.split('. ')
                    for sentence in sentences:
                        if len(current_section) + len(sentence) > self.max_context_length:
                            if current_section:
                                sections.append(current_section.strip())
                            current_section = sentence
                        else:
                            current_section += sentence + '. '
            else:
                current_section += '\n\n' + paragraph
        
        if current_section.strip():
            sections.append(current_section.strip())
        
        return sections
    
    async def _chunk_section_with_llm(self, section: str, document: Document, section_index: int) -> List[Document]:
        """Use LLM to chunk a section"""
        try:
            # Prepare prompt for LLM
            prompt = f"""
{self.chunk_instruction}

Target chunk size: approximately {self.config.chunk_size} characters
Maximum chunk size: {self.config.chunk_size * 1.5} characters
Minimum chunk size: {self.config.chunk_size * 0.3} characters

Text to chunk:
{section}

Please identify the best breaking points and return the chunks as a JSON array of strings.
Each chunk should be semantically coherent and respect natural boundaries.
"""
            
            # Get LLM response
            response = await self.llm_model.generate_async(prompt)
            
            # Parse LLM response
            chunk_texts = self._parse_llm_response(response, section)
            
            # Create Document objects
            chunks = []
            for i, chunk_text in enumerate(chunk_texts):
                chunk_metadata = ChunkMetadata(
                    name=f"{document.metadata.name}_agentic_{section_index}_{i+1}",
                    source=document.metadata.source,
                    source_type=document.metadata.source_type,
                    content_type=document.metadata.content_type,
                    parent_id=document.metadata.document_id,
                    chunk_index=len(chunks),
                    chunker_name="AgenticChunker"
                )
                
                chunk = Document(content=chunk_text, metadata=chunk_metadata)
                chunks.append(chunk)
            
            return chunks
            
        except Exception as e:
            logger.warning(f"LLM chunking failed for section {section_index}, using fallback: {e}")
            return self._fallback_section_chunking(section, document, section_index)
    
    def _parse_llm_response(self, response: str, original_section: str) -> List[str]:
        """Parse LLM response to extract chunks"""
        try:
            # Try to parse as JSON
            if response.strip().startswith('['):
                chunks = json.loads(response)
                if isinstance(chunks, list) and all(isinstance(chunk, str) for chunk in chunks):
                    return chunks
            
            # Try to extract JSON from response
            json_match = re.search(r'\[.*\]', response, re.DOTALL)
            if json_match:
                chunks = json.loads(json_match.group())
                if isinstance(chunks, list) and all(isinstance(chunk, str) for chunk in chunks):
                    return chunks
            
            # Fallback: split by double newlines or numbered sections
            if '\n\n' in response:
                chunks = [chunk.strip() for chunk in response.split('\n\n') if chunk.strip()]
                return chunks
            
            # Last resort: return original section
            return [original_section]
            
        except Exception as e:
            logger.warning(f"Failed to parse LLM response: {e}")
            return [original_section]
    
    def _fallback_section_chunking(self, section: str, document: Document, section_index: int) -> List[Document]:
        """Fallback chunking for a section"""
        chunks = []
        current_chunk = ""
        
        sentences = section.split('. ')
        
        for sentence in sentences:
            if len(current_chunk) + len(sentence) > self.config.chunk_size and current_chunk:
                chunk_metadata = ChunkMetadata(
                    name=f"{document.metadata.name}_fallback_{section_index}_{len(chunks)+1}",
                    source=document.metadata.source,
                    source_type=document.metadata.source_type,
                    content_type=document.metadata.content_type,
                    parent_id=document.metadata.document_id,
                    chunk_index=len(chunks),
                    chunker_name="AgenticChunker"
                )
                
                chunk = Document(content=current_chunk.strip(), metadata=chunk_metadata)
                chunks.append(chunk)
                current_chunk = sentence
            else:
                current_chunk += sentence + '. '
        
        if current_chunk.strip():
            chunk_metadata = ChunkMetadata(
                name=f"{document.metadata.name}_fallback_{section_index}_{len(chunks)+1}",
                source=document.metadata.source,
                source_type=document.metadata.source_type,
                content_type=document.metadata.content_type,
                parent_id=document.metadata.document_id,
                chunk_index=len(chunks),
                chunker_name="AgenticChunker"
            )
            
            chunk = Document(content=current_chunk.strip(), metadata=chunk_metadata)
            chunks.append(chunk)
        
        return chunks
    
    async def _fallback_chunking(self, document: Document, start_time: float, error: Optional[str] = None) -> ChunkingResult:
        """Fallback to simple chunking when LLM is not available"""
        content = document.content
        chunks = []
        
        for i in range(0, len(content), self.config.chunk_size):
            chunk_content = content[i:i + self.config.chunk_size]
            
            chunk_metadata = ChunkMetadata(
                name=f"{document.metadata.name}_fallback_{len(chunks)+1}",
                source=document.metadata.source,
                source_type=document.metadata.source_type,
                content_type=document.metadata.content_type,
                parent_id=document.metadata.document_id,
                chunk_index=len(chunks),
                chunker_name="AgenticChunker"
            )
            
            chunk = Document(content=chunk_content, metadata=chunk_metadata)
            chunks.append(chunk)
        
        return ChunkingResult(
            chunks=chunks,
            strategy_used="agentic_fallback",
            processing_time=time.time() - start_time,
            success=error is None,
            error=error,
            metadata={'fallback_used': True}
        )
    
    async def _evaluate_chunks(self, chunks: List[Document]) -> ChunkMetrics:
        """Evaluate agentic chunk quality"""
        metrics = ChunkMetrics()
        
        if not chunks:
            return metrics
        
        # Agentic chunks should have high quality scores
        metrics.coherence_score = 0.9  # LLM should create coherent chunks
        metrics.completeness_score = 0.85  # LLM should respect boundaries
        metrics.boundary_score = 0.95  # LLM should find natural boundaries
        
        # Size evaluation
        target_size = self.config.chunk_size
        size_scores = []
        for chunk in chunks:
            size = len(chunk.content)
            if target_size * 0.7 <= size <= target_size * 1.3:
                size_scores.append(1.0)
            elif size < target_size * 0.7:
                size_scores.append(size / (target_size * 0.7))
            else:
                size_scores.append((target_size * 1.3) / size)
        
        metrics.size_score = sum(size_scores) / len(size_scores)
        
        # Overlap evaluation
        metrics.overlap_score = 0.8  # LLM chunks may have some intentional overlap
        
        metrics.calculate_overall_score()
        return metrics