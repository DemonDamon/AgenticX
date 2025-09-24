"""Graph Quality Validators for Knowledge Graph"""

import networkx as nx
from typing import Any, Dict, List, Optional

from .models import KnowledgeGraph, GraphQualityMetrics, GraphQualityReport, EntityType


class GraphQualityValidator:
    """Validate and assess knowledge graph quality"""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
        self.min_confidence = self.config.get("min_confidence", 0.5)
        self.min_coverage = self.config.get("min_coverage", 0.3)
        self.max_isolated_nodes = self.config.get("max_isolated_nodes", 0.2)
    
    def validate(self, graph: KnowledgeGraph) -> GraphQualityReport:
        """Perform comprehensive quality validation"""
        metrics = self.calculate_metrics(graph)
        report = GraphQualityReport(metrics=metrics)
        
        # Check for quality issues
        self._check_confidence_issues(graph, report)
        self._check_connectivity_issues(graph, report)
        self._check_coverage_issues(graph, report)
        self._check_content_issues(graph, report)
        self._check_structural_issues(graph, report)
        
        # Generate recommendations
        self._generate_recommendations(graph, report)
        
        return report
    
    def calculate_metrics(self, graph: KnowledgeGraph) -> GraphQualityMetrics:
        """Calculate comprehensive quality metrics"""
        metrics = GraphQualityMetrics()
        
        # Basic statistics
        metrics.entity_count = len(graph.entities)
        metrics.relationship_count = len(graph.relationships)
        metrics.node_count = graph.graph.number_of_nodes()
        metrics.edge_count = graph.graph.number_of_edges()
        
        # Connectivity metrics
        metrics.connected_components = nx.number_weakly_connected_components(graph.graph)
        
        if graph.graph.number_of_nodes() > 0:
            degrees = [d for n, d in graph.graph.degree()]
            metrics.average_degree = sum(degrees) / len(degrees) if degrees else 0.0
            metrics.density = nx.density(graph.graph)
        
        # Quality metrics
        if metrics.entity_count > 0:
            entities_with_relations = sum(
                1 for entity in graph.entities.values()
                if graph.get_entity_relationships(entity.id)
            )
            metrics.entity_coverage = entities_with_relations / metrics.entity_count
            
            # Calculate average confidence
            entity_confidences = [e.confidence for e in graph.entities.values()]
            relation_confidences = [r.confidence for r in graph.relationships.values()]
            all_confidences = entity_confidences + relation_confidences
            
            if all_confidences:
                metrics.confidence_score = sum(all_confidences) / len(all_confidences)
        
        # Relationship diversity
        unique_relation_types = set()
        for relationship in graph.relationships.values():
            relation_value = (
                relationship.relation_type.value 
                if hasattr(relationship.relation_type, 'value')
                else str(relationship.relation_type)
            )
            unique_relation_types.add(relation_value)
        metrics.relationship_diversity = len(unique_relation_types)
        
        # Structural metrics
        if graph.graph.number_of_nodes() > 1:
            try:
                metrics.clustering_coefficient = nx.average_clustering(graph.graph.to_undirected())
                
                # Calculate average path length for largest connected component
                if nx.is_weakly_connected(graph.graph):
                    metrics.average_path_length = nx.average_shortest_path_length(graph.graph)
                else:
                    # Use largest component
                    largest_cc = max(nx.weakly_connected_components(graph.graph), key=len)
                    subgraph = graph.graph.subgraph(largest_cc)
                    if subgraph.number_of_nodes() > 1:
                        metrics.average_path_length = nx.average_shortest_path_length(subgraph)
            except:
                # Handle cases where metrics can't be calculated
                pass
        
        # Content quality
        metrics.entities_with_attributes = sum(
            1 for entity in graph.entities.values() if entity.attributes
        )
        metrics.entities_with_descriptions = sum(
            1 for entity in graph.entities.values() if entity.description
        )
        
        return metrics
    
    def _check_confidence_issues(self, graph: KnowledgeGraph, report: GraphQualityReport) -> None:
        """Check for confidence-related issues"""
        low_confidence_entities = [
            entity for entity in graph.entities.values()
            if entity.confidence < self.min_confidence
        ]
        
        low_confidence_relations = [
            rel for rel in graph.relationships.values()
            if rel.confidence < self.min_confidence
        ]
        
        if low_confidence_entities:
            report.add_issue(f"Found {len(low_confidence_entities)} entities with confidence < {self.min_confidence}")
        
        if low_confidence_relations:
            report.add_issue(f"Found {len(low_confidence_relations)} relationships with confidence < {self.min_confidence}")
    
    def _check_connectivity_issues(self, graph: KnowledgeGraph, report: GraphQualityReport) -> None:
        """Check for connectivity issues"""
        isolated_entities = [
            entity for entity in graph.entities.values()
            if not graph.get_entity_relationships(entity.id)
        ]
        
        isolated_ratio = len(isolated_entities) / max(1, len(graph.entities))
        
        if isolated_ratio > self.max_isolated_nodes:
            report.add_issue(f"Too many isolated entities: {isolated_ratio:.1%} > {self.max_isolated_nodes:.1%}")
        
        if nx.number_weakly_connected_components(graph.graph) > 1:
            report.add_issue("Graph has multiple disconnected components")
    
    def _check_coverage_issues(self, graph: KnowledgeGraph, report: GraphQualityReport) -> None:
        """Check for coverage issues"""
        if report.metrics.entity_coverage < self.min_coverage:
            report.add_issue(f"Low entity coverage: {report.metrics.entity_coverage:.1%} < {self.min_coverage:.1%}")
    
    def _check_content_issues(self, graph: KnowledgeGraph, report: GraphQualityReport) -> None:
        """Check for content quality issues"""
        entities_without_descriptions = sum(
            1 for entity in graph.entities.values()
            if not entity.description
        )
        
        entities_without_attributes = sum(
            1 for entity in graph.entities.values()
            if not entity.attributes
        )
        
        if entities_without_descriptions > len(graph.entities) * 0.5:
            report.add_issue(f"Many entities lack descriptions: {entities_without_descriptions}")
        
        if entities_without_attributes > len(graph.entities) * 0.7:
            report.add_issue(f"Many entities lack attributes: {entities_without_attributes}")
    
    def _check_structural_issues(self, graph: KnowledgeGraph, report: GraphQualityReport) -> None:
        """Check for structural issues"""
        if report.metrics.density < 0.01:
            report.add_issue("Graph density is very low, indicating sparse connections")
        
        if report.metrics.average_degree < 1.0:
            report.add_issue("Average degree is low, indicating poor connectivity")
    
    def _generate_recommendations(self, graph: KnowledgeGraph, report: GraphQualityReport) -> None:
        """Generate quality improvement recommendations"""
        metrics = report.metrics
        
        # Confidence recommendations
        if metrics.confidence_score < 0.7:
            report.add_recommendation("Consider re-extracting low-confidence entities and relationships")
        
        # Connectivity recommendations
        if metrics.entity_coverage < 0.5:
            report.add_recommendation("Add more relationships to improve entity coverage")
        
        if metrics.connected_components > 1:
            report.add_recommendation("Consider adding bridging relationships between disconnected components")
        
        # Content recommendations
        if metrics.entities_with_descriptions < metrics.entity_count * 0.5:
            report.add_recommendation("Add descriptions to entities to improve semantic richness")
        
        if metrics.entities_with_attributes < metrics.entity_count * 0.3:
            report.add_recommendation("Add more attributes to entities to improve information density")
        
        # Structural recommendations
        if metrics.density < 0.05:
            report.add_recommendation("Consider adding more relationships to improve graph density")
        
        if metrics.relationship_diversity < 3:
            report.add_recommendation("Add more diverse relationship types to improve semantic richness")
        
        # Overall recommendations
        if report.overall_score < 0.5:
            report.add_recommendation("Consider reprocessing source data with better extraction parameters")
        
        if report.overall_score >= 0.9:
            report.add_recommendation("Graph quality is excellent - consider this as a reference model")
    
    def get_quality_summary(self, graph: KnowledgeGraph) -> Dict[str, Any]:
        """Get a quick quality summary"""
        report = self.validate(graph)
        
        return {
            "overall_score": report.overall_score,
            "quality_level": report.quality_level,
            "entity_count": report.metrics.entity_count,
            "relationship_count": report.metrics.relationship_count,
            "issue_count": len(report.issues),
            "recommendation_count": len(report.recommendations),
            "top_issues": report.issues[:3],
            "top_recommendations": report.recommendations[:3]
        }