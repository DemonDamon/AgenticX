"""Knowledge Graph Builder - Main orchestrator for knowledge graph construction"""

import json
from typing import Any, Dict, List, Optional, Union
from loguru import logger

from .config import GraphRagConfig, LLMConfig
from .models import Entity, Relationship, KnowledgeGraph, EntityType, RelationType
from .extractors import EntityExtractor, RelationshipExtractor
from .validators import GraphQualityValidator
from .community import CommunityDetector
from .optimizer import GraphOptimizer


class KnowledgeGraphBuilder:
    """Main orchestrator for knowledge graph construction"""
    
    def __init__(self, config: GraphRagConfig, llm_config: LLMConfig):
        self.config = config
        self.llm_config = llm_config
        
        # Delayed import to avoid circular dependency
        from agenticx.llms import LlmFactory
        llm_client = LlmFactory.create_llm(self.llm_config)
        
        # Initialize components
        self.entity_extractor = EntityExtractor(
            llm_client=llm_client,
            config=self.config.entity_extraction
        )
        
        self.relationship_extractor = RelationshipExtractor(
            llm_client=llm_client,
            config=self.config.relationship_extraction
        )
        
        self.quality_validator = GraphQualityValidator(
            config=self.config.quality_validation.to_dict()
        )
        
        community_config = self.config.community_detection.to_dict()
        community_config["llm_client"] = llm_client
        self.community_detector = CommunityDetector(
            algorithm="louvain",
            config=community_config
        )
        
        self.graph_optimizer = GraphOptimizer(
            config=self.config.graph_optimization.to_dict()
        )
    
    def build_from_texts(
        self, 
        texts: List[str], 
        metadata: Optional[List[Dict[str, Any]]] = None,
        **kwargs
    ) -> KnowledgeGraph:
        """Build knowledge graph from a list of texts"""
        logger.info(f"🏗️ 开始构建知识图谱，输入文本数量: {len(texts)}")
        
        # Initialize graph
        logger.debug("📊 初始化知识图谱")
        graph = KnowledgeGraph()
        
        # Process each text
        for i, text in enumerate(texts):
            chunk_id = f"chunk_{i}"
            logger.info(f"📝 处理文本块 {i+1}/{len(texts)} (ID: {chunk_id})")
            logger.debug(f"📏 文本长度: {len(text)} 字符")
            
            # Get metadata for this text chunk if provided
            chunk_metadata = metadata[i] if metadata and i < len(metadata) else {}
            if chunk_metadata:
                logger.debug(f"📋 文本块元数据: {chunk_metadata}")
            
            # Extract entities
            logger.debug("🔍 开始实体提取")
            entities = self.entity_extractor.extract(text, chunk_id=chunk_id)
            logger.debug(f"📍 提取到 {len(entities)} 个实体")
            
            for entity in entities:
                graph.add_entity(entity)
                logger.trace(f"➕ 添加实体: {entity.name} ({entity.entity_type})")
            
            # Extract relationships
            logger.debug("🔗 开始关系提取")
            relationships = self.relationship_extractor.extract(
                text, 
                entities=entities,
                chunk_id=chunk_id
            )
            logger.debug(f"🔗 提取到 {len(relationships)} 个关系")
            
            for relationship in relationships:
                graph.add_relationship(relationship)
                logger.trace(f"➕ 添加关系: {relationship.source_entity_id} --[{relationship.relation_type}]--> {relationship.target_entity_id}")
        
        # Post-processing
        logger.info("🔧 开始后处理")
        
        # Merge duplicate entities
        if kwargs.get("merge_entities", True):
            logger.debug("🔄 合并重复实体")
            merged_count = self._merge_duplicate_entities(graph)
            logger.debug(f"✅ 合并了 {merged_count} 个重复实体")
        
        # Validate quality
        if kwargs.get("validate_quality", True):
            logger.debug("🔍 进行质量验证")
            quality_report = self.quality_validator.validate(graph)
            logger.info(f"📊 质量验证结果: {quality_report.summary()}")
        
        # Detect communities
        if kwargs.get("detect_communities", False):
            logger.debug("👥 检测社区")
            self.community_detector.detect_communities(graph)
        
        # Optimize graph
        if kwargs.get("optimize_graph", True):
            logger.debug("⚡ 优化图谱")
            optimization_stats = self.graph_optimizer.optimize(graph)
            logger.info(f"⚡ 图谱优化结果: {optimization_stats}")
        
        logger.success(f"🎉 知识图谱构建完成！实体数量: {len(graph.entities)}, 关系数量: {len(graph.relationships)}")
        
        return graph
    
    def build_from_documents(
        self, 
        documents: List[Dict[str, Any]], 
        **kwargs
    ) -> KnowledgeGraph:
        """Build knowledge graph from structured documents"""
        texts = [doc.get("content", "") for doc in documents]
        metadata = [doc.get("metadata", {}) for doc in documents]
        
        return self.build_from_texts(texts, metadata, **kwargs)
    
    def build_incremental(
        self, 
        existing_graph: KnowledgeGraph,
        new_texts: List[str],
        **kwargs
    ) -> KnowledgeGraph:
        """Incrementally build upon existing knowledge graph"""
        logger.info(f"🔄 增量构建: 向现有图谱({len(existing_graph.entities)}个实体)添加{len(new_texts)}个新文本")
        
        # Create new graph from existing one
        new_graph = KnowledgeGraph()
        new_graph.entities = existing_graph.entities.copy()
        new_graph.relationships = existing_graph.relationships.copy()
        new_graph.metadata = existing_graph.metadata.copy()
        
        # Copy NetworkX graph
        new_graph.graph = existing_graph.graph.copy()
        
        # Process new texts
        for i, text in enumerate(new_texts):
            chunk_id = f"incremental_chunk_{i}"
            logger.info(f"📝 处理增量文本块 {i+1}/{len(new_texts)}")
            
            # Extract entities
            entities = self.entity_extractor.extract(text, chunk_id=chunk_id)
            for entity in entities:
                new_graph.add_entity(entity)
            
            # Extract relationships
            relationships = self.relationship_extractor.extract(
                text, 
                entities=entities,
                chunk_id=chunk_id
            )
            for relationship in relationships:
                new_graph.add_relationship(relationship)
        
        # Post-processing for incremental build
        if kwargs.get("merge_entities", True):
            self._merge_duplicate_entities(new_graph)
        
        if kwargs.get("validate_quality", True):
            quality_report = self.quality_validator.validate(new_graph)
            logger.info(f"🔍 增量质量验证: {quality_report.summary()}")
        
        if kwargs.get("optimize_graph", True):
            optimization_stats = self.graph_optimizer.optimize(new_graph)
            logger.info(f"⚡ 增量图谱优化: {optimization_stats}")
        
        logger.success(f"✅ 增量构建完成: {len(new_graph.entities)} 个实体, {len(new_graph.relationships)} 个关系")
        
        return new_graph
    
    def _merge_duplicate_entities(self, graph: KnowledgeGraph) -> int:
        """Merge duplicate entities based on name similarity"""
        merged_count = 0
        processed_pairs = set()
        
        entity_list = list(graph.entities.values())
        
        for i, entity1 in enumerate(entity_list):
            for j, entity2 in enumerate(entity_list[i+1:], i+1):
                pair_key = tuple(sorted([entity1.id, entity2.id]))
                
                if pair_key in processed_pairs:
                    continue
                
                processed_pairs.add(pair_key)
                
                # Check if entities are similar enough to merge
                if self._should_merge_entities(entity1, entity2):
                    self._merge_two_entities(graph, entity1.id, entity2.id)
                    merged_count += 1
        
        logger.debug(f"🔄 合并了 {merged_count} 个重复实体")
        return merged_count
    
    def _should_merge_entities(self, entity1: Entity, entity2: Entity) -> bool:
        """Determine if two entities should be merged"""
        # Check name similarity
        name_similarity = self._calculate_name_similarity(entity1.name, entity2.name)
        
        # Check type compatibility
        type_compatible = entity1.entity_type == entity2.entity_type
        
        # Check if they have similar contexts (simple heuristic)
        context_similarity = self._calculate_context_similarity(entity1, entity2)
        
        # Merge if names are very similar and types are compatible
        return name_similarity >= 0.8 and type_compatible and context_similarity >= 0.5
    
    def _calculate_name_similarity(self, name1: str, name2: str) -> float:
        """Calculate similarity between two entity names"""
        name1_lower = name1.lower().strip()
        name2_lower = name2.lower().strip()
        
        # Exact match
        if name1_lower == name2_lower:
            return 1.0
        
        # One is substring of another
        if name1_lower in name2_lower or name2_lower in name1_lower:
            return 0.9
        
        # Calculate Jaccard similarity of words
        words1 = set(name1_lower.split())
        words2 = set(name2_lower.split())
        
        if not words1 or not words2:
            return 0.0
        
        intersection = len(words1.intersection(words2))
        union = len(words1.union(words2))
        
        return intersection / union if union > 0 else 0.0
    
    def _calculate_context_similarity(self, entity1: Entity, entity2: Entity) -> float:
        """Calculate context similarity between entities"""
        # Simple context similarity based on attributes
        attr1 = set(entity1.attributes.keys())
        attr2 = set(entity2.attributes.keys())
        
        if not attr1 or not attr2:
            return 0.5
        
        intersection = len(attr1.intersection(attr2))
        union = len(attr1.union(attr2))
        
        return intersection / union if union > 0 else 0.0
    
    def _merge_two_entities(self, graph: KnowledgeGraph, entity_id1: str, entity_id2: str) -> None:
        """Merge two entities into one"""
        entity1 = graph.get_entity(entity_id1)
        entity2 = graph.get_entity(entity_id2)
        
        if not entity1 or not entity2:
            return
        
        # Keep the entity with higher confidence
        if entity1.confidence >= entity2.confidence:
            keep_entity = entity1
            remove_entity = entity2
            keep_id = entity_id1
            remove_id = entity_id2
        else:
            keep_entity = entity2
            remove_entity = entity1
            keep_id = entity_id2
            remove_id = entity_id1
        
        # Merge attributes
        keep_entity.attributes.update(remove_entity.attributes)
        
        # Merge source chunks
        keep_entity.source_chunks.update(remove_entity.source_chunks)
        
        # Update confidence if merged
        keep_entity.confidence = max(entity1.confidence, entity2.confidence)
        
        # Update relationships
        for rel in graph.relationships.values():
            if rel.source_entity_id == remove_id:
                rel.source_entity_id = keep_id
            if rel.target_entity_id == remove_id:
                rel.target_entity_id = keep_id
        
        # Remove the merged entity
        del graph.entities[remove_id]
        graph.graph.remove_node(remove_id)
    
    def add_metadata(self, graph: KnowledgeGraph, metadata: Dict[str, Any]) -> None:
        """Add metadata to knowledge graph"""
        graph.metadata.update(metadata)
    
    def get_build_statistics(self, graph: KnowledgeGraph) -> Dict[str, Any]:
        """Get statistics about the built knowledge graph"""
        return {
            "num_entities": len(graph.entities),
            "num_relationships": len(graph.relationships),
            "num_entity_types": len(set(entity.entity_type for entity in graph.entities.values())),
            "num_relation_types": len(set(rel.relation_type for rel in graph.relationships.values())),
            "average_entity_confidence": sum(entity.confidence for entity in graph.entities.values()) / len(graph.entities) if graph.entities else 0,
            "average_relationship_confidence": sum(rel.confidence for rel in graph.relationships.values()) / len(graph.relationships) if graph.relationships else 0,
            "num_communities": len([entity for entity in graph.entities.values() if entity.entity_type == EntityType.COMMUNITY]),
            "graph_density": nx.density(graph.graph) if graph.graph.number_of_nodes() > 0 else 0,
            "num_connected_components": nx.number_connected_components(graph.graph) if graph.graph.number_of_nodes() > 0 else 0
        }