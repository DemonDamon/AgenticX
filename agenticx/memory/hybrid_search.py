"""
Hybrid Search Engine

Implements a hybrid search engine that combines BM25 full-text search
with vector-based semantic search for optimal retrieval performance.
"""

from typing import Any, Dict, List, Optional, Tuple, Union
from datetime import datetime, UTC
from dataclasses import dataclass, field
from abc import ABC, abstractmethod
from collections import defaultdict, Counter
import math
import json
import numpy as np

from .hierarchical import HierarchicalMemoryRecord, SearchResult, MemoryType
from .base import MemoryError


@dataclass
class SearchQuery:
    """Represents a search query with multiple modes."""
    
    text: str
    query_type: str = "hybrid"  # "bm25", "vector", "hybrid"
    filters: Dict[str, Any] = field(default_factory=dict)
    boost_fields: Dict[str, float] = field(default_factory=dict)
    time_decay: bool = True
    importance_boost: bool = True


@dataclass
class SearchCandidate:
    """Represents a search candidate with multiple scores."""
    
    record: HierarchicalMemoryRecord
    bm25_score: float = 0.0
    vector_score: float = 0.0
    hybrid_score: float = 0.0
    explanation: Dict[str, Any] = field(default_factory=dict)


class BaseSearchBackend(ABC):
    """Base class for search backends."""
    
    @abstractmethod
    async def search(
        self,
        query: SearchQuery,
        limit: int = 10,
        min_score: float = 0.0
    ) -> List[SearchCandidate]:
        """Perform search and return candidates."""
        pass
    
    @abstractmethod
    async def index_record(self, record: HierarchicalMemoryRecord):
        """Index a record for search."""
        pass
    
    @abstractmethod
    async def remove_record(self, record_id: str):
        """Remove a record from the index."""
        pass
    
    @abstractmethod
    async def get_stats(self) -> Dict[str, Any]:
        """Get backend statistics."""
        pass


class BM25SearchBackend(BaseSearchBackend):
    """
    BM25 full-text search backend with three-tier fallback strategy.
    
    Implements PostgreSQL-style search with AND/OR/ILIKE fallback.
    """
    
    def __init__(self, k1: float = 1.2, b: float = 0.75, **kwargs):
        self.k1 = k1  # Term frequency saturation parameter
        self.b = b    # Length normalization parameter
        
        # Index structures
        self._documents: Dict[str, HierarchicalMemoryRecord] = {}
        self._term_freq: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
        self._doc_freq: Dict[str, int] = defaultdict(int)
        self._doc_lengths: Dict[str, int] = {}
        self._avg_doc_length: float = 0.0
        self._total_docs: int = 0
        
        # Field weights for boosting
        self._field_weights = {
            "content": 1.0,
            "metadata.title": 2.0,
            "metadata.concepts": 1.5,
            "metadata.category": 1.2
        }
    
    async def search(
        self,
        query: SearchQuery,
        limit: int = 10,
        min_score: float = 0.0
    ) -> List[SearchCandidate]:
        """Perform BM25 search with three-tier fallback."""
        terms = self._tokenize(query.text)
        
        if not terms:
            return []
        
        # Tier 1: AND search (all terms must match)
        candidates = await self._search_and(terms, limit * 2)
        
        if len(candidates) < limit:
            # Tier 2: OR search (any term can match)
            or_candidates = await self._search_or(terms, limit * 2)
            candidates.extend(or_candidates)
            
            # Remove duplicates
            seen = set()
            unique_candidates = []
            for candidate in candidates:
                if candidate.record.id not in seen:
                    seen.add(candidate.record.id)
                    unique_candidates.append(candidate)
            candidates = unique_candidates
        
        if len(candidates) < limit:
            # Tier 3: ILIKE search (substring matching)
            ilike_candidates = await self._search_ilike(query.text, limit * 2)
            candidates.extend(ilike_candidates)
            
            # Remove duplicates again
            seen = set()
            unique_candidates = []
            for candidate in candidates:
                if candidate.record.id not in seen:
                    seen.add(candidate.record.id)
                    unique_candidates.append(candidate)
            candidates = unique_candidates
        
        # Apply filters
        if query.filters:
            candidates = [c for c in candidates if self._matches_filters(c.record, query.filters)]
        
        # Apply minimum score threshold
        candidates = [c for c in candidates if c.bm25_score >= min_score]
        
        # Sort by BM25 score
        candidates.sort(key=lambda c: c.bm25_score, reverse=True)
        
        return candidates[:limit]
    
    async def _search_and(self, terms: List[str], limit: int) -> List[SearchCandidate]:
        """Search requiring all terms to match."""
        if not terms:
            return []
        
        # Find documents containing all terms
        doc_sets = []
        for term in terms:
            if term in self._term_freq:
                doc_sets.append(set(self._term_freq[term].keys()))
        
        if not doc_sets:
            return []
        
        # Intersection of all term document sets
        matching_docs = doc_sets[0]
        for doc_set in doc_sets[1:]:
            matching_docs = matching_docs.intersection(doc_set)
        
        # Score matching documents
        candidates = []
        for doc_id in matching_docs:
            if doc_id in self._documents:
                score = self._calculate_bm25_score(doc_id, terms)
                candidate = SearchCandidate(
                    record=self._documents[doc_id],
                    bm25_score=score,
                    explanation={"search_tier": "AND", "terms": terms}
                )
                candidates.append(candidate)
        
        return candidates
    
    async def _search_or(self, terms: List[str], limit: int) -> List[SearchCandidate]:
        """Search requiring any term to match."""
        matching_docs = set()
        for term in terms:
            if term in self._term_freq:
                matching_docs.update(self._term_freq[term].keys())
        
        candidates = []
        for doc_id in matching_docs:
            if doc_id in self._documents:
                score = self._calculate_bm25_score(doc_id, terms)
                candidate = SearchCandidate(
                    record=self._documents[doc_id],
                    bm25_score=score,
                    explanation={"search_tier": "OR", "terms": terms}
                )
                candidates.append(candidate)
        
        return candidates
    
    async def _search_ilike(self, query_text: str, limit: int) -> List[SearchCandidate]:
        """Search using substring matching."""
        query_lower = query_text.lower()
        candidates = []
        
        for doc_id, record in self._documents.items():
            # Check content and metadata for substring matches
            content_lower = record.content.lower()
            match_score = 0.0
            
            if query_lower in content_lower:
                # Calculate match score based on match length and position
                match_score = len(query_lower) / len(content_lower)
                
                # Boost if match is at the beginning
                if content_lower.startswith(query_lower):
                    match_score *= 2.0
                
                candidate = SearchCandidate(
                    record=record,
                    bm25_score=match_score,
                    explanation={"search_tier": "ILIKE", "query": query_text}
                )
                candidates.append(candidate)
        
        return candidates
    
    def _calculate_bm25_score(self, doc_id: str, terms: List[str]) -> float:
        """Calculate BM25 score for a document."""
        if doc_id not in self._documents or not terms:
            return 0.0
        
        doc_length = self._doc_lengths.get(doc_id, 0)
        if doc_length == 0:
            return 0.0
        
        score = 0.0
        
        for term in terms:
            if term in self._term_freq and doc_id in self._term_freq[term]:
                # Term frequency in document
                tf = self._term_freq[term][doc_id]
                
                # Document frequency
                df = self._doc_freq[term]
                
                # Inverse document frequency
                idf = math.log((self._total_docs - df + 0.5) / (df + 0.5))
                
                # BM25 formula
                numerator = tf * (self.k1 + 1)
                denominator = tf + self.k1 * (1 - self.b + self.b * (doc_length / self._avg_doc_length))
                
                term_score = idf * (numerator / denominator)
                score += term_score
        
        return score
    
    async def index_record(self, record: HierarchicalMemoryRecord):
        """Index a record for BM25 search."""
        doc_id = record.id
        
        # Extract searchable text
        searchable_text = self._extract_searchable_text(record)
        
        # Tokenize
        tokens = self._tokenize(searchable_text)
        
        # Update document
        self._documents[doc_id] = record
        self._doc_lengths[doc_id] = len(tokens)
        
        # Update term frequencies
        term_counts = Counter(tokens)
        for term, count in term_counts.items():
            self._term_freq[term][doc_id] = count
            if count > 0:
                self._doc_freq[term] += 1
        
        # Update statistics
        self._total_docs = len(self._documents)
        if self._total_docs > 0:
            self._avg_doc_length = sum(self._doc_lengths.values()) / self._total_docs
    
    async def remove_record(self, record_id: str):
        """Remove a record from the index."""
        if record_id not in self._documents:
            return
        
        # Remove from term frequencies
        for term in self._term_freq:
            if record_id in self._term_freq[term]:
                del self._term_freq[term][record_id]
                self._doc_freq[term] -= 1
        
        # Remove document
        del self._documents[record_id]
        del self._doc_lengths[record_id]
        
        # Update statistics
        self._total_docs = len(self._documents)
        if self._total_docs > 0:
            self._avg_doc_length = sum(self._doc_lengths.values()) / self._total_docs
    
    def _extract_searchable_text(self, record: HierarchicalMemoryRecord) -> str:
        """Extract searchable text from record."""
        text_parts = [record.content]
        
        # Add metadata fields
        if record.metadata:
            for field, weight in self._field_weights.items():
                if field.startswith("metadata."):
                    meta_key = field.replace("metadata.", "")
                    if meta_key in record.metadata:
                        value = record.metadata[meta_key]
                        if isinstance(value, str):
                            # Repeat based on weight for boosting
                            text_parts.extend([value] * int(weight))
                        elif isinstance(value, list):
                            for item in value:
                                if isinstance(item, str):
                                    text_parts.extend([item] * int(weight))
        
        return " ".join(text_parts)
    
    def _tokenize(self, text: str) -> List[str]:
        """Tokenize text into terms."""
        if not text:
            return []
        
        import re
        
        # Convert to lowercase and extract words
        words = re.findall(r'\b\w+\b', text.lower())
        
        # Filter out stop words and short words
        stop_words = {
            'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
            'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have',
            'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
            'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those'
        }
        
        return [word for word in words if word not in stop_words and len(word) > 2]
    
    def _matches_filters(self, record: HierarchicalMemoryRecord, filters: Dict[str, Any]) -> bool:
        """Check if record matches filters."""
        for key, value in filters.items():
            if key == "memory_type":
                if record.memory_type != value:
                    return False
            elif key == "importance":
                if record.importance.value < value:
                    return False
            elif key == "sensitivity":
                if record.sensitivity != value:
                    return False
            elif key in record.metadata:
                if record.metadata[key] != value:
                    return False
            else:
                return False
        
        return True
    
    async def get_stats(self) -> Dict[str, Any]:
        """Get backend statistics."""
        return {
            "backend_type": "BM25",
            "total_documents": self._total_docs,
            "total_terms": len(self._term_freq),
            "avg_doc_length": self._avg_doc_length,
            "parameters": {
                "k1": self.k1,
                "b": self.b
            }
        }


class VectorSearchBackend(BaseSearchBackend):
    """
    Vector-based semantic search backend.
    
    Uses embedding vectors for semantic similarity search.
    """
    
    def __init__(self, embedding_dim: int = 384, **kwargs):
        self.embedding_dim = embedding_dim
        
        # Vector index (in practice, this would use a proper vector database)
        self._vectors: Dict[str, np.ndarray] = {}
        self._documents: Dict[str, HierarchicalMemoryRecord] = {}
        
        # Simple mock embeddings for demonstration
        self._term_embeddings: Dict[str, np.ndarray] = {}
        
    async def search(
        self,
        query: SearchQuery,
        limit: int = 10,
        min_score: float = 0.0
    ) -> List[SearchCandidate]:
        """Perform vector similarity search."""
        # Generate query embedding
        query_vector = self._generate_embedding(query.text)
        
        if query_vector is None:
            return []
        
        # Calculate similarities
        candidates = []
        for doc_id, doc_vector in self._vectors.items():
            if doc_id in self._documents:
                similarity = self._cosine_similarity(query_vector, doc_vector)
                
                if similarity >= min_score:
                    candidate = SearchCandidate(
                        record=self._documents[doc_id],
                        vector_score=similarity,
                        explanation={"search_type": "vector", "similarity": similarity}
                    )
                    candidates.append(candidate)
        
        # Apply filters
        if query.filters:
            candidates = [c for c in candidates if self._matches_filters(c.record, query.filters)]
        
        # Sort by similarity
        candidates.sort(key=lambda c: c.vector_score, reverse=True)
        
        return candidates[:limit]
    
    async def index_record(self, record: HierarchicalMemoryRecord):
        """Index a record for vector search."""
        doc_id = record.id
        
        # Extract text for embedding
        text = self._extract_text_for_embedding(record)
        
        # Generate embedding
        embedding = self._generate_embedding(text)
        
        if embedding is not None:
            self._vectors[doc_id] = embedding
            self._documents[doc_id] = record
    
    async def remove_record(self, record_id: str):
        """Remove a record from the index."""
        if record_id in self._vectors:
            del self._vectors[record_id]
        if record_id in self._documents:
            del self._documents[record_id]
    
    def _generate_embedding(self, text: str) -> Optional[np.ndarray]:
        """Generate embedding for text (mock implementation)."""
        if not text:
            return None
        
        # Simple mock embedding based on word hashing
        words = text.lower().split()
        if not words:
            return None
        
        # Create a simple embedding based on character features
        embedding = np.zeros(self.embedding_dim)
        
        for i, word in enumerate(words[:20]):  # Limit to first 20 words
            for j, char in enumerate(word[:20]):  # Limit to first 20 chars
                idx = (ord(char) + i * 256 + j) % self.embedding_dim
                embedding[idx] += 1.0
        
        # Normalize
        norm = np.linalg.norm(embedding)
        if norm > 0:
            embedding = embedding / norm
        
        return embedding
    
    def _cosine_similarity(self, vec1: np.ndarray, vec2: np.ndarray) -> float:
        """Calculate cosine similarity between two vectors."""
        dot_product = np.dot(vec1, vec2)
        norm1 = np.linalg.norm(vec1)
        norm2 = np.linalg.norm(vec2)
        
        if norm1 == 0 or norm2 == 0:
            return 0.0
        
        return dot_product / (norm1 * norm2)
    
    def _extract_text_for_embedding(self, record: HierarchicalMemoryRecord) -> str:
        """Extract text for embedding generation."""
        text_parts = [record.content]
        
        # Add important metadata
        if record.metadata:
            title = record.metadata.get("title", "")
            description = record.metadata.get("description", "")
            concepts = record.metadata.get("concepts", [])
            
            if title:
                text_parts.append(title)
            if description:
                text_parts.append(description)
            if concepts:
                text_parts.extend(concepts)
        
        return " ".join(text_parts)
    
    def _matches_filters(self, record: HierarchicalMemoryRecord, filters: Dict[str, Any]) -> bool:
        """Check if record matches filters."""
        for key, value in filters.items():
            if key == "memory_type":
                if record.memory_type != value:
                    return False
            elif key == "importance":
                if record.importance.value < value:
                    return False
            elif key == "sensitivity":
                if record.sensitivity != value:
                    return False
            elif key in record.metadata:
                if record.metadata[key] != value:
                    return False
            else:
                return False
        
        return True
    
    async def get_stats(self) -> Dict[str, Any]:
        """Get backend statistics."""
        return {
            "backend_type": "Vector",
            "total_documents": len(self._documents),
            "total_vectors": len(self._vectors),
            "embedding_dim": self.embedding_dim
        }


class HybridRanker:
    """
    Hybrid ranking system that combines BM25 and vector search results.
    """
    
    def __init__(
        self,
        bm25_weight: float = 0.6,
        vector_weight: float = 0.4,
        **kwargs
    ):
        self.bm25_weight = bm25_weight
        self.vector_weight = vector_weight
        
        # Ensure weights sum to 1
        total_weight = bm25_weight + vector_weight
        if total_weight > 0:
            self.bm25_weight = bm25_weight / total_weight
            self.vector_weight = vector_weight / total_weight
    
    def rank_candidates(
        self,
        bm25_candidates: List[SearchCandidate],
        vector_candidates: List[SearchCandidate],
        query: SearchQuery
    ) -> List[SearchCandidate]:
        """Rank candidates using hybrid scoring."""
        # Combine candidates
        combined_candidates = {}
        
        # Add BM25 candidates
        for candidate in bm25_candidates:
            doc_id = candidate.record.id
            if doc_id not in combined_candidates:
                combined_candidates[doc_id] = SearchCandidate(
                    record=candidate.record,
                    bm25_score=candidate.bm25_score,
                    explanation=candidate.explanation.copy()
                )
            else:
                combined_candidates[doc_id].bm25_score = candidate.bm25_score
                combined_candidates[doc_id].explanation.update(candidate.explanation)
        
        # Add vector candidates
        for candidate in vector_candidates:
            doc_id = candidate.record.id
            if doc_id not in combined_candidates:
                combined_candidates[doc_id] = SearchCandidate(
                    record=candidate.record,
                    vector_score=candidate.vector_score,
                    explanation=candidate.explanation.copy()
                )
            else:
                combined_candidates[doc_id].vector_score = candidate.vector_score
                combined_candidates[doc_id].explanation.update(candidate.explanation)
        
        # Calculate hybrid scores
        for candidate in combined_candidates.values():
            candidate.hybrid_score = self._calculate_hybrid_score(candidate, query)
        
        # Sort by hybrid score
        ranked_candidates = list(combined_candidates.values())
        ranked_candidates.sort(key=lambda c: c.hybrid_score, reverse=True)
        
        return ranked_candidates
    
    def _calculate_hybrid_score(self, candidate: SearchCandidate, query: SearchQuery) -> float:
        """Calculate hybrid score for a candidate."""
        # Base hybrid score
        hybrid_score = (
            candidate.bm25_score * self.bm25_weight +
            candidate.vector_score * self.vector_weight
        )
        
        # Apply boosts
        if query.time_decay:
            hybrid_score *= self._calculate_time_decay(candidate.record)
        
        if query.importance_boost:
            hybrid_score *= self._calculate_importance_boost(candidate.record)
        
        # Apply field boosts
        if query.boost_fields:
            hybrid_score *= self._calculate_field_boost(candidate.record, query.boost_fields)
        
        return hybrid_score
    
    def _calculate_time_decay(self, record: HierarchicalMemoryRecord) -> float:
        """Calculate time decay factor."""
        age_hours = (datetime.now(UTC) - record.created_at).total_seconds() / 3600
        
        # Decay over 30 days
        decay_factor = max(0.1, 1.0 - (age_hours / (24 * 30)))
        
        return decay_factor
    
    def _calculate_importance_boost(self, record: HierarchicalMemoryRecord) -> float:
        """Calculate importance boost factor."""
        return 1.0 + (record.importance.value - 1) * 0.1
    
    def _calculate_field_boost(self, record: HierarchicalMemoryRecord, boost_fields: Dict[str, float]) -> float:
        """Calculate field-specific boost."""
        boost = 1.0
        
        for field, weight in boost_fields.items():
            if field in record.metadata:
                boost *= weight
        
        return boost


class HybridSearchEngine:
    """
    Main hybrid search engine that orchestrates BM25 and vector search.
    """
    
    def __init__(
        self,
        bm25_backend: Optional[BM25SearchBackend] = None,
        vector_backend: Optional[VectorSearchBackend] = None,
        ranker: Optional[HybridRanker] = None,
        **kwargs
    ):
        self.bm25_backend = bm25_backend or BM25SearchBackend(**kwargs)
        self.vector_backend = vector_backend or VectorSearchBackend(**kwargs)
        self.ranker = ranker or HybridRanker(**kwargs)
    
    async def search(
        self,
        query: Union[str, SearchQuery],
        limit: int = 10,
        min_score: float = 0.0
    ) -> List[SearchResult]:
        """Perform hybrid search."""
        # Convert string query to SearchQuery
        if isinstance(query, str):
            search_query = SearchQuery(text=query)
        else:
            search_query = query
        
        candidates = []
        
        # Perform searches based on query type
        if search_query.query_type in ["bm25", "hybrid"]:
            bm25_candidates = await self.bm25_backend.search(search_query, limit * 2, min_score)
        else:
            bm25_candidates = []
        
        if search_query.query_type in ["vector", "hybrid"]:
            vector_candidates = await self.vector_backend.search(search_query, limit * 2, min_score)
        else:
            vector_candidates = []
        
        # Combine and rank results
        if search_query.query_type == "hybrid":
            candidates = self.ranker.rank_candidates(bm25_candidates, vector_candidates, search_query)
        elif search_query.query_type == "bm25":
            candidates = bm25_candidates
        elif search_query.query_type == "vector":
            candidates = vector_candidates
        
        # Convert to SearchResult objects
        results = []
        for candidate in candidates[:limit]:
            score = candidate.hybrid_score if search_query.query_type == "hybrid" else (
                candidate.bm25_score if search_query.query_type == "bm25" else candidate.vector_score
            )
            
            result = SearchResult(record=candidate.record, score=score)
            results.append(result)
        
        return results
    
    async def index_record(self, record: HierarchicalMemoryRecord):
        """Index a record in both backends."""
        await self.bm25_backend.index_record(record)
        await self.vector_backend.index_record(record)
    
    async def remove_record(self, record_id: str):
        """Remove a record from both backends."""
        await self.bm25_backend.remove_record(record_id)
        await self.vector_backend.remove_record(record_id)
    
    async def get_stats(self) -> Dict[str, Any]:
        """Get search engine statistics."""
        bm25_stats = await self.bm25_backend.get_stats()
        vector_stats = await self.vector_backend.get_stats()
        
        return {
            "engine_type": "Hybrid",
            "bm25_backend": bm25_stats,
            "vector_backend": vector_stats,
            "ranker_weights": {
                "bm25_weight": self.ranker.bm25_weight,
                "vector_weight": self.ranker.vector_weight
            }
        } 