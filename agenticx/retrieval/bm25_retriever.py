"""
BM25 Retriever Implementation

Implements BM25-based full-text search for document retrieval.
"""

from typing import List, Dict, Any, Optional, Union
import re
from collections import defaultdict, Counter
from dataclasses import dataclass

from .base import BaseRetriever, RetrievalQuery, RetrievalResult, RetrievalError


@dataclass
class BM25Stats:
    """BM25 statistics for a document."""
    doc_length: int
    term_freq: Dict[str, int]
    avg_doc_length: float
    total_docs: int


class BM25Retriever(BaseRetriever):
    """
    BM25-based full-text retriever.
    
    Implements the BM25 ranking function for document retrieval.
    """
    
    def __init__(self, tenant_id: str, k1: float = 1.2, b: float = 0.75, **kwargs):
        # Filter out organization_id from kwargs to avoid conflicts
        filtered_kwargs = {k: v for k, v in kwargs.items() if k != 'organization_id'}
        super().__init__(tenant_id, **filtered_kwargs)
        self.k1 = k1
        self.b = b
        self._documents: Dict[str, Dict[str, Any]] = {}
        self._inverted_index: Dict[str, Dict[str, int]] = defaultdict(dict)
        self._doc_stats: Dict[str, BM25Stats] = {}
        self._avg_doc_length = 0.0
        self._total_docs = 0
    
    async def _initialize(self):
        """Initialize the BM25 retriever."""
        # Build inverted index from existing documents
        # This is synchronous, so no await needed
        self._build_index()
    
    async def retrieve(
        self,
        query: Union[str, RetrievalQuery],
        **kwargs
    ) -> List[RetrievalResult]:
        """Retrieve documents using BM25 scoring."""
        
        await self.initialize()
        
        # Convert query to RetrievalQuery if needed
        if isinstance(query, str):
            retrieval_query = RetrievalQuery(text=query)
        else:
            retrieval_query = query
        
        try:
            # Tokenize query
            query_terms = self._tokenize(retrieval_query.text)
            
            if not query_terms:
                return []
            
            # Calculate BM25 scores for all documents
            doc_scores = {}
            for doc_id, doc_info in self._documents.items():
                score = self._calculate_bm25_score(doc_id, query_terms)
                if score >= retrieval_query.min_score:
                    doc_scores[doc_id] = score
            
            # Sort by score and limit results
            sorted_docs = sorted(
                doc_scores.items(),
                key=lambda x: x[1],
                reverse=True
            )[:retrieval_query.limit]
            
            # Convert to RetrievalResult objects
            results = []
            for doc_id, score in sorted_docs:
                doc_info = self._documents[doc_id]
                result = RetrievalResult(
                    content=doc_info.get("content", ""),
                    score=score,
                    metadata=doc_info.get("metadata", {}),
                    source=doc_info.get("source"),
                    chunk_id=doc_id,
                    bm25_score=score
                )
                results.append(result)
            
            return results
            
        except Exception as e:
            raise RetrievalError(f"BM25 retrieval failed: {str(e)}") from e
    
    async def add_documents(
        self,
        documents: List[Dict[str, Any]],
        **kwargs
    ) -> List[str]:
        """Add documents to the BM25 index."""
        
        await self.initialize()
        
        try:
            document_ids = []
            
            for doc in documents:
                # Generate document ID
                doc_id = doc.get("id") or f"doc_{len(self._documents)}"
                
                # Store document
                self._documents[doc_id] = doc
                
                # Index document terms
                content = doc.get("content", "")
                self._index_document(doc_id, content)
                
                document_ids.append(doc_id)
            
            # Update statistics
            self._update_avg_doc_length()
            
            return document_ids
            
        except Exception as e:
            raise RetrievalError(f"Failed to add documents: {str(e)}") from e
    
    async def remove_documents(
        self,
        document_ids: List[str],
        **kwargs
    ) -> bool:
        """Remove documents from the BM25 index."""
        
        try:
            for doc_id in document_ids:
                if doc_id in self._documents:
                    # Remove from documents
                    del self._documents[doc_id]
                    
                    # Remove from inverted index
                    self._remove_from_index(doc_id)
                    
                    # Remove from stats
                    if doc_id in self._doc_stats:
                        del self._doc_stats[doc_id]
            
            # Update statistics
            self._update_avg_doc_length()
            
            return True
            
        except Exception as e:
            raise RetrievalError(f"Failed to remove documents: {str(e)}") from e
    
    async def get_stats(self) -> Dict[str, Any]:
        """Get BM25 retriever statistics."""
        
        try:
            return {
                "retriever_type": "bm25",
                "total_documents": len(self._documents),
                "total_terms": len(self._inverted_index),
                "avg_doc_length": self._avg_doc_length,
                "k1": self.k1,
                "b": self.b,
                "tenant_id": self.tenant_id
            }
            
        except Exception as e:
            return {
                "retriever_type": "bm25",
                "error": str(e),
                "tenant_id": self.tenant_id
            }
    
    def _tokenize(self, text: str) -> List[str]:
        """Tokenize text into terms."""
        # Simple tokenization - split on whitespace and remove punctuation
        terms = re.findall(r'\b\w+\b', text.lower())
        return [term for term in terms if len(term) > 1]
    
    def _index_document(self, doc_id: str, content: str):
        """Index document terms into inverted index."""
        
        # Tokenize content
        terms = self._tokenize(content)
        
        # Count term frequencies
        term_freq = Counter(terms)
        
        # Add to inverted index
        for term, freq in term_freq.items():
            self._inverted_index[term][doc_id] = freq
        
        # Store document statistics
        self._doc_stats[doc_id] = BM25Stats(
            doc_length=len(terms),
            term_freq=dict(term_freq),
            avg_doc_length=self._avg_doc_length,
            total_docs=self._total_docs
        )
    
    def _remove_from_index(self, doc_id: str):
        """Remove document from inverted index."""
        
        # Remove from all term postings
        for term in list(self._inverted_index.keys()):
            if doc_id in self._inverted_index[term]:
                del self._inverted_index[term][doc_id]
                
                # Remove empty terms
                if not self._inverted_index[term]:
                    del self._inverted_index[term]
    
    def _calculate_bm25_score(self, doc_id: str, query_terms: List[str]) -> float:
        """Calculate BM25 score for a document."""
        
        if doc_id not in self._doc_stats:
            return 0.0
        
        doc_stats = self._doc_stats[doc_id]
        score = 0.0
        
        for term in query_terms:
            if term in self._inverted_index and doc_id in self._inverted_index[term]:
                # Term frequency in document
                tf = self._inverted_index[term][doc_id]
                
                # Document frequency (number of documents containing term)
                df = len(self._inverted_index[term])
                
                # Inverse document frequency
                idf = self._calculate_idf(df)
                
                # BM25 score for this term
                numerator = tf * (self.k1 + 1)
                denominator = tf + self.k1 * (1 - self.b + self.b * (doc_stats.doc_length / self._avg_doc_length))
                
                term_score = idf * (numerator / denominator)
                score += term_score
        
        return score
    
    def _calculate_idf(self, df: int) -> float:
        """Calculate inverse document frequency."""
        if df == 0:
            return 0.0
        
        return max(0, (self._total_docs - df + 0.5) / (df + 0.5))
    
    def _update_avg_doc_length(self):
        """Update average document length."""
        if self._documents:
            total_length = sum(stats.doc_length for stats in self._doc_stats.values())
            self._avg_doc_length = total_length / len(self._documents)
            self._total_docs = len(self._documents)
        else:
            self._avg_doc_length = 0.0
            self._total_docs = 0
    
    def _build_index(self):
        """Build inverted index from existing documents."""
        for doc_id, doc_info in self._documents.items():
            content = doc_info.get("content", "")
            self._index_document(doc_id, content)
        
        self._update_avg_doc_length() 