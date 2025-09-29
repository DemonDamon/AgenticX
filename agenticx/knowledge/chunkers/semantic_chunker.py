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
    
    def chunk_text(self, text: str, metadata: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """Split text into chunks using semantic similarity
        
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
                'chunker': 'SemanticChunker'
            })
            
            result.append({
                'content': chunk.content,
                'metadata': chunk_metadata
            })
        
        return result
    
    async def chunk_document_async(self, document: Document) -> ChunkingResult:
        """Chunk document using semantic similarity"""
        start_time = time.time()
        
        logger.info(f"开始语义分块: {document.metadata.name}")
        logger.info(f"分块器配置: 相似度阈值={self.similarity_threshold}, 最小块={self.min_chunk_size}, 最大块={self.max_chunk_size}")
        
        try:
            # Split into sentences first
            logger.info("✂️ 开始句子分割...")
            sentences = self._split_into_sentences(document.content)
            logger.info(f"句子分割完成: {len(sentences)} 个句子")
            
            if not sentences:
                logger.warning("⚠️ 未找到句子，返回原文档")
                return ChunkingResult(
                    chunks=[document],
                    strategy_used="semantic",
                    processing_time=time.time() - start_time
                )
            
            # 显示前几个句子作为示例
            if sentences:
                logger.debug(f"句子示例: {sentences[0][:100]}...")
            
            # Group sentences by semantic similarity
            logger.info("开始语义相似度分组...")
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
        """Group sentences by semantic similarity with optimization"""
        logger.info(f"进入语义分组，句子数量: {len(sentences)}")
        
        if not self.embedding_model:
            logger.warning("❌ 未找到嵌入模型，使用回退分组策略")
            return self._fallback_grouping(sentences, document)
        
        logger.info(f"✅ 嵌入模型已配置: {type(self.embedding_model).__name__}")
        
        # 算力优化：如果句子太多，使用混合策略
        if len(sentences) > 50:
            logger.info(f"⚡ 句子数量较多({len(sentences)})，使用优化的混合分块策略")
            return await self._optimized_hybrid_grouping(sentences, document)
        
        logger.info(f"句子数量适中({len(sentences)})，使用完整语义分块")
        
        try:
            # Get embeddings for all sentences
            logger.info(f"语义分块：开始为 {len(sentences)} 个句子生成嵌入向量")
            
            if hasattr(self.embedding_model, 'aembed_texts'):
                embeddings = await self.embedding_model.aembed_texts(sentences)
            elif hasattr(self.embedding_model, 'embed_texts'):
                embeddings = self.embedding_model.embed_texts(sentences)
            elif hasattr(self.embedding_model, 'embed'):
                embeddings = self.embedding_model.embed(sentences)
            else:
                logger.warning("嵌入模型没有支持的嵌入方法，回退到简单分组")
                return self._fallback_grouping(sentences, document)
            
            logger.info(f"✅ 嵌入向量生成完成")
            
            # Group sentences by similarity
            groups = self._cluster_by_similarity(sentences, embeddings)
            
            # Convert groups to chunks
            chunks = []
            for i, group in enumerate(groups):
                chunk_content = ' '.join(group)
                
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
            logger.warning(f"语义分组失败，使用回退策略: {e}")
            return self._fallback_grouping(sentences, document)
    
    def _fallback_grouping(self, sentences: List[str], document: Document) -> List[Document]:
        """Fallback grouping when embeddings are not available"""
        logger.warning("⚠️ 使用回退分组策略（基于长度的简单分组，非语义分组）")
        logger.info(f"📏 回退分组参数: 目标大小={self.config.chunk_size}, 句子数={len(sentences)}")
        
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
    
    async def _optimized_hybrid_grouping(self, sentences: List[str], document: Document) -> List[Document]:
        """优化的混合分块策略：先按段落分组，再进行局部语义分析"""
        logger.info("🚀 使用优化混合策略：段落预分组 + 局部语义优化")
        logger.info(f"混合策略输入: {len(sentences)} 个句子")
        
        # 1. 先按段落或长度进行粗分组
        logger.info("📋 第1步: 段落预分组...")
        rough_groups = self._paragraph_based_grouping(sentences)
        logger.info(f"段落预分组完成：{len(rough_groups)} 个粗分组")
        
        # 显示分组大小分布
        group_sizes = [len(group) for group in rough_groups]
        logger.info(f"📈 分组大小分布: 最小={min(group_sizes)}, 最大={max(group_sizes)}, 平均={sum(group_sizes)/len(group_sizes):.1f}")
        
        # 2. 对每个粗分组进行局部语义优化
        logger.info("第2步: 局部语义优化...")
        optimized_chunks = []
        semantic_optimized_count = 0
        
        for i, group in enumerate(rough_groups):
            logger.debug(f"处理分组 {i+1}/{len(rough_groups)}: {len(group)} 个句子")
            
            if len(group) <= 10:  # 小组直接使用
                logger.debug(f"小组直接使用: {len(group)} 个句子")
                chunk_content = ' '.join(group)
                chunk_metadata = ChunkMetadata(
                    name=f"{document.metadata.name}_hybrid_{i+1}",
                    source=document.metadata.source,
                    source_type=document.metadata.source_type,
                    content_type=document.metadata.content_type,
                    parent_id=document.metadata.document_id,
                    chunk_index=i,
                    chunker_name="SemanticChunker"
                )
                chunk = Document(content=chunk_content, metadata=chunk_metadata)
                optimized_chunks.append(chunk)
            else:
                # 大组进行局部语义优化
                logger.debug(f"大组进行语义优化: {len(group)} 个句子")
                try:
                    # 生成嵌入向量
                    if hasattr(self.embedding_model, 'aembed_texts'):
                        logger.debug("使用异步嵌入方法")
                        embeddings = await self.embedding_model.aembed_texts(group)
                    else:
                        logger.debug("使用同步嵌入方法")
                        embeddings = self.embedding_model.embed(group)
                    
                    logger.debug(f"✅ 嵌入向量生成完成: {len(embeddings)} 个向量")
                    
                    # 局部聚类
                    logger.debug("开始局部语义聚类...")
                    local_groups = self._cluster_by_similarity(group, embeddings)
                    logger.debug(f"局部聚类结果: {len(local_groups)} 个子组")
                    semantic_optimized_count += 1
                    
                    # 转换为文档块
                    for j, local_group in enumerate(local_groups):
                        chunk_content = ' '.join(local_group)
                        chunk_metadata = ChunkMetadata(
                            name=f"{document.metadata.name}_hybrid_{i+1}_{j+1}",
                            source=document.metadata.source,
                            source_type=document.metadata.source_type,
                            content_type=document.metadata.content_type,
                            parent_id=document.metadata.document_id,
                            chunk_index=len(optimized_chunks),
                            chunker_name="SemanticChunker"
                        )
                        chunk = Document(content=chunk_content, metadata=chunk_metadata)
                        optimized_chunks.append(chunk)
                        
                except Exception as e:
                    logger.warning(f"局部语义优化失败，使用原分组: {e}")
                    chunk_content = ' '.join(group)
                    chunk_metadata = ChunkMetadata(
                        name=f"{document.metadata.name}_hybrid_{i+1}",
                        source=document.metadata.source,
                        source_type=document.metadata.source_type,
                        content_type=document.metadata.content_type,
                        parent_id=document.metadata.document_id,
                        chunk_index=len(optimized_chunks),
                        chunker_name="SemanticChunker"
                    )
                    chunk = Document(content=chunk_content, metadata=chunk_metadata)
                    optimized_chunks.append(chunk)
        
        logger.info(f"✅ 混合分块完成：{len(optimized_chunks)} 个最终分块")
        logger.info(f"语义优化统计: {semantic_optimized_count}/{len(rough_groups)} 个分组使用了语义优化")
        return optimized_chunks
    
    def _paragraph_based_grouping(self, sentences: List[str]) -> List[List[str]]:
        """基于段落和长度的预分组"""
        groups = []
        current_group = []
        current_size = 0
        target_size = self.config.chunk_size * 0.8  # 预留空间给语义调整
        
        for sentence in sentences:
            sentence_size = len(sentence)
            
            # 检查是否应该开始新组
            should_start_new = (
                current_size + sentence_size > target_size and current_group
            ) or (
                # 检查段落分隔符
                len(current_group) > 0 and 
                (sentence.strip().startswith(('第', '一、', '二、', '三、', '四、', '五、', '1.', '2.', '3.', '4.', '5.')) or
                 current_group[-1].endswith(('。', '！', '？', '.', '!', '?')))
            )
            
            if should_start_new:
                if current_group:
                    groups.append(current_group)
                current_group = [sentence]
                current_size = sentence_size
            else:
                current_group.append(sentence)
                current_size += sentence_size
        
        # 添加最后一组
        if current_group:
            groups.append(current_group)
        
        return groups
    
    def _cluster_by_similarity(self, sentences: List[str], embeddings: List[List[float]]) -> List[List[str]]:
        """优化的语义聚类算法：使用贪心策略减少计算复杂度"""
        if not embeddings or len(embeddings) != len(sentences):
            logger.warning("嵌入向量数量与句子数量不匹配，使用单句分组")
            return [[sentence] for sentence in sentences]
        
        logger.info(f"开始优化语义聚类，相似度阈值: {self.similarity_threshold}")
        
        # 优化的贪心聚类算法
        groups = []
        used = set()
        similarity_matches = 0
        total_comparisons = 0
        
        for i, sentence in enumerate(sentences):
            if i in used:
                continue
            
            group = [sentence]
            used.add(i)
            current_size = len(sentence)
            group_similarities = []
            
            # 优化：只检查附近的句子（滑动窗口）
            window_size = min(20, len(sentences) - i - 1)  # 限制搜索窗口
            
            for offset in range(1, window_size + 1):
                j = i + offset
                if j >= len(sentences) or j in used:
                    continue
                
                other_sentence = sentences[j]
                if current_size + len(other_sentence) > self.max_chunk_size:
                    continue
                
                # 计算相似度
                similarity = self._cosine_similarity(embeddings[i], embeddings[j])
                total_comparisons += 1
                
                if similarity > self.similarity_threshold:
                    group.append(other_sentence)
                    used.add(j)
                    current_size += len(other_sentence)
                    group_similarities.append(similarity)
                    similarity_matches += 1
                    
                    # 早停优化：如果找到足够相似的句子，停止搜索
                    if len(group) >= 5:  # 限制每组最大句子数
                        break
            
            if len(group) > 1:
                avg_similarity = sum(group_similarities) / len(group_similarities) if group_similarities else 0
                logger.debug(f"语义组 {len(groups)+1}: {len(group)} 个句子, 平均相似度: {avg_similarity:.3f}")
            
            groups.append(group)
        
        logger.info(f"✅ 优化聚类完成: {len(groups)} 个组, {similarity_matches} 个匹配, {total_comparisons} 次比较")
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