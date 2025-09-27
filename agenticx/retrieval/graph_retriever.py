"""
Graph Retriever Implementation

Implements graph-based retrieval using knowledge graphs and relationships.
"""

from typing import List, Dict, Any, Optional, Union
from dataclasses import dataclass

from .base import BaseRetriever, RetrievalQuery, RetrievalResult, RetrievalError, RetrievalType
from ..storage.graph_storages.base import BaseGraphStorage


@dataclass
class GraphNode:
    """Represents a node in the knowledge graph."""
    id: str
    label: str
    properties: Dict[str, Any]
    content: str


@dataclass
class GraphRelationship:
    """Represents a relationship in the knowledge graph."""
    id: str
    source_id: str
    target_id: str
    type: str
    properties: Dict[str, Any]


class GraphRetriever(BaseRetriever):
    """
    Graph-based retriever using knowledge graphs.
    
    Supports entity recognition, relationship search, and path queries.
    """
    
    def __init__(
        self,
        tenant_id: str,
        graph_storage: BaseGraphStorage,
        **kwargs
    ):
        # Filter out organization_id from kwargs to avoid conflicts
        filtered_kwargs = {k: v for k, v in kwargs.items() if k != 'organization_id'}
        super().__init__(tenant_id, **filtered_kwargs)
        self.graph_storage = graph_storage
        self._nodes: Dict[str, GraphNode] = {}
        self._relationships: Dict[str, GraphRelationship] = {}
    
    async def _initialize(self):
        """Initialize the graph retriever."""
        await self._load_graph_data()
    
    async def retrieve(
        self,
        query: Union[str, RetrievalQuery],
        **kwargs
    ) -> List[RetrievalResult]:
        """Retrieve documents using graph search."""
        
        await self.initialize()
        
        # Convert query to RetrievalQuery if needed
        if isinstance(query, str):
            retrieval_query = RetrievalQuery(text=query)
        else:
            retrieval_query = query
        
        try:
            # Search graph nodes
            node_results = await self._search_graph_nodes(retrieval_query.text)
            
            # Search graph relationships
            relationship_results = await self._search_graph_relationships(retrieval_query.text)
            
            # Combine and rank results
            all_results = node_results + relationship_results
            ranked_results = await self._rank_graph_results(all_results, retrieval_query.text)
            
            # Convert to RetrievalResult objects
            results = []
            for i, (content, score, metadata) in enumerate(ranked_results):
                if score >= retrieval_query.min_score:
                    result = RetrievalResult(
                        content=content,
                        score=score,
                        metadata=metadata,
                        source="graph",
                        chunk_id=f"graph_{i}",
                        graph_score=score
                    )
                    results.append(result)
            
            return results[:retrieval_query.limit]
            
        except Exception as e:
            raise RetrievalError(f"Graph retrieval failed: {str(e)}") from e
    
    async def add_documents(
        self,
        documents: List[Dict[str, Any]],
        **kwargs
    ) -> List[str]:
        """Add documents to the graph index."""
        
        await self.initialize()
        
        try:
            document_ids = []
            
            for doc in documents:
                # Extract entities and relationships from document
                entities = await self._extract_entities(doc.get("content", ""))
                relationships = await self._extract_relationships(doc.get("content", ""))
                
                # Add to graph storage
                node_ids = []
                for entity in entities:
                    node_id = entity.get("content", f"entity_{len(node_ids)}")
                    properties = {
                        **entity.get("properties", {}),
                        "label": entity.get("label", "Entity"),
                        "content": entity.get("content", "")
                    }
                    # Check if source_id and target_id exist before calling add_edge
                    source_id = entity.get("content", f"entity_{len(node_ids)}")
                    if source_id is not None:
                        self.graph_storage.add_node(
                            node_id=source_id,
                            properties=properties
                        )
                    node_ids.append(node_id)
                
                # Add relationships
                for rel in relationships:
                    source_id = rel.get("source_id")
                    target_id = rel.get("target_id")
                    # Check if source_id and target_id exist before calling add_edge
                    if source_id is not None and target_id is not None:
                        self.graph_storage.add_edge(
                            from_node=source_id,
                            to_node=target_id,
                            edge_type=rel.get("type", "RELATES_TO"),
                            properties=rel.get("properties", {})
                        )
                
                # Store document metadata
                doc_id = doc.get("id") or f"doc_{len(self._nodes)}"
                self._nodes[doc_id] = GraphNode(
                    id=doc_id,
                    label="Document",
                    properties=doc.get("metadata", {}),
                    content=doc.get("content", "")
                )
                
                document_ids.append(doc_id)
            
            return document_ids
            
        except Exception as e:
            raise RetrievalError(f"Failed to add documents: {str(e)}") from e
    
    async def remove_documents(
        self,
        document_ids: List[str],
        **kwargs
    ) -> bool:
        """Remove documents from the graph index."""
        
        try:
            for doc_id in document_ids:
                if doc_id in self._nodes:
                    # Remove from graph storage
                    self.graph_storage.delete_node(doc_id)
                    
                    # Remove from local cache
                    del self._nodes[doc_id]
            
            return True
            
        except Exception as e:
            raise RetrievalError(f"Failed to remove documents: {str(e)}") from e
    
    async def get_stats(self) -> Dict[str, Any]:
        """Get graph retriever statistics."""
        
        try:
            return {
                "retriever_type": "graph",
                "total_nodes": len(self._nodes),
                "total_relationships": len(self._relationships),
                "tenant_id": self.tenant_id
            }
            
        except Exception as e:
            return {
                "retriever_type": "graph",
                "error": str(e),
                "tenant_id": self.tenant_id
            }
    
    async def _search_graph_nodes(self, query: str) -> List[Dict[str, Any]]:
        """Search for nodes in the graph."""
        
        try:
            # Search nodes by name and description using query
            nodes = self.graph_storage.query(
                query=f"MATCH (n) WHERE n.name CONTAINS '{query}' OR n.description CONTAINS '{query}' RETURN n LIMIT 10"
            )
            
            results = []
            for node_data in nodes:
                node = node_data.get("n", {})
                results.append({
                    "content": node.get("content", ""),
                    "score": 0.7,  # Default score
                    "metadata": {
                        "node_id": node.get("id"),
                        "label": node.get("label", "Node"),
                        "properties": node.get("properties", {})
                    }
                })
            
            return results
            
        except Exception as e:
            print(f"Error searching graph nodes: {e}")
            return []
    
    async def _search_graph_relationships(self, query: str) -> List[Dict[str, Any]]:
        """Search for relationships in the graph."""
        
        try:
            # Search relationships by type and entity properties using query
            relationships = self.graph_storage.query(
                query=f"MATCH (a)-[r]->(b) WHERE r.type CONTAINS '{query}' OR a.name CONTAINS '{query}' OR b.name CONTAINS '{query}' OR a.description CONTAINS '{query}' OR b.description CONTAINS '{query}' RETURN a, r, b LIMIT 10"
            )
            
            results = []
            for rel_data in relationships:
                source_node = rel_data.get("a", {})
                target_node = rel_data.get("b", {})
                relationship = rel_data.get("r", {})
                
                content = f"{source_node.get('content', '')} {relationship.get('type', '')} {target_node.get('content', '')}"
                
                results.append({
                    "content": content,
                    "score": 0.6,  # Default score
                    "metadata": {
                        "relationship_id": relationship.get("id"),
                        "source_id": source_node.get("id"),
                        "target_id": target_node.get("id"),
                        "type": relationship.get("type"),
                        "properties": relationship.get("properties", {})
                    }
                })
            
            return results
            
        except Exception as e:
            print(f"Error searching graph relationships: {e}")
            return []
    
    async def _rank_graph_results(
        self,
        results: List[Dict[str, Any]],
        query: str
    ) -> List[tuple]:
        """Rank graph search results."""
        
        # Simple ranking based on score and content relevance
        ranked = []
        
        for result in results:
            score = result.get("score", 0.0)
            
            # Boost score for content relevance
            content = result.get("content", "")
            relevance_boost = self._calculate_content_relevance(content, query)
            
            final_score = score * (1 + relevance_boost)
            
            ranked.append((
                content,
                final_score,
                result.get("metadata", {})
            ))
        
        # Sort by score
        ranked.sort(key=lambda x: x[1], reverse=True)
        
        return ranked
    
    def _calculate_content_relevance(self, content: str, query: str) -> float:
        """Calculate content relevance to query."""
        
        # Simple keyword matching
        query_words = set(query.lower().split())
        content_words = set(content.lower().split())
        
        if not query_words or not content_words:
            return 0.0
        
        intersection = len(query_words & content_words)
        union = len(query_words | content_words)
        
        return intersection / union if union > 0 else 0.0
    
    async def _extract_entities(self, content: str) -> List[Dict[str, Any]]:
        """Extract entities from content."""
        
        # Simple entity extraction (in practice, use NER models)
        entities = []
        
        # Extract potential entities (capitalized words)
        import re
        potential_entities = re.findall(r'\b[A-Z][a-z]+\b', content)
        
        for entity in set(potential_entities):
            entities.append({
                "label": "Entity",
                "content": entity,
                "properties": {
                    "type": "unknown",
                    "frequency": content.count(entity)
                }
            })
        
        return entities
    
    async def _extract_relationships(self, content: str) -> List[Dict[str, Any]]:
        """Extract relationships from content."""
        
        # Simple relationship extraction (in practice, use relation extraction models)
        relationships = []
        
        # Extract simple subject-verb-object patterns
        import re
        svo_patterns = re.findall(r'\b(\w+)\s+(is|are|has|have)\s+(\w+)\b', content)
        
        for subject, verb, obj in svo_patterns:
            relationships.append({
                "source_id": subject,
                "target_id": obj,
                "type": verb.upper(),
                "properties": {
                    "confidence": 0.5
                }
            })
        
        return relationships
    
    async def _load_graph_data(self):
        """Load existing graph data from storage."""
        
        try:
            # Load nodes using query
            nodes = self.graph_storage.query("MATCH (n) RETURN n")
            for node_data in nodes:
                node = node_data.get("n", {})
                node_id = node.get("id", f"node_{len(self._nodes)}")
                self._nodes[node_id] = GraphNode(
                    id=node_id,
                    label=node.get("label", "Node"),
                    properties=node.get("properties", {}),
                    content=node.get("content", "")
                )
            
            # Load relationships using query
            relationships = self.graph_storage.query("MATCH (a)-[r]->(b) RETURN a, r, b")
            for rel_data in relationships:
                source_node = rel_data.get("a", {})
                target_node = rel_data.get("b", {})
                relationship = rel_data.get("r", {})
                
                rel_id = relationship.get("id", f"rel_{len(self._relationships)}")
                self._relationships[rel_id] = GraphRelationship(
                    id=rel_id,
                    source_id=source_node.get("id"),
                    target_id=target_node.get("id"),
                    type=relationship.get("type", "RELATES_TO"),
                    properties=relationship.get("properties", {})
                )
                
        except Exception as e:
            print(f"Error loading graph data: {e}")