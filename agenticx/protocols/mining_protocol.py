"""
Mining Protocol Data Models

This module defines the data structures for intelligent agent mining/exploration tasks.
Inspired by DeerFlow's structured planning approach, these models enable:
- Structured task decomposition with explicit step types
- Automatic constraint validation (e.g., requiring external info to prevent hallucination)
- Exploration budget management for controlled discovery

Design Principles (from DeerFlow):
1. Structured plans over free exploration
2. At least one step must require external info (anti-hallucination)
3. Each step has explicit type (search/analyze/execute/explore)
"""

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional, Literal
from uuid import UUID, uuid4
from pydantic import BaseModel, Field, ConfigDict, model_validator
import logging

logger = logging.getLogger(__name__)


class MiningStepType(str, Enum):
    """
    Types of mining/exploration steps.
    
    Each type represents a different mode of operation:
    - SEARCH: External information retrieval (web, docs, codebase)
    - ANALYZE: Pure LLM reasoning and analysis
    - EXECUTE: Code execution for experiments/validation
    - EXPLORE: Free-form exploration in unknown domains
    """
    SEARCH = "search"
    ANALYZE = "analyze"
    EXECUTE = "execute"
    EXPLORE = "explore"


class MiningStepStatus(str, Enum):
    """
    Status of a mining step execution.
    
    兼容 AgentScope 的 SubTask 状态 (todo/in_progress/done/abandoned)
    """
    PENDING = "pending"       # 等同于 AgentScope 的 "todo"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"   # 等同于 AgentScope 的 "done"
    FAILED = "failed"
    SKIPPED = "skipped"       # 等同于 AgentScope 的 "abandoned"
    
    @classmethod
    def from_agentscope(cls, state: str) -> "MiningStepStatus":
        """从 AgentScope SubTask 状态转换"""
        mapping = {
            "todo": cls.PENDING,
            "in_progress": cls.IN_PROGRESS,
            "done": cls.COMPLETED,
            "abandoned": cls.SKIPPED,
        }
        return mapping.get(state, cls.PENDING)
    
    def to_agentscope(self) -> str:
        """转换为 AgentScope SubTask 状态"""
        mapping = {
            self.PENDING: "todo",
            self.IN_PROGRESS: "in_progress",
            self.COMPLETED: "done",
            self.FAILED: "abandoned",
            self.SKIPPED: "abandoned",
        }
        return mapping.get(self, "todo")


class MiningStep(BaseModel):
    """
    A single step in a mining plan.
    
    Inspired by DeerFlow's Step model, each step has:
    - Explicit type for routing to appropriate executor
    - External info flag to prevent pure hallucination
    - Exploration budget for controlled discovery
    
    Attributes:
        step_type: Type of operation (search/analyze/execute/explore)
        title: Short descriptive title for the step
        description: Detailed execution instructions
        need_external_info: Whether this step requires external data
        exploration_budget: Number of allowed failures/retries for exploration
        execution_result: Result after execution (populated during run)
        learned_insights: Key insights discovered during execution
        status: Current execution status
        error: Error message if step failed
    """
    id: str = Field(default_factory=lambda: str(uuid4()), description="Unique step identifier")
    step_type: MiningStepType = Field(..., description="Type of mining operation")
    title: str = Field(..., min_length=1, max_length=200, description="Short step title")
    description: str = Field(..., min_length=1, description="Detailed execution instructions")
    need_external_info: bool = Field(
        default=False,
        description="Whether this step requires external information (search/retrieval)"
    )
    exploration_budget: int = Field(
        default=1,
        ge=1,
        le=10,
        description="Number of allowed failures/retries for exploration"
    )
    execution_result: Optional[str] = Field(
        default=None,
        description="Result after step execution"
    )
    learned_insights: List[str] = Field(
        default_factory=list,
        description="Key insights discovered during execution"
    )
    status: MiningStepStatus = Field(
        default=MiningStepStatus.PENDING,
        description="Current execution status"
    )
    error: Optional[str] = Field(
        default=None,
        description="Error message if step failed"
    )
    # 新增字段：与 AgentScope SubTask 对齐
    outcome: Optional[str] = Field(
        default=None,
        description="实际成果（参考自 AgentScope SubTask.outcome）"
    )
    expected_outcome: Optional[str] = Field(
        default=None,
        description="预期成果（参考自 AgentScope SubTask.expected_outcome）"
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="创建时间"
    )
    finished_at: Optional[datetime] = Field(
        default=None,
        description="完成时间"
    )
    
    model_config = ConfigDict(use_enum_values=True)
    
    def mark_completed(self, result: str, insights: Optional[List[str]] = None) -> None:
        """Mark step as completed with result."""
        self.status = MiningStepStatus.COMPLETED
        self.execution_result = result
        self.finished_at = datetime.now(timezone.utc)
        if insights:
            self.learned_insights.extend(insights)
    
    def mark_failed(self, error: str) -> None:
        """Mark step as failed with error message."""
        self.status = MiningStepStatus.FAILED
        self.error = error
        self.finished_at = datetime.now(timezone.utc)
    
    def can_retry(self) -> bool:
        """Check if step can be retried based on exploration budget."""
        return self.exploration_budget > 0
    
    def consume_retry(self) -> bool:
        """Consume one retry from exploration budget. Returns True if retry was available."""
        if self.exploration_budget > 0:
            self.exploration_budget -= 1
            return True
        return False
    
    # =========================================================================
    # 与 AgentScope SubTask 兼容的方法（参考自 AgentScope）
    # =========================================================================
    
    def finish(self, outcome: str) -> None:
        """
        完成步骤并设置成果（参考自 AgentScope SubTask.finish）
        
        Args:
            outcome: 步骤的实际成果
        """
        self.status = MiningStepStatus.COMPLETED
        self.outcome = outcome
        self.execution_result = outcome
        self.finished_at = datetime.now(timezone.utc)
    
    def to_subtask_dict(self) -> Dict[str, Any]:
        """
        转换为 AgentScope SubTask 格式的字典
        
        Returns:
            与 PlanNotebook.create_plan() subtasks 参数兼容的字典
        """
        return {
            "name": self.title,
            "description": self.description,
            "expected_outcome": self.expected_outcome or f"Complete {self.title}",
            "outcome": self.outcome,
            "state": self.status.to_agentscope() if isinstance(self.status, MiningStepStatus) else MiningStepStatus(self.status).to_agentscope(),
        }
    
    def to_oneline_markdown(self) -> str:
        """转换为单行 Markdown（参考自 AgentScope SubTask）"""
        status_map = {
            MiningStepStatus.PENDING: "- [ ]",
            MiningStepStatus.IN_PROGRESS: "- [ ][WIP]",
            MiningStepStatus.COMPLETED: "- [x]",
            MiningStepStatus.FAILED: "- [ ][Failed]",
            MiningStepStatus.SKIPPED: "- [ ][Skipped]",
        }
        status = self.status if isinstance(self.status, MiningStepStatus) else MiningStepStatus(self.status)
        return f"{status_map.get(status, '- [ ]')} {self.title}"
    
    @classmethod
    def from_subtask(cls, subtask_dict: Dict[str, Any], step_type: MiningStepType = MiningStepType.ANALYZE) -> "MiningStep":
        """
        从 AgentScope SubTask 字典创建 MiningStep
        
        Args:
            subtask_dict: SubTask 格式的字典
            step_type: 步骤类型（默认为 ANALYZE）
            
        Returns:
            MiningStep 实例
        """
        state = subtask_dict.get("state", "todo")
        status = MiningStepStatus.from_agentscope(state)
        
        return cls(
            step_type=step_type,
            title=subtask_dict.get("name", "Untitled"),
            description=subtask_dict.get("description", ""),
            expected_outcome=subtask_dict.get("expected_outcome"),
            outcome=subtask_dict.get("outcome"),
            status=status,
            need_external_info=step_type == MiningStepType.SEARCH,
        )


class ExplorationStrategy(str, Enum):
    """Strategy for exploring the solution space."""
    BREADTH_FIRST = "breadth_first"   # Explore all branches at current depth
    DEPTH_FIRST = "depth_first"       # Fully explore one branch before others
    ADAPTIVE = "adaptive"              # Dynamically switch based on results


class StopCondition(str, Enum):
    """Conditions for stopping the mining process."""
    MAX_STEPS = "max_steps"                    # Stop after N steps
    CONFIDENCE_THRESHOLD = "confidence_threshold"  # Stop when confidence is high enough
    COST_LIMIT = "cost_limit"                  # Stop when cost limit reached
    GOAL_ACHIEVED = "goal_achieved"            # Stop when goal is achieved
    TIME_LIMIT = "time_limit"                  # Stop after time limit


class MiningPlanStatus(str, Enum):
    """Status of the overall mining plan."""
    DRAFT = "draft"               # Plan created but not validated
    VALIDATED = "validated"       # Plan passed constraint validation
    IN_PROGRESS = "in_progress"   # Plan is being executed
    COMPLETED = "completed"       # All steps completed
    FAILED = "failed"             # Plan execution failed
    CANCELLED = "cancelled"       # Plan was cancelled


class MiningPlan(BaseModel):
    """
    A structured mining/exploration plan.
    
    Inspired by DeerFlow's Plan model, this enforces:
    - At least one step must require external info (anti-hallucination constraint)
    - Automatic validation and repair of constraints
    - Cost tracking and budget management
    
    Attributes:
        goal: The mining/exploration objective
        steps: Ordered list of mining steps
        exploration_strategy: How to explore the solution space
        stop_condition: When to stop the mining process
        max_total_cost: Maximum allowed cost in USD
        current_step_index: Index of the currently executing step
        total_cost: Accumulated cost so far
        status: Overall plan status
    """
    id: str = Field(default_factory=lambda: str(uuid4()), description="Unique plan identifier")
    goal: str = Field(..., min_length=1, description="The mining/exploration objective")
    steps: List[MiningStep] = Field(..., min_length=1, description="Ordered list of mining steps")
    exploration_strategy: ExplorationStrategy = Field(
        default=ExplorationStrategy.BREADTH_FIRST,
        description="Strategy for exploring the solution space"
    )
    stop_condition: StopCondition = Field(
        default=StopCondition.MAX_STEPS,
        description="Condition for stopping the mining process"
    )
    max_total_cost: float = Field(
        default=10.0,
        ge=0.0,
        description="Maximum total cost in USD"
    )
    max_steps: int = Field(
        default=10,
        ge=1,
        le=50,
        description="Maximum number of steps to execute"
    )
    confidence_threshold: float = Field(
        default=0.8,
        ge=0.0,
        le=1.0,
        description="Confidence threshold for CONFIDENCE_THRESHOLD stop condition"
    )
    time_limit_seconds: int = Field(
        default=3600,
        ge=60,
        description="Time limit in seconds for TIME_LIMIT stop condition"
    )
    current_step_index: int = Field(
        default=0,
        ge=0,
        description="Index of the currently executing step"
    )
    total_cost: float = Field(
        default=0.0,
        ge=0.0,
        description="Total cost accumulated so far"
    )
    status: MiningPlanStatus = Field(
        default=MiningPlanStatus.DRAFT,
        description="Overall plan status"
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="Plan creation timestamp"
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="Last update timestamp"
    )
    metadata: Dict[str, Any] = Field(
        default_factory=dict,
        description="Additional metadata for the plan"
    )
    
    model_config = ConfigDict(use_enum_values=True)
    
    def validate_constraints(self) -> bool:
        """
        Validate and auto-fix plan constraints.
        
        Key constraint: At least one step must require external info
        to prevent pure LLM hallucination.
        
        Returns:
            True if plan is valid (possibly after auto-repair)
        """
        # Check if any step requires external info
        has_external_info_step = any(step.need_external_info for step in self.steps)
        
        if not has_external_info_step:
            # Auto-repair: Try to find a SEARCH step and mark it
            for step in self.steps:
                if step.step_type == MiningStepType.SEARCH:
                    step.need_external_info = True
                    logger.info(f"Auto-repair: Marked step '{step.title}' as requiring external info")
                    has_external_info_step = True
                    break
            
            # If still no external info step, insert a default SEARCH step
            if not has_external_info_step:
                initial_search = MiningStep(
                    step_type=MiningStepType.SEARCH,
                    title="Initial External Search",
                    description=f"Search for relevant information about: {self.goal}",
                    need_external_info=True,
                    exploration_budget=2
                )
                self.steps.insert(0, initial_search)
                logger.info("Auto-repair: Inserted initial SEARCH step to prevent hallucination")
        
        # Update status
        self.status = MiningPlanStatus.VALIDATED
        self.updated_at = datetime.now(timezone.utc)
        
        return True
    
    def get_current_step(self) -> Optional[MiningStep]:
        """Get the current step to execute."""
        if 0 <= self.current_step_index < len(self.steps):
            return self.steps[self.current_step_index]
        return None
    
    def advance_to_next_step(self) -> Optional[MiningStep]:
        """Advance to the next step and return it."""
        self.current_step_index += 1
        self.updated_at = datetime.now(timezone.utc)
        return self.get_current_step()
    
    def get_pending_steps(self) -> List[MiningStep]:
        """Get all pending steps."""
        return [s for s in self.steps if s.status == MiningStepStatus.PENDING]
    
    def get_completed_steps(self) -> List[MiningStep]:
        """Get all completed steps."""
        return [s for s in self.steps if s.status == MiningStepStatus.COMPLETED]
    
    def get_failed_steps(self) -> List[MiningStep]:
        """Get all failed steps."""
        return [s for s in self.steps if s.status == MiningStepStatus.FAILED]
    
    def is_complete(self) -> bool:
        """Check if the plan is complete (all steps done or stop condition met)."""
        if self.status in [MiningPlanStatus.COMPLETED, MiningPlanStatus.FAILED, MiningPlanStatus.CANCELLED]:
            return True
        
        # Check stop conditions
        if self.stop_condition == StopCondition.MAX_STEPS:
            if self.current_step_index >= self.max_steps:
                return True
        elif self.stop_condition == StopCondition.COST_LIMIT:
            if self.total_cost >= self.max_total_cost:
                return True
        
        # All steps completed
        return all(s.status in [MiningStepStatus.COMPLETED, MiningStepStatus.SKIPPED] for s in self.steps)
    
    def add_cost(self, cost: float) -> bool:
        """
        Add cost to the plan and check budget.
        
        Returns:
            True if within budget, False if exceeded
        """
        self.total_cost += cost
        self.updated_at = datetime.now(timezone.utc)
        return self.total_cost <= self.max_total_cost
    
    def mark_completed(self) -> None:
        """Mark the plan as completed."""
        self.status = MiningPlanStatus.COMPLETED
        self.updated_at = datetime.now(timezone.utc)
    
    def mark_failed(self, reason: str) -> None:
        """Mark the plan as failed."""
        self.status = MiningPlanStatus.FAILED
        self.metadata["failure_reason"] = reason
        self.updated_at = datetime.now(timezone.utc)
    
    def get_progress(self) -> float:
        """Get execution progress as a percentage (0.0 - 1.0)."""
        if not self.steps:
            return 0.0
        completed = len([s for s in self.steps if s.status in [MiningStepStatus.COMPLETED, MiningStepStatus.SKIPPED]])
        return completed / len(self.steps)
    
    def get_insights(self) -> List[str]:
        """Collect all insights from completed steps."""
        insights = []
        for step in self.get_completed_steps():
            insights.extend(step.learned_insights)
        return insights
    
    def to_summary(self) -> str:
        """Generate a human-readable summary of the plan."""
        lines = [
            f"Mining Plan: {self.goal}",
            f"Status: {self.status}",
            f"Progress: {self.get_progress() * 100:.1f}%",
            f"Cost: ${self.total_cost:.4f} / ${self.max_total_cost:.2f}",
            f"Strategy: {self.exploration_strategy}",
            "",
            "Steps:"
        ]
        
        for i, step in enumerate(self.steps):
            status_icon = {
                MiningStepStatus.PENDING: "⏳",
                MiningStepStatus.IN_PROGRESS: "🔄",
                MiningStepStatus.COMPLETED: "✅",
                MiningStepStatus.FAILED: "❌",
                MiningStepStatus.SKIPPED: "⏭️"
            }.get(step.status, "?")
            
            external = "🌐" if step.need_external_info else ""
            lines.append(f"  {i+1}. [{status_icon}] {step.title} ({step.step_type}) {external}")
        
        return "\n".join(lines)


class PlanValidationResult(BaseModel):
    """Result of plan validation."""
    valid: bool = Field(..., description="Whether the plan is valid")
    auto_repaired: bool = Field(default=False, description="Whether auto-repair was applied")
    repairs: List[str] = Field(default_factory=list, description="List of repairs applied")
    warnings: List[str] = Field(default_factory=list, description="Validation warnings")
    errors: List[str] = Field(default_factory=list, description="Validation errors (if invalid)")


def validate_mining_plan(plan: MiningPlan) -> PlanValidationResult:
    """
    Comprehensive validation of a mining plan.
    
    Checks:
    1. At least one step requires external info
    2. Step types are valid
    3. Exploration budgets are reasonable
    4. Cost limits are set
    
    Returns:
        PlanValidationResult with validation details
    """
    result = PlanValidationResult(valid=True)
    
    # Check 1: External info requirement
    has_external = any(s.need_external_info for s in plan.steps)
    if not has_external:
        # Attempt auto-repair
        for step in plan.steps:
            if step.step_type == MiningStepType.SEARCH:
                step.need_external_info = True
                result.auto_repaired = True
                result.repairs.append(f"Marked step '{step.title}' as requiring external info")
                has_external = True
                break
        
        if not has_external:
            # Insert a search step
            initial_search = MiningStep(
                step_type=MiningStepType.SEARCH,
                title="Initial External Search",
                description=f"Search for relevant information about: {plan.goal}",
                need_external_info=True
            )
            plan.steps.insert(0, initial_search)
            result.auto_repaired = True
            result.repairs.append("Inserted initial SEARCH step to prevent hallucination")
    
    # Check 2: Warn about high exploration budgets
    for step in plan.steps:
        if step.exploration_budget > 5:
            result.warnings.append(f"Step '{step.title}' has high exploration budget ({step.exploration_budget})")
    
    # Check 3: Warn about very high cost limits
    if plan.max_total_cost > 50.0:
        result.warnings.append(f"High cost limit: ${plan.max_total_cost}")
    
    # Check 4: Warn if no SEARCH steps
    search_steps = [s for s in plan.steps if s.step_type == MiningStepType.SEARCH]
    if not search_steps:
        result.warnings.append("No SEARCH steps in plan - may rely heavily on LLM knowledge")
    
    # Update plan status
    plan.status = MiningPlanStatus.VALIDATED
    
    return result


# Factory functions for common plan patterns

def create_research_plan(
    goal: str,
    topics: List[str],
    max_cost: float = 5.0
) -> MiningPlan:
    """
    Create a research-focused mining plan.
    
    Pattern: For each topic -> SEARCH -> ANALYZE
    """
    steps = []
    for topic in topics:
        # Search step
        steps.append(MiningStep(
            step_type=MiningStepType.SEARCH,
            title=f"Search: {topic}",
            description=f"Search for information about {topic} related to the goal: {goal}",
            need_external_info=True,
            exploration_budget=2
        ))
        # Analysis step
        steps.append(MiningStep(
            step_type=MiningStepType.ANALYZE,
            title=f"Analyze: {topic}",
            description=f"Analyze the search results for {topic} and extract key insights",
            need_external_info=False
        ))
    
    return MiningPlan(
        goal=goal,
        steps=steps,
        exploration_strategy=ExplorationStrategy.BREADTH_FIRST,
        stop_condition=StopCondition.MAX_STEPS,
        max_total_cost=max_cost,
        max_steps=len(steps)
    )


def create_exploration_plan(
    goal: str,
    initial_directions: List[str],
    depth: int = 3,
    max_cost: float = 10.0
) -> MiningPlan:
    """
    Create an exploration-focused mining plan.
    
    Pattern: For each direction -> EXPLORE with budget -> ANALYZE
    """
    steps = []
    
    # Initial broad search
    steps.append(MiningStep(
        step_type=MiningStepType.SEARCH,
        title="Initial Discovery",
        description=f"Broad search to understand the landscape for: {goal}",
        need_external_info=True,
        exploration_budget=3
    ))
    
    for direction in initial_directions:
        # Exploration step with budget
        steps.append(MiningStep(
            step_type=MiningStepType.EXPLORE,
            title=f"Explore: {direction}",
            description=f"Deep exploration of {direction}. Try different approaches, document failures.",
            need_external_info=True,
            exploration_budget=depth
        ))
    
    # Final synthesis
    steps.append(MiningStep(
        step_type=MiningStepType.ANALYZE,
        title="Synthesis",
        description="Synthesize findings from all exploration paths into coherent insights",
        need_external_info=False
    ))
    
    return MiningPlan(
        goal=goal,
        steps=steps,
        exploration_strategy=ExplorationStrategy.ADAPTIVE,
        stop_condition=StopCondition.COST_LIMIT,
        max_total_cost=max_cost,
        max_steps=len(steps) * 2  # Allow for retries
    )


def create_validation_plan(
    hypothesis: str,
    validation_approaches: List[str],
    max_cost: float = 5.0
) -> MiningPlan:
    """
    Create a validation-focused mining plan.
    
    Pattern: SEARCH evidence -> EXECUTE validation -> ANALYZE results
    """
    steps = []
    
    # Search for supporting evidence
    steps.append(MiningStep(
        step_type=MiningStepType.SEARCH,
        title="Find Evidence",
        description=f"Search for evidence related to the hypothesis: {hypothesis}",
        need_external_info=True,
        exploration_budget=2
    ))
    
    for approach in validation_approaches:
        # Execute validation
        steps.append(MiningStep(
            step_type=MiningStepType.EXECUTE,
            title=f"Validate: {approach}",
            description=f"Execute validation using approach: {approach}",
            need_external_info=False,
            exploration_budget=2
        ))
    
    # Analyze validation results
    steps.append(MiningStep(
        step_type=MiningStepType.ANALYZE,
        title="Evaluate Results",
        description="Analyze all validation results and determine hypothesis validity",
        need_external_info=False
    ))
    
    return MiningPlan(
        goal=f"Validate: {hypothesis}",
        steps=steps,
        exploration_strategy=ExplorationStrategy.DEPTH_FIRST,
        stop_condition=StopCondition.CONFIDENCE_THRESHOLD,
        max_total_cost=max_cost,
        confidence_threshold=0.85
    )

