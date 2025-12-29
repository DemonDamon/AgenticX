"""
Mining Graph Nodes for Intelligent Agent Mining

Graph-based implementation of the mining workflow:
- ExploreNode: Discover new APIs/tools in the environment
- ValidateNode: Validate discovered tools using Pydantic
- FeedbackNode: Generate correction feedback for validation errors

Uses the graph execution engine from agenticx.core.graph
and the validation error handling from agenticx.core.tool_v2.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Union, Callable, Awaitable

from agenticx.core.graph import (
    BaseNode,
    End,
    Graph,
    GraphRunContext,
    GraphRunResult,
)
from agenticx.core.tool_v2 import (
    ValidationFeedback,
    ValidationErrorHandler,
    ValidationErrorTranslator,
)

logger = logging.getLogger(__name__)


# =============================================================================
# Mining State and Dependencies
# =============================================================================

@dataclass
class MiningState:
    """
    State for the mining graph execution.
    
    Tracks discovered APIs, validated tools, and retry attempts.
    
    Attributes:
        discovered_apis: List of discovered API endpoints.
        validated_tools: List of successfully validated tools.
        pending_validation: APIs awaiting validation.
        retry_count: Current retry attempt count.
        max_retries: Maximum allowed retries.
        message_history: History of messages for context.
        validation_errors: List of validation errors encountered.
        current_feedback: Current feedback for LLM correction.
    """
    discovered_apis: List[str] = field(default_factory=list)
    validated_tools: List[str] = field(default_factory=list)
    pending_validation: List[str] = field(default_factory=list)
    retry_count: int = 0
    max_retries: int = 3
    message_history: List[Dict[str, Any]] = field(default_factory=list)
    validation_errors: List[Dict[str, Any]] = field(default_factory=list)
    current_feedback: Optional[str] = None


@dataclass
class MiningDeps:
    """
    Dependencies for the mining graph.
    
    Provides access to external services and configurations.
    
    Attributes:
        llm_provider: LLM provider for generating corrections.
        discovery_fn: Function to discover APIs in an environment.
        validate_fn: Function to validate a tool/API.
        environment: The environment to explore.
        exploration_budget: Maximum number of exploration attempts.
    """
    llm_provider: Optional[Any] = None
    discovery_fn: Optional[Callable[[str], Awaitable[List[str]]]] = None
    validate_fn: Optional[Callable[[str, Dict], Awaitable[bool]]] = None
    environment: str = ""
    exploration_budget: int = 10


# =============================================================================
# Mining Graph Nodes
# =============================================================================

@dataclass
class ExploreNode(BaseNode[MiningState, MiningDeps, List[str]]):
    """
    Exploration node - discovers new APIs/tools in the environment.
    
    This node:
    1. Calls the discovery function to find new APIs
    2. Adds discovered APIs to pending_validation
    3. Transitions to ValidateNode if APIs found, otherwise End
    """
    
    async def run(
        self, ctx: GraphRunContext[MiningState, MiningDeps]
    ) -> Union['ValidateNode', End[List[str]]]:
        """Execute exploration logic."""
        logger.info("[ExploreNode] Starting exploration...")
        
        # Check exploration budget
        if len(ctx.state.discovered_apis) >= ctx.deps.exploration_budget:
            logger.info("[ExploreNode] Exploration budget exhausted")
            return End(ctx.state.validated_tools)
        
        # Discover new APIs
        discovered: List[str] = []
        if ctx.deps.discovery_fn:
            try:
                discovered = await ctx.deps.discovery_fn(ctx.deps.environment)
            except Exception as e:
                logger.error(f"[ExploreNode] Discovery failed: {e}")
        else:
            # Mock discovery for testing
            discovered = [f"api_{len(ctx.state.discovered_apis) + 1}"]
        
        if not discovered:
            logger.info("[ExploreNode] No new APIs discovered")
            return End(ctx.state.validated_tools)
        
        # Add to state
        ctx.state.discovered_apis.extend(discovered)
        ctx.state.pending_validation.extend(discovered)
        ctx.state.message_history.append({
            "role": "system",
            "content": f"Discovered APIs: {discovered}"
        })
        
        logger.info(f"[ExploreNode] Discovered {len(discovered)} APIs: {discovered}")
        
        return ValidateNode()


@dataclass
class ValidateNode(BaseNode[MiningState, MiningDeps, List[str]]):
    """
    Validation node - validates pending APIs using Pydantic.
    
    This node:
    1. Takes pending APIs and attempts validation
    2. Uses ValidationErrorHandler for structured error feedback
    3. Transitions to FeedbackNode on error, ExploreNode on success
    """
    
    async def run(
        self, ctx: GraphRunContext[MiningState, MiningDeps]
    ) -> Union['FeedbackNode', ExploreNode, End[List[str]]]:
        """Execute validation logic."""
        logger.info("[ValidateNode] Starting validation...")
        
        if not ctx.state.pending_validation:
            logger.info("[ValidateNode] No pending validations")
            return ExploreNode()
        
        # Get next API to validate
        api = ctx.state.pending_validation[0]
        
        logger.info(f"[ValidateNode] Validating: {api}")
        
        # Attempt validation
        validation_success = False
        validation_error: Optional[Dict[str, Any]] = None
        
        if ctx.deps.validate_fn:
            try:
                # Call the validation function
                params = {"api": api, "retry": ctx.state.retry_count}
                validation_success = await ctx.deps.validate_fn(api, params)
            except Exception as e:
                # Capture validation error
                error_handler = ValidationErrorHandler()
                
                # Create mock ValidationError for demonstration
                validation_error = {
                    "api": api,
                    "error": str(e),
                    "retry_count": ctx.state.retry_count,
                }
                ctx.state.validation_errors.append(validation_error)
                logger.warning(f"[ValidateNode] Validation failed: {e}")
        else:
            # Mock validation for testing
            # First attempt fails, subsequent attempts succeed
            validation_success = ctx.state.retry_count > 0
            if not validation_success:
                validation_error = {
                    "api": api,
                    "error": "Mock validation error: missing required parameter 'auth_token'",
                    "retry_count": ctx.state.retry_count,
                }
                ctx.state.validation_errors.append(validation_error)
        
        if validation_success:
            # Validation succeeded
            ctx.state.pending_validation.pop(0)
            ctx.state.validated_tools.append(api)
            ctx.state.retry_count = 0  # Reset retry count
            
            ctx.state.message_history.append({
                "role": "system",
                "content": f"Validated: {api}"
            })
            
            logger.info(f"[ValidateNode] Validated successfully: {api}")
            
            # Check if more to validate
            if ctx.state.pending_validation:
                return ValidateNode()
            else:
                return ExploreNode()
        else:
            # Validation failed - need feedback
            if ctx.state.retry_count >= ctx.state.max_retries:
                # Max retries exceeded, skip this API
                logger.warning(f"[ValidateNode] Max retries exceeded for: {api}")
                ctx.state.pending_validation.pop(0)
                ctx.state.retry_count = 0
                
                if ctx.state.pending_validation:
                    return ValidateNode()
                else:
                    return ExploreNode()
            
            return FeedbackNode(error=validation_error)


@dataclass
class FeedbackNode(BaseNode[MiningState, MiningDeps, List[str]]):
    """
    Feedback node - generates LLM feedback for validation errors.
    
    This node:
    1. Translates validation errors to natural language
    2. Requests LLM to generate corrected parameters
    3. Transitions back to ValidateNode for retry
    """
    
    error: Optional[Dict[str, Any]] = None
    
    async def run(
        self, ctx: GraphRunContext[MiningState, MiningDeps]
    ) -> Union[ValidateNode, ExploreNode, End[List[str]]]:
        """Execute feedback generation logic."""
        logger.info("[FeedbackNode] Generating feedback...")
        
        if not self.error:
            logger.warning("[FeedbackNode] No error to process")
            return ValidateNode()
        
        # Use ValidationErrorTranslator to generate human-readable feedback
        translator = ValidationErrorTranslator()
        
        # Create a mock ValidationFeedback for demonstration
        feedback = ValidationFeedback(
            tool_name=self.error.get("api", "unknown"),
            errors=[{"loc": ["param"], "msg": self.error.get("error", "Unknown error")}],
            original_params=self.error,
            retry_count=ctx.state.retry_count,
        )
        
        natural_language_error = translator.translate(feedback)
        ctx.state.current_feedback = natural_language_error
        
        logger.info(f"[FeedbackNode] Generated feedback: {natural_language_error[:100]}...")
        
        # If LLM provider is available, request correction
        if ctx.deps.llm_provider:
            try:
                # Request LLM to correct parameters
                prompt = f"""The following tool call failed with validation errors:

{natural_language_error}

Please suggest corrected parameters."""
                
                if hasattr(ctx.deps.llm_provider, 'acomplete'):
                    correction = await ctx.deps.llm_provider.acomplete(prompt)
                    ctx.state.message_history.append({
                        "role": "assistant",
                        "content": f"Correction suggested: {correction}"
                    })
            except Exception as e:
                logger.error(f"[FeedbackNode] LLM correction failed: {e}")
        
        # Increment retry count
        ctx.state.retry_count += 1
        
        ctx.state.message_history.append({
            "role": "system",
            "content": f"Feedback generated, retry {ctx.state.retry_count}"
        })
        
        return ValidateNode()


# =============================================================================
# Mining Graph Builder
# =============================================================================

def create_mining_graph(
    name: str = "MiningGraph",
    max_steps: int = 100,
) -> Graph[MiningState, MiningDeps, List[str]]:
    """
    Create a mining graph with explore-validate-feedback loop.
    
    Args:
        name: Name of the graph.
        max_steps: Maximum execution steps.
        
    Returns:
        Configured Graph instance.
        
    Example:
        >>> graph = create_mining_graph()
        >>> result = await graph.run(
        ...     initial_node=ExploreNode(),
        ...     state=MiningState(),
        ...     deps=MiningDeps(environment="test_env"),
        ... )
        >>> print(result.result)  # List of validated tools
    """
    return Graph(
        nodes=[ExploreNode, ValidateNode, FeedbackNode],
        name=name,
        max_steps=max_steps,
    )


# =============================================================================
# High-level Mining API
# =============================================================================

class MiningGraphRunner:
    """
    High-level runner for mining graph execution.
    
    Provides a simplified interface for running the mining workflow.
    
    Example:
        >>> runner = MiningGraphRunner(
        ...     environment="http://api.example.com",
        ...     llm_provider=my_llm,
        ... )
        >>> validated = await runner.run()
        >>> print(f"Validated {len(validated)} tools")
    """
    
    def __init__(
        self,
        environment: str = "",
        llm_provider: Optional[Any] = None,
        discovery_fn: Optional[Callable[[str], Awaitable[List[str]]]] = None,
        validate_fn: Optional[Callable[[str, Dict], Awaitable[bool]]] = None,
        max_retries: int = 3,
        exploration_budget: int = 10,
    ):
        """
        Initialize the mining runner.
        
        Args:
            environment: Environment to explore.
            llm_provider: LLM provider for feedback.
            discovery_fn: Custom discovery function.
            validate_fn: Custom validation function.
            max_retries: Max retries per validation.
            exploration_budget: Max APIs to discover.
        """
        self.graph = create_mining_graph()
        self.deps = MiningDeps(
            environment=environment,
            llm_provider=llm_provider,
            discovery_fn=discovery_fn,
            validate_fn=validate_fn,
            exploration_budget=exploration_budget,
        )
        self.max_retries = max_retries
    
    async def run(self) -> List[str]:
        """
        Run the mining workflow.
        
        Returns:
            List of validated tools.
        """
        state = MiningState(max_retries=self.max_retries)
        
        result = await self.graph.run(
            initial_node=ExploreNode(),
            state=state,
            deps=self.deps,
        )
        
        return result.result
    
    def run_sync(self) -> List[str]:
        """Synchronous wrapper for run()."""
        import asyncio
        return asyncio.run(self.run())


__all__ = [
    'MiningState',
    'MiningDeps',
    'ExploreNode',
    'ValidateNode',
    'FeedbackNode',
    'create_mining_graph',
    'MiningGraphRunner',
]

