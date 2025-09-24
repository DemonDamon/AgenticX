"""Graph Optimizers for Knowledge Graph"""

from typing import Any, Dict, List, Optional, Set, Tuple

import networkx as nx

from .models import Entity, Relationship, KnowledgeGraph, EntityType, RelationType


class GraphOptimizer:
    """Optimize knowledge graph structure and content"""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
        self.min_confidence = self.config.get("min_confidence", 0.3)
        self.max_node_degree = self.config.get("max_node_degree", 50)
        self.similarity_threshold = self.config.get("similarity_threshold", 0.8)
        self.llm_client = self.config.get("llm_client")
    
    def optimize(self, graph: KnowledgeGraph, **kwargs) -> Dict[str, Any]:
        """Perform comprehensive graph optimization"""
        optimization_stats = {
            "removed_low_confidence_entities": 0,
            "removed_low_confidence_relationships": 0,
            "pruned_high_degree_nodes": 0,
            "removed_isolated_nodes": 0,
            "merged_similar_entities": 0,
            "merged_duplicate_relationships": 0,
            "added_missing_attributes": 0,
            "total_changes": 0
        }
        
        # Apply optimization steps
        if kwargs.get("prune_low_confidence", True):
            stats = self._prune_low_confidence(graph)
            for key, value in stats.items():
                optimization_stats[key] += value
        
        if kwargs.get("prune_high_degree_nodes", True):
            stats = self._prune_high_degree_nodes(graph)
            for key, value in stats.items():
                optimization_stats[key] += value
        
        if kwargs.get("remove_isolated_nodes", True):
            stats = self._remove_isolated_nodes(graph)
            for key, value in stats.items():
                optimization_stats[key] += value
        
        if kwargs.get("merge_similar_entities", True):
            stats = self._merge_similar_entities(graph)
            for key, value in stats.items():
                optimization_stats[key] += value
        
        if kwargs.get("merge_duplicate_relationships", True):
            stats = self._merge_duplicate_relationships(graph)
            for key, value in stats.items():
                optimization_stats[key] += value
        
        if kwargs.get("add_missing_attributes", True):
            stats = self._add_missing_attributes(graph)
            for key, value in stats.items():
                optimization_stats[key] += value
        
        # Calculate total changes
        optimization_stats["total_changes"] = (
            optimization_stats["removed_low_confidence_entities"] +
            optimization_stats["removed_low_confidence_relationships"] +
            optimization_stats["pruned_high_degree_nodes"] +
            optimization_stats["removed_isolated_nodes"] +
            optimization_stats["merged_similar_entities"] +
            optimization_stats["merged_duplicate_relationships"] +
            optimization_stats["added_missing_attributes"]
        )
        
        return optimization_stats
    
    def _prune_low_confidence(self, graph: KnowledgeGraph) -> Dict[str, Any]:
        """Remove low confidence entities and relationships"""
        removed_entities = 0
        removed_relationships = 0
        
        # Remove low confidence entities
        low_confidence_entities = [
            entity_id for entity_id, entity in graph.entities.items()
            if entity.confidence < self.min_confidence
        ]
        
        for entity_id in low_confidence_entities:
            # Remove related relationships first
            related_relationships = graph.get_entity_relationships(entity_id)
            for rel in related_relationships:
                if rel.id in graph.relationships:
                    del graph.relationships[rel.id]
                    removed_relationships += 1
            
            # Remove entity
            if entity_id in graph.entities:
                del graph.entities[entity_id]
                graph.graph.remove_node(entity_id)
                removed_entities += 1
        
        # Remove low confidence relationships
        low_confidence_relationships = [
            rel_id for rel_id, rel in graph.relationships.items()
            if rel.confidence < self.min_confidence
        ]
        
        for rel_id in low_confidence_relationships:
            if rel_id in graph.relationships:
                del graph.relationships[rel_id]
                # Remove from NetworkX graph
                for u, v, k in list(graph.graph.edges(keys=True)):
                    if k == rel_id:
                        graph.graph.remove_edge(u, v, k)
                        break
                removed_relationships += 1
        
        return {
            "removed_low_confidence_entities": removed_entities,
            "removed_low_confidence_relationships": removed_relationships
        }
    
    def _prune_high_degree_nodes(self, graph: KnowledgeGraph) -> Dict[str, Any]:
        """Prune edges from nodes with very high degree"""
        pruned_nodes = 0
        
        for node_id in list(graph.graph.nodes()):
            degree = graph.graph.degree(node_id)
            
            if degree > self.max_node_degree:
                # Calculate how many edges to remove
                edges_to_remove = degree - self.max_node_degree
                
                # Get all edges for this node
                edges = list(graph.graph.edges(node_id, keys=True))
                
                # Sort by confidence (lowest first) and remove weakest edges
                edges_with_confidence = []
                for u, v, k in edges:
                    if k in graph.relationships:
                        confidence = graph.relationships[k].confidence
                        edges_with_confidence.append((u, v, k, confidence))
                
                # Sort by confidence (ascending)
                edges_with_confidence.sort(key=lambda x: x[3])
                
                # Remove lowest confidence edges
                for u, v, k, conf in edges_with_confidence[:edges_to_remove]:
                    if k in graph.relationships:
                        del graph.relationships[k]
                        graph.graph.remove_edge(u, v, k)
                
                pruned_nodes += 1
        
        return {"pruned_high_degree_nodes": pruned_nodes}
    
    def _remove_isolated_nodes(self, graph: KnowledgeGraph) -> Dict[str, Any]:
        """Remove nodes with no connections"""
        isolated_nodes = []
        
        for node_id in list(graph.graph.nodes()):
            if graph.graph.degree(node_id) == 0:
                isolated_nodes.append(node_id)
        
        # Remove isolated entities
        removed_count = 0
        for node_id in isolated_nodes:
            if node_id in graph.entities:
                del graph.entities[node_id]
                graph.graph.remove_node(node_id)
                removed_count += 1
        
        return {"removed_isolated_nodes": removed_count}
    
    def _merge_similar_entities(self, graph: KnowledgeGraph) -> Dict[str, Any]:
        """Merge entities with similar names"""
        merged_count = 0
        processed_pairs = set()
        
        entity_list = list(graph.entities.values())
        
        for i, entity1 in enumerate(entity_list):
            for j, entity2 in enumerate(entity_list[i+1:], i+1):
                pair_key = tuple(sorted([entity1.id, entity2.id]))
                
                if pair_key in processed_pairs:
                    continue
                
                processed_pairs.add(pair_key)
                
                # Calculate name similarity
                similarity = self._calculate_name_similarity(entity1.name, entity2.name)
                
                if similarity >= self.similarity_threshold:
                    # Merge entities
                    self._merge_two_entities(graph, entity1.id, entity2.id)
                    merged_count += 1
        
        return {"merged_similar_entities": merged_count}
    
    def _calculate_name_similarity(self, name1: str, name2: str) -> float:
        """Calculate similarity between two entity names"""
        # Simple similarity based on string matching
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
        
        # Update relationships
        for rel in graph.relationships.values():
            if rel.source_entity_id == remove_id:
                rel.source_entity_id = keep_id
            if rel.target_entity_id == remove_id:
                rel.target_entity_id = keep_id
        
        # Remove the merged entity
        del graph.entities[remove_id]
        graph.graph.remove_node(remove_id)
    
    def _merge_duplicate_relationships(self, graph: KnowledgeGraph) -> Dict[str, Any]:
        """Merge duplicate relationships between the same entities"""
        # Group relationships by source-target pair
        relationship_groups = {}
        
        for rel_id, rel in graph.relationships.items():
            pair_key = (rel.source_entity_id, rel.target_entity_id, str(rel.relation_type))
            
            if pair_key not in relationship_groups:
                relationship_groups[pair_key] = []
            
            relationship_groups[pair_key].append((rel_id, rel))
        
        merged_count = 0
        
        for pair_key, rel_list in relationship_groups.items():
            if len(rel_list) > 1:
                # Keep the relationship with highest confidence
                best_rel = max(rel_list, key=lambda x: x[1].confidence)
                best_rel_id, best_relationship = best_rel
                
                # Merge attributes from other relationships
                for rel_id, rel in rel_list:
                    if rel_id != best_rel_id:
                        best_relationship.attributes.update(rel.attributes)
                        best_relationship.source_chunks.update(rel.source_chunks)
                        
                        # Remove duplicate relationship
                        del graph.relationships[rel_id]
                        
                        # Remove from NetworkX graph
                        for u, v, k in list(graph.graph.edges(keys=True)):
                            if k == rel_id:
                                graph.graph.remove_edge(u, v, k)
                                break
                        
                        merged_count += 1
        
        return {"merged_duplicate_relationships": merged_count}
    
    def _add_missing_attributes(self, graph: KnowledgeGraph) -> Dict[str, Any]:
        """Add missing attributes to entities and relationships"""
        added_attributes = 0
        
        # Add missing attributes to entities
        for entity in graph.entities.values():
            initial_attr_count = len(entity.attributes)
            
            # Add entity type as attribute if missing
            if "entity_type" not in entity.attributes:
                entity.attributes["entity_type"] = entity.entity_type.value
            
            # Add confidence as attribute if missing
            if "confidence" not in entity.attributes:
                entity.attributes["confidence"] = entity.confidence
            
            # Add source count as attribute if missing
            if "source_count" not in entity.attributes:
                entity.attributes["source_count"] = len(entity.source_chunks)
            
            if len(entity.attributes) > initial_attr_count:
                added_attributes += 1
        
        # Add missing attributes to relationships
        for relationship in graph.relationships.values():
            initial_attr_count = len(relationship.attributes)
            
            # Add relation type as attribute if missing
            relation_value = (
                relationship.relation_type.value 
                if hasattr(relationship.relation_type, 'value')
                else str(relationship.relation_type)
            )
            if "relation_type" not in relationship.attributes:
                relationship.attributes["relation_type"] = relation_value
            
            # Add confidence as attribute if missing
            if "confidence" not in relationship.attributes:
                relationship.attributes["confidence"] = relationship.confidence
            
            # Add source count as attribute if missing
            if "source_count" not in relationship.attributes:
                relationship.attributes["source_count"] = len(relationship.source_chunks)
            
            if len(relationship.attributes) > initial_attr_count:
                added_attributes += 1
        
        return {"added_missing_attributes": added_attributes}
    
    def get_optimization_recommendations(self, graph: KnowledgeGraph) -> List[str]:
        """Get recommendations for graph optimization"""
        recommendations = []
        
        # Check for low confidence items
        low_confidence_entities = sum(
            1 for entity in graph.entities.values()
            if entity.confidence < self.min_confidence
        )
        
        if low_confidence_entities > 0:
            recommendations.append(f"Consider removing {low_confidence_entities} low-confidence entities")
        
        # Check for isolated nodes
        isolated_nodes = 0
        for node_id in graph.graph.nodes():
            if graph.graph.degree(node_id) == 0:
                isolated_nodes += 1
        
        if isolated_nodes > 0:
            recommendations.append(f"Consider removing {isolated_nodes} isolated nodes")
        
        # Check for high degree nodes
        high_degree_nodes = 0
        for node_id in graph.graph.nodes():
            if graph.graph.degree(node_id) > self.max_node_degree:
                high_degree_nodes += 1
        
        if high_degree_nodes > 0:
            recommendations.append(f"Consider pruning edges from {high_degree_nodes} high-degree nodes")
        
        # Check for duplicate relationships
        relationship_pairs = {}
        for rel in graph.relationships.values():
            pair_key = (rel.source_entity_id, rel.target_entity_id, str(rel.relation_type))
            relationship_pairs[pair_key] = relationship_pairs.get(pair_key, 0) + 1
        
        duplicate_relationships = sum(count - 1 for count in relationship_pairs.values() if count > 1)
        
        if duplicate_relationships > 0:
            recommendations.append(f"Consider merging {duplicate_relationships} duplicate relationships")
        
        return recommendations