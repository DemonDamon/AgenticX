"""Knowledge Graph Data Models for AgenticX

This module provides data models for knowledge graph construction,
including entities, relationships, and graph structures.
"""

import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone, UTC
from enum import Enum
from typing import Any, Dict, List, Optional, Set, Union

import networkx as nx


class EntityType(Enum):
    """Entity types in knowledge graph"""
    PERSON = "person"
    ORGANIZATION = "organization"
    LOCATION = "location"
    EVENT = "event"
    CONCEPT = "concept"
    OBJECT = "object"
    TIME = "time"
    UNKNOWN = "unknown"


class RelationType(Enum):
    """Relationship types in knowledge graph"""
    # Basic relations
    IS_A = "is_a"
    PART_OF = "part_of"
    HAS_ATTRIBUTE = "has_attribute"
    LOCATED_IN = "located_in"
    OCCURS_AT = "occurs_at"
    
    # Social relations
    WORKS_FOR = "works_for"
    KNOWS = "knows"
    RELATED_TO = "related_to"
    
    # Temporal relations
    BEFORE = "before"
    AFTER = "after"
    DURING = "during"
    
    # Custom relations
    CUSTOM = "custom"


class NodeLevel(Enum):
    """Node levels in hierarchical graph structure"""
    ATTRIBUTE = 1      # Attributes of entities
    ENTITY = 2         # Core entities
    KEYWORD = 3        # Keywords/topics
    COMMUNITY = 4      # Communities/clusters


@dataclass
class Entity:
    """Represents an entity in the knowledge graph"""
    
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    name: str = ""
    entity_type: EntityType = EntityType.UNKNOWN
    description: Optional[str] = None
    attributes: Dict[str, Any] = field(default_factory=dict)
    source_chunks: Set[str] = field(default_factory=set)
    confidence: float = 1.0
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    
    def __post_init__(self):
        """Validate entity data after initialization"""
        if not self.name:
            raise ValueError("Entity name cannot be empty")
        
        if not 0.0 <= self.confidence <= 1.0:
            raise ValueError("Confidence must be between 0.0 and 1.0")
    
    def add_attribute(self, key: str, value: Any) -> None:
        """Add an attribute to the entity"""
        self.attributes[key] = value
    
    def add_source_chunk(self, chunk_id: str) -> None:
        """Add a source chunk ID"""
        self.source_chunks.add(chunk_id)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert entity to dictionary"""
        return {
            "id": self.id,
            "name": self.name,
            "entity_type": self.entity_type.value,
            "description": self.description,
            "attributes": self.attributes,
            "source_chunks": list(self.source_chunks),
            "confidence": self.confidence,
            "created_at": self.created_at.isoformat()
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Entity":
        """Create entity from dictionary"""
        entity = cls(
            id=data.get("id", str(uuid.uuid4())),
            name=data["name"],
            entity_type=EntityType(data.get("entity_type", "unknown")),
            description=data.get("description"),
            attributes=data.get("attributes", {}),
            confidence=data.get("confidence", 1.0)
        )
        
        # Handle source_chunks
        source_chunks = data.get("source_chunks", [])
        entity.source_chunks = set(source_chunks)
        
        # Handle created_at
        if "created_at" in data:
            entity.created_at = datetime.fromisoformat(data["created_at"])
        
        return entity


@dataclass
class Relationship:
    """Represents a relationship between entities"""
    
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    source_entity_id: str = ""
    target_entity_id: str = ""
    relation_type: Union[RelationType, str] = RelationType.RELATED_TO
    description: Optional[str] = None
    attributes: Dict[str, Any] = field(default_factory=dict)
    source_chunks: Set[str] = field(default_factory=set)
    confidence: float = 1.0
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    
    def __post_init__(self):
        """Validate relationship data after initialization"""
        if not self.source_entity_id or not self.target_entity_id:
            raise ValueError("Source and target entity IDs cannot be empty")
        
        if not 0.0 <= self.confidence <= 1.0:
            raise ValueError("Confidence must be between 0.0 and 1.0")
        
        # Convert string relation_type to RelationType if possible
        if isinstance(self.relation_type, str):
            try:
                self.relation_type = RelationType(self.relation_type)
            except ValueError:
                # Keep as custom string if not in enum
                pass
    
    def add_source_chunk(self, chunk_id: str) -> None:
        """Add a source chunk ID"""
        self.source_chunks.add(chunk_id)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert relationship to dictionary"""
        relation_value = (
            self.relation_type.value 
            if isinstance(self.relation_type, RelationType) 
            else self.relation_type
        )
        
        return {
            "id": self.id,
            "source_entity_id": self.source_entity_id,
            "target_entity_id": self.target_entity_id,
            "relation_type": relation_value,
            "description": self.description,
            "attributes": self.attributes,
            "source_chunks": list(self.source_chunks),
            "confidence": self.confidence,
            "created_at": self.created_at.isoformat()
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Relationship":
        """Create relationship from dictionary"""
        relationship = cls(
            id=data.get("id", str(uuid.uuid4())),
            source_entity_id=data["source_entity_id"],
            target_entity_id=data["target_entity_id"],
            relation_type=data.get("relation_type", "related_to"),
            description=data.get("description"),
            attributes=data.get("attributes", {}),
            confidence=data.get("confidence", 1.0)
        )
        
        # Handle source_chunks
        source_chunks = data.get("source_chunks", [])
        relationship.source_chunks = set(source_chunks)
        
        # Handle created_at
        if "created_at" in data:
            relationship.created_at = datetime.fromisoformat(data["created_at"])
        
        return relationship


@dataclass
class GraphQualityMetrics:
    """Metrics for evaluating knowledge graph quality"""
    
    # Basic statistics
    entity_count: int = 0
    relationship_count: int = 0
    node_count: int = 0
    edge_count: int = 0
    
    # Connectivity metrics
    connected_components: int = 0
    average_degree: float = 0.0
    density: float = 0.0
    
    # Quality metrics
    entity_coverage: float = 0.0      # Percentage of entities with relationships
    relationship_diversity: float = 0.0  # Number of unique relation types
    confidence_score: float = 0.0     # Average confidence of entities/relationships
    
    # Structural metrics
    clustering_coefficient: float = 0.0
    average_path_length: float = 0.0
    
    # Content quality
    entities_with_attributes: int = 0
    entities_with_descriptions: int = 0
    
    def calculate_overall_score(self) -> float:
        """Calculate overall quality score (0-1)"""
        weights = {
            'connectivity': 0.3,
            'coverage': 0.25,
            'diversity': 0.2,
            'confidence': 0.15,
            'content': 0.1
        }
        
        # Normalize metrics to 0-1 scale
        connectivity_score = min(1.0, self.density * 10)  # Density is usually small
        coverage_score = self.entity_coverage
        diversity_score = min(1.0, self.relationship_diversity / 10)  # Assume max 10 types
        confidence_score = self.confidence_score
        content_score = (
            (self.entities_with_attributes + self.entities_with_descriptions) / 
            (2 * max(1, self.entity_count))
        )
        
        overall_score = (
            connectivity_score * weights['connectivity'] +
            coverage_score * weights['coverage'] +
            diversity_score * weights['diversity'] +
            confidence_score * weights['confidence'] +
            content_score * weights['content']
        )
        
        return min(1.0, overall_score)


@dataclass
class GraphQualityReport:
    """Comprehensive quality report for knowledge graph"""
    
    metrics: GraphQualityMetrics = field(default_factory=GraphQualityMetrics)
    issues: List[str] = field(default_factory=list)
    recommendations: List[str] = field(default_factory=list)
    overall_score: float = 0.0
    quality_level: str = "Unknown"
    
    def __post_init__(self):
        """Calculate overall score and quality level"""
        self.overall_score = self.metrics.calculate_overall_score()
        
        if self.overall_score >= 0.9:
            self.quality_level = "Excellent"
        elif self.overall_score >= 0.7:
            self.quality_level = "Good"
        elif self.overall_score >= 0.5:
            self.quality_level = "Fair"
        else:
            self.quality_level = "Poor"
    
    def add_issue(self, issue: str) -> None:
        """Add a quality issue"""
        self.issues.append(issue)
    
    def add_recommendation(self, recommendation: str) -> None:
        """Add a quality improvement recommendation"""
        self.recommendations.append(recommendation)
    
    def summary(self) -> str:
        """Generate a summary of the quality report"""
        summary_parts = [
            f"质量等级: {self.quality_level}",
            f"总体评分: {self.overall_score:.2f}",
            f"实体数量: {self.metrics.entity_count}",
            f"关系数量: {self.metrics.relationship_count}",
            f"连通性: {self.metrics.density:.3f}"
        ]
        
        if self.issues:
            summary_parts.append(f"发现问题: {len(self.issues)}个")
        
        if self.recommendations:
            summary_parts.append(f"改进建议: {len(self.recommendations)}个")
        
        return " | ".join(summary_parts)


class KnowledgeGraph:
    """Knowledge graph implementation using NetworkX"""
    
    def __init__(self, name: str = ""):
        self.name = name
        self.graph = nx.MultiDiGraph()
        self.entities: Dict[str, Entity] = {}
        self.relationships: Dict[str, Relationship] = {}
        self.created_at = datetime.now(timezone.utc)
        self.updated_at = datetime.now(timezone.utc)
        self.metadata: Dict[str, Any] = {}
    
    def add_entity(self, entity: Entity) -> str:
        """Add an entity to the graph"""
        self.entities[entity.id] = entity
        
        # Add node to NetworkX graph
        self.graph.add_node(
            entity.id,
            label="entity",
            level=NodeLevel.ENTITY.value,
            properties={
                "name": entity.name,
                "entity_type": entity.entity_type.value,
                "description": entity.description,
                "attributes": entity.attributes,
                "confidence": entity.confidence
            }
        )
        
        self.updated_at = datetime.now(timezone.utc)
        return entity.id
    
    def add_relationship(self, relationship: Relationship) -> str:
        """Add a relationship to the graph"""
        # Validate that entities exist
        if relationship.source_entity_id not in self.entities:
            raise ValueError(f"Source entity {relationship.source_entity_id} not found")
        if relationship.target_entity_id not in self.entities:
            raise ValueError(f"Target entity {relationship.target_entity_id} not found")
        
        self.relationships[relationship.id] = relationship
        
        # Add edge to NetworkX graph
        relation_value = (
            relationship.relation_type.value 
            if isinstance(relationship.relation_type, RelationType) 
            else relationship.relation_type
        )
        
        self.graph.add_edge(
            relationship.source_entity_id,
            relationship.target_entity_id,
            key=relationship.id,
            relation=relation_value,
            description=relationship.description,
            confidence=relationship.confidence,
            attributes=relationship.attributes
        )
        
        self.updated_at = datetime.now(timezone.utc)
        return relationship.id
    
    def get_entity(self, entity_id: str) -> Optional[Entity]:
        """Get entity by ID"""
        return self.entities.get(entity_id)
    
    def get_relationship(self, relationship_id: str) -> Optional[Relationship]:
        """Get relationship by ID"""
        return self.relationships.get(relationship_id)
    
    def find_entities_by_name(self, name: str, exact_match: bool = True) -> List[Entity]:
        """Find entities by name"""
        if exact_match:
            return [entity for entity in self.entities.values() if entity.name == name]
        else:
            name_lower = name.lower()
            return [
                entity for entity in self.entities.values() 
                if name_lower in entity.name.lower()
            ]
    
    def find_entities_by_type(self, entity_type: EntityType) -> List[Entity]:
        """Find entities by type"""
        return [
            entity for entity in self.entities.values() 
            if entity.entity_type == entity_type
        ]
    
    def get_entity_relationships(self, entity_id: str) -> List[Relationship]:
        """Get all relationships involving an entity"""
        return [
            rel for rel in self.relationships.values()
            if rel.source_entity_id == entity_id or rel.target_entity_id == entity_id
        ]
    
    def get_neighbors(self, entity_id: str) -> List[str]:
        """Get neighboring entity IDs"""
        if entity_id not in self.graph:
            return []
        
        neighbors = set()
        neighbors.update(self.graph.predecessors(entity_id))
        neighbors.update(self.graph.successors(entity_id))
        return list(neighbors)
    
    def merge_entities(self, entity_id1: str, entity_id2: str, keep_id: Optional[str] = None) -> str:
        """Merge two entities into one"""
        entity1 = self.get_entity(entity_id1)
        entity2 = self.get_entity(entity_id2)
        
        if not entity1 or not entity2:
            raise ValueError("Both entities must exist")
        
        # Determine which entity to keep
        if keep_id:
            if keep_id not in [entity_id1, entity_id2]:
                raise ValueError("keep_id must be one of the entity IDs")
            keep_entity = self.get_entity(keep_id)
            remove_id = entity_id2 if keep_id == entity_id1 else entity_id1
        else:
            # Keep the entity with higher confidence
            if entity1.confidence >= entity2.confidence:
                keep_entity = entity1
                remove_id = entity_id2
            else:
                keep_entity = entity2
                remove_id = entity_id1
        
        remove_entity = self.get_entity(remove_id)
        
        # Merge attributes and source chunks
        keep_entity.attributes.update(remove_entity.attributes)
        keep_entity.source_chunks.update(remove_entity.source_chunks)
        
        # Update relationships
        for rel in self.relationships.values():
            if rel.source_entity_id == remove_id:
                rel.source_entity_id = keep_entity.id
            if rel.target_entity_id == remove_id:
                rel.target_entity_id = keep_entity.id
        
        # Remove the merged entity
        del self.entities[remove_id]
        self.graph.remove_node(remove_id)
        
        # Update the graph
        self.graph.nodes[keep_entity.id]["properties"].update({
            "attributes": keep_entity.attributes,
            "confidence": keep_entity.confidence
        })
        
        self.updated_at = datetime.now(timezone.utc)
        return keep_entity.id
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert graph to dictionary"""
        return {
            "name": self.name,
            "entities": [entity.to_dict() for entity in self.entities.values()],
            "relationships": [rel.to_dict() for rel in self.relationships.values()],
            "metadata": self.metadata,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat()
        }
    
    def to_json(self, file_path: str) -> None:
        """Save graph to JSON file"""
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(self.to_dict(), f, ensure_ascii=False, indent=2)
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "KnowledgeGraph":
        """Create graph from dictionary"""
        graph = cls(name=data.get("name", ""))
        
        # Load entities
        for entity_data in data.get("entities", []):
            entity = Entity.from_dict(entity_data)
            graph.add_entity(entity)
        
        # Load relationships
        for rel_data in data.get("relationships", []):
            relationship = Relationship.from_dict(rel_data)
            try:
                graph.add_relationship(relationship)
            except ValueError as e:
                # Skip relationships with missing entities
                continue
        
        # Load metadata
        graph.metadata = data.get("metadata", {})
        
        # Load timestamps
        if "created_at" in data:
            graph.created_at = datetime.fromisoformat(data["created_at"])
        if "updated_at" in data:
            graph.updated_at = datetime.fromisoformat(data["updated_at"])
        
        return graph
    
    @classmethod
    def from_json(cls, file_path: str) -> "KnowledgeGraph":
        """Load graph from JSON file"""
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return cls.from_dict(data)
    
    def get_statistics(self) -> Dict[str, Any]:
        """Get basic graph statistics"""
        return {
            "entity_count": len(self.entities),
            "relationship_count": len(self.relationships),
            "node_count": self.graph.number_of_nodes(),
            "edge_count": self.graph.number_of_edges(),
            "connected_components": nx.number_weakly_connected_components(self.graph),
            "density": nx.density(self.graph),
            "entity_types": {
                entity_type.value: len(self.find_entities_by_type(entity_type))
                for entity_type in EntityType
            }
        }
    
    def export_to_neo4j(self, uri: str, username: str, password: str, 
                       database: str = "neo4j", clear_existing: bool = True) -> None:
        """Export knowledge graph to Neo4j database
        
        Args:
            uri: Neo4j database URI (e.g., "bolt://localhost:7687")
            username: Database username
            password: Database password
            database: Database name (default: "neo4j")
            clear_existing: Whether to clear existing data
        """
        try:
            from .neo4j_exporter import Neo4jExporterContext
            
            with Neo4jExporterContext(uri, username, password, database) as exporter:
                exporter.export_graph(self, clear_existing=clear_existing)
                
        except ImportError:
            raise ImportError("Neo4j exporter not available. Make sure neo4j_exporter.py is in the same directory.")
    
    def export_to_spo_json(self, output_path: str) -> None:
        """Export graph to SPO (Subject-Predicate-Object) JSON format like youtu-graph
        
        Args:
            output_path: Output file path for SPO JSON
        """
        try:
            from .neo4j_exporter import Neo4jExporter
            
            # Create a temporary exporter just for SPO export (no connection needed)
            exporter = Neo4jExporter("", "", "")  # Dummy values
            exporter.export_to_spo_format(self, output_path)
            
        except ImportError:
            # Fallback implementation without neo4j_exporter
            import os
            
            spo_data = []
            
            for relationship in self.relationships.values():
                source_entity = self.entities.get(relationship.source_entity_id)
                target_entity = self.entities.get(relationship.target_entity_id)
                
                if not source_entity or not target_entity:
                    continue
                
                spo_triple = {
                    "start_node": {
                        "label": source_entity.entity_type.value,
                        "properties": {
                            "name": source_entity.name,
                            "id": source_entity.id,
                            "description": source_entity.description or "",
                            **source_entity.attributes
                        }
                    },
                    "relation": (
                        relationship.relation_type.value 
                        if isinstance(relationship.relation_type, RelationType) 
                        else relationship.relation_type
                    ),
                    "end_node": {
                        "label": target_entity.entity_type.value,
                        "properties": {
                            "name": target_entity.name,
                            "id": target_entity.id,
                            "description": target_entity.description or "",
                            **target_entity.attributes
                        }
                    },
                    "relationship_properties": {
                        "id": relationship.id,
                        "description": relationship.description or "",
                        "confidence": relationship.confidence,
                        **relationship.attributes
                    }
                }
                
                spo_data.append(spo_triple)
            
            # Save to JSON file
            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(spo_data, f, ensure_ascii=False, indent=2)