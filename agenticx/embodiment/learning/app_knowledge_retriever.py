"""Application Knowledge Retriever Component

This module implements the AppKnowledgeRetriever component that extracts
high-level knowledge about specific applications from past experiences.
"""

from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field

from agenticx.core.component import Component
from agenticx.memory.component import MemoryComponent


class AppContext(BaseModel):
    """Application context containing high-level knowledge about an app."""
    
    app_name: str = Field(description="Name of the application")
    ui_patterns: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Common UI patterns found in the application"
    )
    main_tasks: List[str] = Field(
        default_factory=list,
        description="Main tasks that can be performed in the application"
    )
    navigation_structure: Dict[str, Any] = Field(
        default_factory=dict,
        description="Navigation structure and menu hierarchy"
    )
    common_workflows: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Common workflows and task sequences"
    )
    interaction_patterns: Dict[str, Any] = Field(
        default_factory=dict,
        description="Common interaction patterns and element types"
    )
    metadata: Dict[str, Any] = Field(
        default_factory=dict,
        description="Additional metadata about the application"
    )


class AppKnowledgeRetriever(Component):
    """Application Knowledge Retriever Component
    
    Retrieves and constructs high-level knowledge about specific applications
    from past experiences stored in memory.
    """
    
    def __init__(self, name: Optional[str] = None, **kwargs):
        """Initialize the AppKnowledgeRetriever.
        
        Args:
            name: Optional component name
            **kwargs: Additional configuration options
        """
        super().__init__(name=name, **kwargs)
        self._similarity_threshold = kwargs.get('similarity_threshold', 0.7)
        self._max_results = kwargs.get('max_results', 50)
    
    async def get_app_context(self, app_name: str, memory: MemoryComponent) -> AppContext:
        """Retrieve and construct application context from memory.
        
        Args:
            app_name: Name of the application
            memory: Memory component to search
            
        Returns:
            AppContext containing high-level knowledge about the application
        """
        # Search for app-related memories
        app_memories = await memory.search_across_memories(
            query=f"application:{app_name} UI patterns workflows",
            limit=self._max_results,
            metadata_filter={"app_name": app_name},
            min_score=self._similarity_threshold
        )
        
        # Extract UI patterns
        ui_patterns = await self._extract_ui_patterns(app_memories)
        
        # Extract main tasks
        main_tasks = await self._extract_main_tasks(app_memories)
        
        # Extract navigation structure
        navigation_structure = await self._extract_navigation_structure(app_memories)
        
        # Extract common workflows
        common_workflows = await self._extract_common_workflows(app_memories)
        
        # Extract interaction patterns
        interaction_patterns = await self._extract_interaction_patterns(app_memories)
        
        # Compile metadata
        metadata = await self._compile_metadata(app_memories)
        
        return AppContext(
            app_name=app_name,
            ui_patterns=ui_patterns,
            main_tasks=main_tasks,
            navigation_structure=navigation_structure,
            common_workflows=common_workflows,
            interaction_patterns=interaction_patterns,
            metadata=metadata
        )
    
    async def find_similar_apps(self, app_name: str, memory: MemoryComponent) -> List[str]:
        """Find applications similar to the given app based on UI structure and interaction patterns.
        
        Args:
            app_name: Name of the target application
            memory: Memory component to search
            
        Returns:
            List of similar application names
        """
        # Get the target app context
        target_context = await self.get_app_context(app_name, memory)
        
        # Search for apps with similar patterns
        similar_apps = await memory.search_across_memories(
            query=f"UI patterns {' '.join(target_context.main_tasks)} navigation",
            limit=self._max_results * 2,
            min_score=self._similarity_threshold * 0.8
        )
        
        # Extract app names and calculate similarity scores
        app_similarities = {}
        for result in similar_apps:
            result_app_name = result.record.metadata.get('app_name')
            if result_app_name and result_app_name != app_name:
                if result_app_name not in app_similarities:
                    app_similarities[result_app_name] = []
                app_similarities[result_app_name].append(result.score)
        
        # Calculate average similarity scores
        avg_similarities = {
            app: sum(scores) / len(scores)
            for app, scores in app_similarities.items()
        }
        
        # Sort by similarity and return top matches
        sorted_apps = sorted(
            avg_similarities.items(),
            key=lambda x: x[1],
            reverse=True
        )
        
        return [app_name for app_name, _ in sorted_apps[:10]]
    
    async def _extract_ui_patterns(self, memories) -> List[Dict[str, Any]]:
        """Extract UI patterns from memory results."""
        patterns = []
        for result in memories:
            metadata = result.record.metadata
            if 'ui_patterns' in metadata:
                patterns.extend(metadata['ui_patterns'])
            elif 'element_type' in metadata:
                patterns.append({
                    'type': metadata['element_type'],
                    'properties': metadata.get('element_properties', {}),
                    'frequency': 1
                })
        
        # Aggregate and deduplicate patterns
        pattern_counts = {}
        for pattern in patterns:
            pattern_key = f"{pattern.get('type', 'unknown')}_{hash(str(pattern.get('properties', {})))}"
            if pattern_key not in pattern_counts:
                pattern_counts[pattern_key] = pattern.copy()
                pattern_counts[pattern_key]['frequency'] = 0
            pattern_counts[pattern_key]['frequency'] += 1
        
        return list(pattern_counts.values())
    
    async def _extract_main_tasks(self, memories) -> List[str]:
        """Extract main tasks from memory results."""
        tasks = set()
        for result in memories:
            metadata = result.record.metadata
            if 'task_type' in metadata:
                tasks.add(metadata['task_type'])
            if 'goal' in metadata:
                tasks.add(metadata['goal'])
        
        return list(tasks)
    
    async def _extract_navigation_structure(self, memories) -> Dict[str, Any]:
        """Extract navigation structure from memory results."""
        navigation = {
            'menus': [],
            'buttons': [],
            'links': [],
            'hierarchy': {}
        }
        
        for result in memories:
            metadata = result.record.metadata
            if 'navigation_element' in metadata:
                nav_element = metadata['navigation_element']
                element_type = nav_element.get('type', 'unknown')
                if element_type in navigation:
                    navigation[element_type].append(nav_element)
        
        return navigation
    
    async def _extract_common_workflows(self, memories) -> List[Dict[str, Any]]:
        """Extract common workflows from memory results."""
        workflows = []
        for result in memories:
            metadata = result.record.metadata
            if 'workflow' in metadata:
                workflows.append(metadata['workflow'])
            elif 'action_sequence' in metadata:
                workflows.append({
                    'name': metadata.get('task_name', 'Unknown'),
                    'steps': metadata['action_sequence'],
                    'success_rate': metadata.get('success_rate', 0.0)
                })
        
        return workflows
    
    async def _extract_interaction_patterns(self, memories) -> Dict[str, Any]:
        """Extract interaction patterns from memory results."""
        patterns = {
            'click_patterns': [],
            'input_patterns': [],
            'scroll_patterns': [],
            'gesture_patterns': []
        }
        
        for result in memories:
            metadata = result.record.metadata
            if 'interaction_type' in metadata:
                interaction_type = metadata['interaction_type']
                pattern_key = f"{interaction_type}_patterns"
                if pattern_key in patterns:
                    patterns[pattern_key].append({
                        'type': interaction_type,
                        'context': metadata.get('context', {}),
                        'success': metadata.get('success', True)
                    })
        
        return patterns
    
    async def _compile_metadata(self, memories) -> Dict[str, Any]:
        """Compile additional metadata from memory results."""
        metadata = {
            'total_interactions': len(memories),
            'success_rate': 0.0,
            'last_updated': None,
            'version_info': {},
            'platform_info': {}
        }
        
        successful_interactions = 0
        for result in memories:
            result_metadata = result.record.metadata
            if result_metadata.get('success', True):
                successful_interactions += 1
            
            # Update last_updated
            timestamp = result_metadata.get('timestamp')
            if timestamp and (not metadata['last_updated'] or timestamp > metadata['last_updated']):
                metadata['last_updated'] = timestamp
            
            # Collect version and platform info
            if 'app_version' in result_metadata:
                version = result_metadata['app_version']
                metadata['version_info'][version] = metadata['version_info'].get(version, 0) + 1
            
            if 'platform' in result_metadata:
                platform = result_metadata['platform']
                metadata['platform_info'][platform] = metadata['platform_info'].get(platform, 0) + 1
        
        if len(memories) > 0:
            metadata['success_rate'] = successful_interactions / len(memories)
        
        return metadata