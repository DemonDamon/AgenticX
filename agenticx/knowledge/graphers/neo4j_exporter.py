"""Neo4j Exporter for AgenticX Knowledge Graph

This module provides functionality to export knowledge graphs to Neo4j database.
"""

import json
from typing import Any, Dict, List, Optional, Union
from loguru import logger  # type: ignore

try:
    from neo4j import GraphDatabase  # type: ignore
    NEO4J_AVAILABLE = True
except ImportError:
    GraphDatabase = None  # type: ignore
    NEO4J_AVAILABLE = False

from .models import KnowledgeGraph, Entity, Relationship, EntityType, RelationType


class Neo4jExporter:
    """Export knowledge graph to Neo4j database"""
    
    def __init__(self, uri: str, username: str, password: str, database: str = "neo4j"):
        """Initialize Neo4j connection
        
        Args:
            uri: Neo4j database URI (e.g., "bolt://localhost:7687")
            username: Database username
            password: Database password
            database: Database name (default: "neo4j")
        """
        if not NEO4J_AVAILABLE:
            raise ImportError("Neo4j driver not available. Install with: pip install neo4j")
        
        self.uri = uri
        self.username = username
        self.password = password
        self.database = database
        self.driver = None
        
    def connect(self) -> None:
        """Establish connection to Neo4j"""
        try:
            self.driver = GraphDatabase.driver(
                self.uri, 
                auth=(self.username, self.password)
            )
            # Test connection
            with self.driver.session(database=self.database) as session:
                session.run("RETURN 1")
            logger.info(f"✅ 成功连接到Neo4j数据库: {self.uri}")
        except Exception as e:
            logger.error(f"❌ 连接Neo4j失败: {e}")
            raise
    
    def close(self) -> None:
        """Close Neo4j connection"""
        if self.driver:
            self.driver.close()
            logger.info("🔌 Neo4j连接已关闭")
    
    def clear_database(self) -> None:
        """Clear all nodes and relationships in the database"""
        if not self.driver:
            raise RuntimeError("Not connected to Neo4j. Call connect() first.")
        
        with self.driver.session(database=self.database) as session:
            # Delete all relationships first
            session.run("MATCH ()-[r]-() DELETE r")
            # Then delete all nodes
            session.run("MATCH (n) DELETE n")
            logger.info("🧹 已清空Neo4j数据库")
    
    def _clear_tenant_data(self, tenant_id: str) -> None:
        """Clear all nodes and relationships for a specific tenant."""
        if not self.driver:
            raise RuntimeError("Not connected to Neo4j. Call connect() first.")
    
        with self.driver.session(database=self.database) as session:
            # Delete all relationships for the tenant
            session.run("MATCH ()-[r {tenant_id: $tenant_id}]-() DELETE r", tenant_id=tenant_id)
            # Then delete all nodes for the tenant
            session.run("MATCH (n {tenant_id: $tenant_id}) DELETE n", tenant_id=tenant_id)
            logger.info(f"🧹 已清空租户 '{tenant_id}' 的数据")
    
    def export_graph(self, graph: KnowledgeGraph, tenant_id: str, clear_existing: bool = True) -> None:
        """Export knowledge graph to Neo4j
    
        Args:
            graph: Knowledge graph to export
            tenant_id: The ID of the tenant
            clear_existing: Whether to clear existing data for the tenant
        """
        if not self.driver:
            raise RuntimeError("Not connected to Neo4j. Call connect() first.")
    
        logger.info(f"🚀 开始导出知识图谱到Neo4j: {graph.name} (租户: {tenant_id})")
    
        if clear_existing:
            self._clear_tenant_data(tenant_id)
    
        # Export entities as nodes
        self._export_entities(graph.entities, tenant_id)
    
        # Export relationships as edges
        self._export_relationships(graph.relationships, tenant_id)
    
        # Create indexes for better performance
        self._create_indexes()
    
        logger.success(f"✅ 知识图谱导出完成！实体: {len(graph.entities)}, 关系: {len(graph.relationships)}")
    
    def _export_entities(self, entities: Dict[str, Entity], tenant_id: str) -> None:
        """Export entities as Neo4j nodes"""
        logger.info(f"📍 导出 {len(entities)} 个实体")
    
        with self.driver.session(database=self.database) as session:
            for entity in entities.values():
                # Create node with entity type as label
                cypher = f"""
                CREATE (e:{entity.entity_type.value.title()})
                SET e.id = $id,
                    e.name = $name,
                    e.description = $description,
                    e.confidence = $confidence,
                    e.created_at = $created_at,
                    e.updated_at = $updated_at,
                    e.tenant_id = $tenant_id
                """
    
                # Add attributes as properties
                for key, value in entity.attributes.items():
                    cypher += f", e.{self._sanitize_property_name(key)} = ${key}"
    
                params = {
                    "id": entity.id,
                    "name": entity.name,
                    "description": entity.description or "",
                    "confidence": entity.confidence,
                    "created_at": entity.created_at.isoformat() if entity.created_at else "",
                    "updated_at": entity.updated_at.isoformat() if entity.updated_at else "",
                    "tenant_id": tenant_id,
                    **entity.attributes
                }
    
                try:
                    session.run(cypher, params)
                    logger.trace(f"✅ 创建实体节点: {entity.name} ({entity.entity_type.value})")
                except Exception as e:
                    logger.error(f"❌ 创建实体节点失败 {entity.name}: {e}")
    
    def _export_relationships(self, relationships: Dict[str, Relationship], tenant_id: str) -> None:
        """Export relationships as Neo4j edges"""
        logger.info(f"🔗 导出 {len(relationships)} 个关系")
    
        with self.driver.session(database=self.database) as session:
            for relationship in relationships.values():
                # Create relationship between nodes
                relation_type = self._sanitize_relationship_type(
                    relationship.relation_type.value
                    if isinstance(relationship.relation_type, RelationType)
                    else relationship.relation_type
                )
    
                cypher = f"""
                MATCH (source {{id: $source_id, tenant_id: $tenant_id}})
                MATCH (target {{id: $target_id, tenant_id: $tenant_id}})
                CREATE (source)-[r:{relation_type}]->(target)
                SET r.id = $id,
                    r.description = $description,
                    r.confidence = $confidence,
                    r.created_at = $created_at,
                    r.updated_at = $updated_at,
                    r.tenant_id = $tenant_id
                """
    
                # Add attributes as properties
                for key, value in relationship.attributes.items():
                    cypher += f", r.{self._sanitize_property_name(key)} = ${key}"
    
                params = {
                    "source_id": relationship.source_entity_id,
                    "target_id": relationship.target_entity_id,
                    "id": relationship.id,
                    "description": relationship.description or "",
                    "confidence": relationship.confidence,
                    "created_at": relationship.created_at.isoformat() if relationship.created_at else "",
                    "updated_at": relationship.updated_at.isoformat() if relationship.updated_at else "",
                    "tenant_id": tenant_id,
                    **relationship.attributes
                }
    
                try:
                    session.run(cypher, params)
                    logger.trace(f"✅ 创建关系: {relationship.source_entity_id} --[{relation_type}]--> {relationship.target_entity_id}")
                except Exception as e:
                    logger.error(f"❌ 创建关系失败: {e}")
    
    def _create_indexes(self) -> None:
        """Create indexes for better query performance"""
        logger.info("创建索引以提升查询性能")
        
        indexes = [
            # Entity indexes
            "CREATE INDEX entity_id_index IF NOT EXISTS FOR (e:Person) ON (e.id)",
            "CREATE INDEX entity_name_index IF NOT EXISTS FOR (e:Person) ON (e.name)",
            "CREATE INDEX entity_id_index IF NOT EXISTS FOR (e:Organization) ON (e.id)",
            "CREATE INDEX entity_name_index IF NOT EXISTS FOR (e:Organization) ON (e.name)",
            "CREATE INDEX entity_id_index IF NOT EXISTS FOR (e:Location) ON (e.id)",
            "CREATE INDEX entity_name_index IF NOT EXISTS FOR (e:Location) ON (e.name)",
            "CREATE INDEX entity_id_index IF NOT EXISTS FOR (e:Event) ON (e.id)",
            "CREATE INDEX entity_name_index IF NOT EXISTS FOR (e:Event) ON (e.name)",
            "CREATE INDEX entity_id_index IF NOT EXISTS FOR (e:Concept) ON (e.id)",
            "CREATE INDEX entity_name_index IF NOT EXISTS FOR (e:Concept) ON (e.name)",
            "CREATE INDEX entity_id_index IF NOT EXISTS FOR (e:Object) ON (e.id)",
            "CREATE INDEX entity_name_index IF NOT EXISTS FOR (e:Object) ON (e.name)",
            "CREATE INDEX entity_id_index IF NOT EXISTS FOR (e:Time) ON (e.id)",
            "CREATE INDEX entity_name_index IF NOT EXISTS FOR (e:Time) ON (e.name)",
            "CREATE INDEX entity_id_index IF NOT EXISTS FOR (e:Unknown) ON (e.id)",
            "CREATE INDEX entity_name_index IF NOT EXISTS FOR (e:Unknown) ON (e.name)",
        ]
        
        with self.driver.session(database=self.database) as session:
            for index_query in indexes:
                try:
                    session.run(index_query)
                except Exception as e:
                    logger.warning(f"创建索引时出现警告: {e}")
        
        logger.debug("✅ 索引创建完成")
    
    def _sanitize_property_name(self, name: str) -> str:
        """Sanitize property name for Neo4j"""
        # Replace invalid characters with underscores
        sanitized = "".join(c if c.isalnum() or c == "_" else "_" for c in name)
        # Ensure it doesn't start with a number
        if sanitized and sanitized[0].isdigit():
            sanitized = "prop_" + sanitized
        return sanitized or "unknown_property"
    
    def _sanitize_relationship_type(self, rel_type: str) -> str:
        """Sanitize relationship type for Neo4j"""
        # Convert to uppercase and replace invalid characters
        sanitized = rel_type.upper().replace(" ", "_").replace("-", "_")
        sanitized = "".join(c if c.isalnum() or c == "_" else "_" for c in sanitized)
        return sanitized or "UNKNOWN_RELATION"
    
    def export_to_spo_format(self, graph: KnowledgeGraph, output_path: str) -> None:
        """Export graph to SPO (Subject-Predicate-Object) JSON format like youtu-graph
        
        Args:
            graph: Knowledge graph to export
            output_path: Output file path for SPO JSON
        """
        logger.info(f"导出SPO格式到: {output_path}")
        
        spo_data = []
        
        for relationship in graph.relationships.values():
            source_entity = graph.entities.get(relationship.source_entity_id)
            target_entity = graph.entities.get(relationship.target_entity_id)
            
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
        import os
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(spo_data, f, ensure_ascii=False, indent=2)
        
        logger.success(f"✅ SPO格式导出完成: {len(spo_data)} 个三元组")
    
    def query_graph(self, cypher_query: str, parameters: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """Execute Cypher query and return results
        
        Args:
            cypher_query: Cypher query string
            parameters: Query parameters
            
        Returns:
            List of query results
        """
        if not self.driver:
            raise RuntimeError("Not connected to Neo4j. Call connect() first.")
        
        with self.driver.session(database=self.database) as session:
            result = session.run(cypher_query, parameters or {})
            return [record.data() for record in result]
    
    def get_graph_statistics(self) -> Dict[str, Any]:
        """Get graph statistics from Neo4j"""
        stats_queries = {
            "node_count": "MATCH (n) RETURN count(n) as count",
            "relationship_count": "MATCH ()-[r]-() RETURN count(r) as count",
            "entity_types": """
                MATCH (n) 
                RETURN labels(n)[0] as entity_type, count(n) as count 
                ORDER BY count DESC
            """,
            "relationship_types": """
                MATCH ()-[r]-() 
                RETURN type(r) as relationship_type, count(r) as count 
                ORDER BY count DESC
            """
        }
        
        stats = {}
        
        for stat_name, query in stats_queries.items():
            try:
                result = self.query_graph(query)
                if stat_name in ["node_count", "relationship_count"]:
                    stats[stat_name] = result[0]["count"] if result else 0
                else:
                    stats[stat_name] = result
            except Exception as e:
                logger.error(f"获取统计信息失败 {stat_name}: {e}")
                stats[stat_name] = 0 if stat_name.endswith("_count") else []
        
        return stats


# Context manager for automatic connection handling
class Neo4jExporterContext:
    """Context manager for Neo4j exporter"""
    
    def __init__(self, uri: str, username: str, password: str, database: str = "neo4j"):
        self.exporter = Neo4jExporter(uri, username, password, database)
    
    def __enter__(self) -> Neo4jExporter:
        self.exporter.connect()
        return self.exporter
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.exporter.close()