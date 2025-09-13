"""Task Synthesizer Component

This module implements the TaskSynthesizer component that synthesizes new task patterns
from observed user behaviors and interactions.
"""

from typing import List, Dict, Any, Optional, Tuple
from pydantic import BaseModel, Field
from datetime import datetime, timedelta, UTC
import json
from collections import defaultdict, Counter

from agenticx.core.component import Component
from agenticx.memory.component import MemoryComponent
from agenticx.embodiment.core.task import GUITask


class TaskPattern(BaseModel):
    """Represents a synthesized task pattern."""
    
    pattern_id: str = Field(description="Unique identifier for the pattern")
    name: str = Field(description="Human-readable name for the pattern")
    description: str = Field(description="Description of what the pattern does")
    action_sequence: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Sequence of actions that define the pattern"
    )
    preconditions: List[str] = Field(
        default_factory=list,
        description="Conditions that must be met before executing the pattern"
    )
    postconditions: List[str] = Field(
        default_factory=list,
        description="Expected outcomes after executing the pattern"
    )
    frequency: int = Field(default=1, description="How often this pattern has been observed")
    success_rate: float = Field(default=0.0, description="Success rate of the pattern")
    confidence_score: float = Field(default=0.0, description="Confidence in the pattern validity")
    applications: List[str] = Field(
        default_factory=list,
        description="Applications where this pattern is applicable"
    )
    variations: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Known variations of this pattern"
    )
    metadata: Dict[str, Any] = Field(
        default_factory=dict,
        description="Additional metadata about the pattern"
    )
    created_at: datetime = Field(
        default_factory=datetime.now,
        description="When the pattern was first synthesized"
    )
    last_updated: datetime = Field(
        default_factory=datetime.now,
        description="When the pattern was last updated"
    )


class SynthesisConfig(BaseModel):
    """Configuration for task synthesis."""
    
    min_frequency_threshold: int = Field(
        default=3,
        description="Minimum frequency to consider a pattern valid"
    )
    min_confidence_threshold: float = Field(
        default=0.7,
        description="Minimum confidence score to accept a pattern"
    )
    max_action_sequence_length: int = Field(
        default=20,
        description="Maximum length of action sequences to consider"
    )
    similarity_threshold: float = Field(
        default=0.8,
        description="Threshold for considering two patterns similar"
    )
    time_window_hours: int = Field(
        default=24,
        description="Time window for grouping related actions"
    )
    enable_pattern_merging: bool = Field(
        default=True,
        description="Whether to merge similar patterns"
    )
    enable_variation_detection: bool = Field(
        default=True,
        description="Whether to detect pattern variations"
    )


class TaskSynthesizer(Component):
    """Task Synthesizer Component
    
    Synthesizes new task patterns from observed user behaviors and interactions,
    creating reusable task templates for automation.
    """
    
    def __init__(self, name: Optional[str] = None, **kwargs):
        """Initialize the TaskSynthesizer.
        
        Args:
            name: Optional component name
            **kwargs: Additional configuration options
        """
        super().__init__(name=name, **kwargs)
        self._config = SynthesisConfig(**kwargs.get('synthesis_config', {}))
        self._known_patterns: Dict[str, TaskPattern] = {}
        self._action_sequences: List[List[Dict[str, Any]]] = []
    
    async def synthesize_patterns_from_memory(self, 
                                            memory: MemoryComponent,
                                            app_name: Optional[str] = None,
                                            time_range: Optional[Tuple[datetime, datetime]] = None) -> List[TaskPattern]:
        """Synthesize task patterns from memory data.
        
        Args:
            memory: Memory component containing user interaction data
            app_name: Optional app name to filter patterns for
            time_range: Optional time range to consider
            
        Returns:
            List of synthesized task patterns
        """
        # Build search query
        query_parts = ["user interaction", "action sequence", "task execution"]
        if app_name:
            query_parts.append(app_name)
        
        search_query = " ".join(query_parts)
        
        # Build metadata filter
        metadata_filter = {}
        if app_name:
            metadata_filter['app_name'] = app_name
        
        # Search for relevant memories
        memories = await memory.search_across_memories(
            query=search_query,
            limit=500,
            metadata_filter=metadata_filter if metadata_filter else None
        )
        
        # Filter by time range if specified
        if time_range:
            start_time, end_time = time_range
            memories = [
                mem for mem in memories
                if self._is_within_time_range(mem.record.metadata.get('timestamp'), start_time, end_time)
            ]
        
        # Extract action sequences from memories
        action_sequences = await self._extract_action_sequences(memories)
        
        # Group related sequences
        grouped_sequences = await self._group_related_sequences(action_sequences)
        
        # Synthesize patterns from groups
        synthesized_patterns = []
        for group in grouped_sequences:
            pattern = await self._synthesize_pattern_from_group(group)
            if pattern and await self._validate_pattern(pattern):
                synthesized_patterns.append(pattern)
        
        # Merge similar patterns if enabled
        if self._config.enable_pattern_merging:
            synthesized_patterns = await self._merge_similar_patterns(synthesized_patterns)
        
        # Detect variations if enabled
        if self._config.enable_variation_detection:
            for pattern in synthesized_patterns:
                pattern.variations = await self._detect_pattern_variations(pattern, action_sequences)
        
        # Update known patterns
        for pattern in synthesized_patterns:
            self._known_patterns[pattern.pattern_id] = pattern
        
        return synthesized_patterns
    
    async def create_task_from_pattern(self, pattern: TaskPattern, **task_params) -> GUITask:
        """Create a GUITask from a synthesized pattern.
        
        Args:
            pattern: The task pattern to convert
            **task_params: Additional parameters for task creation
            
        Returns:
            GUITask instance based on the pattern
        """
        # Extract target application
        target_app = pattern.applications[0] if pattern.applications else "unknown"
        
        # Build task parameters
        task_config = {
            'description': pattern.description,
            'expected_output': f"Successfully executed pattern: {pattern.name}",
            'app_name': target_app,
            'automation_type': 'desktop',  # Default to desktop automation
            'metadata': {
                'pattern_id': pattern.pattern_id,
                'confidence_score': pattern.confidence_score,
                'success_rate': pattern.success_rate,
                **pattern.metadata
            }
        }
        
        # Override with provided parameters
        task_config.update(task_params)
        
        # Create GUITask with correct parameters
        return GUITask(
            id=f"synthesized_{pattern.pattern_id}_{datetime.now().isoformat()}",
            **task_config
        )
    
    async def refine_pattern(self, 
                           pattern_id: str, 
                           new_observations: List[Dict[str, Any]],
                           success_feedback: Optional[bool] = None) -> Optional[TaskPattern]:
        """Refine an existing pattern with new observations.
        
        Args:
            pattern_id: ID of the pattern to refine
            new_observations: New action sequences or observations
            success_feedback: Whether the pattern execution was successful
            
        Returns:
            Updated pattern or None if pattern doesn't exist
        """
        if pattern_id not in self._known_patterns:
            return None
        
        pattern = self._known_patterns[pattern_id]
        
        # Update frequency
        pattern.frequency += len(new_observations)
        
        # Update success rate if feedback provided
        if success_feedback is not None:
            current_total = pattern.frequency * pattern.success_rate
            new_total = current_total + (1 if success_feedback else 0)
            pattern.success_rate = new_total / pattern.frequency
        
        # Analyze new observations for pattern updates
        if new_observations:
            # Check if observations suggest pattern variations
            for observation in new_observations:
                similarity = await self._calculate_sequence_similarity(
                    pattern.action_sequence, observation.get('actions', [])
                )
                
                if similarity < self._config.similarity_threshold:
                    # This might be a variation
                    variation = {
                        'variation_id': f"{pattern_id}_var_{len(pattern.variations)}",
                        'actions': observation.get('actions', []),
                        'context': observation.get('context', {}),
                        'frequency': 1,
                        'similarity_to_base': similarity
                    }
                    pattern.variations.append(variation)
        
        # Recalculate confidence score
        pattern.confidence_score = await self._calculate_confidence_score(pattern)
        pattern.last_updated = datetime.now()
        
        return pattern
    
    async def get_applicable_patterns(self, 
                                    context: Dict[str, Any],
                                    app_name: Optional[str] = None) -> List[TaskPattern]:
        """Get patterns applicable to the given context.
        
        Args:
            context: Current context information
            app_name: Optional application name
            
        Returns:
            List of applicable patterns sorted by relevance
        """
        applicable_patterns = []
        
        for pattern in self._known_patterns.values():
            # Check application compatibility
            if app_name and pattern.applications and app_name not in pattern.applications:
                continue
            
            # Check preconditions
            if await self._check_preconditions(pattern.preconditions, context):
                relevance_score = await self._calculate_relevance_score(pattern, context)
                applicable_patterns.append((pattern, relevance_score))
        
        # Sort by relevance score
        applicable_patterns.sort(key=lambda x: x[1], reverse=True)
        
        return [pattern for pattern, _ in applicable_patterns]
    
    async def _extract_action_sequences(self, memories) -> List[List[Dict[str, Any]]]:
        """Extract action sequences from memory records."""
        sequences = []
        
        for memory in memories:
            metadata = memory.record.metadata
            
            # Extract action sequence from metadata
            if 'action_sequence' in metadata:
                sequences.append(metadata['action_sequence'])
            elif 'actions' in metadata:
                sequences.append(metadata['actions'])
            elif 'interaction_type' in metadata:
                # Single action
                action = {
                    'type': metadata['interaction_type'],
                    'element': metadata.get('element', {}),
                    'timestamp': metadata.get('timestamp'),
                    'success': metadata.get('success', True)
                }
                sequences.append([action])
        
        # Filter sequences by length
        sequences = [
            seq for seq in sequences 
            if len(seq) <= self._config.max_action_sequence_length
        ]
        
        return sequences
    
    async def _group_related_sequences(self, sequences: List[List[Dict[str, Any]]]) -> List[List[List[Dict[str, Any]]]]:
        """Group related action sequences together."""
        groups = []
        ungrouped = sequences.copy()
        
        while ungrouped:
            current_seq = ungrouped.pop(0)
            current_group = [current_seq]
            
            # Find similar sequences
            to_remove = []
            for i, other_seq in enumerate(ungrouped):
                similarity = await self._calculate_sequence_similarity(current_seq, other_seq)
                if similarity >= self._config.similarity_threshold:
                    current_group.append(other_seq)
                    to_remove.append(i)
            
            # Remove grouped sequences
            for i in reversed(to_remove):
                ungrouped.pop(i)
            
            # Only keep groups with sufficient frequency
            if len(current_group) >= self._config.min_frequency_threshold:
                groups.append(current_group)
        
        return groups
    
    async def _synthesize_pattern_from_group(self, group: List[List[Dict[str, Any]]]) -> Optional[TaskPattern]:
        """Synthesize a task pattern from a group of similar sequences."""
        if not group:
            return None
        
        # Find the most common action sequence
        action_sequences = [self._normalize_action_sequence(seq) for seq in group]
        most_common_sequence = self._find_consensus_sequence(action_sequences)
        
        # Extract pattern metadata
        pattern_name = await self._generate_pattern_name(most_common_sequence)
        pattern_description = await self._generate_pattern_description(most_common_sequence)
        
        # Calculate success rate
        successful_executions = sum(
            1 for seq in group 
            if all(action.get('success', True) for action in seq)
        )
        success_rate = successful_executions / len(group)
        
        # Extract applications
        applications = list(set(
            action.get('app_name', 'unknown')
            for seq in group
            for action in seq
            if action.get('app_name')
        ))
        
        # Generate preconditions and postconditions
        preconditions = await self._extract_preconditions(group)
        postconditions = await self._extract_postconditions(group)
        
        pattern = TaskPattern(
            pattern_id=f"pattern_{hash(str(most_common_sequence)) % 1000000}",
            name=pattern_name,
            description=pattern_description,
            action_sequence=most_common_sequence,
            preconditions=preconditions,
            postconditions=postconditions,
            frequency=len(group),
            success_rate=success_rate,
            confidence_score=await self._calculate_confidence_score_from_group(group),
            applications=applications
        )
        
        return pattern
    
    async def _calculate_sequence_similarity(self, seq1: List[Dict[str, Any]], seq2: List[Dict[str, Any]]) -> float:
        """Calculate similarity between two action sequences."""
        if not seq1 or not seq2:
            return 0.0
        
        # Normalize sequences
        norm_seq1 = self._normalize_action_sequence(seq1)
        norm_seq2 = self._normalize_action_sequence(seq2)
        
        # Calculate edit distance
        max_len = max(len(norm_seq1), len(norm_seq2))
        if max_len == 0:
            return 1.0
        
        edit_distance = self._calculate_edit_distance(norm_seq1, norm_seq2)
        similarity = 1.0 - (edit_distance / max_len)
        
        return max(0.0, similarity)
    
    def _normalize_action_sequence(self, sequence: List[Dict[str, Any]]) -> List[str]:
        """Normalize an action sequence to a list of action signatures."""
        normalized = []
        for action in sequence:
            action_type = action.get('type', 'unknown')
            element_type = action.get('element', {}).get('element_type', 'unknown')
            signature = f"{action_type}_{element_type}"
            normalized.append(signature)
        return normalized
    
    def _calculate_edit_distance(self, seq1: List[str], seq2: List[str]) -> int:
        """Calculate edit distance between two sequences."""
        m, n = len(seq1), len(seq2)
        dp = [[0] * (n + 1) for _ in range(m + 1)]
        
        for i in range(m + 1):
            dp[i][0] = i
        for j in range(n + 1):
            dp[0][j] = j
        
        for i in range(1, m + 1):
            for j in range(1, n + 1):
                if seq1[i-1] == seq2[j-1]:
                    dp[i][j] = dp[i-1][j-1]
                else:
                    dp[i][j] = 1 + min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
        
        return dp[m][n]
    
    def _find_consensus_sequence(self, sequences: List[List[str]]) -> List[Dict[str, Any]]:
        """Find consensus sequence from multiple normalized sequences."""
        if not sequences:
            return []
        
        # Find the most common length
        length_counter = Counter(len(seq) for seq in sequences)
        most_common_length = length_counter.most_common(1)[0][0]
        
        # Filter sequences by most common length
        filtered_sequences = [seq for seq in sequences if len(seq) == most_common_length]
        
        # Find most common action at each position
        consensus = []
        for i in range(most_common_length):
            position_actions = [seq[i] for seq in filtered_sequences if i < len(seq)]
            if position_actions:
                most_common_action = Counter(position_actions).most_common(1)[0][0]
                action_type, element_type = most_common_action.split('_', 1)
                consensus.append({
                    'type': action_type,
                    'element_type': element_type,
                    'position': i
                })
        
        return consensus
    
    async def _generate_pattern_name(self, action_sequence: List[Dict[str, Any]]) -> str:
        """Generate a human-readable name for a pattern."""
        if not action_sequence:
            return "Empty Pattern"
        
        # Extract key actions
        key_actions = [action['type'] for action in action_sequence[:3]]
        action_summary = " → ".join(key_actions)
        
        return f"Pattern: {action_summary}"
    
    async def _generate_pattern_description(self, action_sequence: List[Dict[str, Any]]) -> str:
        """Generate a description for a pattern."""
        if not action_sequence:
            return "Empty pattern with no actions"
        
        action_types = [action['type'] for action in action_sequence]
        element_types = [action.get('element_type', 'unknown') for action in action_sequence]
        
        description_parts = []
        for action_type, element_type in zip(action_types, element_types):
            description_parts.append(f"{action_type} {element_type}")
        
        return f"Automated task: {' then '.join(description_parts)}"
    
    async def _extract_preconditions(self, group: List[List[Dict[str, Any]]]) -> List[str]:
        """Extract common preconditions from a group of sequences."""
        # This is a simplified implementation
        # In practice, this would analyze the context before each sequence
        return ["Application is running", "User interface is accessible"]
    
    async def _extract_postconditions(self, group: List[List[Dict[str, Any]]]) -> List[str]:
        """Extract common postconditions from a group of sequences."""
        # This is a simplified implementation
        # In practice, this would analyze the outcomes after each sequence
        return ["Task completed successfully", "UI state changed as expected"]
    
    async def _validate_pattern(self, pattern: TaskPattern) -> bool:
        """Validate if a pattern meets the quality criteria."""
        return (
            pattern.frequency >= self._config.min_frequency_threshold and
            pattern.confidence_score >= self._config.min_confidence_threshold and
            len(pattern.action_sequence) > 0
        )
    
    async def _calculate_confidence_score(self, pattern: TaskPattern) -> float:
        """Calculate confidence score for a pattern."""
        # Base confidence on frequency and success rate
        frequency_score = min(pattern.frequency / 10.0, 1.0)  # Cap at 10 observations
        success_score = pattern.success_rate
        
        # Combine scores
        confidence = (frequency_score * 0.4) + (success_score * 0.6)
        return min(confidence, 1.0)
    
    async def _calculate_confidence_score_from_group(self, group: List[List[Dict[str, Any]]]) -> float:
        """Calculate confidence score from a group of sequences."""
        frequency_score = min(len(group) / 10.0, 1.0)
        
        # Calculate success rate
        successful = sum(
            1 for seq in group 
            if all(action.get('success', True) for action in seq)
        )
        success_rate = successful / len(group) if group else 0.0
        
        confidence = (frequency_score * 0.4) + (success_rate * 0.6)
        return min(confidence, 1.0)
    
    async def _merge_similar_patterns(self, patterns: List[TaskPattern]) -> List[TaskPattern]:
        """Merge similar patterns to reduce redundancy."""
        merged_patterns = []
        remaining_patterns = patterns.copy()
        
        while remaining_patterns:
            current_pattern = remaining_patterns.pop(0)
            similar_patterns = []
            
            # Find similar patterns
            to_remove = []
            for i, other_pattern in enumerate(remaining_patterns):
                similarity = await self._calculate_sequence_similarity(
                    current_pattern.action_sequence,
                    other_pattern.action_sequence
                )
                if similarity >= self._config.similarity_threshold:
                    similar_patterns.append(other_pattern)
                    to_remove.append(i)
            
            # Remove similar patterns from remaining
            for i in reversed(to_remove):
                remaining_patterns.pop(i)
            
            # Merge if similar patterns found
            if similar_patterns:
                merged_pattern = await self._merge_pattern_group([current_pattern] + similar_patterns)
                merged_patterns.append(merged_pattern)
            else:
                merged_patterns.append(current_pattern)
        
        return merged_patterns
    
    async def _merge_pattern_group(self, patterns: List[TaskPattern]) -> TaskPattern:
        """Merge a group of similar patterns into one."""
        if len(patterns) == 1:
            return patterns[0]
        
        # Use the pattern with highest confidence as base
        base_pattern = max(patterns, key=lambda p: p.confidence_score)
        
        # Merge frequencies and success rates
        total_frequency = sum(p.frequency for p in patterns)
        weighted_success_rate = sum(p.success_rate * p.frequency for p in patterns) / total_frequency
        
        # Merge applications
        all_applications = list(set(
            app for pattern in patterns for app in pattern.applications
        ))
        
        # Create merged pattern
        merged_pattern = TaskPattern(
            pattern_id=base_pattern.pattern_id,
            name=base_pattern.name,
            description=base_pattern.description,
            action_sequence=base_pattern.action_sequence,
            preconditions=base_pattern.preconditions,
            postconditions=base_pattern.postconditions,
            frequency=total_frequency,
            success_rate=weighted_success_rate,
            confidence_score=await self._calculate_confidence_score(base_pattern),
            applications=all_applications,
            variations=base_pattern.variations,
            metadata=base_pattern.metadata
        )
        
        return merged_pattern
    
    async def _detect_pattern_variations(self, pattern: TaskPattern, all_sequences: List[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
        """Detect variations of a pattern."""
        variations = []
        
        for sequence in all_sequences:
            similarity = await self._calculate_sequence_similarity(
                pattern.action_sequence, sequence
            )
            
            # If similar but not identical, it might be a variation
            if 0.5 <= similarity < self._config.similarity_threshold:
                variation = {
                    'variation_id': f"{pattern.pattern_id}_var_{len(variations)}",
                    'actions': sequence,
                    'similarity_to_base': similarity,
                    'frequency': 1
                }
                variations.append(variation)
        
        return variations
    
    def _is_within_time_range(self, timestamp_str: Optional[str], start_time: datetime, end_time: datetime) -> bool:
        """Check if a timestamp is within the specified time range."""
        if not timestamp_str:
            return False
        
        try:
            timestamp = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
            return start_time <= timestamp <= end_time
        except (ValueError, TypeError):
            return False
    
    async def _determine_task_type(self, pattern: TaskPattern) -> str:
        """Determine task type based on pattern characteristics."""
        action_types = [action.get('type', '') for action in pattern.action_sequence]
        
        if 'type' in action_types and 'input' in str(pattern.action_sequence).lower():
            return "form_filling"
        elif 'click' in action_types and 'navigation' in pattern.description.lower():
            return "navigation"
        elif 'scroll' in action_types:
            return "browsing"
        else:
            return "general_automation"
    
    def _convert_action_to_step(self, action: Dict[str, Any]) -> Dict[str, Any]:
        """Convert a pattern action to a task step."""
        return {
            'action': action.get('type', 'unknown'),
            'target': {
                'element_type': action.get('element_type', 'unknown'),
                'selector': action.get('selector', ''),
                'text': action.get('text', '')
            },
            'parameters': action.get('parameters', {})
        }
    
    async def _check_preconditions(self, preconditions: List[str], context: Dict[str, Any]) -> bool:
        """Check if preconditions are met in the given context."""
        # Simplified implementation
        # In practice, this would evaluate each precondition against the context
        return True
    
    async def _calculate_relevance_score(self, pattern: TaskPattern, context: Dict[str, Any]) -> float:
        """Calculate how relevant a pattern is to the given context."""
        # Base score on confidence and success rate
        base_score = (pattern.confidence_score * 0.6) + (pattern.success_rate * 0.4)
        
        # Adjust based on context similarity
        context_similarity = 1.0  # Simplified - would analyze context in practice
        
        return base_score * context_similarity