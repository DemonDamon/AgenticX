"""Knowledge Graph Builder - Main orchestrator for knowledge graph construction"""

import json
import os
from typing import Any, Dict, List, Optional, Union
from loguru import logger

from .config import GraphRagConfig, LLMConfig
from .models import Entity, Relationship, KnowledgeGraph, EntityType, RelationType
# Note: Traditional extractors removed - using SPO extraction only
from .spo_extractor import SPOExtractor
from .schema_generator import SchemaGenerator
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
        self.llm_client = llm_client  # 保存为实例属性（轻量模型）
        
        # 创建强模型客户端（用于文档分析和Schema生成）
        try:
            # 尝试从配置中获取强模型配置
            strong_model_config = getattr(self.config, 'strong_model_config', None)
            if strong_model_config:
                self.strong_llm_client = LlmFactory.create_llm(strong_model_config)
                # logger.info("🚀 强模型客户端初始化完成")
            else:
                self.strong_llm_client = llm_client  # 回退到默认模型
                logger.warning("⚠️ 未找到强模型配置，使用默认模型")
        except Exception as e:
            logger.warning(f"⚠️ 强模型初始化失败，使用默认模型: {e}")
            self.strong_llm_client = llm_client
        
        # Note: Traditional extractors removed - using SPO extraction only
        
        # Initialize extraction method
        self.extraction_method = getattr(self.config, 'extraction_method', 'separate')
        
        # Initialize prompt manager - 使用当前工作目录的相对路径
        prompts_dir = os.path.join(os.getcwd(), 'prompts')
        
        # 动态导入PromptManager（避免循环导入）
        try:
            import sys
            sys.path.append(os.getcwd())
            from prompt_manager import PromptManager
            self.prompt_manager = PromptManager(prompts_dir)
        except ImportError as e:
            logger.warning(f"⚠️ 无法导入PromptManager: {e}")
            self.prompt_manager = None
        
        # Initialize schema generator
        base_schema_path = os.path.join(os.getcwd(), 'schema.json')
        self.schema_generator = SchemaGenerator(
            llm_client=llm_client,
            strong_llm_client=self.strong_llm_client,  # 传入强模型客户端
            prompt_manager=self.prompt_manager,
            base_schema_path=base_schema_path if os.path.exists(base_schema_path) else None
        )
        
        # Initialize SPO extractor (will be configured with custom schema later)
        if self.extraction_method == 'spo':
            self.spo_extractor = None  # Will be initialized with custom schema
            logger.info(f"使用两阶段SPO抽取方法（Schema生成 + SPO抽取）")
        else:
            logger.info(f"使用传统分离抽取方法")
        
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
    
    async def build_from_texts(
        self, 
        texts: List[str], 
        metadata: Optional[List[Dict[str, Any]]] = None,
        **kwargs
    ) -> KnowledgeGraph:
        """Build knowledge graph from a list of texts"""
        logger.info(f"开始构建知识图谱，输入文本数量: {len(texts)}")
        
        # Initialize graph
        logger.debug("初始化知识图谱")
        graph = KnowledgeGraph()
        
        # Stage 1: Generate custom schema if using SPO method
        custom_schema = None
        if self.extraction_method == 'spo':
            logger.info("阶段1: 智能Schema生成")
            logger.info(f"抽取方法: {self.extraction_method} (两阶段SPO抽取)")
            
            # 直接基于完整文档生成定制schema（新方法）
            logger.info("开始基于完整文档生成定制Schema...")
            custom_schema = self.schema_generator.generate_custom_schema_from_documents(texts)
            
            # Save custom schema for reference
            custom_schema_path = os.path.join(os.getcwd(), 'custom_schema.json')
            self.schema_generator.save_custom_schema(custom_schema, custom_schema_path)
            logger.info(f"定制Schema已保存: {custom_schema_path}")
            
            # Initialize SPO extractor with custom schema
            logger.info("初始化SPO抽取器...")
            self.spo_extractor = SPOExtractor(
                llm_client=self.llm_client,
                prompt_manager=self.prompt_manager,
                custom_schema=custom_schema,
                config=self.config.entity_extraction.to_dict()
            )
            
            logger.success(f"✅ 阶段1完成 - 定制Schema生成，领域: {custom_schema.get('domain_info', {}).get('primary_domain', '通用')}")
        else:
            logger.info(f"抽取方法: {self.extraction_method} (传统分离抽取)")
        
        # Stage 2: Extract entities and relationships
        logger.info("阶段2: 知识抽取")
        
        if self.extraction_method == 'spo':
            # 使用批处理SPO抽取（性能优化）
            # logger.info("🚀 使用批处理SPO抽取，显著提升性能")
            batch_size = getattr(self.config, 'spo_batch_size', 1)  # 从配置获取批处理大小，默认为1避免网络问题
            
            try:
                entities, relationships = await self.spo_extractor.extract_batch(
                    texts=texts, 
                    batch_size=batch_size,
                    **kwargs
                )
                
                logger.info(f"批处理SPO抽取完成: {len(entities)} 个实体, {len(relationships)} 个关系")
                
                # 批量添加实体到图谱
                for entity in entities:
                    graph.add_entity(entity)
                
                # 批量添加关系到图谱
                for relationship in relationships:
                    try:
                        graph.add_relationship(relationship)
                    except Exception as e:
                        logger.error(f"❌ 添加关系失败: {e}")
                        
            except Exception as e:
                logger.error(f"❌ 批处理SPO抽取失败，回退到逐个处理: {e}")
                # 回退到原来的逐个处理方式
                for i, text in enumerate(texts):
                    chunk_id = f"chunk_{i}"
                    logger.debug(f"处理文本块 {i+1}/{len(texts)} (ID: {chunk_id})")
                    
                    entities, relationships = self.spo_extractor.extract(text, chunk_id=chunk_id)
                    
                    for entity in entities:
                        graph.add_entity(entity)
                    
                    for relationship in relationships:
                        try:
                            graph.add_relationship(relationship)
                        except Exception as rel_e:
                            logger.error(f"❌ 添加关系失败: {rel_e}")
        
        else:
            # 传统分离抽取模式已移除，强制使用SPO模式
            logger.error(f"❌ 不支持的抽取方法: {self.extraction_method}")
            logger.error("💡 传统分离抽取模式已移除，请使用 'spo' 模式")
            raise ValueError(f"不支持的抽取方法: {self.extraction_method}，请使用 'spo' 模式")
        
        # Post-processing
        logger.info("开始后处理")
        
        # Merge duplicate entities
        if kwargs.get("merge_entities", True):
            logger.debug("🔄 合并重复实体")
            merged_count = self._merge_duplicate_entities(graph)
            logger.debug(f"✅ 合并了 {merged_count} 个重复实体")
        
        # Validate quality
        if kwargs.get("validate_quality", True):
            logger.debug("进行质量验证")
            quality_report = self.quality_validator.validate(graph)
            logger.info(f"质量验证结果: {quality_report.summary()}")
        
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
        
        # Auto export to Neo4j if enabled
        if self.config.neo4j.enabled and self.config.neo4j.auto_export:
            try:
                logger.info("🗄️ 自动导出到Neo4j...")
                graph.export_to_neo4j(
                    uri=self.config.neo4j.uri,
                    username=self.config.neo4j.username,
                    password=self.config.neo4j.password,
                    database=self.config.neo4j.database,
                    clear_existing=self.config.neo4j.clear_on_export,
                    tenant_id=graph.name  # Use graph name as tenant_id
                )
                logger.success("✅ Neo4j导出成功")
            except Exception as e:
                logger.error(f"❌ Neo4j导出失败: {e}")
                logger.warning("💡 请检查Neo4j服务是否运行，以及连接配置是否正确")
        
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
    
    async def build_incremental(
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
        
        # Process new texts using SPO extraction
        if self.spo_extractor:
            try:
                # Use batch SPO extraction for incremental texts
                entities, relationships = await self.spo_extractor.extract_batch(
                    texts=new_texts,
                    batch_size=1,  # Conservative batch size for incremental
                    **kwargs
                )
                
                # Add extracted entities and relationships
                for entity in entities:
                    new_graph.add_entity(entity)
                
                for relationship in relationships:
                    try:
                        new_graph.add_relationship(relationship)
                    except Exception as e:
                        logger.error(f"❌ 增量添加关系失败: {e}")
                        
            except Exception as e:
                logger.error(f"❌ 增量SPO抽取失败: {e}")
                logger.warning("💡 增量构建失败，请检查SPO抽取器配置")
        else:
            logger.error("❌ SPO抽取器未初始化，无法进行增量构建")
            raise ValueError("SPO抽取器未初始化，无法进行增量构建")
        
        # Post-processing for incremental build
        if kwargs.get("merge_entities", True):
            self._merge_duplicate_entities(new_graph)
        
        if kwargs.get("validate_quality", True):
            quality_report = self.quality_validator.validate(new_graph)
            logger.info(f"增量质量验证: {quality_report.summary()}")
        
        if kwargs.get("optimize_graph", True):
            optimization_stats = self.graph_optimizer.optimize(new_graph)
            logger.info(f"⚡ 增量图谱优化: {optimization_stats}")
        
        logger.success(f"✅ 增量构建完成: {len(new_graph.entities)} 个实体, {len(new_graph.relationships)} 个关系")
        
        return new_graph
    
    def _find_entity_by_name(self, graph: KnowledgeGraph, name: str) -> Optional[Entity]:
        """通过名称查找实体"""
        for entity in graph.entities.values():
            if entity.name == name:
                return entity
            # 尝试模糊匹配（去除空格和大小写）
            if entity.name.strip().lower() == name.strip().lower():
                return entity
        return None
    
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