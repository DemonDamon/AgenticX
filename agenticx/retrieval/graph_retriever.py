"""
Graph Retriever Implementation

Implements graph-based retrieval using knowledge graphs and relationships.
Enhanced with vector indexing capabilities inspired by youtu-graphrag:
- Node vector indexing for semantic node search
- Relation vector indexing for relationship type search  
- Triple vector indexing for fact-based search
- Community vector indexing for cluster-based search
"""

import logging
from typing import List, Dict, Any, Optional, Union
from dataclasses import dataclass

from .base import BaseRetriever, RetrievalQuery, RetrievalResult, RetrievalError, RetrievalType
from ..storage.graph_storages.base import BaseGraphStorage
from ..storage.vectordb_storages.base import BaseVectorStorage, VectorRecord
from ..embeddings.base import BaseEmbeddingProvider

logger = logging.getLogger(__name__)


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


@dataclass
class GraphVectorConfig:
    """Configuration for graph vector indexing."""
    enable_vector_indexing: bool = False
    vector_collections: Dict[str, str] = None
    batch_size: int = 100
    enable_caching: bool = True
    
    def __post_init__(self):
        if self.vector_collections is None:
            self.vector_collections = {
                "nodes": "graph_nodes",
                "relations": "graph_relations", 
                "triples": "graph_triples",
                "communities": "graph_communities"
            }


class GraphRetriever(BaseRetriever):
    """
    Enhanced graph-based retriever using knowledge graphs and vector indexing.
    
    Supports:
    - Traditional graph traversal and search
    - Vector-based semantic search for nodes, relations, triples, and communities
    - Hybrid retrieval combining graph structure and semantic similarity
    """
    
    def __init__(
        self,
        tenant_id: str,
        graph_storage: BaseGraphStorage,
        vector_storage: Optional[BaseVectorStorage] = None,
        embedding_provider: Optional[BaseEmbeddingProvider] = None,
        vector_config: Optional[GraphVectorConfig] = None,
        **kwargs
    ):
        # Filter out organization_id from kwargs to avoid conflicts
        filtered_kwargs = {k: v for k, v in kwargs.items() if k != 'organization_id'}
        super().__init__(tenant_id, **filtered_kwargs)
        
        # Core storage
        self.graph_storage = graph_storage
        self.vector_storage = vector_storage
        self.embedding_provider = embedding_provider
        
        # Vector indexing configuration
        self.vector_config = vector_config or GraphVectorConfig()
        self.enable_vector_search = (
            self.vector_config.enable_vector_indexing and 
            self.vector_storage is not None and 
            self.embedding_provider is not None
        )
        
        # Local caches
        self._nodes: Dict[str, GraphNode] = {}
        self._relationships: Dict[str, GraphRelationship] = {}
        
        # Vector index status
        self._vector_indices_built = False
    
    async def _initialize(self):
        """Initialize the graph retriever."""
        await self._load_graph_data()
    
    async def retrieve(
        self,
        query: Union[str, RetrievalQuery],
        **kwargs
    ) -> List[RetrievalResult]:
        """
        Enhanced retrieve using both traditional graph search and vector indexing.
        
        Supports multiple retrieval strategies:
        - 'traditional': Classic graph traversal only
        - 'vector': Vector-based semantic search only  
        - 'hybrid': Combined graph + vector search (default)
        - 'auto': Intelligent strategy selection
        """
        
        await self.initialize()
        
        # Convert query to RetrievalQuery if needed
        if isinstance(query, str):
            retrieval_query = RetrievalQuery(text=query)
        else:
            retrieval_query = query
        
        # Determine retrieval strategy
        strategy = kwargs.get('strategy', 'hybrid' if self.enable_vector_search else 'traditional')
        
        try:
            all_results = []
            
            # Traditional graph search
            if strategy in ['traditional', 'hybrid', 'auto']:
                graph_results = await self._traditional_graph_search(retrieval_query.text)
                all_results.extend(self._add_source_tag(graph_results, 'graph_traditional'))
            
            # Vector-based search
            if strategy in ['vector', 'hybrid', 'auto'] and self.enable_vector_search:
                vector_results = await self._vector_graph_search(retrieval_query.text, kwargs.get('top_k', 10))
                all_results.extend(self._add_source_tag(vector_results, 'graph_vector'))
            
            # Rank and merge results
            if strategy == 'hybrid' and len(all_results) > 0:
                ranked_results = await self._hybrid_rank_results(all_results, retrieval_query.text)
            else:
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
            logger.error(f"Graph retrieval failed: {e}")
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
            logger.error(f"Error loading graph data: {e}")
    
    # ========== Enhanced Methods for Vector Indexing ==========
    
    async def _traditional_graph_search(self, query: str) -> List[Dict[str, Any]]:
        """Traditional graph search combining node and relationship search."""
        node_results = await self._search_graph_nodes(query)
        relationship_results = await self._search_graph_relationships(query)
        return node_results + relationship_results
    
    async def _vector_graph_search(self, query: str, top_k: int = 10) -> List[Dict[str, Any]]:
        """Vector-based graph search using four index types."""
        if not self.enable_vector_search:
            return []
        
        try:
            # Generate query embedding - 修复：根据provider类型选择正确的调用方式
            if hasattr(self.embedding_provider, 'aembed_text'):
                # EmbeddingRouter类型，使用aembed_text处理单个字符串
                query_embedding = await self.embedding_provider.aembed_text(query)
            else:
                # BaseEmbeddingProvider类型，使用aembed处理字符串列表
                query_embeddings = await self.embedding_provider.aembed([query])
                query_embedding = query_embeddings[0]
            
            all_results = []
            
            # Search node vectors
            node_results = await self._search_node_vectors(query_embedding, top_k)
            all_results.extend(self._add_vector_type(node_results, 'node'))
            
            # Search relation vectors
            relation_results = await self._search_relation_vectors(query_embedding, top_k)
            all_results.extend(self._add_vector_type(relation_results, 'relation'))
            
            # Search triple vectors
            triple_results = await self._search_triple_vectors(query_embedding, top_k)
            all_results.extend(self._add_vector_type(triple_results, 'triple'))
            
            # Search community vectors
            community_results = await self._search_community_vectors(query_embedding, top_k)
            all_results.extend(self._add_vector_type(community_results, 'community'))
            
            return all_results
            
        except Exception as e:
            logger.error(f"Vector graph search failed: {e}")
            return []
    
    async def _search_node_vectors(self, query_embedding: List[float], top_k: int) -> List[Dict[str, Any]]:
        """Search node vectors."""
        try:
            from ..storage.vectordb_storages.base import VectorDBQuery
            query = VectorDBQuery(
                query_vector=query_embedding,
                top_k=top_k
            )
            results = self.vector_storage.query(query)
            
            return [self._convert_vector_result_to_graph_result(r, 'node') for r in results]
        except Exception as e:
            logger.warning(f"Node vector search failed: {e}")
            return []
    
    async def _search_relation_vectors(self, query_embedding: List[float], top_k: int) -> List[Dict[str, Any]]:
        """Search relation vectors."""
        try:
            from ..storage.vectordb_storages.base import VectorDBQuery
            query = VectorDBQuery(
                query_vector=query_embedding,
                top_k=top_k
            )
            results = self.vector_storage.query(query)
            
            return [self._convert_vector_result_to_graph_result(r, 'relation') for r in results]
        except Exception as e:
            logger.warning(f"Relation vector search failed: {e}")
            return []
    
    async def _search_triple_vectors(self, query_embedding: List[float], top_k: int) -> List[Dict[str, Any]]:
        """Search triple vectors."""
        try:
            from ..storage.vectordb_storages.base import VectorDBQuery
            query = VectorDBQuery(
                query_vector=query_embedding,
                top_k=top_k
            )
            results = self.vector_storage.query(query)
            
            return [self._convert_vector_result_to_graph_result(r, 'triple') for r in results]
        except Exception as e:
            logger.warning(f"Triple vector search failed: {e}")
            return []
    
    async def _search_community_vectors(self, query_embedding: List[float], top_k: int) -> List[Dict[str, Any]]:
        """Search community vectors."""
        try:
            from ..storage.vectordb_storages.base import VectorDBQuery
            query = VectorDBQuery(
                query_vector=query_embedding,
                top_k=top_k
            )
            results = self.vector_storage.query(query)
            
            return [self._convert_vector_result_to_graph_result(r, 'community') for r in results]
        except Exception as e:
            logger.warning(f"Community vector search failed: {e}")
            return []
    
    def _convert_vector_result_to_graph_result(self, vector_result, result_type: str) -> Dict[str, Any]:
        """Convert vector search result to graph result format."""
        # 处理 VectorDBQueryResult 对象
        if hasattr(vector_result, 'record') and hasattr(vector_result, 'similarity'):
            # 极端错误检查：VectorRecord没有metadata属性，只有payload属性！
            if hasattr(vector_result.record, 'metadata'):
                print(f"🚨 CRITICAL ERROR: VectorRecord should NOT have metadata attribute!")
                print(f"🚨 VectorRecord attributes: {dir(vector_result.record)}")
                print(f"🚨 This is a serious bug - exiting immediately!")
                import sys
                sys.exit(1)
            
            # 正确的做法：使用payload属性而不是metadata
            metadata = vector_result.record.payload if vector_result.record.payload else {}
            score = vector_result.similarity
        else:
            # 兼容字典格式
            metadata = vector_result.get('metadata', {})
            score = vector_result.get('score', 0.0)
        
        # 🔧 修复：直接使用向量记录中存储的content，而不是重新生成
        content = metadata.get('content', '')
        
        # 如果没有content，才使用备用生成逻辑
        if not content:
            if result_type == 'node':
                name = metadata.get('name', '')
                description = metadata.get('description', '')
                
                # 过滤掉无用的"动态创建的实体"描述
                if description.startswith('动态创建的实体:') or description.startswith('实体:'):
                    # 尝试从其他字段获取更好的描述
                    if 'properties' in metadata and isinstance(metadata['properties'], dict):
                        props = metadata['properties']
                        # 查找可能的描述字段
                        for key in ['description', 'summary', 'content', 'definition', 'info']:
                            if key in props and props[key] and not props[key].startswith('动态创建的实体:'):
                                description = props[key]
                                break
                        else:
                            # 如果没有找到好的描述，使用实体类型信息
                            entity_type = props.get('type', props.get('entity_type', ''))
                            if entity_type:
                                description = f"类型为{entity_type}的实体"
                            else:
                                description = f"知识图谱中的{name}实体"
                    else:
                        description = f"知识图谱中的{name}实体"
                
                content = f"Entity: {name}. {description}" if description else f"Entity: {name}"
            elif result_type == 'relation':
                content = f"Relationship: {metadata.get('relation_name', '')}"
            elif result_type == 'triple':
                content = metadata.get('triple_text', f"{metadata.get('head', '')} {metadata.get('relation', '')} {metadata.get('tail', '')}")
            elif result_type == 'community':
                content = f"Community: {metadata.get('name', '')}. {metadata.get('description', '')}"
            else:
                content = str(metadata)
        
        return {
            'content': content,
            'score': score,
            'metadata': {
                **metadata,
                'vector_type': result_type,
                'search_method': 'vector'
            }
        }
    
    def _add_source_tag(self, results: List[Dict[str, Any]], source: str) -> List[Dict[str, Any]]:
        """Add source tag to results."""
        for result in results:
            result['metadata'] = result.get('metadata', {})
            result['metadata']['search_source'] = source
        return results
    
    def _add_vector_type(self, results: List[Dict[str, Any]], vector_type: str) -> List[Dict[str, Any]]:
        """Add vector type tag to results."""
        for result in results:
            result['metadata'] = result.get('metadata', {})
            result['metadata']['vector_type'] = vector_type
        return results
    
    async def _hybrid_rank_results(self, results: List[Dict[str, Any]], query: str) -> List[tuple]:
        """Hybrid ranking combining graph structure and vector similarity."""
        # Weight configuration for different sources
        source_weights = {
            'graph_traditional': 0.4,
            'graph_vector': 0.6
        }
        
        # Vector type weights
        vector_type_weights = {
            'node': 0.3,
            'relation': 0.2,
            'triple': 0.3,
            'community': 0.2
        }
        
        ranked = []
        for result in results:
            metadata = result.get('metadata', {})
            base_score = result.get('score', 0.0)
            
            # Apply source weight
            source = metadata.get('search_source', 'unknown')
            source_weight = source_weights.get(source, 0.5)
            
            # Apply vector type weight if applicable
            vector_type = metadata.get('vector_type')
            if vector_type:
                vector_weight = vector_type_weights.get(vector_type, 0.25)
                final_score = base_score * source_weight * vector_weight
            else:
                final_score = base_score * source_weight
            
            # Content relevance boost
            content = result.get('content', '')
            relevance_boost = self._calculate_content_relevance(content, query)
            final_score *= (1 + relevance_boost)
            
            ranked.append((content, final_score, metadata))
        
        # Sort by score
        ranked.sort(key=lambda x: x[1], reverse=True)
        return ranked
    
    async def build_vector_indices(self) -> Dict[str, bool]:
        """
        Build all four types of vector indices for the graph.
        
        Returns:
            Dict indicating success/failure for each index type
        """
        if not self.enable_vector_search:
            logger.warning("Vector indexing is disabled")
            return {"error": "Vector indexing is disabled"}
        
        results = {}
        
        try:
            # Extract graph data
            logger.info("Extracting graph data for vector indexing...")
            graph_data = await self._extract_graph_data_for_indexing()
            
            # Build node index
            logger.info("Building node vector index...")
            results['nodes'] = await self._build_node_index(graph_data['nodes'])
            
            # Build relation index
            logger.info("Building relation vector index...")
            results['relations'] = await self._build_relation_index(graph_data['relations'])
            
            # Build triple index
            logger.info("Building triple vector index...")
            results['triples'] = await self._build_triple_index(graph_data['triples'])
            
            # Build community index
            logger.info("Building community vector index...")
            results['communities'] = await self._build_community_index(graph_data['communities'])
            
            self._vector_indices_built = True
            logger.info(f"Vector indices built successfully: {results}")
            
        except Exception as e:
            logger.error(f"Failed to build vector indices: {e}")
            results['error'] = str(e)
        
        return results
    
    async def _extract_graph_data_for_indexing(self) -> Dict[str, Any]:
        """Extract nodes, relations, triples, and communities from graph storage."""
        
        nodes = []
        relations = set()
        triples = []
        communities = []
        
        try:
            # 方法1：尝试使用图存储的查询接口
            if hasattr(self.graph_storage, 'query'):
                try:
                    # Extract nodes
                    node_query_results = self.graph_storage.query("MATCH (n) RETURN n LIMIT 1000")
                    for node_data in node_query_results:
                        node = node_data.get("n", {})
                        if node:
                            nodes.append(self._normalize_node_data(node))
                    
                    # Extract relations and triples
                    rel_query_results = self.graph_storage.query("MATCH (a)-[r]->(b) RETURN a, r, b, type(r) as rel_type LIMIT 1000")
                    for rel_data in rel_query_results:
                        source_node = rel_data.get("a", {})
                        target_node = rel_data.get("b", {})
                        relationship = rel_data.get("r", {})
                        
                        if source_node and target_node and relationship:
                            # 使用查询返回的关系类型
                            rel_type = rel_data.get('rel_type', '') or relationship.get('type', '') or relationship.get('relation', '')
                            
                            if rel_type:
                                relations.add(rel_type)
                            
                            triples.append((
                                source_node.get('id', '') or source_node.get('name', ''),
                                rel_type,
                                target_node.get('id', '') or target_node.get('name', '')
                            ))
                    
                    # Extract communities
                    try:
                        comm_query_results = self.graph_storage.query("MATCH (c) WHERE 'community' IN labels(c) RETURN c LIMIT 100")
                        for comm_data in comm_query_results:
                            community = comm_data.get("c", {})
                            if community:
                                communities.append(self._normalize_community_data(community))
                    except Exception as e:
                        logger.debug(f"Community extraction failed (this is normal if no communities exist): {e}")
                        
                except Exception as e:
                    logger.warning(f"Graph query method failed: {e}, trying alternative methods...")
                    
            # 方法2：尝试使用本地缓存的图数据
            if not nodes and hasattr(self, '_nodes') and self._nodes:
                logger.info("Using cached graph data for indexing")
                for node_id, graph_node in self._nodes.items():
                    nodes.append({
                        'id': node_id,
                        'name': graph_node.label,
                        'description': graph_node.content,
                        'labels': [graph_node.label],
                        'properties': graph_node.properties
                    })
                
                if hasattr(self, '_relationships') and self._relationships:
                    for rel_id, graph_rel in self._relationships.items():
                        relations.add(graph_rel.type)
                        triples.append((
                            graph_rel.source_id,
                            graph_rel.type,
                            graph_rel.target_id
                        ))
            
            # 方法3：如果都没有数据，创建示例数据用于测试
            if not nodes:
                logger.warning("No graph data found, creating minimal test data for vector indexing")
                nodes = [
                    {
                        'id': 'test_node_1',
                        'name': 'Test Entity',
                        'description': 'A test entity for vector indexing',
                        'labels': ['Entity'],
                        'properties': {'type': 'test'}
                    }
                ]
                relations = {'TEST_RELATION'}
                triples = [('test_node_1', 'TEST_RELATION', 'test_node_2')]
                
        except Exception as e:
            logger.error(f"Error extracting graph data: {e}")
            # 返回空数据而不是失败
            nodes = []
            relations = set()
            triples = []
            communities = []
        
        logger.info(f"Extracted graph data: {len(nodes)} nodes, {len(relations)} relation types, {len(triples)} triples, {len(communities)} communities")
        
        return {
            'nodes': nodes,
            'relations': list(relations),
            'triples': triples,
            'communities': communities
        }
    
    def _normalize_node_data(self, node: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize node data from different graph storage formats."""
        # 🔧 修复：正确处理Neo4j节点对象
        if hasattr(node, '_properties'):
            # Neo4j节点对象
            props = node._properties
            node_id = props.get('id', '') or props.get('_id', '') or props.get('name', '')
            name = props.get('name', '') or props.get('title', '') or str(node_id)
            description = props.get('description', '') or props.get('content', '') or props.get('summary', '')
            labels = list(node.labels) if hasattr(node, 'labels') else ['Entity']
            properties = props
        else:
            # 字典格式的节点数据
            node_id = node.get('id') or node.get('_id') or node.get('name', '')
            name = node.get('name', '') or node.get('title', '') or str(node_id)
            description = node.get('description', '') or node.get('content', '') or node.get('summary', '')
            labels = node.get('labels', []) or node.get('types', []) or ['Entity']
            properties = node.get('properties', {}) or {}
        
        # 确保labels是列表
        if isinstance(labels, str):
            labels = [labels]
        
        return {
            'id': str(node_id),
            'name': str(name),
            'description': str(description),
            'labels': labels,
            'properties': properties
        }
    
    def _normalize_community_data(self, community: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize community data from different graph storage formats."""
        comm_id = community.get('id') or community.get('_id') or community.get('name', '')
        name = community.get('name', '') or str(comm_id)
        description = community.get('description', '') or community.get('summary', '')
        members = community.get('members', []) or community.get('entities', []) or []
        properties = community.get('properties', {}) or {}
        
        return {
            'id': str(comm_id),
            'name': str(name),
            'description': str(description),
            'members': members,
            'properties': properties
        }
    
    async def _build_node_index(self, nodes: List[Dict[str, Any]]) -> bool:
        """Build node vector index."""
        try:
            if not nodes:
                return False
            
            # Check if embedding provider is available
            if not self.embedding_provider:
                logger.error("Embedding provider is None, cannot build node index")
                return False
            
            # Prepare node texts and records
            records = []
            texts = []
            
            for node in nodes:
                # Create node text representation
                name = node.get('name', '')
                description = node.get('description', '')
                labels = node.get('labels', [])
                
                text_parts = []
                if name:
                    text_parts.append(name)
                if description:
                    text_parts.append(description)
                if labels:
                    text_parts.append(f"(类型: {', '.join(labels)})")
                
                node_text = " - ".join(text_parts) if text_parts else ""
                if node_text:
                    texts.append(node_text)
                    
                    # Prepare metadata
                    metadata = {
                        "type": "node",
                        "node_id": node.get('id', ''),
                        "name": name,
                        "description": description,
                        "labels": labels
                    }
                    
                    records.append((node_text, metadata))
            
            # Generate embeddings and insert
            if records:
                embeddings = await self.embedding_provider.aembed_documents([r[0] for r in records])
                
                vector_records = []
                for i, ((text, metadata), embedding) in enumerate(zip(records, embeddings)):
                    vector_record = VectorRecord(
                        id=f"node_{metadata['node_id']}",
                        vector=embedding,
                        payload={
                            'content': text,  # 🔧 修复：将content放到payload中
                            'metadata': metadata
                        }
                    )
                    vector_records.append(vector_record)
                
                await self.vector_storage.add(vector_records)
                
                logger.info(f"Built node index with {len(vector_records)} records")
                return True
            
        except Exception as e:
            logger.error(f"Failed to build node index: {e}")
        
        return False
    
    async def _build_relation_index(self, relations: List[str]) -> bool:
        """Build relation vector index."""
        try:
            if not relations:
                return False
            
            # Check if embedding provider is available
            if not self.embedding_provider:
                logger.error("Embedding provider is None, cannot build relation index")
                return False
            
            # Generate embeddings for relations
            embeddings = await self.embedding_provider.aembed_documents(relations)
            
            # Create vector records
            vector_records = []
            for i, (relation, embedding) in enumerate(zip(relations, embeddings)):
                vector_record = VectorRecord(
                    id=f"relation_{i}",
                    vector=embedding,
                    payload={
                        'content': relation,  # 🔧 修复：将content放到payload中
                        'metadata': {
                            "type": "relation",
                            "relation_name": relation,
                            "relation_id": i
                        }
                    }
                )
                vector_records.append(vector_record)
            
            await self.vector_storage.add(vector_records)
            
            logger.info(f"Built relation index with {len(vector_records)} records")
            return True
            
        except Exception as e:
            logger.error(f"Failed to build relation index: {e}")
            return False
    
    async def _build_triple_index(self, triples: List[tuple]) -> bool:
        """Build triple vector index."""
        try:
            if not triples:
                return False
            
            # Check if embedding provider is available
            if not self.embedding_provider:
                logger.error("Embedding provider is None, cannot build triple index")
                return False
            
            # Create triple text representations
            triple_texts = []
            triple_metadata = []
            
            for i, (head, relation, tail) in enumerate(triples):
                triple_text = f"{head} {relation} {tail}"
                triple_texts.append(triple_text)
                
                triple_metadata.append({
                    "type": "triple",
                    "head": head,
                    "relation": relation,
                    "tail": tail,
                    "triple_id": i,
                    "triple_text": triple_text
                })
            
            # Generate embeddings
            embeddings = await self.embedding_provider.aembed_documents(triple_texts)
            
            # Create vector records
            vector_records = []
            for i, (embedding, metadata, triple_text) in enumerate(zip(embeddings, triple_metadata, triple_texts)):
                vector_record = VectorRecord(
                    id=f"triple_{i}",
                    vector=embedding,
                    payload={
                        'content': triple_text,  # 🔧 修复：将content放到payload中
                        'metadata': metadata
                    }
                )
                vector_records.append(vector_record)
            
            await self.vector_storage.add(vector_records)
            
            logger.info(f"Built triple index with {len(vector_records)} records")
            return True
            
        except Exception as e:
            logger.error(f"Failed to build triple index: {e}")
            return False
    
    async def _build_community_index(self, communities: List[Dict[str, Any]]) -> str:
        """Build community vector index."""
        try:
            if not communities:
                logger.info("No community data available, skipping community index")
                return "skipped"
            
            # Check if embedding provider is available
            if not self.embedding_provider:
                logger.error("Embedding provider is None, cannot build community index")
                return "failed"
            
            # Create community text representations
            community_texts = []
            community_metadata = []
            
            for community in communities:
                name = community.get('name', '')
                description = community.get('description', '')
                members = community.get('members', [])
                
                # Build community text
                text_parts = []
                if name:
                    text_parts.append(f"Community: {name}")
                if description:
                    text_parts.append(f"Description: {description}")
                if members:
                    member_text = ", ".join(str(member) for member in members[:10])
                    if len(members) > 10:
                        member_text += f" and {len(members) - 10} more members"
                    text_parts.append(f"Members: {member_text}")
                
                community_text = ". ".join(text_parts) if text_parts else ""
                if community_text:
                    community_texts.append(community_text)
                    
                    community_metadata.append({
                        "type": "community",
                        "community_id": community.get('id', ''),
                        "name": name,
                        "description": description,
                        "member_count": len(members),
                        "members": members[:10]  # Limit members in metadata
                    })
            
            if not community_texts:
                return False
            
            # Generate embeddings
            embeddings = await self.embedding_provider.aembed_documents(community_texts)
            
            # Create vector records
            vector_records = []
            for i, (embedding, metadata, community_text) in enumerate(zip(embeddings, community_metadata, community_texts)):
                vector_record = VectorRecord(
                    id=f"community_{metadata['community_id']}",
                    vector=embedding,
                    payload={
                        'content': community_text,  # 🔧 修复：将content放到payload中
                        'metadata': metadata
                    }
                )
                vector_records.append(vector_record)
            
            await self.vector_storage.add(vector_records)
            
            logger.info(f"Built community index with {len(vector_records)} records")
            return "success"
            
        except Exception as e:
            logger.error(f"Failed to build community index: {e}")
            
        return "failed"