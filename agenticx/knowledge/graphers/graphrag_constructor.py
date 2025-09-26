"""Advanced GraphRAG Constructor - High-level knowledge graph construction with communities and optimization"""

import json
import logging
from typing import Any, Dict, List, Optional, Union

from .config import GraphRagConfig, LLMConfig
from .models import Entity, Relationship, KnowledgeGraph, EntityType, RelationType, NodeLevel
from .builder import KnowledgeGraphBuilder
from .extractors import EntityExtractor, RelationshipExtractor
from .validators import GraphQualityValidator
from .community import CommunityDetector
from .optimizer import GraphOptimizer


logger = logging.getLogger(__name__)


class GraphRAGConstructor:
    """Advanced GraphRAG Constructor with community detection and optimization"""
    
    def __init__(self, config: GraphRagConfig, llm_config: LLMConfig):
        self.config = config
        self.llm_config = llm_config
        
        # 延迟导入以避免循环依赖
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
        
        # 准备社区检测配置，包含LLM客户端
        community_config = self.config.community_detection.to_dict()
        community_config['llm_client'] = llm_client
        
        self.community_detector = CommunityDetector(
            algorithm=community_config.get('algorithm', 'louvain'),
            config=community_config
        )
        
        self.graph_optimizer = GraphOptimizer(
            config=self.config.graph_optimization.to_dict()
        )
        
        self.logger = logging.getLogger(__name__)
    
    def construct_from_texts(
        self, 
        texts: List[str], 
        metadata: Optional[List[Dict[str, Any]]] = None,
        **kwargs
    ) -> KnowledgeGraph:
        """Construct comprehensive knowledge graph from texts with advanced features"""
        self.logger.info(f"Constructing GraphRAG from {len(texts)} texts")
        
        # Step 1: Build basic knowledge graph
        self.logger.info("Step 1: Building basic knowledge graph")
        builder = KnowledgeGraphBuilder(config=self.config, llm_config=self.llm_config)
        graph = builder.build_from_texts(texts, metadata, **kwargs)
        
        # Step 2: Detect communities
        self.logger.info("Step 2: Detecting communities")
        community_results = self.community_detector.detect_communities(graph)
        
        # Step 3: Create community entities and relationships
        self.logger.info("Step 3: Creating community entities and relationships")
        self._create_community_entities(graph, community_results)
        
        # Step 4: Add hierarchical structure
        self.logger.info("Step 4: Adding hierarchical structure")
        self._add_hierarchical_structure(graph, community_results)
        
        # Step 5: Generate community summaries
        if kwargs.get("generate_community_summaries", True):
            self.logger.info("Step 5: Generating community summaries")
            self._generate_community_summaries(graph)
        
        # Step 6: Final optimization
        self.logger.info("Step 6: Final optimization")
        optimization_stats = self.graph_optimizer.optimize(graph)
        self.logger.info(f"Final optimization: {optimization_stats}")
        
        # Final quality validation
        self.logger.info("Final quality validation")
        quality_report = self.quality_validator.validate(graph)
        self.logger.info(f"Final quality report: {quality_report.summary()}")
        
        self.logger.info(f"GraphRAG construction complete: {len(graph.entities)} entities, {len(graph.relationships)} relationships")
        
        return graph
    
    def construct_incremental(
        self, 
        existing_graph: KnowledgeGraph,
        new_texts: List[str],
        **kwargs
    ) -> KnowledgeGraph:
        """Incrementally construct GraphRAG"""
        self.logger.info(f"Incremental GraphRAG construction: adding {len(new_texts)} new texts")
        
        # Build incremental graph
        builder = KnowledgeGraphBuilder(config=self.config, llm_config=self.llm_config)
        updated_graph = builder.build_incremental(existing_graph, new_texts, **kwargs)
        
        # Re-detect communities for the updated graph
        self.logger.info("Re-detecting communities for updated graph")
        community_results = self.community_detector.detect_communities(updated_graph)
        
        # Update community entities and relationships
        self.logger.info("Updating community entities and relationships")
        self._update_community_entities(updated_graph, community_results)
        
        # Re-generate community summaries if needed
        if kwargs.get("regenerate_community_summaries", True):
            self.logger.info("Re-generating community summaries")
            self._generate_community_summaries(updated_graph)
        
        # Final optimization
        self.logger.info("Final optimization for incremental build")
        optimization_stats = self.graph_optimizer.optimize(updated_graph)
        self.logger.info(f"Incremental optimization: {optimization_stats}")
        
        return updated_graph
    
    def _create_community_entities(self, graph: KnowledgeGraph, community_results: Dict[str, Any]) -> None:
        """Create community entities and relationships"""
        communities = community_results.get("communities", [])
        
        for community_info in communities:
            community_id = community_info["community_id"]
            member_ids = community_info["member_ids"]
            
            # Create community entity
            community_entity = Entity(
                id=f"community_{community_id}",
                name=f"Community {community_id}",
                entity_type=EntityType.COMMUNITY,
                confidence=community_info.get("confidence", 0.8),
                attributes={
                    "community_id": community_id,
                    "member_count": len(member_ids),
                    "algorithm": community_results.get("algorithm", "unknown"),
                    "modularity": community_info.get("modularity", 0.0)
                },
                source_chunks=set()
            )
            
            graph.add_entity(community_entity)
            
            # Create relationships between community and its members
            for member_id in member_ids:
                if member_id in graph.entities:
                    member_relationship = Relationship(
                        id=f"community_member_{community_id}_{member_id}",
                        source_entity_id=f"community_{community_id}",
                        target_entity_id=member_id,
                        relation_type=RelationType.MEMBER_OF,
                        confidence=0.9,
                        attributes={"community_id": community_id},
                        source_chunks=set()
                    )
                    graph.add_relationship(member_relationship)
    
    def _add_hierarchical_structure(self, graph: KnowledgeGraph, community_results: Dict[str, Any]) -> None:
        """Add hierarchical structure to the graph"""
        communities = community_results.get("communities", [])
        hierarchy_levels = community_results.get("hierarchy_levels", 1)
        
        # Assign levels to entities based on community structure
        for entity in graph.entities.values():
            if entity.entity_type != EntityType.COMMUNITY:
                # Find which communities this entity belongs to
                member_relationships = [
                    rel for rel in graph.relationships.values()
                    if rel.target_entity_id == entity.id and rel.relation_type == RelationType.MEMBER_OF
                ]
                
                # Assign level based on community hierarchy
                if member_relationships:
                    community_levels = []
                    for rel in member_relationships:
                        community = graph.get_entity(rel.source_entity_id)
                        if community and "level" in community.attributes:
                            community_levels.append(community.attributes["level"])
                    
                    if community_levels:
                        entity.level = min(community_levels) + 1
                    else:
                        entity.level = NodeLevel.ENTITY
                else:
                    entity.level = NodeLevel.ENTITY
        
        # Assign levels to communities
        for community_info in communities:
            community_id = community_info["community_id"]
            community_entity = graph.get_entity(f"community_{community_id}")
            
            if community_entity:
                # Assign level based on hierarchy information
                if "level" in community_info:
                    community_entity.level = community_info["level"]
                else:
                    community_entity.level = NodeLevel.COMMUNITY
                
                # Add hierarchy attributes
                community_entity.attributes.update({
                    "level": community_entity.level.value,
                    "hierarchy_position": community_info.get("hierarchy_position", "leaf")
                })
    
    def _generate_community_summaries(self, graph: KnowledgeGraph) -> None:
        """Generate summaries for communities using LLM"""
        if not self.community_detector.llm_client:
            self.logger.warning("No LLM client available for community summary generation")
            return
        
        communities = [
            entity for entity in graph.entities.values()
            if entity.entity_type == EntityType.COMMUNITY
        ]
        
        for community in communities:
            # Get community members
            member_relationships = [
                rel for rel in graph.relationships.values()
                if rel.source_entity_id == community.id and rel.relation_type == RelationType.MEMBER_OF
            ]
            
            member_entities = []
            for rel in member_relationships:
                member = graph.get_entity(rel.target_entity_id)
                if member:
                    member_entities.append(member)
            
            if member_entities:
                # Generate summary using LLM
                summary = self._generate_single_community_summary(community, member_entities)
                if summary:
                    community.attributes["summary"] = summary
                    community.attributes["summary_generated"] = True
    
    def _generate_single_community_summary(self, community: Entity, member_entities: List[Entity]) -> Optional[str]:
        """Generate summary for a single community"""
        try:
            # Prepare context for LLM
            member_info = []
            for member in member_entities[:10]:  # Limit to top 10 members
                member_info.append({
                    "name": member.name,
                    "type": member.entity_type.value,
                    "attributes": member.attributes
                })
            
            context = {
                "community_name": community.name,
                "community_id": community.attributes.get("community_id"),
                "member_count": len(member_entities),
                "members": member_info
            }
            
            # Generate summary prompt
            summary_prompt = self._create_community_summary_prompt(context)
            
            # Call LLM
            response = self.community_detector.llm_client.call(summary_prompt)
            
            if response and response.get("content"):
                return response["content"].strip()
            
        except Exception as e:
            self.logger.error(f"Error generating community summary: {e}")
        
        return None
    
    def _create_community_summary_prompt(self, context: Dict[str, Any]) -> str:
        """Create prompt for community summary generation"""
        return f"""
        Please generate a concise summary for the following community in a knowledge graph:
        
        Community Name: {context['community_name']}
        Community ID: {context['community_id']}
        Member Count: {context['member_count']}
        
        Community Members:
        {json.dumps(context['members'], indent=2, ensure_ascii=False)}
        
        Please provide a brief summary (1-3 sentences) that describes:
        1. What this community represents
        2. The main themes or topics
        3. Key relationships or patterns
        
        Summary:
        """
    
    def _update_community_entities(self, graph: KnowledgeGraph, community_results: Dict[str, Any]) -> None:
        """Update existing community entities or create new ones"""
        existing_communities = {
            entity.attributes.get("community_id"): entity
            for entity in graph.entities.values()
            if entity.entity_type == EntityType.COMMUNITY
        }
        
        communities = community_results.get("communities", [])
        
        for community_info in communities:
            community_id = community_info["community_id"]
            member_ids = community_info["member_ids"]
            
            if community_id in existing_communities:
                # Update existing community
                community = existing_communities[community_id]
                community.attributes["member_count"] = len(member_ids)
                community.attributes["modularity"] = community_info.get("modularity", 0.0)
            else:
                # Create new community
                community_entity = Entity(
                    id=f"community_{community_id}",
                    name=f"Community {community_id}",
                    entity_type=EntityType.COMMUNITY,
                    confidence=community_info.get("confidence", 0.8),
                    attributes={
                        "community_id": community_id,
                        "member_count": len(member_ids),
                        "algorithm": community_results.get("algorithm", "unknown"),
                        "modularity": community_info.get("modularity", 0.0)
                    },
                    source_chunks=set()
                )
                
                graph.add_entity(community_entity)
                
                # Create relationships with members
                for member_id in member_ids:
                    if member_id in graph.entities:
                        member_relationship = Relationship(
                            id=f"community_member_{community_id}_{member_id}",
                            source_entity_id=f"community_{community_id}",
                            target_entity_id=member_id,
                            relation_type=RelationType.MEMBER_OF,
                            confidence=0.9,
                            attributes={"community_id": community_id},
                            source_chunks=set()
                        )
                        graph.add_relationship(member_relationship)
    
    def add_metadata(self, graph: KnowledgeGraph, metadata: Dict[str, Any]) -> None:
        """Add metadata to knowledge graph"""
        graph.metadata.update(metadata)
    
    def get_construction_statistics(self, graph: KnowledgeGraph) -> Dict[str, Any]:
        """Get comprehensive statistics about the constructed graph"""
        communities = [
            entity for entity in graph.entities.values()
            if entity.entity_type == EntityType.COMMUNITY
        ]
        
        community_summaries = [
            entity for entity in communities
            if entity.attributes.get("summary_generated", False)
        ]
        
        hierarchical_entities = [
            entity for entity in graph.entities.values()
            if entity.level != NodeLevel.ENTITY
        ]
        
        return {
            "num_entities": len(graph.entities),
            "num_relationships": len(graph.relationships),
            "num_communities": len(communities),
            "num_communities_with_summaries": len(community_summaries),
            "num_hierarchical_entities": len(hierarchical_entities),
            "num_entity_types": len(set(entity.entity_type for entity in graph.entities.values())),
            "num_relation_types": len(set(rel.relation_type for rel in graph.relationships.values())),
            "average_entity_confidence": sum(entity.confidence for entity in graph.entities.values()) / len(graph.entities) if graph.entities else 0,
            "average_relationship_confidence": sum(rel.confidence for rel in graph.relationships.values()) / len(graph.relationships) if graph.relationships else 0,
            "graph_density": graph.graph.density() if graph.graph.number_of_nodes() > 0 else 0,
            "num_connected_components": graph.graph.number_of_components() if graph.graph.number_of_nodes() > 0 else 0,
            "average_clustering_coefficient": graph.graph.average_clustering() if graph.graph.number_of_nodes() > 0 else 0,
            "construction_timestamp": graph.metadata.get("construction_timestamp", "unknown")
        }