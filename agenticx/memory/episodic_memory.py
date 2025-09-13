"""
Episodic Memory Layer

Implements the episodic memory layer for storing time-based events,
experiences, and contextual information.
"""

from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime, timedelta, UTC
import json
from dataclasses import dataclass, field
from collections import defaultdict

from .hierarchical import (
    BaseHierarchicalMemory,
    HierarchicalMemoryRecord,
    MemoryType,
    MemoryImportance,
    MemorySensitivity,
    SearchContext,
    SearchResult
)
from .base import MemoryError, MemoryRecord


@dataclass
class EpisodeEvent:
    """Represents a single event in an episode."""
    
    event_id: str
    timestamp: datetime
    event_type: str
    content: str
    metadata: Dict[str, Any] = field(default_factory=dict)
    importance: MemoryImportance = MemoryImportance.MEDIUM
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "event_id": self.event_id,
            "timestamp": self.timestamp.isoformat(),
            "event_type": self.event_type,
            "content": self.content,
            "metadata": self.metadata,
            "importance": self.importance.value
        }


@dataclass
class Episode:
    """Represents a collection of related events."""
    
    episode_id: str
    title: str
    start_time: datetime
    end_time: Optional[datetime] = None
    events: List[EpisodeEvent] = field(default_factory=list)
    summary: Optional[str] = None
    tags: List[str] = field(default_factory=list)
    importance: MemoryImportance = MemoryImportance.MEDIUM
    
    def add_event(self, event: EpisodeEvent):
        """Add an event to the episode."""
        self.events.append(event)
        
        # Update end time
        if not self.end_time or event.timestamp > self.end_time:
            self.end_time = event.timestamp
    
    def get_duration(self) -> Optional[timedelta]:
        """Get episode duration."""
        if self.end_time:
            return self.end_time - self.start_time
        return None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "episode_id": self.episode_id,
            "title": self.title,
            "start_time": self.start_time.isoformat(),
            "end_time": self.end_time.isoformat() if self.end_time else None,
            "events": [event.to_dict() for event in self.events],
            "summary": self.summary,
            "tags": self.tags,
            "importance": self.importance.value
        }


class EpisodicMemory(BaseHierarchicalMemory):
    """
    Episodic Memory Layer
    
    Manages time-based events and experiences, organized as episodes.
    Supports temporal queries and automatic episode grouping.
    """
    
    def __init__(self, tenant_id: str, agent_id: str, **kwargs):
        super().__init__(tenant_id, MemoryType.EPISODIC, **kwargs)
        self.agent_id = agent_id
        self._episodic_records: Dict[str, HierarchicalMemoryRecord] = {}
        self._episodes: Dict[str, Episode] = {}
        self._time_index: Dict[str, List[str]] = defaultdict(list)  # date -> record_ids
        self._event_index: Dict[str, List[str]] = defaultdict(list)  # event_type -> record_ids
        self._keyword_index: Dict[str, List[str]] = defaultdict(list)  # keyword -> record_ids
        
        # Configuration
        self.episode_gap_threshold = kwargs.get('episode_gap_threshold', timedelta(hours=2))
        self.auto_summarize_threshold = kwargs.get('auto_summarize_threshold', 10)
    
    async def add_event(
        self,
        event_type: str,
        content: str,
        timestamp: Optional[datetime] = None,
        metadata: Optional[Dict[str, Any]] = None,
        importance: MemoryImportance = MemoryImportance.MEDIUM,
        sensitivity: MemorySensitivity = MemorySensitivity.INTERNAL,
        episode_id: Optional[str] = None
    ) -> str:
        """
        Add a new event to episodic memory.
        
        Args:
            event_type: Type of event (e.g., 'conversation', 'task', 'error')
            content: Event content/description
            timestamp: Event timestamp (defaults to now)
            metadata: Additional metadata
            importance: Event importance level
            sensitivity: Event sensitivity level
            episode_id: Optional episode ID to add to
            
        Returns:
            Record ID
        """
        if timestamp is None:
            timestamp = datetime.now(UTC)
        
        # Create event
        event = EpisodeEvent(
            event_id=self._generate_record_id(),
            timestamp=timestamp,
            event_type=event_type,
            content=content,
            metadata=metadata or {},
            importance=importance
        )
        
        # Find or create episode
        if episode_id:
            episode = self._episodes.get(episode_id)
            if not episode:
                raise MemoryError(f"Episode {episode_id} not found")
        else:
            episode = await self._find_or_create_episode(event)
        
        # Add event to episode
        episode.add_event(event)
        
        # Create memory record
        record_content = f"Event: {event_type} at {timestamp.isoformat()}\n{content}"
        record_metadata = {
            "type": "episodic_event",
            "event_type": event_type,
            "episode_id": episode.episode_id,
            "timestamp": timestamp.isoformat(),
            "event_data": event.to_dict()
        }
        
        if metadata:
            record_metadata.update(metadata)
        
        record_id = await self.add(
            content=record_content,
            metadata=record_metadata,
            importance=importance,
            sensitivity=sensitivity,
            source="episodic_system"
        )
        
        # Update episode summary if needed
        if len(episode.events) >= self.auto_summarize_threshold:
            await self._update_episode_summary(episode)
        
        return record_id
    
    async def create_episode(
        self,
        title: str,
        start_time: Optional[datetime] = None,
        tags: Optional[List[str]] = None,
        importance: MemoryImportance = MemoryImportance.MEDIUM
    ) -> str:
        """
        Create a new episode.
        
        Args:
            title: Episode title
            start_time: Start time (defaults to now)
            tags: Optional tags
            importance: Episode importance
            
        Returns:
            Episode ID
        """
        if start_time is None:
            start_time = datetime.now(UTC)
        
        episode_id = self._generate_record_id()
        episode = Episode(
            episode_id=episode_id,
            title=title,
            start_time=start_time,
            tags=tags or [],
            importance=importance
        )
        
        self._episodes[episode_id] = episode
        
        # Create memory record for the episode
        await self.add(
            content=f"Episode: {title}",
            metadata={
                "type": "episode",
                "episode_id": episode_id,
                "episode_data": episode.to_dict()
            },
            importance=importance,
            sensitivity=MemorySensitivity.INTERNAL,
            source="episodic_system"
        )
        
        return episode_id
    
    async def get_episode(self, episode_id: str) -> Optional[Episode]:
        """Get an episode by ID."""
        return self._episodes.get(episode_id)
    
    async def get_episodes_by_time_range(
        self,
        start_time: datetime,
        end_time: datetime
    ) -> List[Episode]:
        """Get episodes within a time range."""
        episodes = []
        for episode in self._episodes.values():
            if (episode.start_time <= end_time and 
                (not episode.end_time or episode.end_time >= start_time)):
                episodes.append(episode)
        
        return sorted(episodes, key=lambda e: e.start_time)
    
    async def get_recent_episodes(self, limit: int = 10) -> List[Episode]:
        """Get recent episodes."""
        episodes = sorted(self._episodes.values(), key=lambda e: e.start_time, reverse=False)
        return episodes[:limit]
    
    async def search_events_by_type(
        self,
        event_type: str,
        limit: int = 20,
        time_range: Optional[Tuple[datetime, datetime]] = None
    ) -> List[EpisodeEvent]:
        """Search events by type."""
        events = []
        
        for episode in self._episodes.values():
            for event in episode.events:
                if event.event_type == event_type:
                    # Apply time filter if provided
                    if time_range:
                        if not (time_range[0] <= event.timestamp <= time_range[1]):
                            continue
                    events.append(event)
        
        # Sort by timestamp (newest first)
        events.sort(key=lambda e: e.timestamp, reverse=True)
        return events[:limit]
    
    async def get_timeline(
        self,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        limit: int = 100
    ) -> List[EpisodeEvent]:
        """Get chronological timeline of events."""
        all_events = []
        
        for episode in self._episodes.values():
            all_events.extend(episode.events)
        
        # Apply time filters
        if start_time or end_time:
            filtered_events = []
            for event in all_events:
                if start_time and event.timestamp < start_time:
                    continue
                if end_time and event.timestamp > end_time:
                    continue
                filtered_events.append(event)
            all_events = filtered_events
        
        # Sort by timestamp
        all_events.sort(key=lambda e: e.timestamp)
        return all_events[:limit]
    
    async def _find_or_create_episode(self, event: EpisodeEvent) -> Episode:
        """Find existing episode or create new one for event."""
        # Find recent episodes that might be related
        recent_episodes = sorted(self._episodes.values(), key=lambda e: e.start_time, reverse=True)
        
        for episode in recent_episodes:
            # Check if we can add this event to the existing episode
            if episode.events:
                # Calculate time gap from the last event in this episode
                last_event_time = max(e.timestamp for e in episode.events)
                time_gap = event.timestamp - last_event_time
                
                # If the time gap is within threshold, add to this episode
                if time_gap <= self.episode_gap_threshold:
                    return episode
            else:
                # Empty episode - check against start time
                time_gap = event.timestamp - episode.start_time
                if time_gap <= self.episode_gap_threshold:
                    return episode
        
        # Create new episode
        episode_title = f"Episode: {event.event_type} at {event.timestamp.strftime('%Y-%m-%d %H:%M')}"
        episode_id = await self.create_episode(
            title=episode_title,
            start_time=event.timestamp,
            importance=event.importance
        )
        
        return self._episodes[episode_id]
    
    async def _update_episode_summary(self, episode: Episode):
        """Update episode summary based on events."""
        if not episode.events:
            return
        
        # Simple summarization logic
        event_types = set(event.event_type for event in episode.events)
        duration = episode.get_duration()
        
        summary_parts = []
        summary_parts.append(f"Episode with {len(episode.events)} events")
        summary_parts.append(f"Event types: {', '.join(event_types)}")
        
        if duration:
            summary_parts.append(f"Duration: {duration}")
        
        # Add most important events
        important_events = [e for e in episode.events if e.importance.value >= MemoryImportance.HIGH.value]
        if important_events:
            summary_parts.append(f"Key events: {len(important_events)}")
        
        episode.summary = "; ".join(summary_parts)
        
        # Update episode record
        await self._update_episode_record(episode)
    
    async def _update_episode_record(self, episode: Episode):
        """Update the memory record for an episode."""
        episode_records = await self.search(
            f"episode_id:{episode.episode_id}",
            metadata_filter={"type": "episode"}
        )
        
        if episode_records:
            record_id = episode_records[0].record.id
            await self.update(
                record_id,
                content=f"Episode: {episode.title}",
                metadata={
                    "type": "episode",
                    "episode_id": episode.episode_id,
                    "episode_data": episode.to_dict()
                }
            )
    
    async def _store_record(self, record: HierarchicalMemoryRecord):
        """Store a hierarchical memory record."""
        self._episodic_records[record.id] = record
        
        # Update time index
        date_key = record.created_at.date().isoformat()
        if record.id not in self._time_index[date_key]:
            self._time_index[date_key].append(record.id)
        
        # Update event type index
        event_type = record.metadata.get("event_type")
        if event_type and record.id not in self._event_index[event_type]:
            self._event_index[event_type].append(record.id)
        
        # Update keyword index
        keywords = self._extract_keywords(record.content)
        for keyword in keywords:
            if record.id not in self._keyword_index[keyword]:
                self._keyword_index[keyword].append(record.id)
    
    async def _hierarchical_search(
        self,
        query: str,
        context: SearchContext,
        limit: int,
        min_score: float
    ) -> List[SearchResult]:
        """Perform hierarchical search with temporal context."""
        results = []
        
        # Handle temporal queries
        if context.query_type == "temporal" and context.time_range:
            start_date = context.time_range[0].date().isoformat()
            end_date = context.time_range[1].date().isoformat()
            
            candidate_ids = set()
            current_date = context.time_range[0].date()
            while current_date <= context.time_range[1].date():
                date_key = current_date.isoformat()
                if date_key in self._time_index:
                    candidate_ids.update(self._time_index[date_key])
                current_date += timedelta(days=1)
        else:
            # Regular keyword search
            query_keywords = self._extract_keywords(query)
            candidate_ids = set()
            for keyword in query_keywords:
                if keyword in self._keyword_index:
                    candidate_ids.update(self._keyword_index[keyword])
        
        # Score and filter results
        for record_id in candidate_ids:
            record = self._episodic_records.get(record_id)
            if not record:
                continue
            
            # Apply filters
            if context.time_range:
                if not (context.time_range[0] <= record.created_at <= context.time_range[1]):
                    continue
            
            if context.importance_threshold:
                if record.importance.value < context.importance_threshold.value:
                    continue
            
            if context.max_age:
                if datetime.now(UTC) - record.created_at > context.max_age:
                    continue
            
            if not context.include_decayed and record.decay_factor < 0.5:
                continue
            
            # Calculate score
            score = self._calculate_temporal_score(record, query, context)
            
            if score >= min_score:
                results.append(SearchResult(record=record, score=score))
        
        # Sort and return top results
        results.sort(key=lambda r: r.score, reverse=True)
        return results[:limit]
    
    def _calculate_temporal_score(
        self,
        record: HierarchicalMemoryRecord,
        query: str,
        context: SearchContext
    ) -> float:
        """Calculate score with temporal relevance."""
        # Base keyword score
        query_keywords = self._extract_keywords(query)
        record_keywords = self._extract_keywords(record.content)
        
        if query_keywords:
            keyword_matches = len(set(query_keywords) & set(record_keywords))
            keyword_score = keyword_matches / len(query_keywords)
        else:
            keyword_score = 0.5  # Default score for non-keyword queries
        
        # Temporal relevance
        if context.time_range:
            # Events closer to query time range get higher scores
            query_center = context.time_range[0] + (context.time_range[1] - context.time_range[0]) / 2
            time_diff = abs((record.created_at - query_center).total_seconds())
            max_time_diff = (context.time_range[1] - context.time_range[0]).total_seconds()
            
            if max_time_diff > 0:
                temporal_score = 1 - (time_diff / max_time_diff)
            else:
                temporal_score = 1.0
        else:
            # Recency bonus
            age_hours = (datetime.now(UTC) - record.created_at).total_seconds() / 3600
            temporal_score = max(0, 1 - (age_hours / (24 * 7)))  # Fades over a week
        
        # Importance multiplier
        importance_multiplier = record.importance.value / 4.0
        
        # Combine scores
        final_score = (keyword_score * 0.4 + temporal_score * 0.6) * importance_multiplier
        
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
        if record_id in self._episodic_records:
            record = self._episodic_records[record_id]
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
            query_type="temporal",
            memory_types=[MemoryType.EPISODIC]
        )
        
        results = await self._hierarchical_search(query, context, limit, min_score)
        
        # Apply metadata filter if provided
        if metadata_filter:
            filtered_results = []
            for result in results:
                if self._matches_metadata_filter(result.record.metadata, metadata_filter):
                    filtered_results.append(result)
            results = filtered_results
        
        return results
    
    def _matches_metadata_filter(self, metadata: Dict[str, Any], filter_dict: Dict[str, Any]) -> bool:
        """Check if metadata matches the filter."""
        for key, value in filter_dict.items():
            if key not in metadata or metadata[key] != value:
                return False
        return True
    
    async def update(
        self,
        record_id: str,
        content: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> bool:
        """Update an existing memory record."""
        if record_id not in self._episodic_records:
            return False
        
        record = self._episodic_records[record_id]
        
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
        if record_id not in self._episodic_records:
            return False
        
        record = self._episodic_records[record_id]
        
        # Remove from indices
        date_key = record.created_at.date().isoformat()
        if date_key in self._time_index and record_id in self._time_index[date_key]:
            self._time_index[date_key].remove(record_id)
        
        event_type = record.metadata.get("event_type")
        if event_type and record_id in self._event_index[event_type]:
            self._event_index[event_type].remove(record_id)
        
        keywords = self._extract_keywords(record.content)
        for keyword in keywords:
            if record_id in self._keyword_index[keyword]:
                self._keyword_index[keyword].remove(record_id)
        
        # Remove record
        del self._episodic_records[record_id]
        
        return True
    
    async def get(self, record_id: str) -> Optional[MemoryRecord]:
        """Get a specific memory record by ID."""
        record = self._episodic_records.get(record_id)
        return record  # type: ignore
    
    async def list_all(
        self,
        limit: int = 100,
        offset: int = 0,
        metadata_filter: Optional[Dict[str, Any]] = None
    ) -> List[MemoryRecord]:
        """List all memory records for the current tenant."""
        all_records: List[MemoryRecord] = list(self._episodic_records.values())
        
        # Apply metadata filter
        if metadata_filter:
            filtered_records = []
            for record in all_records:
                if self._matches_metadata_filter(record.metadata, metadata_filter):
                    filtered_records.append(record)
            all_records = filtered_records
        
        # Sort by creation time (newest first)
        all_records.sort(key=lambda r: r.created_at, reverse=True)  # type: ignore
        
        # Apply pagination
        start = offset
        end = offset + limit
        return all_records[start:end]  # type: ignore
    
    async def clear(self) -> int:
        """Clear all memory records for the current tenant."""
        count = len(self._episodic_records)
        self._episodic_records.clear()
        self._episodes.clear()
        self._time_index.clear()
        self._event_index.clear()
        self._keyword_index.clear()
        return count 