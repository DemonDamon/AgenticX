"""
Semantic Memory Layer

Implements the semantic memory layer for storing general knowledge,
concepts, and factual information that is independent of specific time contexts.
"""

from typing import Any, Dict, List, Optional, Set, Tuple
from datetime import datetime, UTC
import json
import uuid
from dataclasses import dataclass, field
from collections import defaultdict
import math

from .hierarchical import (
    BaseHierarchicalMemory,
    HierarchicalMemoryRecord,
    MemoryType,
    MemoryImportance,
    MemorySensitivity,
    SearchContext,
    SearchResult,
    MemoryEvent
)
from .base import MemoryError, MemoryRecord


@dataclass
class Concept:
    """Represents a semantic concept."""
    
    concept_id: str
    name: str
    description: str
    category: str
    attributes: Dict[str, Any] = field(default_factory=dict)
    relationships: Dict[str, List[str]] = field(default_factory=dict)  # relation_type -> concept_ids
    synonyms: List[str] = field(default_factory=list)
    confidence: float = 1.0
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "concept_id": self.concept_id,
            "name": self.name,
            "description": self.description,
            "category": self.category,
            "attributes": self.attributes,
            "relationships": self.relationships,
            "synonyms": self.synonyms,
            "confidence": self.confidence
        }


@dataclass
class KnowledgeTriple:
    """Represents a knowledge triple (subject, predicate, object)."""
    
    triple_id: str
    subject: str
    predicate: str
    object: str
    confidence: float = 1.0
    source: Optional[str] = None
    evidence: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "triple_id": self.triple_id,
            "subject": self.subject,
            "predicate": self.predicate,
            "object": self.object,
            "confidence": self.confidence,
            "source": self.source,
            "evidence": self.evidence
        }


class SemanticMemory(BaseHierarchicalMemory):
    """
    Semantic Memory Layer
    
    Manages general knowledge, concepts, and factual information.
    Supports concept extraction, relationship mapping, and semantic search.
    """
    
    def __init__(self, tenant_id: str, agent_id: str, **kwargs):
        super().__init__(tenant_id, MemoryType.SEMANTIC, **kwargs)
        self.agent_id = agent_id
        self._semantic_records: Dict[str, HierarchicalMemoryRecord] = {}
        self._concepts: Dict[str, Concept] = {}
        self._knowledge_triples: Dict[str, KnowledgeTriple] = {}
        
        # Indices for efficient search
        self._concept_index: Dict[str, Set[str]] = defaultdict(set)  # concept_name -> record_ids
        self._category_index: Dict[str, Set[str]] = defaultdict(set)  # category -> concept_ids
        self._keyword_index: Dict[str, Set[str]] = defaultdict(set)  # keyword -> record_ids
        self._triple_index: Dict[str, Set[str]] = defaultdict(set)  # entity -> triple_ids
        
        # Configuration
        self.concept_similarity_threshold = kwargs.get('concept_similarity_threshold', 0.7)
        self.auto_merge_similar_concepts = kwargs.get('auto_merge_similar_concepts', True)
    
    async def add_knowledge(
        self,
        content: str,
        knowledge_type: str = "fact",
        category: Optional[str] = None,
        concepts: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        importance: MemoryImportance = MemoryImportance.MEDIUM,
        sensitivity: MemorySensitivity = MemorySensitivity.INTERNAL,
        source: Optional[str] = None
    ) -> str:
        """
        Add knowledge to semantic memory.
        
        Args:
            content: Knowledge content
            knowledge_type: Type of knowledge (fact, concept, rule, etc.)
            category: Knowledge category
            concepts: Related concepts
            metadata: Additional metadata
            importance: Knowledge importance
            sensitivity: Knowledge sensitivity
            source: Knowledge source
            
        Returns:
            Record ID
        """
        # Extract concepts from content if not provided
        if concepts is None:
            concepts = await self._extract_concepts(content)
        
        # Create knowledge record
        record_metadata = {
            "type": "semantic_knowledge",
            "knowledge_type": knowledge_type,
            "category": category or "general",
            "concepts": concepts,
            "extracted_at": datetime.now(UTC).isoformat()
        }
        
        if metadata:
            record_metadata.update(metadata)
        
        record_id = await self.add(
            content=content,
            metadata=record_metadata,
            importance=importance,
            sensitivity=sensitivity,
            source=source or "user"  # Provide default value if source is None
        )
        
        # Create or update concepts
        for concept_name in concepts:
            await self._create_or_update_concept(
                name=concept_name,
                category=category or "general",
                source_content=content,
                source_record_id=record_id
            )
        
        # Extract knowledge triples
        await self._extract_knowledge_triples(content, record_id)
        
        return record_id
    
    async def add_concept(
        self,
        name: str,
        description: str,
        category: str = "general",
        attributes: Optional[Dict[str, Any]] = None,
        synonyms: Optional[List[str]] = None,
        confidence: float = 1.0
    ) -> str:
        """
        Add a concept to semantic memory.
        
        Args:
            name: Concept name
            description: Concept description
            category: Concept category
            attributes: Concept attributes
            synonyms: Concept synonyms
            confidence: Confidence level
            
        Returns:
            Concept ID
        """
        concept_id = self._generate_record_id()
        
        concept = Concept(
            concept_id=concept_id,
            name=name,
            description=description,
            category=category,
            attributes=attributes or {},
            synonyms=synonyms or [],
            confidence=confidence
        )
        
        # Check for similar concepts
        if self.auto_merge_similar_concepts:
            similar_concept = await self._find_similar_concept(concept)
            if similar_concept:
                # Merge with similar concept
                await self._merge_concepts(similar_concept, concept)
                return similar_concept.concept_id
        
        self._concepts[concept_id] = concept
        
        # Update indices
        self._concept_index[name.lower()].add(concept_id)
        self._category_index[category].add(concept_id)
        
        for synonym in synonyms or []:
            self._concept_index[synonym.lower()].add(concept_id)
        
        # Create memory record for the concept
        await self.add(
            content=f"Concept: {name} - {description}",
            metadata={
                "type": "concept",
                "concept_id": concept_id,
                "concept_data": concept.to_dict()
            },
            importance=MemoryImportance.HIGH,
            sensitivity=MemorySensitivity.INTERNAL,
            source="semantic_system"
        )
        
        return concept_id
    
    async def add(
        self,
        content: str,
        metadata: Optional[Dict[str, Any]] = None,
        record_id: Optional[str] = None,
        importance: MemoryImportance = MemoryImportance.MEDIUM,
        sensitivity: MemorySensitivity = MemorySensitivity.INTERNAL,
        source: Optional[str] = None,
        context: Optional[Dict[str, Any]] = None
    ) -> str:
        """Add a new memory record."""
        if record_id is None:
            record_id = self._generate_record_id()
        
        now = datetime.now(UTC)
        
        record = HierarchicalMemoryRecord(
            id=record_id,
            content=content,
            metadata=self._ensure_tenant_isolation(metadata or {}),
            tenant_id=self.tenant_id,
            created_at=now,
            updated_at=now,
            memory_type=MemoryType.SEMANTIC,
            importance=importance,
            sensitivity=sensitivity,
            source=source,
            context=context or {}
        )
        
        # Store the record
        await self._store_record(record)
        
        # Log event
        self._log_event(MemoryEvent(
            event_id=str(uuid.uuid4()),
            event_type="write",
            memory_type=MemoryType.SEMANTIC,
            record_id=record_id,
            timestamp=now,
            metadata={"importance": importance.value, "sensitivity": sensitivity.value}
        ))
        
        return record_id
    
    async def add_relationship(
        self,
        subject_concept: str,
        relationship_type: str,
        object_concept: str,
        confidence: float = 1.0
    ) -> bool:
        """
        Add relationship between concepts.
        
        Args:
            subject_concept: Subject concept name or ID
            relationship_type: Type of relationship
            object_concept: Object concept name or ID
            confidence: Relationship confidence
            
        Returns:
            True if relationship was added
        """
        # Find concept IDs
        subject_id = await self._find_concept_id(subject_concept)
        object_id = await self._find_concept_id(object_concept)
        
        if not subject_id or not object_id:
            return False
        
        # Add relationship
        subject_concept_obj = self._concepts[subject_id]
        if relationship_type not in subject_concept_obj.relationships:
            subject_concept_obj.relationships[relationship_type] = []
        
        if object_id not in subject_concept_obj.relationships[relationship_type]:
            subject_concept_obj.relationships[relationship_type].append(object_id)
        
        # Add reverse relationship for some types
        reverse_relations = {
            "is_a": "has_subtype",
            "has_subtype": "is_a",
            "related_to": "related_to",
            "similar_to": "similar_to"
        }
        
        if relationship_type in reverse_relations:
            reverse_type = reverse_relations[relationship_type]
            object_concept_obj = self._concepts[object_id]
            
            if reverse_type not in object_concept_obj.relationships:
                object_concept_obj.relationships[reverse_type] = []
            
            if subject_id not in object_concept_obj.relationships[reverse_type]:
                object_concept_obj.relationships[reverse_type].append(subject_id)
        
        return True
    
    async def get_concept(self, concept_identifier: str) -> Optional[Concept]:
        """Get concept by name or ID."""
        # Try as concept ID first
        if concept_identifier in self._concepts:
            return self._concepts[concept_identifier]
        
        # Try as concept name
        concept_id = await self._find_concept_id(concept_identifier)
        if concept_id and concept_id in self._concepts:
            return self._concepts[concept_id]
        
        return None
    
    async def get_concepts_by_category(self, category: str) -> List[Concept]:
        """Get all concepts in a category."""
        concept_ids = self._category_index.get(category, set())
        return [self._concepts[cid] for cid in concept_ids if cid in self._concepts]
    
    async def get_related_concepts(
        self,
        concept_identifier: str,
        relationship_types: Optional[List[str]] = None,
        depth: int = 1
    ) -> List[Tuple[Concept, str, int]]:
        """
        Get related concepts.
        
        Args:
            concept_identifier: Concept name or ID
            relationship_types: Types of relationships to follow
            depth: Maximum depth to search
            
        Returns:
            List of (concept, relationship_type, depth) tuples
        """
        concept = await self.get_concept(concept_identifier)
        if not concept:
            return []
        
        visited = set()
        results = []
        
        def _explore(current_concept: Concept, current_depth: int):
            if current_depth > depth or current_concept.concept_id in visited:
                return
            
            visited.add(current_concept.concept_id)
            
            for rel_type, related_ids in current_concept.relationships.items():
                if relationship_types and rel_type not in relationship_types:
                    continue
                
                for related_id in related_ids:
                    if related_id in self._concepts:
                        related_concept = self._concepts[related_id]
                        if related_concept.concept_id not in visited:
                            results.append((related_concept, rel_type, current_depth))
                            
                            if current_depth < depth:
                                _explore(related_concept, current_depth + 1)
        
        _explore(concept, 1)
        return results
    
    async def search_concepts(
        self,
        query: str,
        category: Optional[str] = None,
        limit: int = 10
    ) -> List[Tuple[Concept, float]]:
        """
        Search concepts by query.
        
        Args:
            query: Search query
            category: Optional category filter
            limit: Maximum results
            
        Returns:
            List of (concept, score) tuples
        """
        query_lower = query.lower()
        candidates = []
        
        # Exact name matches
        if query_lower in self._concept_index:
            for concept_id in self._concept_index[query_lower]:
                if concept_id in self._concepts:
                    candidates.append((self._concepts[concept_id], 1.0))
        
        # Partial matches
        query_words = query_lower.split()
        for concept_id, concept in self._concepts.items():
            if category and concept.category != category:
                continue
            
            # Skip if already found in exact match
            if any(c.concept_id == concept_id for c, _ in candidates):
                continue
            
            score = self._calculate_concept_similarity(concept, query_words)
            if score > 0.3:  # Threshold for partial matches
                candidates.append((concept, score))
        
        # Sort by score and return top results
        candidates.sort(key=lambda x: x[1], reverse=True)
        return candidates[:limit]
    
    async def _extract_concepts(self, content: str) -> List[str]:
        """Extract concepts from content."""
        # Simple concept extraction - in practice, this could use NLP
        import re
        
        concepts = []
        
        # Extract capitalized words/phrases (potential proper nouns)
        capitalized_words = re.findall(r'\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b', content)
        concepts.extend(capitalized_words)
        
        # Extract quoted terms
        quoted_terms = re.findall(r'"([^"]+)"', content)
        concepts.extend(quoted_terms)
        
        # Extract key terms after certain phrases
        key_phrases = [
            r'is a (\w+)',
            r'type of (\w+)',
            r'refers to (\w+)',
            r'defined as (\w+)',
        ]
        
        for phrase in key_phrases:
            matches = re.findall(phrase, content, re.IGNORECASE)
            concepts.extend(matches)
        
        # Clean and deduplicate
        concepts = list(set(c.strip() for c in concepts if c.strip() and len(c.strip()) > 2))
        
        return concepts
    
    async def _extract_knowledge_triples(self, content: str, record_id: str):
        """Extract knowledge triples from content."""
        # Simple triple extraction - in practice, this could use advanced NLP
        import re
        
        # Pattern for simple is-a relationships
        is_a_pattern = r'(\w+(?:\s+\w+)*)\s+is\s+a\s+(\w+(?:\s+\w+)*)'
        matches = re.findall(is_a_pattern, content, re.IGNORECASE)
        
        for subject, object_val in matches:
            triple_id = self._generate_record_id()
            triple = KnowledgeTriple(
                triple_id=triple_id,
                subject=subject.strip(),
                predicate="is_a",
                object=object_val.strip(),
                source=record_id,
                evidence=content[:200] + "..." if len(content) > 200 else content
            )
            
            self._knowledge_triples[triple_id] = triple
            
            # Update triple index
            self._triple_index[subject.lower()].add(triple_id)
            self._triple_index[object_val.lower()].add(triple_id)
    
    async def _create_or_update_concept(
        self,
        name: str,
        category: str,
        source_content: str,
        source_record_id: str
    ):
        """Create or update a concept."""
        # Check if concept already exists
        existing_concept = await self.get_concept(name)
        
        if existing_concept:
            # Update existing concept
            existing_concept.attributes["last_seen"] = datetime.now(UTC).isoformat()
            existing_concept.attributes["source_records"] = existing_concept.attributes.get("source_records", [])
            if source_record_id not in existing_concept.attributes["source_records"]:
                existing_concept.attributes["source_records"].append(source_record_id)
        else:
            # Create new concept
            description = f"Concept extracted from: {source_content[:100]}..."
            await self.add_concept(
                name=name,
                description=description,
                category=category,
                attributes={"source_records": [source_record_id]}
            )
    
    async def _find_concept_id(self, concept_identifier: str) -> Optional[str]:
        """Find concept ID by name or ID."""
        # Try as concept ID first
        if concept_identifier in self._concepts:
            return concept_identifier
        
        # Try as concept name
        concept_ids = self._concept_index.get(concept_identifier.lower(), set())
        if concept_ids:
            return next(iter(concept_ids))  # Return first match
        
        return None
    
    async def _find_similar_concept(self, concept: Concept) -> Optional[Concept]:
        """Find similar concept for potential merging."""
        for existing_concept in self._concepts.values():
            if existing_concept.category == concept.category:
                similarity = self._calculate_concept_similarity_score(existing_concept, concept)
                if similarity >= self.concept_similarity_threshold:
                    return existing_concept
        
        return None
    
    def _calculate_concept_similarity_score(self, concept1: Concept, concept2: Concept) -> float:
        """Calculate similarity between two concepts."""
        # Name similarity
        name_similarity = self._calculate_string_similarity(concept1.name, concept2.name)
        
        # Description similarity
        desc_similarity = self._calculate_string_similarity(concept1.description, concept2.description)
        
        # Synonym overlap
        all_names1 = {concept1.name.lower()} | {s.lower() for s in concept1.synonyms}
        all_names2 = {concept2.name.lower()} | {s.lower() for s in concept2.synonyms}
        
        synonym_overlap = len(all_names1 & all_names2) / len(all_names1 | all_names2)
        
        # Combine scores
        return (name_similarity * 0.4 + desc_similarity * 0.3 + synonym_overlap * 0.3)
    
    def _calculate_string_similarity(self, str1: str, str2: str) -> float:
        """Calculate string similarity using Jaccard index."""
        if not str1 or not str2:
            return 0.0
        
        words1 = set(str1.lower().split())
        words2 = set(str2.lower().split())
        
        if not words1 or not words2:
            return 0.0
        
        intersection = len(words1 & words2)
        union = len(words1 | words2)
        
        return intersection / union if union > 0 else 0.0
    
    def _calculate_concept_similarity(self, concept: Concept, query_words: List[str]) -> float:
        """Calculate concept similarity to query words."""
        query_set = set(query_words)
        
        # Name similarity
        name_words = set(concept.name.lower().split())
        name_score = len(query_set & name_words) / len(query_set | name_words) if query_set | name_words else 0
        
        # Description similarity
        desc_words = set(concept.description.lower().split())
        desc_score = len(query_set & desc_words) / len(query_set | desc_words) if query_set | desc_words else 0
        
        # Synonym similarity
        synonym_score = 0
        for synonym in concept.synonyms:
            synonym_words = set(synonym.lower().split())
            syn_score = len(query_set & synonym_words) / len(query_set | synonym_words) if query_set | synonym_words else 0
            synonym_score = max(synonym_score, syn_score)
        
        return max(name_score, desc_score, synonym_score)
    
    async def _merge_concepts(self, target: Concept, source: Concept):
        """Merge source concept into target concept."""
        # Merge synonyms
        target.synonyms.extend([s for s in source.synonyms if s not in target.synonyms])
        
        # Merge attributes
        for key, value in source.attributes.items():
            if key not in target.attributes:
                target.attributes[key] = value
            elif isinstance(value, list) and isinstance(target.attributes[key], list):
                target.attributes[key].extend([v for v in value if v not in target.attributes[key]])
        
        # Merge relationships
        for rel_type, related_ids in source.relationships.items():
            if rel_type not in target.relationships:
                target.relationships[rel_type] = []
            target.relationships[rel_type].extend([rid for rid in related_ids if rid not in target.relationships[rel_type]])
        
        # Update confidence (weighted average)
        total_confidence = target.confidence + source.confidence
        target.confidence = total_confidence / 2
    
    async def _store_record(self, record: HierarchicalMemoryRecord):
        """Store a hierarchical memory record."""
        self._semantic_records[record.id] = record
        
        # Update keyword index
        keywords = self._extract_keywords(record.content)
        for keyword in keywords:
            self._keyword_index[keyword].add(record.id)
        
        # Index concepts mentioned in metadata
        concepts = record.metadata.get("concepts", [])
        for concept in concepts:
            self._concept_index[concept.lower()].add(record.id)
    
    async def _hierarchical_search(
        self,
        query: str,
        context: SearchContext,
        limit: int,
        min_score: float
    ) -> List[SearchResult]:
        """Perform hierarchical search with semantic understanding."""
        query_keywords = self._extract_keywords(query)
        
        # Find candidates through multiple strategies
        candidates = set()
        
        # 1. Keyword matching
        for keyword in query_keywords:
            if keyword in self._keyword_index:
                candidates.update(self._keyword_index[keyword])
        
        # 2. Concept matching
        concept_results = await self.search_concepts(query, limit=5)
        for concept, _ in concept_results:
            if concept.concept_id in self._concept_index:
                candidates.update(self._concept_index[concept.concept_id])
        
        # Score and rank results
        results = []
        for record_id in candidates:
            record = self._semantic_records.get(record_id)
            if not record:
                continue
            
            # Apply context filters
            if context.importance_threshold:
                if record.importance.value < context.importance_threshold.value:
                    continue
            
            if context.max_age:
                if datetime.now(UTC) - record.created_at > context.max_age:
                    continue
            
            if not context.include_decayed and record.decay_factor < 0.5:
                continue
            
            # Calculate semantic score
            score = self._calculate_semantic_score(record, query_keywords, query)
            
            if score >= min_score:
                results.append(SearchResult(record=record, score=score))
        
        # Sort by score and return top results
        results.sort(key=lambda r: r.score, reverse=True)
        return results[:limit]
    
    def _calculate_semantic_score(self, record: HierarchicalMemoryRecord, query_keywords: List[str], query: str) -> float:
        """Calculate semantic relevance score."""
        # Keyword matching score
        record_keywords = self._extract_keywords(record.content)
        keyword_matches = len(set(query_keywords) & set(record_keywords))
        keyword_score = keyword_matches / len(query_keywords) if query_keywords else 0
        
        # Concept matching score
        concepts = record.metadata.get("concepts", [])
        concept_score = 0
        if concepts:
            for concept_name in concepts:
                concept = self._concepts.get(concept_name)
                if concept:
                    concept_sim = self._calculate_concept_similarity(concept, query_keywords)
                    concept_score = max(concept_score, concept_sim)
        
        # Importance multiplier
        importance_multiplier = record.importance.value / 4.0
        
        # Decay factor
        decay_factor = record.decay_factor
        
        # Category boost (if query contains category terms)
        category_boost = 1.0
        category = record.metadata.get("category", "")
        if category and category.lower() in query.lower():
            category_boost = 1.2
        
        # Combine scores
        final_score = (keyword_score * 0.4 + concept_score * 0.6) * importance_multiplier * decay_factor * category_boost
        
        return min(1.0, final_score)
    
    def _extract_keywords(self, text: str) -> List[str]:
        """Extract keywords from text."""
        if not text:
            return []
        
        import re
        words = re.findall(r'\b\w+\b', text.lower())
        
        # Filter stop words
        stop_words = {
            'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
            'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have',
            'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
            'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those'
        }
        
        return [word for word in words if word not in stop_words and len(word) > 2]
    
    async def _update_access_count(self, record_id: str):
        """Update access count for a record."""
        if record_id in self._semantic_records:
            record = self._semantic_records[record_id]
            record.access_count += 1
            record.last_accessed = datetime.now(UTC)
            record.decay_factor = min(1.0, record.decay_factor + 0.05)
    
    # Implement required abstract methods from BaseMemory
    async def search(
        self,
        query: str,
        limit: int = 10,
        metadata_filter: Optional[Dict[str, Any]] = None,
        min_score: float = 0.0
    ) -> List[SearchResult]:
        """Search for relevant memory records."""
        context = SearchContext(
            query_type="semantic",
            memory_types=[MemoryType.SEMANTIC]
        )
        
        results = await self._hierarchical_search(query, context, limit, min_score)
        
        # Apply metadata filter if provided
        if metadata_filter:
            filtered_results = []
            for result in results:
                if self._matches_metadata_filter(result.record, metadata_filter):
                    filtered_results.append(result)
            results = filtered_results
        
        return results
    
    def _matches_metadata_filter(self, record: MemoryRecord, filter_dict: Dict[str, Any]) -> bool:
        """Check if record matches the filter."""
        for key, value in filter_dict.items():
            # Check record attributes first
            if hasattr(record, key):
                record_value = getattr(record, key)
                # Handle enum values
                if hasattr(record_value, 'value'):
                    record_value = record_value.value
                if record_value != value:
                    return False
            # Check metadata
            elif key in record.metadata:
                if record.metadata[key] != value:
                    return False
            else:
                return False
        return True
    
    async def update(
        self,
        record_id: str,
        content: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> bool:
        """Update an existing memory record."""
        if record_id not in self._semantic_records:
            return False
        
        record = self._semantic_records[record_id]
        
        if content is not None:
            record.content = content
        
        if metadata is not None:
            record.metadata.update(metadata)
        
        record.updated_at = datetime.now(UTC)
        
        # Re-index the record
        await self._store_record(record)
        
        return True
    
    async def delete(self, record_id: str) -> bool:
        """Delete a memory record."""
        if record_id not in self._semantic_records:
            return False
        
        record = self._semantic_records[record_id]
        
        # Remove from indices
        keywords = self._extract_keywords(record.content)
        for keyword in keywords:
            self._keyword_index[keyword].discard(record_id)
        
        concepts = record.metadata.get("concepts", [])
        for concept in concepts:
            self._concept_index[concept.lower()].discard(record_id)
        
        # Remove record
        del self._semantic_records[record_id]
        
        return True
    
    async def get(self, record_id: str) -> Optional[HierarchicalMemoryRecord]:
        """Get a specific memory record by ID."""
        return self._semantic_records.get(record_id)
    
    async def list_all(
        self,
        limit: int = 100,
        offset: int = 0,
        metadata_filter: Optional[Dict[str, Any]] = None
    ) -> List[MemoryRecord]:
        """List all memory records for the current tenant."""
        all_records: List[HierarchicalMemoryRecord] = list(self._semantic_records.values())
        
        # Apply metadata filter
        if metadata_filter:
            filtered_records = []
            for record in all_records:
                if self._matches_metadata_filter(record, metadata_filter):
                    filtered_records.append(record)
            all_records = filtered_records
        
        # Sort by relevance (access count and importance)
        all_records.sort(key=lambda r: (r.access_count, r.importance.value), reverse=True)
        
        # Apply pagination
        start = offset
        end = offset + limit
        return all_records[start:end]  # type: ignore
    
    async def clear(self) -> int:
        """Clear all memory records for the current tenant."""
        count = len(self._semantic_records)
        self._semantic_records.clear()
        self._concepts.clear()
        self._knowledge_triples.clear()
        self._concept_index.clear()
        self._category_index.clear()
        self._keyword_index.clear()
        self._triple_index.clear()
        return count 