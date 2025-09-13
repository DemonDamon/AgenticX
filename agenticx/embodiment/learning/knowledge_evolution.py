"""Knowledge Evolution Component

This module implements the KnowledgeEvolution component that manages the evolution
and refinement of GUI automation knowledge over time.
"""

from typing import List, Dict, Any, Optional, Tuple, Set, Union
from pydantic import BaseModel, Field
from datetime import datetime, timedelta, UTC
from collections import defaultdict, Counter
from dataclasses import dataclass
import json
import statistics
from enum import Enum
import hashlib
import math
from abc import ABC, abstractmethod

from agenticx.core.component import Component
from agenticx.memory.component import MemoryComponent
from agenticx.embodiment.core.models import GUITask, ScreenState, InteractionElement


class KnowledgeType(str, Enum):
    """Types of knowledge in the system."""
    UI_PATTERN = "ui_pattern"
    TASK_WORKFLOW = "task_workflow"
    APPLICATION_BEHAVIOR = "application_behavior"
    USER_PREFERENCE = "user_preference"
    INTERACTION_STRATEGY = "interaction_strategy"
    ERROR_RECOVERY = "error_recovery"
    PERFORMANCE_OPTIMIZATION = "performance_optimization"
    CONTEXT_ADAPTATION = "context_adaptation"


class EvolutionTrigger(str, Enum):
    """Triggers for knowledge evolution."""
    PERFORMANCE_DEGRADATION = "performance_degradation"
    NEW_DATA_PATTERN = "new_data_pattern"
    USER_FEEDBACK = "user_feedback"
    ERROR_FREQUENCY = "error_frequency"
    CONTEXT_CHANGE = "context_change"
    SCHEDULED_UPDATE = "scheduled_update"
    MANUAL_TRIGGER = "manual_trigger"
    CONFLICT_DETECTION = "conflict_detection"


class EvolutionStrategy(str, Enum):
    """Strategies for knowledge evolution."""
    INCREMENTAL_UPDATE = "incremental_update"
    COMPLETE_REPLACEMENT = "complete_replacement"
    MERGE_AND_REFINE = "merge_and_refine"
    SELECTIVE_ADAPTATION = "selective_adaptation"
    ROLLBACK_AND_RETRY = "rollback_and_retry"
    ENSEMBLE_LEARNING = "ensemble_learning"


class KnowledgeItem(BaseModel):
    """Represents a piece of knowledge in the system."""
    
    knowledge_id: str = Field(description="Unique identifier for the knowledge item")
    knowledge_type: KnowledgeType = Field(description="Type of knowledge")
    title: str = Field(description="Human-readable title")
    description: str = Field(description="Description of the knowledge")
    content: Dict[str, Any] = Field(description="The actual knowledge content")
    confidence_score: float = Field(default=0.5, description="Confidence in this knowledge")
    usage_count: int = Field(default=0, description="Number of times this knowledge was used")
    success_rate: float = Field(default=0.0, description="Success rate when using this knowledge")
    last_used: Optional[datetime] = Field(default=None, description="Last time this knowledge was used")
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
    version: int = Field(default=1, description="Version number")
    source: str = Field(default="system", description="Source of this knowledge")
    tags: List[str] = Field(default_factory=list, description="Tags for categorization")
    dependencies: List[str] = Field(default_factory=list, description="IDs of dependent knowledge items")
    conflicts: List[str] = Field(default_factory=list, description="IDs of conflicting knowledge items")
    validation_results: List[Dict[str, Any]] = Field(default_factory=list, description="Validation test results")
    performance_metrics: Dict[str, float] = Field(default_factory=dict, description="Performance metrics")
    context_constraints: Dict[str, Any] = Field(default_factory=dict, description="Context where this knowledge applies")
    expiry_date: Optional[datetime] = Field(default=None, description="When this knowledge expires")


class EvolutionEvent(BaseModel):
    """Represents an evolution event."""
    
    event_id: str = Field(description="Unique identifier for the event")
    trigger: EvolutionTrigger = Field(description="What triggered this evolution")
    strategy: EvolutionStrategy = Field(description="Strategy used for evolution")
    affected_knowledge: List[str] = Field(description="IDs of affected knowledge items")
    changes_made: Dict[str, Any] = Field(description="Details of changes made")
    performance_before: Dict[str, float] = Field(description="Performance metrics before evolution")
    performance_after: Dict[str, float] = Field(description="Performance metrics after evolution")
    success: bool = Field(description="Whether the evolution was successful")
    rollback_info: Optional[Dict[str, Any]] = Field(default=None, description="Information for potential rollback")
    timestamp: datetime = Field(default_factory=datetime.now)
    duration: float = Field(default=0.0, description="Duration of evolution process")
    impact_score: float = Field(default=0.0, description="Impact score of the evolution")
    validation_results: List[Dict[str, Any]] = Field(default_factory=list, description="Validation results")


class KnowledgeConflict(BaseModel):
    """Represents a conflict between knowledge items."""
    
    conflict_id: str = Field(description="Unique identifier for the conflict")
    knowledge_items: List[str] = Field(description="IDs of conflicting knowledge items")
    conflict_type: str = Field(description="Type of conflict")
    severity: float = Field(description="Severity of the conflict (0-1)")
    description: str = Field(description="Description of the conflict")
    resolution_strategy: Optional[str] = Field(default=None, description="Strategy to resolve the conflict")
    detected_at: datetime = Field(default_factory=datetime.now)
    resolved_at: Optional[datetime] = Field(default=None)
    resolution_details: Optional[Dict[str, Any]] = Field(default=None)


class EvolutionConfig(BaseModel):
    """Configuration for knowledge evolution."""
    
    evolution_frequency: timedelta = Field(default=timedelta(hours=24), description="How often to check for evolution")
    confidence_threshold: float = Field(default=0.7, description="Minimum confidence for knowledge retention")
    usage_threshold: int = Field(default=10, description="Minimum usage count for knowledge retention")
    performance_threshold: float = Field(default=0.6, description="Minimum performance for knowledge retention")
    conflict_resolution_enabled: bool = Field(default=True, description="Enable automatic conflict resolution")
    validation_enabled: bool = Field(default=True, description="Enable knowledge validation")
    rollback_enabled: bool = Field(default=True, description="Enable rollback on failed evolution")
    max_knowledge_age_days: int = Field(default=90, description="Maximum age for knowledge items")
    max_evolution_attempts: int = Field(default=3, description="Maximum evolution attempts per trigger")
    learning_rate: float = Field(default=0.1, description="Learning rate for incremental updates")
    ensemble_size: int = Field(default=5, description="Size of ensemble for ensemble learning")
    validation_sample_size: int = Field(default=100, description="Sample size for validation")


class KnowledgeValidator(ABC):
    """Abstract base class for knowledge validators."""
    
    @abstractmethod
    async def validate(self, knowledge: KnowledgeItem, context: Dict[str, Any]) -> Dict[str, Any]:
        """Validate a knowledge item.
        
        Args:
            knowledge: Knowledge item to validate
            context: Validation context
            
        Returns:
            Validation results
        """
        pass


class PerformanceValidator(KnowledgeValidator):
    """Validator that checks knowledge performance."""
    
    async def validate(self, knowledge: KnowledgeItem, context: Dict[str, Any]) -> Dict[str, Any]:
        """Validate knowledge based on performance metrics."""
        return {
            'validator': 'performance',
            'valid': knowledge.success_rate >= context.get('min_success_rate', 0.6),
            'score': knowledge.success_rate,
            'details': {
                'success_rate': knowledge.success_rate,
                'usage_count': knowledge.usage_count,
                'confidence': knowledge.confidence_score
            }
        }


class ConsistencyValidator(KnowledgeValidator):
    """Validator that checks knowledge consistency."""
    
    async def validate(self, knowledge: KnowledgeItem, context: Dict[str, Any]) -> Dict[str, Any]:
        """Validate knowledge based on consistency with other knowledge."""
        # Simplified consistency check
        consistency_score = 1.0 - len(knowledge.conflicts) * 0.1
        
        return {
            'validator': 'consistency',
            'valid': consistency_score >= 0.7,
            'score': consistency_score,
            'details': {
                'conflicts': len(knowledge.conflicts),
                'dependencies': len(knowledge.dependencies)
            }
        }


class KnowledgeEvolution(Component):
    """Knowledge Evolution Component
    
    Manages the evolution and refinement of GUI automation knowledge over time,
    ensuring the knowledge base remains accurate, relevant, and effective.
    """
    
    def __init__(self, name: Optional[str] = None, **kwargs):
        """Initialize the KnowledgeEvolution component.
        
        Args:
            name: Optional component name
            **kwargs: Additional configuration options
        """
        super().__init__(name=name, **kwargs)
        self._config = EvolutionConfig(**kwargs.get('evolution_config', {}))
        self._knowledge_base: Dict[str, KnowledgeItem] = {}
        self._evolution_history: List[EvolutionEvent] = []
        self._conflicts: Dict[str, KnowledgeConflict] = {}
        self._validators: List[KnowledgeValidator] = []
        self._last_evolution_check = datetime.now()
        
        # Initialize default validators
        self._initialize_validators()
    
    async def add_knowledge(self, 
                          knowledge_type: KnowledgeType,
                          title: str,
                          content: Dict[str, Any],
                          source: str = "system",
                          **kwargs) -> str:
        """Add new knowledge to the system.
        
        Args:
            knowledge_type: Type of knowledge
            title: Human-readable title
            content: The actual knowledge content
            source: Source of the knowledge
            **kwargs: Additional knowledge properties
            
        Returns:
            Knowledge ID
        """
        # Generate unique knowledge ID
        knowledge_data = f"{knowledge_type}_{title}_{datetime.now().isoformat()}"
        knowledge_id = hashlib.md5(knowledge_data.encode()).hexdigest()[:12]
        
        # Create knowledge item
        knowledge = KnowledgeItem(
            knowledge_id=knowledge_id,
            knowledge_type=knowledge_type,
            title=title,
            content=content,
            source=source,
            **kwargs
        )
        
        # Store knowledge
        self._knowledge_base[knowledge_id] = knowledge
        
        # Check for conflicts
        await self._detect_conflicts(knowledge)
        
        return knowledge_id
    
    async def update_knowledge(self, 
                             knowledge_id: str,
                             updates: Dict[str, Any],
                             trigger: EvolutionTrigger = EvolutionTrigger.MANUAL_TRIGGER) -> bool:
        """Update existing knowledge.
        
        Args:
            knowledge_id: ID of knowledge to update
            updates: Updates to apply
            trigger: What triggered this update
            
        Returns:
            True if update was successful
        """
        if knowledge_id not in self._knowledge_base:
            return False
        
        knowledge = self._knowledge_base[knowledge_id]
        old_version = knowledge.model_copy()
        
        # Apply updates
        for key, value in updates.items():
            if hasattr(knowledge, key):
                setattr(knowledge, key, value)
        
        knowledge.version += 1
        knowledge.updated_at = datetime.now()
        
        # Record evolution event
        await self._record_evolution_event(
            trigger=trigger,
            strategy=EvolutionStrategy.INCREMENTAL_UPDATE,
            affected_knowledge=[knowledge_id],
            changes_made=updates,
            old_knowledge=old_version
        )
        
        # Re-validate knowledge
        if self._config.validation_enabled:
            await self._validate_knowledge(knowledge)
        
        return True
    
    async def evolve_knowledge(self, 
                             trigger: EvolutionTrigger,
                             context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Trigger knowledge evolution process.
        
        Args:
            trigger: What triggered the evolution
            context: Optional context for evolution
            
        Returns:
            Evolution results
        """
        start_time = datetime.now()
        context = context or {}
        
        # Identify knowledge items that need evolution
        candidates = await self._identify_evolution_candidates(trigger, context)
        
        if not candidates:
            return {
                'success': True,
                'message': 'No knowledge items require evolution',
                'candidates': 0,
                'evolved': 0
            }
        
        # Determine evolution strategy
        strategy = await self._determine_evolution_strategy(trigger, candidates, context)
        
        # Perform evolution
        evolution_results = await self._perform_evolution(strategy, candidates, context)
        
        # Record evolution event
        duration = (datetime.now() - start_time).total_seconds()
        await self._record_evolution_event(
            trigger=trigger,
            strategy=strategy,
            affected_knowledge=[c['knowledge_id'] for c in candidates],
            changes_made=evolution_results,
            duration=duration
        )
        
        # Update last evolution check
        self._last_evolution_check = datetime.now()
        
        return {
            'success': True,
            'candidates': len(candidates),
            'evolved': evolution_results.get('evolved_count', 0),
            'strategy': strategy,
            'duration': duration,
            'improvements': evolution_results.get('improvements', {})
        }
    
    async def validate_knowledge_base(self, 
                                    sample_size: Optional[int] = None) -> Dict[str, Any]:
        """Validate the entire knowledge base.
        
        Args:
            sample_size: Optional sample size for validation
            
        Returns:
            Validation results
        """
        if sample_size is None:
            sample_size = self._config.validation_sample_size
        
        # Select knowledge items to validate
        knowledge_items = list(self._knowledge_base.values())
        if len(knowledge_items) > sample_size:
            # Sample based on usage and recency
            knowledge_items = sorted(
                knowledge_items,
                key=lambda k: (k.usage_count, k.updated_at),
                reverse=True
            )[:sample_size]
        
        validation_results = []
        valid_count = 0
        
        for knowledge in knowledge_items:
            result = await self._validate_knowledge(knowledge)
            validation_results.append(result)
            
            if result.get('overall_valid', False):
                valid_count += 1
        
        return {
            'total_validated': len(validation_results),
            'valid_count': valid_count,
            'validity_rate': valid_count / len(validation_results) if validation_results else 0,
            'results': validation_results
        }
    
    async def resolve_conflicts(self, 
                              conflict_ids: Optional[List[str]] = None) -> Dict[str, Any]:
        """Resolve knowledge conflicts.
        
        Args:
            conflict_ids: Optional specific conflicts to resolve
            
        Returns:
            Resolution results
        """
        if conflict_ids is None:
            conflicts_to_resolve = list(self._conflicts.values())
        else:
            conflicts_to_resolve = [
                self._conflicts[cid] for cid in conflict_ids
                if cid in self._conflicts
            ]
        
        resolution_results = []
        resolved_count = 0
        
        for conflict in conflicts_to_resolve:
            try:
                result = await self._resolve_conflict(conflict)
                resolution_results.append(result)
                
                if result.get('resolved', False):
                    resolved_count += 1
                    conflict.resolved_at = datetime.now()
                    conflict.resolution_details = result
            
            except Exception as e:
                resolution_results.append({
                    'conflict_id': conflict.conflict_id,
                    'resolved': False,
                    'error': str(e)
                })
        
        return {
            'total_conflicts': len(conflicts_to_resolve),
            'resolved_count': resolved_count,
            'resolution_rate': resolved_count / len(conflicts_to_resolve) if conflicts_to_resolve else 0,
            'results': resolution_results
        }
    
    async def get_knowledge_insights(self, 
                                   time_range: Optional[Tuple[datetime, datetime]] = None) -> Dict[str, Any]:
        """Get insights about the knowledge base.
        
        Args:
            time_range: Optional time range for analysis
            
        Returns:
            Knowledge insights
        """
        # Filter knowledge by time range
        knowledge_items = list(self._knowledge_base.values())
        if time_range:
            start_time, end_time = time_range
            knowledge_items = [
                k for k in knowledge_items
                if start_time <= k.updated_at <= end_time
            ]
        
        insights = {
            'summary': await self._generate_knowledge_summary(knowledge_items),
            'quality_metrics': await self._analyze_knowledge_quality(knowledge_items),
            'usage_patterns': await self._analyze_usage_patterns(knowledge_items),
            'evolution_trends': await self._analyze_evolution_trends(),
            'conflict_analysis': await self._analyze_conflicts(),
            'recommendations': await self._generate_improvement_recommendations()
        }
        
        return insights
    
    async def cleanup_knowledge_base(self) -> Dict[str, Any]:
        """Clean up outdated and low-quality knowledge.
        
        Returns:
            Cleanup results
        """
        cleanup_results = {
            'removed_count': 0,
            'archived_count': 0,
            'updated_count': 0,
            'removed_items': [],
            'archived_items': []
        }
        
        current_time = datetime.now()
        items_to_remove = []
        
        for knowledge_id, knowledge in self._knowledge_base.items():
            should_remove = False
            
            # Check age
            age_days = (current_time - knowledge.created_at).days
            if age_days > self._config.max_knowledge_age_days:
                should_remove = True
            
            # Check performance
            if (knowledge.usage_count >= self._config.usage_threshold and 
                knowledge.success_rate < self._config.performance_threshold):
                should_remove = True
            
            # Check confidence
            if knowledge.confidence_score < self._config.confidence_threshold:
                should_remove = True
            
            # Check expiry
            if knowledge.expiry_date and current_time > knowledge.expiry_date:
                should_remove = True
            
            if should_remove:
                items_to_remove.append(knowledge_id)
                cleanup_results['removed_items'].append({
                    'knowledge_id': knowledge_id,
                    'title': knowledge.title,
                    'reason': 'low_quality_or_outdated'
                })
        
        # Remove identified items
        for knowledge_id in items_to_remove:
            del self._knowledge_base[knowledge_id]
            cleanup_results['removed_count'] += 1
        
        return cleanup_results
    
    async def _identify_evolution_candidates(self, 
                                           trigger: EvolutionTrigger,
                                           context: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Identify knowledge items that need evolution."""
        candidates = []
        
        for knowledge_id, knowledge in self._knowledge_base.items():
            candidate_score = await self._calculate_evolution_score(knowledge, trigger, context)
            
            if candidate_score > 0.5:  # Threshold for evolution candidacy
                candidates.append({
                    'knowledge_id': knowledge_id,
                    'knowledge': knowledge,
                    'evolution_score': candidate_score,
                    'reasons': await self._get_evolution_reasons(knowledge, trigger, context)
                })
        
        # Sort by evolution score
        candidates.sort(key=lambda c: c['evolution_score'], reverse=True)
        
        return candidates
    
    async def _calculate_evolution_score(self, 
                                       knowledge: KnowledgeItem,
                                       trigger: EvolutionTrigger,
                                       context: Dict[str, Any]) -> float:
        """Calculate evolution score for a knowledge item."""
        score = 0.0
        
        # Performance-based scoring
        if knowledge.usage_count > 0:
            performance_score = 1.0 - knowledge.success_rate
            score += performance_score * 0.4
        
        # Age-based scoring
        age_days = (datetime.now() - knowledge.updated_at).days
        age_score = min(age_days / 30.0, 1.0)  # Normalize to 30 days
        score += age_score * 0.2
        
        # Conflict-based scoring
        conflict_score = len(knowledge.conflicts) * 0.1
        score += min(conflict_score, 0.3)
        
        # Trigger-specific scoring
        if trigger == EvolutionTrigger.PERFORMANCE_DEGRADATION:
            if knowledge.success_rate < 0.7:
                score += 0.3
        elif trigger == EvolutionTrigger.ERROR_FREQUENCY:
            error_rate = 1.0 - knowledge.success_rate
            score += error_rate * 0.4
        
        return min(score, 1.0)
    
    async def _get_evolution_reasons(self, 
                                   knowledge: KnowledgeItem,
                                   trigger: EvolutionTrigger,
                                   context: Dict[str, Any]) -> List[str]:
        """Get reasons why knowledge needs evolution."""
        reasons = []
        
        if knowledge.success_rate < 0.7:
            reasons.append("Low success rate")
        
        if knowledge.confidence_score < 0.6:
            reasons.append("Low confidence")
        
        if len(knowledge.conflicts) > 0:
            reasons.append("Has conflicts")
        
        age_days = (datetime.now() - knowledge.updated_at).days
        if age_days > 30:
            reasons.append("Outdated")
        
        if trigger == EvolutionTrigger.USER_FEEDBACK:
            reasons.append("User feedback received")
        
        return reasons
    
    async def _determine_evolution_strategy(self, 
                                          trigger: EvolutionTrigger,
                                          candidates: List[Dict[str, Any]],
                                          context: Dict[str, Any]) -> EvolutionStrategy:
        """Determine the best evolution strategy."""
        # Strategy selection based on trigger and context
        if trigger == EvolutionTrigger.PERFORMANCE_DEGRADATION:
            return EvolutionStrategy.SELECTIVE_ADAPTATION
        elif trigger == EvolutionTrigger.CONFLICT_DETECTION:
            return EvolutionStrategy.MERGE_AND_REFINE
        elif trigger == EvolutionTrigger.NEW_DATA_PATTERN:
            return EvolutionStrategy.INCREMENTAL_UPDATE
        elif len(candidates) > 10:
            return EvolutionStrategy.ENSEMBLE_LEARNING
        else:
            return EvolutionStrategy.INCREMENTAL_UPDATE
    
    async def _perform_evolution(self, 
                               strategy: EvolutionStrategy,
                               candidates: List[Dict[str, Any]],
                               context: Dict[str, Any]) -> Dict[str, Any]:
        """Perform the actual evolution process."""
        results = {
            'evolved_count': 0,
            'improvements': {},
            'errors': []
        }
        
        for candidate in candidates:
            try:
                knowledge = candidate['knowledge']
                
                if strategy == EvolutionStrategy.INCREMENTAL_UPDATE:
                    await self._incremental_update(knowledge, context)
                elif strategy == EvolutionStrategy.SELECTIVE_ADAPTATION:
                    await self._selective_adaptation(knowledge, context)
                elif strategy == EvolutionStrategy.MERGE_AND_REFINE:
                    await self._merge_and_refine(knowledge, context)
                
                results['evolved_count'] += 1
                
            except Exception as e:
                results['errors'].append({
                    'knowledge_id': candidate['knowledge_id'],
                    'error': str(e)
                })
        
        return results
    
    async def _incremental_update(self, knowledge: KnowledgeItem, context: Dict[str, Any]):
        """Perform incremental update on knowledge."""
        # Update confidence based on recent performance
        if knowledge.usage_count > 0:
            new_confidence = (
                knowledge.confidence_score * 0.8 + 
                knowledge.success_rate * 0.2
            )
            knowledge.confidence_score = new_confidence
        
        # Update performance metrics
        if 'new_performance' in context:
            for metric, value in context['new_performance'].items():
                if metric in knowledge.performance_metrics:
                    old_value = knowledge.performance_metrics[metric]
                    new_value = old_value * 0.9 + value * 0.1
                    knowledge.performance_metrics[metric] = new_value
                else:
                    knowledge.performance_metrics[metric] = value
        
        knowledge.updated_at = datetime.now()
    
    async def _selective_adaptation(self, knowledge: KnowledgeItem, context: Dict[str, Any]):
        """Perform selective adaptation on knowledge."""
        # Adapt specific parts of knowledge based on context
        if 'adaptation_targets' in context:
            for target, new_value in context['adaptation_targets'].items():
                if target in knowledge.content:
                    # Blend old and new values
                    if isinstance(knowledge.content[target], (int, float)):
                        old_value = knowledge.content[target]
                        blended_value = old_value * 0.7 + new_value * 0.3
                        knowledge.content[target] = blended_value
                    else:
                        knowledge.content[target] = new_value
        
        knowledge.version += 1
        knowledge.updated_at = datetime.now()
    
    async def _merge_and_refine(self, knowledge: KnowledgeItem, context: Dict[str, Any]):
        """Merge and refine knowledge with related items."""
        # Find related knowledge items
        related_items = await self._find_related_knowledge(knowledge)
        
        if related_items:
            # Merge content from related items
            merged_content = knowledge.content.copy()
            
            for related in related_items:
                for key, value in related.content.items():
                    if key in merged_content:
                        # Average numeric values
                        if isinstance(value, (int, float)) and isinstance(merged_content[key], (int, float)):
                            merged_content[key] = (merged_content[key] + value) / 2
                    else:
                        merged_content[key] = value
            
            knowledge.content = merged_content
            knowledge.version += 1
            knowledge.updated_at = datetime.now()
    
    async def _find_related_knowledge(self, knowledge: KnowledgeItem) -> List[KnowledgeItem]:
        """Find knowledge items related to the given item."""
        related = []
        
        for other_knowledge in self._knowledge_base.values():
            if other_knowledge.knowledge_id == knowledge.knowledge_id:
                continue
            
            # Check for same type and similar tags
            if (other_knowledge.knowledge_type == knowledge.knowledge_type and
                len(set(knowledge.tags) & set(other_knowledge.tags)) > 0):
                related.append(other_knowledge)
        
        return related
    
    async def _validate_knowledge(self, knowledge: KnowledgeItem) -> Dict[str, Any]:
        """Validate a knowledge item using all validators."""
        validation_results = []
        overall_valid = True
        
        for validator in self._validators:
            try:
                result = await validator.validate(knowledge, {})
                validation_results.append(result)
                
                if not result.get('valid', False):
                    overall_valid = False
            
            except Exception as e:
                validation_results.append({
                    'validator': validator.__class__.__name__,
                    'valid': False,
                    'error': str(e)
                })
                overall_valid = False
        
        # Update knowledge validation results
        knowledge.validation_results = validation_results
        
        return {
            'knowledge_id': knowledge.knowledge_id,
            'overall_valid': overall_valid,
            'validator_results': validation_results
        }
    
    async def _detect_conflicts(self, knowledge: KnowledgeItem):
        """Detect conflicts with existing knowledge."""
        for other_id, other_knowledge in self._knowledge_base.items():
            if other_id == knowledge.knowledge_id:
                continue
            
            conflict_severity = await self._calculate_conflict_severity(knowledge, other_knowledge)
            
            if conflict_severity > 0.5:
                conflict_id = f"{knowledge.knowledge_id}_{other_id}"
                
                conflict = KnowledgeConflict(
                    conflict_id=conflict_id,
                    knowledge_items=[knowledge.knowledge_id, other_id],
                    conflict_type="content_conflict",
                    severity=conflict_severity,
                    description=f"Conflict between {knowledge.title} and {other_knowledge.title}"
                )
                
                self._conflicts[conflict_id] = conflict
                
                # Update knowledge items with conflict references
                if other_id not in knowledge.conflicts:
                    knowledge.conflicts.append(other_id)
                if knowledge.knowledge_id not in other_knowledge.conflicts:
                    other_knowledge.conflicts.append(knowledge.knowledge_id)
    
    async def _calculate_conflict_severity(self, 
                                         knowledge1: KnowledgeItem,
                                         knowledge2: KnowledgeItem) -> float:
        """Calculate conflict severity between two knowledge items."""
        # Check for same type and overlapping context
        if knowledge1.knowledge_type != knowledge2.knowledge_type:
            return 0.0
        
        # Check for conflicting content
        content_conflicts = 0
        total_keys = 0
        
        common_keys = set(knowledge1.content.keys()) & set(knowledge2.content.keys())
        
        for key in common_keys:
            total_keys += 1
            value1 = knowledge1.content[key]
            value2 = knowledge2.content[key]
            
            if value1 != value2:
                content_conflicts += 1
        
        if total_keys == 0:
            return 0.0
        
        conflict_ratio = content_conflicts / total_keys
        
        # Adjust by confidence scores
        confidence_factor = abs(knowledge1.confidence_score - knowledge2.confidence_score)
        
        return conflict_ratio * (1.0 + confidence_factor)
    
    async def _resolve_conflict(self, conflict: KnowledgeConflict) -> Dict[str, Any]:
        """Resolve a knowledge conflict."""
        if len(conflict.knowledge_items) != 2:
            return {'resolved': False, 'error': 'Can only resolve conflicts between two items'}
        
        knowledge1 = self._knowledge_base.get(conflict.knowledge_items[0])
        knowledge2 = self._knowledge_base.get(conflict.knowledge_items[1])
        
        if not knowledge1 or not knowledge2:
            return {'resolved': False, 'error': 'Knowledge items not found'}
        
        # Choose resolution strategy based on confidence and performance
        if knowledge1.confidence_score > knowledge2.confidence_score:
            winner, loser = knowledge1, knowledge2
        elif knowledge2.confidence_score > knowledge1.confidence_score:
            winner, loser = knowledge2, knowledge1
        else:
            # Use success rate as tiebreaker
            if knowledge1.success_rate > knowledge2.success_rate:
                winner, loser = knowledge1, knowledge2
            else:
                winner, loser = knowledge2, knowledge1
        
        # Remove conflict references
        if loser.knowledge_id in winner.conflicts:
            winner.conflicts.remove(loser.knowledge_id)
        if winner.knowledge_id in loser.conflicts:
            loser.conflicts.remove(winner.knowledge_id)
        
        # Archive or remove the losing knowledge
        loser.tags.append('archived_due_to_conflict')
        loser.confidence_score *= 0.5  # Reduce confidence
        
        return {
            'resolved': True,
            'strategy': 'confidence_based_selection',
            'winner': winner.knowledge_id,
            'loser': loser.knowledge_id
        }
    
    async def _record_evolution_event(self, 
                                    trigger: EvolutionTrigger,
                                    strategy: EvolutionStrategy,
                                    affected_knowledge: List[str],
                                    changes_made: Dict[str, Any],
                                    duration: float = 0.0,
                                    old_knowledge: Optional[KnowledgeItem] = None,
                                    performance_before: Optional[Dict[str, float]] = None,
                                    performance_after: Optional[Dict[str, float]] = None) -> str:
        """Record an evolution event."""
        event_id = hashlib.md5(f"{trigger}_{datetime.now().isoformat()}".encode()).hexdigest()[:12]
        
        event = EvolutionEvent(
            event_id=event_id,
            trigger=trigger,
            strategy=strategy,
            affected_knowledge=affected_knowledge,
            changes_made=changes_made,
            performance_before=performance_before or {},
            performance_after=performance_after or {},
            duration=duration,
            success=True  # Simplified for now
        )
        
        self._evolution_history.append(event)
        
        return event_id
    
    def _initialize_validators(self):
        """Initialize default knowledge validators."""
        self._validators = [
            PerformanceValidator(),
            ConsistencyValidator()
        ]
    
    async def _generate_knowledge_summary(self, knowledge_items: List[KnowledgeItem]) -> Dict[str, Any]:
        """Generate summary statistics for knowledge items."""
        if not knowledge_items:
            return {}
        
        return {
            'total_items': len(knowledge_items),
            'by_type': dict(Counter(k.knowledge_type for k in knowledge_items)),
            'avg_confidence': statistics.mean([k.confidence_score for k in knowledge_items]) if knowledge_items else 0.0,
            'avg_success_rate': statistics.mean([k.success_rate for k in knowledge_items if k.usage_count > 0]) if [k for k in knowledge_items if k.usage_count > 0] else 0.0,
            'total_usage': sum(k.usage_count for k in knowledge_items),
            'avg_age_days': statistics.mean([
                (datetime.now() - k.created_at).days for k in knowledge_items
            ]) if knowledge_items else 0.0
        }
    
    async def _analyze_knowledge_quality(self, knowledge_items: List[KnowledgeItem]) -> Dict[str, Any]:
        """Analyze quality metrics of knowledge items."""
        if not knowledge_items:
            return {}
        
        high_quality = sum(1 for k in knowledge_items if k.confidence_score > 0.8)
        medium_quality = sum(1 for k in knowledge_items if 0.5 <= k.confidence_score <= 0.8)
        low_quality = sum(1 for k in knowledge_items if k.confidence_score < 0.5)
        
        return {
            'high_quality_count': high_quality,
            'medium_quality_count': medium_quality,
            'low_quality_count': low_quality,
            'quality_distribution': {
                'high': high_quality / len(knowledge_items),
                'medium': medium_quality / len(knowledge_items),
                'low': low_quality / len(knowledge_items)
            }
        }
    
    async def _analyze_usage_patterns(self, knowledge_items: List[KnowledgeItem]) -> Dict[str, Any]:
        """Analyze usage patterns of knowledge items."""
        if not knowledge_items:
            return {}
        
        used_items = [k for k in knowledge_items if k.usage_count > 0]
        
        if not used_items:
            return {'usage_rate': 0.0}
        
        usage_counts = [k.usage_count for k in used_items]
        
        return {
            'usage_rate': len(used_items) / len(knowledge_items),
            'avg_usage_count': statistics.mean(usage_counts) if usage_counts else 0.0,
            'most_used': max(used_items, key=lambda k: k.usage_count).title if used_items else 'None',
            'usage_distribution': dict(Counter(
                'high' if k.usage_count > 50 else 'medium' if k.usage_count > 10 else 'low'
                for k in used_items
            ))
        }
    
    async def _analyze_evolution_trends(self) -> Dict[str, Any]:
        """Analyze trends in knowledge evolution."""
        if not self._evolution_history:
            return {}
        
        recent_events = [
            e for e in self._evolution_history
            if (datetime.now() - e.timestamp).days <= 30
        ]
        
        return {
            'total_events': len(self._evolution_history),
            'recent_events': len(recent_events),
            'common_triggers': dict(Counter(e.trigger for e in recent_events)),
            'common_strategies': dict(Counter(e.strategy for e in recent_events)),
            'avg_evolution_duration': statistics.mean([e.duration for e in recent_events if e.duration > 0]) if [e for e in recent_events if e.duration > 0] else 0.0
        }
    
    async def _analyze_conflicts(self) -> Dict[str, Any]:
        """Analyze knowledge conflicts."""
        active_conflicts = [c for c in self._conflicts.values() if c.resolved_at is None]
        resolved_conflicts = [c for c in self._conflicts.values() if c.resolved_at is not None]
        
        return {
            'total_conflicts': len(self._conflicts),
            'active_conflicts': len(active_conflicts),
            'resolved_conflicts': len(resolved_conflicts),
            'avg_severity': statistics.mean([c.severity for c in self._conflicts.values()]) if self._conflicts else 0.0,
            'resolution_rate': len(resolved_conflicts) / len(self._conflicts) if self._conflicts else 0
        }
    
    async def _generate_improvement_recommendations(self) -> List[Dict[str, Any]]:
        """Generate recommendations for improving the knowledge base."""
        recommendations = []
        
        # Check for low-quality knowledge
        low_quality_count = sum(
            1 for k in self._knowledge_base.values()
            if k.confidence_score < 0.5
        )
        
        if low_quality_count > 0:
            recommendations.append({
                'type': 'quality_improvement',
                'description': f'Review and improve {low_quality_count} low-quality knowledge items',
                'priority': 'high'
            })
        
        # Check for conflicts
        active_conflicts = sum(
            1 for c in self._conflicts.values()
            if c.resolved_at is None
        )
        
        if active_conflicts > 0:
            recommendations.append({
                'type': 'conflict_resolution',
                'description': f'Resolve {active_conflicts} active knowledge conflicts',
                'priority': 'medium'
            })
        
        # Check for outdated knowledge
        outdated_count = sum(
            1 for k in self._knowledge_base.values()
            if (datetime.now() - k.updated_at).days > 60
        )
        
        if outdated_count > 0:
            recommendations.append({
                'type': 'knowledge_refresh',
                'description': f'Update {outdated_count} outdated knowledge items',
                'priority': 'medium'
            })
        
        return recommendations