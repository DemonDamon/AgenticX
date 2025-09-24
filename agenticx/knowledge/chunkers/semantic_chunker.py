"""Semantic Chunker for AgenticX Knowledge Management System

This module provides semantic chunking that groups content by semantic similarity.
"""

import logging
import re
import time
from typing import List, Optional, Dict, Any

from ..base import ChunkingConfig
from ..document import Document, DocumentMetadata, ChunkMetadata
from .framework import AdvancedBaseChunker, ChunkingResult, ChunkMetrics

logger = logging.getLogger(__name__)


class SemanticChunker(AdvancedBaseChunker):
    """Semantic chunker that groups content by semantic similarity"""
    
    def __init__(self, config: Optional[ChunkingConfig] = None, **kwargs):
        super().__init__(config, **kwargs)
        self.embedding_model = kwargs.get('embedding_model')
        self.similarity_threshold = kwargs.get('similarity_threshold', 0.7)
        self.min_chunk_size = kwargs.get('min_chunk_size', 100)
        self.max_chunk_size = kwargs.get('max_chunk_size', self.config.chunk_size * 2)
    
    async def chunk_document_async(self, document: Document) -> ChunkingResult:
        """Chunk document using semantic similarity"""
        start_time = time.time()
        
        try:
            # Split into sentences first
            sentences = self._split_into_sentences(document.content)
            if not sentences:
                return ChunkingResult(
                    chunks=[document],
                    strategy_used="semantic",
                    processing_time=time.time() - start_time
                )
            
            # Group sentences by semantic similarity
            chunks = await self._group_by_semantic_similarity(sentences, document)
            
            # Evaluate chunk quality
            metrics = await self._evaluate_chunks(chunks)
            
            return ChunkingResult(
                chunks=chunks,
                strategy_used="semantic",
                processing_time=time.time() - start_time,
                metrics=metrics,
                metadata={
                    'original_sentences': len(sentences),
                    'similarity_threshold': self.similarity_threshold
                }
            )
            
        except Exception as e:
            logger.error(f"Semantic chunking failed: {e}")
            return ChunkingResult(
                strategy_used="semantic",
                processing_time=time.time() - start_time,
                success=False,
                error=str(e)
            )
    
    def _split_into_sentences(self, text: str) -> List[str]:
        """Split text into sentences"""
        # Simple sentence splitting - can be enhanced with NLP libraries
        sentences = re.split(r'[.!?]+', text)
        sentences = [s.strip() for s in sentences if s.strip()]
        return sentences
    
    async def _group_by_semantic_similarity(self, sentences: List[str], document: Document) -> List[Document]:
        """Group sentences by semantic similarity"""
        if not self.embedding_model:
            # Fallback to simple grouping by length
            return self._fallback_grouping(sentences, document)
        
        try:
            # Get embeddings for all sentences
            embeddings = await self.embedding_model.embed_texts(sentences)
            
            # Group sentences by similarity
            groups = self._cluster_by_similarity(sentences, embeddings)
            
            # Convert groups to chunks
            chunks = []
            for i, group in enumerate(groups):
                chunk_content = ' '.join(group)
                
                # Create chunk metadata
                chunk_metadata = ChunkMetadata(
                    name=f"{document.metadata.name}_semantic_{i+1}",
                    source=document.metadata.source,
                    source_type=document.metadata.source_type,
                    content_type=document.metadata.content_type,
                    parent_id=document.metadata.document_id,
                    chunk_index=i,
                    chunker_name="SemanticChunker"
                )
                
                chunk = Document(content=chunk_content, metadata=chunk_metadata)
                chunks.append(chunk)
            
            return chunks
            
        except Exception as e:
            logger.warning(f"Semantic grouping failed, using fallback: {e}")
            return self._fallback_grouping(sentences, document)
    
    def _fallback_grouping(self, sentences: List[str], document: Document) -> List[Document]:
        """Fallback grouping when embeddings are not available"""
        chunks = []
        current_chunk = []
        current_size = 0
        
        for sentence in sentences:
            sentence_size = len(sentence)
            
            if current_size + sentence_size > self.config.chunk_size and current_chunk:
                # Create chunk from current group
                chunk_content = ' '.join(current_chunk)
                chunk_metadata = ChunkMetadata(
                    name=f"{document.metadata.name}_fallback_{len(chunks)+1}",
                    source=document.metadata.source,
                    source_type=document.metadata.source_type,
                    content_type=document.metadata.content_type,
                    parent_id=document.metadata.document_id,
                    chunk_index=len(chunks),
                    chunker_name="SemanticChunker"
                )
                
                chunk = Document(content=chunk_content, metadata=chunk_metadata)
                chunks.append(chunk)
                
                current_chunk = [sentence]
                current_size = sentence_size
            else:
                current_chunk.append(sentence)
                current_size += sentence_size
        
        # Add remaining sentences as final chunk
        if current_chunk:
            chunk_content = ' '.join(current_chunk)
            chunk_metadata = ChunkMetadata(
                name=f"{document.metadata.name}_fallback_{len(chunks)+1}",
                source=document.metadata.source,
                source_type=document.metadata.source_type,
                content_type=document.metadata.content_type,
                parent_id=document.metadata.document_id,
                chunk_index=len(chunks),
                chunker_name="SemanticChunker"
            )
            
            chunk = Document(content=chunk_content, metadata=chunk_metadata)
            chunks.append(chunk)
        
        return chunks
    
    def _cluster_by_similarity(self, sentences: List[str], embeddings: List[List[float]]) -> List[List[str]]:
        """Cluster sentences by embedding similarity"""
        if not embeddings or len(embeddings) != len(sentences):
            return [[sentence] for sentence in sentences]
        
        # Simple clustering algorithm
        groups = []
        used = set()
        
        for i, sentence in enumerate(sentences):
            if i in used:
                continue
            
            group = [sentence]
            used.add(i)
            current_size = len(sentence)
            
            # Find similar sentences
            for j, other_sentence in enumerate(sentences[i+1:], i+1):
                if j in used or current_size + len(other_sentence) > self.max_chunk_size:
                    continue
                
                # Calculate similarity (simplified cosine similarity)
                similarity = self._cosine_similarity(embeddings[i], embeddings[j])
                
                if similarity > self.similarity_threshold:
                    group.append(other_sentence)
                    used.add(j)
                    current_size += len(other_sentence)
            
            groups.append(group)
        
        return groups
    
    def _cosine_similarity(self, vec1: List[float], vec2: List[float]) -> float:
        """Calculate cosine similarity between two vectors"""
        if len(vec1) != len(vec2):
            return 0.0
        
        dot_product = sum(a * b for a, b in zip(vec1, vec2))
        norm1 = sum(a * a for a in vec1) ** 0.5
        norm2 = sum(b * b for b in vec2) ** 0.5
        
        if norm1 == 0 or norm2 == 0:
            return 0.0
        
        return dot_product / (norm1 * norm2)
    
    async def _evaluate_chunks(self, chunks: List[Document]) -> ChunkMetrics:
        """Evaluate semantic chunk quality"""
        metrics = ChunkMetrics()
        
        if not chunks:
            return metrics
        
        # Size evaluation
        target_size = self.config.chunk_size
        size_scores = []
        for chunk in chunks:
            size = len(chunk.content)
            if target_size * 0.5 <= size <= target_size * 1.5:
                size_scores.append(1.0)
            elif size < target_size * 0.5:
                size_scores.append(size / (target_size * 0.5))
            else:
                size_scores.append((target_size * 1.5) / size)
        
        metrics.size_score = sum(size_scores) / len(size_scores)
        
        # Coherence evaluation (semantic chunks should be highly coherent)
        metrics.coherence_score = 0.85  # Assume high coherence for semantic chunks
        
        # Completeness evaluation
        completeness_scores = []
        for chunk in chunks:
            content = chunk.content.strip()
            # Check for complete sentences
            ends_with_punctuation = content and content[-1] in '.!?'
            starts_with_capital = content and content[0].isupper()
            completeness_scores.append(0.5 * ends_with_punctuation + 0.5 * starts_with_capital)
        
        metrics.completeness_score = sum(completeness_scores) / len(completeness_scores)
        
        # Overlap score (semantic chunks typically have minimal overlap)
        metrics.overlap_score = 0.9
        
        # Boundary score (semantic boundaries are natural)
        metrics.boundary_score = 0.9
        
        metrics.calculate_overall_score()
        return metrics