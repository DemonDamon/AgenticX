"""
Memory Decay Service

Implements memory decay algorithms and optimization strategies
for intelligent memory lifecycle management.
"""

from typing import Any, Dict, List, Optional, Tuple, Callable
from datetime import datetime, timedelta, UTC
from dataclasses import dataclass, field
from enum import Enum
import math
import asyncio
import json

from .hierarchical import (
    HierarchicalMemoryRecord,
    MemoryType,
    MemoryImportance,
    MemorySensitivity
)
from .base import MemoryError


class DecayStrategy(Enum):
    """Memory decay strategies."""
    
    EXPONENTIAL = "exponential"
    LINEAR = "linear"
    LOGARITHMIC = "logarithmic"
    CUSTOM = "custom"


@dataclass
class DecayParameters:
    """Parameters for memory decay calculation."""
    
    strategy: DecayStrategy = DecayStrategy.EXPONENTIAL
    base_decay_rate: float = 0.1  # Base decay rate per day
    importance_multiplier: float = 2.0  # Multiplier for importance
    access_boost: float = 0.1  # Boost per access
    recency_window: timedelta = timedelta(days=7)  # Recent memory protection
    min_decay_factor: float = 0.1  # Minimum decay factor
    max_decay_factor: float = 1.0  # Maximum decay factor
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "strategy": self.strategy.value,
            "base_decay_rate": self.base_decay_rate,
            "importance_multiplier": self.importance_multiplier,
            "access_boost": self.access_boost,
            "recency_window": self.recency_window.total_seconds(),
            "min_decay_factor": self.min_decay_factor,
            "max_decay_factor": self.max_decay_factor
        }


@dataclass
class DecayAnalysis:
    """Analysis of memory decay for a record."""
    
    record_id: str
    current_decay_factor: float
    predicted_decay_factor: float
    days_until_threshold: Optional[int]
    decay_factors: Dict[str, float]  # Component decay factors
    recommendations: List[str]
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "record_id": self.record_id,
            "current_decay_factor": self.current_decay_factor,
            "predicted_decay_factor": self.predicted_decay_factor,
            "days_until_threshold": self.days_until_threshold,
            "decay_factors": self.decay_factors,
            "recommendations": self.recommendations
        }


class MemoryDecayService:
    """
    Memory decay service that implements intelligent memory lifecycle management.
    
    Handles memory decay, importance evaluation, and cleanup strategies.
    """
    
    def __init__(
        self,
        tenant_id: str,
        decay_params: Optional[DecayParameters] = None,
        **kwargs
    ):
        self.tenant_id = tenant_id
        self.decay_params = decay_params or DecayParameters()
        
        # Decay history tracking
        self._decay_history: Dict[str, List[Tuple[datetime, float]]] = {}
        self._last_decay_run: Optional[datetime] = None
        
        # Custom decay functions
        self._custom_decay_functions: Dict[str, Callable] = {}
        
        # Configuration
        self.cleanup_threshold = kwargs.get('cleanup_threshold', 0.1)
        self.batch_size = kwargs.get('batch_size', 100)
        self.decay_interval = kwargs.get('decay_interval', timedelta(hours=1))
    
    async def calculate_decay_factor(
        self,
        record: HierarchicalMemoryRecord,
        current_time: Optional[datetime] = None
    ) -> float:
        """
        Calculate current decay factor for a memory record.
        
        Args:
            record: Memory record to analyze
            current_time: Current time (defaults to now)
            
        Returns:
            Decay factor between 0 and 1
        """
        if current_time is None:
            current_time = datetime.now(UTC)
        
        # Calculate age
        age = current_time - record.created_at
        age_days = age.total_seconds() / (24 * 3600)
        
        # Calculate base decay
        base_decay = self._calculate_base_decay(age_days)
        
        # Apply importance multiplier
        importance_factor = self._calculate_importance_factor(record)
        
        # Apply access boost
        access_factor = self._calculate_access_factor(record)
        
        # Apply recency protection
        recency_factor = self._calculate_recency_factor(record, current_time)
        
        # Apply memory type specific factors
        type_factor = self._calculate_type_factor(record)
        
        # Calculate final decay factor
        raw_decay = base_decay * importance_factor * access_factor * recency_factor * type_factor
        
        # Clamp to valid range
        decay_factor = max(
            self.decay_params.min_decay_factor,
            min(self.decay_params.max_decay_factor, raw_decay)
        )
        
        return decay_factor
    
    async def analyze_decay(
        self,
        record: HierarchicalMemoryRecord,
        prediction_days: int = 30
    ) -> DecayAnalysis:
        """
        Analyze memory decay for a record with predictions.
        
        Args:
            record: Memory record to analyze
            prediction_days: Days to predict ahead
            
        Returns:
            Decay analysis results
        """
        current_time = datetime.now(UTC)
        current_decay = await self.calculate_decay_factor(record, current_time)
        
        # Predict future decay
        future_time = current_time + timedelta(days=prediction_days)
        predicted_decay = await self.calculate_decay_factor(record, future_time)
        
        # Calculate days until threshold
        days_until_threshold = await self._calculate_days_until_threshold(
            record, current_time, self.cleanup_threshold
        )
        
        # Calculate component decay factors
        age = current_time - record.created_at
        age_days = age.total_seconds() / (24 * 3600)
        
        decay_factors = {
            "base_decay": self._calculate_base_decay(age_days),
            "importance_factor": self._calculate_importance_factor(record),
            "access_factor": self._calculate_access_factor(record),
            "recency_factor": self._calculate_recency_factor(record, current_time),
            "type_factor": self._calculate_type_factor(record)
        }
        
        # Generate recommendations
        recommendations = self._generate_recommendations(record, decay_factors)
        
        return DecayAnalysis(
            record_id=record.id,
            current_decay_factor=current_decay,
            predicted_decay_factor=predicted_decay,
            days_until_threshold=days_until_threshold,
            decay_factors=decay_factors,
            recommendations=recommendations
        )
    
    async def update_decay_factors(
        self,
        records: List[HierarchicalMemoryRecord],
        current_time: Optional[datetime] = None
    ) -> Dict[str, float]:
        """
        Update decay factors for multiple records.
        
        Args:
            records: List of memory records
            current_time: Current time (defaults to now)
            
        Returns:
            Dictionary of record_id -> new_decay_factor
        """
        if current_time is None:
            current_time = datetime.now(UTC)
        
        updated_factors = {}
        
        for record in records:
            new_decay_factor = await self.calculate_decay_factor(record, current_time)
            
            # Update record
            record.decay_factor = new_decay_factor
            record.updated_at = current_time
            
            # Track history
            if record.id not in self._decay_history:
                self._decay_history[record.id] = []
            
            self._decay_history[record.id].append((current_time, new_decay_factor))
            
            # Keep only recent history
            cutoff_time = current_time - timedelta(days=30)
            self._decay_history[record.id] = [
                (time, factor) for time, factor in self._decay_history[record.id]
                if time > cutoff_time
            ]
            
            updated_factors[record.id] = new_decay_factor
        
        self._last_decay_run = current_time
        return updated_factors
    
    async def get_decaying_records(
        self,
        records: List[HierarchicalMemoryRecord],
        threshold: Optional[float] = None
    ) -> List[HierarchicalMemoryRecord]:
        """
        Get records that are decaying below threshold.
        
        Args:
            records: List of memory records to check
            threshold: Decay threshold (defaults to cleanup_threshold)
            
        Returns:
            List of decaying records
        """
        # Ensure threshold is not None
        effective_threshold: float = threshold if threshold is not None else self.cleanup_threshold
        
        decaying_records = []
        current_time = datetime.now(UTC)
        
        for record in records:
            decay_factor = await self.calculate_decay_factor(record, current_time)
            if decay_factor < effective_threshold:
                decaying_records.append(record)
        
        return decaying_records
    
    async def suggest_cleanup_candidates(
        self,
        records: List[HierarchicalMemoryRecord],
        max_candidates: int = 100
    ) -> List[Tuple[HierarchicalMemoryRecord, float, str]]:
        """
        Suggest records for cleanup based on decay analysis.
        
        Args:
            records: List of memory records
            max_candidates: Maximum number of candidates
            
        Returns:
            List of (record, decay_factor, reason) tuples
        """
        candidates = []
        current_time = datetime.now(UTC)
        
        for record in records:
            decay_factor = await self.calculate_decay_factor(record, current_time)
            
            # Skip if above threshold
            if decay_factor >= self.cleanup_threshold:
                continue
            
            # Determine cleanup reason
            reason = self._determine_cleanup_reason(record, decay_factor)
            
            candidates.append((record, decay_factor, reason))
        
        # Sort by decay factor (lowest first)
        candidates.sort(key=lambda x: x[1])
        
        return candidates[:max_candidates]
    
    async def boost_memory_importance(
        self,
        record: HierarchicalMemoryRecord,
        boost_factor: float = 0.2
    ) -> float:
        """
        Boost memory importance to prevent decay.
        
        Args:
            record: Memory record to boost
            boost_factor: Boost amount (0-1)
            
        Returns:
            New decay factor
        """
        # Increase decay factor
        new_decay_factor = min(
            self.decay_params.max_decay_factor,
            record.decay_factor + boost_factor
        )
        
        record.decay_factor = new_decay_factor
        record.updated_at = datetime.now(UTC)
        
        # Track boost in history
        if record.id not in self._decay_history:
            self._decay_history[record.id] = []
        
        self._decay_history[record.id].append((datetime.now(UTC), new_decay_factor))
        
        return new_decay_factor
    
    def register_custom_decay_function(
        self,
        name: str,
        decay_function: Callable[[HierarchicalMemoryRecord, datetime], float]
    ):
        """
        Register a custom decay function.
        
        Args:
            name: Function name
            decay_function: Function that takes (record, current_time) and returns decay factor
        """
        self._custom_decay_functions[name] = decay_function
    
    def _calculate_base_decay(self, age_days: float) -> float:
        """Calculate base decay based on age."""
        if age_days <= 0:
            return 1.0
        
        if self.decay_params.strategy == DecayStrategy.EXPONENTIAL:
            return math.exp(-self.decay_params.base_decay_rate * age_days)
        
        elif self.decay_params.strategy == DecayStrategy.LINEAR:
            return max(0, 1.0 - (self.decay_params.base_decay_rate * age_days))
        
        elif self.decay_params.strategy == DecayStrategy.LOGARITHMIC:
            return 1.0 / (1.0 + self.decay_params.base_decay_rate * math.log(age_days + 1))
        
        else:
            # Default to exponential
            return math.exp(-self.decay_params.base_decay_rate * age_days)
    
    def _calculate_importance_factor(self, record: HierarchicalMemoryRecord) -> float:
        """Calculate importance factor multiplier."""
        importance_value = record.importance.value
        
        # Higher importance = slower decay
        factor = 1.0 + (importance_value - 1) * (self.decay_params.importance_multiplier - 1) / 3
        
        return factor
    
    def _calculate_access_factor(self, record: HierarchicalMemoryRecord) -> float:
        """Calculate access factor boost."""
        access_count = record.access_count
        
        # More accesses = slower decay
        factor = 1.0 + (access_count * self.decay_params.access_boost)
        
        return factor
    
    def _calculate_recency_factor(self, record: HierarchicalMemoryRecord, current_time: datetime) -> float:
        """Calculate recency protection factor."""
        if not record.last_accessed:
            return 1.0
        
        time_since_access = current_time - record.last_accessed
        
        # Protect recent memories
        if time_since_access < self.decay_params.recency_window:
            protection_ratio = 1.0 - (time_since_access / self.decay_params.recency_window)
            return 1.0 + protection_ratio
        
        return 1.0
    
    def _calculate_type_factor(self, record: HierarchicalMemoryRecord) -> float:
        """Calculate memory type specific factor."""
        # Different memory types have different decay rates
        type_factors = {
            MemoryType.CORE: 2.0,      # Core memories decay very slowly
            MemoryType.SEMANTIC: 1.5,  # Semantic memories decay slowly
            MemoryType.PROCEDURAL: 1.3, # Procedural memories are fairly stable
            MemoryType.EPISODIC: 1.0,  # Episodic memories decay normally
            MemoryType.RESOURCE: 0.8,  # Resource memories decay faster
            MemoryType.KNOWLEDGE: 1.8  # Knowledge vault is protected
        }
        
        return type_factors.get(record.memory_type, 1.0)
    
    async def _calculate_days_until_threshold(
        self,
        record: HierarchicalMemoryRecord,
        current_time: datetime,
        threshold: float
    ) -> Optional[int]:
        """Calculate days until decay factor reaches threshold."""
        current_decay = await self.calculate_decay_factor(record, current_time)
        
        if current_decay <= threshold:
            return 0
        
        # Binary search for threshold crossing
        low, high = 0, 365  # Search up to 1 year
        
        while low < high:
            mid = (low + high) // 2
            future_time = current_time + timedelta(days=mid)
            future_decay = await self.calculate_decay_factor(record, future_time)
            
            if future_decay <= threshold:
                high = mid
            else:
                low = mid + 1
        
        return low if low < 365 else None
    
    def _determine_cleanup_reason(self, record: HierarchicalMemoryRecord, decay_factor: float) -> str:
        """Determine reason for cleanup suggestion."""
        reasons = []
        
        age_days = (datetime.now(UTC) - record.created_at).total_seconds() / (24 * 3600)
        
        if age_days > 90:
            reasons.append("old age")
        
        if record.access_count == 0:
            reasons.append("never accessed")
        
        if decay_factor < 0.05:
            reasons.append("extremely low relevance")
        
        if record.importance == MemoryImportance.LOW:
            reasons.append("low importance")
        
        if not reasons:
            reasons.append("natural decay")
        
        return ", ".join(reasons)
    
    def _generate_recommendations(
        self,
        record: HierarchicalMemoryRecord,
        decay_factors: Dict[str, float]
    ) -> List[str]:
        """Generate recommendations based on decay analysis."""
        recommendations = []
        
        # Check individual factors
        if decay_factors["base_decay"] < 0.5:
            recommendations.append("Consider archiving due to age")
        
        if decay_factors["access_factor"] < 1.1:
            recommendations.append("Memory rarely accessed - consider removal")
        
        if decay_factors["importance_factor"] < 1.2:
            recommendations.append("Consider upgrading importance level")
        
        if record.memory_type == MemoryType.EPISODIC and decay_factors["recency_factor"] < 1.1:
            recommendations.append("Episodic memory becoming stale")
        
        if record.access_count > 10 and decay_factors["base_decay"] < 0.7:
            recommendations.append("High-access memory aging - consider refreshing")
        
        # Overall recommendations
        overall_decay = (
            decay_factors["base_decay"] *
            decay_factors["importance_factor"] *
            decay_factors["access_factor"] *
            decay_factors["recency_factor"] *
            decay_factors["type_factor"]
        )
        
        if overall_decay < 0.1:
            recommendations.append("Recommend immediate cleanup")
        elif overall_decay < 0.3:
            recommendations.append("Schedule for future cleanup")
        elif overall_decay > 0.8:
            recommendations.append("Memory is well-maintained")
        
        return recommendations
    
    async def get_decay_statistics(
        self,
        records: List[HierarchicalMemoryRecord]
    ) -> Dict[str, Any]:
        """Get decay statistics for a set of records."""
        if not records:
            return {}
        
        current_time = datetime.now(UTC)
        decay_factors = []
        
        for record in records:
            decay_factor = await self.calculate_decay_factor(record, current_time)
            decay_factors.append(decay_factor)
        
        # Calculate statistics
        stats = {
            "total_records": len(records),
            "avg_decay_factor": sum(decay_factors) / len(decay_factors),
            "min_decay_factor": min(decay_factors),
            "max_decay_factor": max(decay_factors),
            "records_below_threshold": sum(1 for f in decay_factors if f < self.cleanup_threshold),
            "decay_distribution": {
                "healthy": sum(1 for f in decay_factors if f >= 0.7),
                "aging": sum(1 for f in decay_factors if 0.3 <= f < 0.7),
                "decaying": sum(1 for f in decay_factors if f < 0.3)
            },
            "by_memory_type": {},
            "by_importance": {}
        }
        
        # Statistics by memory type
        type_stats = {}
        for record in records:
            memory_type = record.memory_type.value
            if memory_type not in type_stats:
                type_stats[memory_type] = []
            
            decay_factor = await self.calculate_decay_factor(record, current_time)
            type_stats[memory_type].append(decay_factor)
        
        for memory_type, factors in type_stats.items():
            stats["by_memory_type"][memory_type] = {
                "count": len(factors),
                "avg_decay": sum(factors) / len(factors),
                "min_decay": min(factors),
                "max_decay": max(factors)
            }
        
        # Statistics by importance
        importance_stats = {}
        for record in records:
            importance = record.importance.value
            if importance not in importance_stats:
                importance_stats[importance] = []
            
            decay_factor = await self.calculate_decay_factor(record, current_time)
            importance_stats[importance].append(decay_factor)
        
        for importance, factors in importance_stats.items():
            stats["by_importance"][importance] = {
                "count": len(factors),
                "avg_decay": sum(factors) / len(factors),
                "min_decay": min(factors),
                "max_decay": max(factors)
            }
        
        return stats 