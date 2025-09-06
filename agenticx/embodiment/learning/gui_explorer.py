"""GUI Explorer Component

This module implements the GUIExplorer component that automatically explores
and learns the structure of application interfaces.
"""

from typing import List, Dict, Any, Optional, Tuple, Set
from pydantic import BaseModel, Field
import asyncio
from datetime import datetime

from agenticx.core.component import Component
from agenticx.memory.component import MemoryComponent
from agenticx.embodiment.core.models import ScreenState, InteractionElement


class ExplorationResult(BaseModel):
    """Result of GUI exploration containing discovered elements and structure."""
    
    app_name: str = Field(description="Name of the explored application")
    exploration_id: str = Field(description="Unique identifier for this exploration session")
    discovered_elements: List[InteractionElement] = Field(
        default_factory=list,
        description="List of discovered interactive elements"
    )
    ui_structure: Dict[str, Any] = Field(
        default_factory=dict,
        description="Hierarchical structure of the UI"
    )
    navigation_map: Dict[str, List[str]] = Field(
        default_factory=dict,
        description="Map of navigation paths between different views"
    )
    interaction_patterns: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Discovered interaction patterns"
    )
    coverage_metrics: Dict[str, float] = Field(
        default_factory=dict,
        description="Metrics about exploration coverage"
    )
    timestamp: datetime = Field(
        default_factory=datetime.now,
        description="When the exploration was performed"
    )


class ExplorationStrategy(BaseModel):
    """Strategy configuration for GUI exploration."""
    
    max_depth: int = Field(default=5, description="Maximum exploration depth")
    max_elements_per_view: int = Field(default=50, description="Maximum elements to explore per view")
    timeout_per_action: float = Field(default=5.0, description="Timeout for each action in seconds")
    exploration_modes: List[str] = Field(
        default=["breadth_first", "depth_first", "random"],
        description="Exploration modes to use"
    )
    element_priorities: Dict[str, int] = Field(
        default_factory=lambda: {
            "button": 10,
            "link": 9,
            "menu": 8,
            "tab": 7,
            "input": 6,
            "dropdown": 5,
            "checkbox": 4,
            "radio": 3,
            "text": 1
        },
        description="Priority scores for different element types"
    )
    avoid_destructive_actions: bool = Field(
        default=True,
        description="Whether to avoid potentially destructive actions"
    )


class GUIExplorer(Component):
    """GUI Explorer Component
    
    Automatically explores and learns the structure of application interfaces
    through systematic interaction and observation.
    """
    
    def __init__(self, name: Optional[str] = None, **kwargs):
        """Initialize the GUIExplorer.
        
        Args:
            name: Optional component name
            **kwargs: Additional configuration options
        """
        super().__init__(name=name, **kwargs)
        self._strategy = ExplorationStrategy(**kwargs.get('strategy', {}))
        self._visited_states: Set[str] = set()
        self._exploration_queue: List[Tuple[ScreenState, int]] = []
        self._current_exploration_id: Optional[str] = None
    
    async def explore_application(self, 
                                app_name: str, 
                                initial_state: ScreenState,
                                memory: MemoryComponent,
                                tool_executor) -> ExplorationResult:
        """Explore an application starting from the initial state.
        
        Args:
            app_name: Name of the application to explore
            initial_state: Initial screen state to start exploration
            memory: Memory component to store discoveries
            tool_executor: Tool executor for performing actions
            
        Returns:
            ExplorationResult containing all discoveries
        """
        self._current_exploration_id = f"{app_name}_{datetime.now().isoformat()}"
        self._visited_states.clear()
        self._exploration_queue.clear()
        
        # Initialize exploration
        self._exploration_queue.append((initial_state, 0))
        
        discovered_elements = []
        ui_structure = {}
        navigation_map = {}
        interaction_patterns = []
        
        while self._exploration_queue:
            current_state, depth = self._exploration_queue.pop(0)
            
            if depth >= self._strategy.max_depth:
                continue
            
            state_id = self._generate_state_id(current_state)
            if state_id in self._visited_states:
                continue
            
            self._visited_states.add(state_id)
            
            # Analyze current state
            state_analysis = await self._analyze_screen_state(current_state)
            
            # Extract interactive elements
            interactive_elements = await self._extract_interactive_elements(current_state)
            discovered_elements.extend(interactive_elements)
            
            # Update UI structure
            ui_structure[state_id] = state_analysis
            
            # Explore interactive elements
            for element in interactive_elements[:self._strategy.max_elements_per_view]:
                if await self._should_interact_with_element(element):
                    try:
                        # Perform interaction
                        new_state = await self._interact_with_element(
                            element, current_state, tool_executor
                        )
                        
                        if new_state:
                            new_state_id = self._generate_state_id(new_state)
                            
                            # Record navigation
                            if state_id not in navigation_map:
                                navigation_map[state_id] = []
                            navigation_map[state_id].append(new_state_id)
                            
                            # Record interaction pattern
                            interaction_patterns.append({
                                'from_state': state_id,
                                'to_state': new_state_id,
                                'element': element.dict(),
                                'action_type': await self._determine_action_type(element),
                                'success': True,
                                'timestamp': datetime.now().isoformat()
                            })
                            
                            # Add to exploration queue
                            self._exploration_queue.append((new_state, depth + 1))
                            
                            # Store discovery in memory
                            await self._store_discovery(memory, {
                                'app_name': app_name,
                                'exploration_id': self._current_exploration_id,
                                'state_id': state_id,
                                'element': element.dict(),
                                'interaction_result': new_state_id,
                                'depth': depth
                            })
                    
                    except Exception as e:
                        # Record failed interaction
                        interaction_patterns.append({
                            'from_state': state_id,
                            'to_state': None,
                            'element': element.dict(),
                            'action_type': await self._determine_action_type(element),
                            'success': False,
                            'error': str(e),
                            'timestamp': datetime.now().isoformat()
                        })
        
        # Calculate coverage metrics
        coverage_metrics = await self._calculate_coverage_metrics(
            discovered_elements, ui_structure, navigation_map
        )
        
        return ExplorationResult(
            app_name=app_name,
            exploration_id=self._current_exploration_id,
            discovered_elements=discovered_elements,
            ui_structure=ui_structure,
            navigation_map=navigation_map,
            interaction_patterns=interaction_patterns,
            coverage_metrics=coverage_metrics
        )
    
    async def guided_exploration(self, 
                               app_name: str,
                               target_goals: List[str],
                               initial_state: ScreenState,
                               memory: MemoryComponent,
                               tool_executor) -> ExplorationResult:
        """Perform guided exploration focused on specific goals.
        
        Args:
            app_name: Name of the application
            target_goals: List of goals to focus exploration on
            initial_state: Initial screen state
            memory: Memory component
            tool_executor: Tool executor for actions
            
        Returns:
            ExplorationResult with goal-focused discoveries
        """
        # Retrieve relevant knowledge from memory
        relevant_knowledge = await memory.search_across_memories(
            query=f"{app_name} {' '.join(target_goals)} UI elements",
            limit=20,
            metadata_filter={'app_name': app_name}
        )
        
        # Adjust exploration strategy based on goals
        goal_strategy = self._adapt_strategy_for_goals(target_goals, relevant_knowledge)
        original_strategy = self._strategy
        self._strategy = goal_strategy
        
        try:
            result = await self.explore_application(
                app_name, initial_state, memory, tool_executor
            )
            
            # Filter results based on goal relevance
            result = await self._filter_results_by_goals(result, target_goals)
            
            return result
        
        finally:
            self._strategy = original_strategy
    
    async def _analyze_screen_state(self, state: ScreenState) -> Dict[str, Any]:
        """Analyze a screen state to extract structural information."""
        analysis = {
            'element_count': len(state.interactive_elements),
            'element_types': {},
            'layout_structure': {},
            'text_content': [],
            'interactive_areas': []
        }
        
        for element in state.interactive_elements:
            element_type = getattr(element, 'element_type', 'unknown')
            analysis['element_types'][element_type] = analysis['element_types'].get(element_type, 0) + 1
            
            element_text = getattr(element, 'text_content', '')
            if element_text:
                analysis['text_content'].append(element_text)
            
            # Check if element is interactive
            is_interactive = element.attributes.get('is_interactive', True) if element.attributes else True
            if is_interactive:
                element_text = getattr(element, 'text_content', '')
                analysis['interactive_areas'].append({
                    'type': element_type,
                    'bounds': element.bounds,
                    'text': element_text
                })
        
        return analysis
    
    async def _extract_interactive_elements(self, state: ScreenState) -> List[InteractionElement]:
        """Extract interactive elements from a screen state."""
        interactive_elements = []
        
        for element in state.interactive_elements:
            # Check if element is interactive based on its properties
            is_interactive_attr = element.attributes.get('is_interactive', True) if element.attributes else True
            is_interactive_type = hasattr(element, 'element_type') and str(element.element_type) in ['button', 'link', 'text_input']
            
            if is_interactive_attr or is_interactive_type:
                interactive_elements.append(element)
        
        # Sort by priority
        interactive_elements.sort(
            key=lambda e: self._strategy.element_priorities.get(e.element_type, 0) if hasattr(e, 'element_type') else 0,
            reverse=True
        )
        
        return interactive_elements
    
    async def _should_interact_with_element(self, element: InteractionElement) -> bool:
        """Determine if we should interact with an element."""
        if self._strategy.avoid_destructive_actions:
            destructive_keywords = ['delete', 'remove', 'clear', 'reset', 'logout', 'exit']
            element_text = (getattr(element, 'text_content', '') or '').lower()
            if any(keyword in element_text for keyword in destructive_keywords):
                return False
        
        # Check element priority
        priority = self._strategy.element_priorities.get(element.element_type, 0)
        return priority > 0
    
    async def _interact_with_element(self, 
                                   element: InteractionElement, 
                                   current_state: ScreenState,
                                   tool_executor) -> Optional[ScreenState]:
        """Interact with an element and return the resulting state."""
        action_type = await self._determine_action_type(element)
        
        try:
            # Perform the action using tool executor
            action_result = await asyncio.wait_for(
                tool_executor.execute_action(action_type, element),
                timeout=self._strategy.timeout_per_action
            )
            
            if action_result and hasattr(action_result, 'new_state'):
                return action_result.new_state
            
        except asyncio.TimeoutError:
            pass
        except Exception:
            pass
        
        return None
    
    async def _determine_action_type(self, element: InteractionElement) -> str:
        """Determine the appropriate action type for an element."""
        element_type = element.element_type.lower()
        
        action_mapping = {
            'button': 'click',
            'link': 'click',
            'menu': 'click',
            'tab': 'click',
            'input': 'type',
            'textarea': 'type',
            'dropdown': 'select',
            'checkbox': 'toggle',
            'radio': 'select'
        }
        
        return action_mapping.get(element_type, 'click')
    
    def _generate_state_id(self, state: ScreenState) -> str:
        """Generate a unique identifier for a screen state."""
        # Create a hash based on element structure and content
        elements_signature = ''
        for element in sorted(state.interactive_elements, key=lambda e: (e.bounds[0] if e.bounds else 0, e.bounds[1] if e.bounds else 0)):
            element_type = getattr(element, 'element_type', 'unknown')
            text = getattr(element, 'text_content', '')
            bounds = getattr(element, 'bounds', (0, 0, 0, 0))
            x, y = bounds[0], bounds[1] if len(bounds) >= 2 else (0, 0)
            elements_signature += f"{element_type}_{text}_{x}_{y}_"
        
        return f"state_{hash(elements_signature) % 1000000}"
    
    async def _store_discovery(self, memory: MemoryComponent, discovery: Dict[str, Any]):
        """Store a discovery in memory."""
        await memory.add_intelligent(
            content=f"GUI exploration discovery: {discovery['element']['element_type']} element",
            metadata=discovery
        )
    
    async def _calculate_coverage_metrics(self, 
                                        elements: List[InteractionElement],
                                        ui_structure: Dict[str, Any],
                                        navigation_map: Dict[str, List[str]]) -> Dict[str, float]:
        """Calculate exploration coverage metrics."""
        total_elements = len(elements)
        unique_element_types = len(set(e.element_type for e in elements))
        total_states = len(ui_structure)
        total_transitions = sum(len(transitions) for transitions in navigation_map.values())
        
        return {
            'total_elements_discovered': float(total_elements),
            'unique_element_types': float(unique_element_types),
            'total_states_visited': float(total_states),
            'total_transitions_found': float(total_transitions),
            'average_elements_per_state': float(total_elements / max(total_states, 1)),
            'navigation_density': float(total_transitions / max(total_states, 1))
        }
    
    def _adapt_strategy_for_goals(self, goals: List[str], knowledge) -> ExplorationStrategy:
        """Adapt exploration strategy based on goals and existing knowledge."""
        adapted_strategy = ExplorationStrategy(**self._strategy.dict())
        
        # Adjust priorities based on goals
        goal_keywords = ' '.join(goals).lower()
        if 'form' in goal_keywords or 'input' in goal_keywords:
            adapted_strategy.element_priorities['input'] = 15
            adapted_strategy.element_priorities['button'] = 12
        
        if 'navigation' in goal_keywords or 'menu' in goal_keywords:
            adapted_strategy.element_priorities['menu'] = 15
            adapted_strategy.element_priorities['link'] = 12
        
        return adapted_strategy
    
    async def _filter_results_by_goals(self, result: ExplorationResult, goals: List[str]) -> ExplorationResult:
        """Filter exploration results to focus on goal-relevant discoveries."""
        goal_keywords = set(word.lower() for goal in goals for word in goal.split())
        
        # Filter elements
        relevant_elements = []
        for element in result.discovered_elements:
            element_text = (element.text_content or '').lower()
            if any(keyword in element_text for keyword in goal_keywords):
                relevant_elements.append(element)
        
        # Filter interaction patterns
        relevant_patterns = []
        for pattern in result.interaction_patterns:
            element_text = pattern['element'].get('text_content', '').lower()
            if any(keyword in element_text for keyword in goal_keywords):
                relevant_patterns.append(pattern)
        
        result.discovered_elements = relevant_elements
        result.interaction_patterns = relevant_patterns
        
        return result
    
    async def _capture_screen_state(self) -> ScreenState:
        """Capture the current screen state.
        
        Returns:
            ScreenState representing the current screen
        """
        # This would typically use screen capture tools
        # For now, return a basic state for testing
        from ..core.models import ScreenState, InteractionElement, ElementType
        from datetime import datetime
        
        return ScreenState(
            timestamp=datetime.now(),
            agent_id="test_agent",
            screenshot="test_screenshot.png",
            interactive_elements=[],
            element_tree={},
            ocr_text="Mock OCR text",
            state_hash="mock_hash"
        )