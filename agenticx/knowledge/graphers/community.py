"""Community Detection for Knowledge Graph"""

import json
import uuid
from typing import Any, Dict, List, Optional, Set

import networkx as nx
from cdlib import algorithms

from .models import Entity, Relationship, EntityType, RelationType, KnowledgeGraph


class CommunityDetector:
    """Detect communities in knowledge graph using various algorithms"""
    
    def __init__(self, algorithm: str = "louvain", config: Optional[Dict[str, Any]] = None):
        self.algorithm = algorithm
        self.config = config or {}
        self.llm_client = self.config.get("llm_client")
    
    def detect_communities(self, graph: KnowledgeGraph, **kwargs) -> Dict[str, Any]:
        """Detect communities in the knowledge graph"""
        if self.algorithm == "louvain":
            return self._detect_louvain(graph, **kwargs)
        elif self.algorithm == "leiden":
            return self._detect_leiden(graph, **kwargs)
        elif self.algorithm == "networkx":
            return self._detect_networkx(graph, **kwargs)
        else:
            raise ValueError(f"Unknown community detection algorithm: {self.algorithm}")
    
    def _detect_louvain(self, graph: KnowledgeGraph, **kwargs) -> Dict[str, Any]:
        """Detect communities using Louvain algorithm"""
        # Convert to undirected graph for community detection
        undirected_graph = graph.graph.to_undirected()
        
        # Apply Louvain algorithm
        communities = algorithms.louvain(undirected_graph)
        
        # Convert to our format
        return self._convert_communities(graph, communities, **kwargs)
    
    def _detect_leiden(self, graph: KnowledgeGraph, **kwargs) -> Dict[str, Any]:
        """Detect communities using Leiden algorithm"""
        # Convert to undirected graph for community detection
        undirected_graph = graph.graph.to_undirected()
        
        # Apply Leiden algorithm
        communities = algorithms.leiden(undirected_graph)
        
        # Convert to our format
        return self._convert_communities(graph, communities, **kwargs)
    
    def _detect_networkx(self, graph: KnowledgeGraph, **kwargs) -> Dict[str, Any]:
        """Detect communities using NetworkX algorithms"""
        # Convert to undirected graph
        undirected_graph = graph.graph.to_undirected()
        
        # Use greedy modularity communities
        communities = list(nx.community.greedy_modularity_communities(undirected_graph))
        
        # Convert to cdlib format for consistency
        community_data = {
            "communities": communities,
            "algorithm": "networkx_greedy_modularity"
        }
        
        return self._convert_networkx_communities(graph, community_data, **kwargs)
    
    def _convert_communities(self, graph: KnowledgeGraph, communities, **kwargs) -> Dict[str, Any]:
        """Convert cdlib communities to our format"""
        community_info = []
        
        for i, community in enumerate(communities.communities):
            community_data = {
                "id": f"community_{i}",
                "name": f"Community {i+1}",
                "entity_ids": list(community),
                "entity_count": len(community),
                "description": None
            }
            
            # Generate community description if LLM is available
            if self.llm_client and kwargs.get("generate_descriptions", True):
                community_data["description"] = self._generate_community_description(
                    graph, community_data["entity_ids"]
                )
            
            community_info.append(community_data)
        
        return {
            "communities": community_info,
            "algorithm": self.algorithm,
            "total_communities": len(community_info),
            "modularity": communities.newman_girvan_modularity()
            if hasattr(communities, 'newman_girvan_modularity') else None
        }
    
    def _convert_networkx_communities(self, graph: KnowledgeGraph, community_data, **kwargs) -> Dict[str, Any]:
        """Convert NetworkX communities to our format"""
        communities = community_data["communities"]
        community_info = []
        
        for i, community in enumerate(communities):
            community_data_item = {
                "id": f"community_{i}",
                "name": f"Community {i+1}",
                "entity_ids": list(community),
                "entity_count": len(community),
                "description": None
            }
            
            # Generate community description if LLM is available
            if self.llm_client and kwargs.get("generate_descriptions", True):
                community_data_item["description"] = self._generate_community_description(
                    graph, community_data_item["entity_ids"]
                )
            
            community_info.append(community_data_item)
        
        return {
            "communities": community_info,
            "algorithm": community_data["algorithm"],
            "total_communities": len(community_info)
        }
    
    def _generate_community_description(self, graph: KnowledgeGraph, entity_ids: List[str]) -> str:
        """Generate description for a community using LLM"""
        if not self.llm_client:
            return "Community description not available"
        
        # Get entity information
        entity_info = []
        for entity_id in entity_ids[:10]:  # Limit to first 10 entities
            entity = graph.get_entity(entity_id)
            if entity:
                info = f"- {entity.name} ({entity.entity_type.value})"
                if entity.description:
                    info += f": {entity.description[:100]}"
                entity_info.append(info)
        
        prompt = f"""
Based on the following entities in a community, generate a brief description of what this community represents.

Entities:
{chr(10).join(entity_info)}

Provide a concise 1-2 sentence description of this community's theme or focus.
"""
        
        try:
            response = self.llm_client.call(prompt)
            return response.strip()[:200]  # Limit length
        except:
            return "Community description generation failed"
    
    def create_community_entities(self, graph: KnowledgeGraph, community_data: Dict[str, Any]) -> List[Entity]:
        """Create community entities in the knowledge graph"""
        community_entities = []
        
        for community in community_data["communities"]:
            # Create community entity
            community_entity = Entity(
                name=community["name"],
                entity_type=EntityType.CONCEPT,  # Communities are concepts
                description=community.get("description", f"Community with {community['entity_count']} entities"),
                attributes={
                    "community_id": community["id"],
                    "entity_count": community["entity_count"],
                    "algorithm": community_data["algorithm"],
                    "member_entities": community["entity_ids"]
                },
                confidence=0.9  # High confidence for community entities
            )
            
            community_entities.append(community_entity)
        
        return community_entities
    
    def create_community_relationships(self, graph: KnowledgeGraph, community_data: Dict[str, Any], community_entities: List[Entity]) -> List[Relationship]:
        """Create relationships between entities and their communities"""
        relationships = []
        
        for i, community in enumerate(community_data["communities"]):
            community_entity = community_entities[i]
            
            # Create BELONGS_TO relationships from each entity to its community
            for entity_id in community["entity_ids"]:
                relationship = Relationship(
                    source_entity_id=entity_id,
                    target_entity_id=community_entity.id,
                    relation_type="belongs_to",  # Custom relation type
                    description=f"Entity belongs to community {community['name']}",
                    confidence=0.95
                )
                relationships.append(relationship)
        
        return relationships
    
    def add_communities_to_graph(self, graph: KnowledgeGraph, **kwargs) -> Dict[str, Any]:
        """Detect communities and add them to the knowledge graph"""
        # Detect communities
        community_data = self.detect_communities(graph, **kwargs)
        
        # Create community entities
        community_entities = self.create_community_entities(graph, community_data)
        
        # Add community entities to graph
        for entity in community_entities:
            graph.add_entity(entity)
        
        # Create and add community relationships
        community_relationships = self.create_community_relationships(graph, community_data, community_entities)
        
        for relationship in community_relationships:
            try:
                graph.add_relationship(relationship)
            except ValueError:
                # Skip if entity doesn't exist
                continue
        
        return {
            "community_data": community_data,
            "community_entities": [entity.to_dict() for entity in community_entities],
            "community_relationships": [rel.to_dict() for rel in community_relationships],
            "total_added": len(community_entities) + len(community_relationships)
        }
    
    def get_community_statistics(self, graph: KnowledgeGraph, community_data: Dict[str, Any]) -> Dict[str, Any]:
        """Get statistics about detected communities"""
        community_sizes = [community["entity_count"] for community in community_data["communities"]]
        
        return {
            "total_communities": len(community_data["communities"]),
            "average_community_size": sum(community_sizes) / len(community_sizes) if community_sizes else 0,
            "largest_community": max(community_sizes) if community_sizes else 0,
            "smallest_community": min(community_sizes) if community_sizes else 0,
            "algorithm": community_data["algorithm"],
            "modularity": community_data.get("modularity")
        }