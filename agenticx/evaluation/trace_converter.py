"""
Trace to EvalSet Converter

Converts ExecutionTrajectory objects from AgenticX observability module
into standard EvalSet format for evaluation and testing.

This module bridges the gap between execution traces (observability)
and evaluation sets (testing), enabling automatic test case generation
from recorded agent executions.
"""

from typing import Dict, List, Optional, Any, Union
from pathlib import Path
import json
import uuid

from agenticx.evaluation.evalset import EvalSet, EvalCase, ExpectedToolUse
from agenticx.observability.trajectory import ExecutionTrajectory, TrajectoryStep, StepType


class TraceToEvalSetConverter:
    """
    Converts execution trajectories to evaluation sets.
    
    Extracts tool calls, LLM interactions, and task descriptions
    from execution traces to create standard evaluation cases.
    """
    
    def __init__(self, 
                 default_match_mode: str = "name_only",
                 include_tool_inputs: bool = False):
        """
        Initialize the converter.
        
        Args:
            default_match_mode: Default matching mode for tool calls
                ("name_only", "partial", or "exact")
            include_tool_inputs: Whether to include tool inputs in expected tool use
        """
        self.default_match_mode = default_match_mode
        self.include_tool_inputs = include_tool_inputs
    
    def convert(self, 
                trajectory: Union[ExecutionTrajectory, Dict[str, Any]],
                evalset_name: Optional[str] = None,
                evalset_version: str = "1.0.0") -> EvalSet:
        """
        Convert an execution trajectory to an EvalSet.
        
        Args:
            trajectory: ExecutionTrajectory object or its dict representation
            evalset_name: Name for the resulting EvalSet (defaults to trajectory ID)
            evalset_version: Version string for the EvalSet
            
        Returns:
            EvalSet containing converted evaluation cases
        """
        # Convert dict to ExecutionTrajectory if needed
        if isinstance(trajectory, dict):
            trajectory = ExecutionTrajectory.from_dict(trajectory)
        
        # Get basic info
        if evalset_name is None:
            evalset_name = f"trace_{trajectory.trajectory_id[:8]}"
        
        # Extract cases from trajectory
        cases = self._extract_cases(trajectory)
        
        # Create and return EvalSet
        eval_set = EvalSet(
            name=evalset_name,
            version=evalset_version,
            description=f"Auto-generated from trajectory {trajectory.trajectory_id}",
            cases=cases,
            metadata={
                "source_trajectory_id": trajectory.trajectory_id,
                "source_agent_id": trajectory.metadata.agent_id,
                "source_task_id": trajectory.metadata.task_id,
            }
        )
        
        return eval_set
    
    def _extract_cases(self, trajectory: ExecutionTrajectory) -> List[EvalCase]:
        """
        Extract evaluation cases from trajectory steps.
        
        Creates one EvalCase per TASK_START in the trajectory.
        
        Args:
            trajectory: The execution trajectory
            
        Returns:
            List of extracted EvalCase objects
        """
        cases = []
        
        # Get all task start steps
        task_starts = trajectory.get_steps_by_type(StepType.TASK_START)
        
        if not task_starts:
            # No tasks found, return empty list
            return cases
        
        # Process each task
        for task_start in task_starts:
            task_id = task_start.task_id
            
            # Extract query from task start
            query = self._extract_query(task_start)
            
            if not query:
                # Skip if no query found
                continue
            
            # Extract tool calls for this task
            expected_tool_use = self._extract_tool_calls(trajectory, task_id)
            
            # Extract reference response (from task end or last LLM response)
            reference = self._extract_reference(trajectory, task_id)
            
            # Create evaluation case
            case = EvalCase(
                id=task_id or str(uuid.uuid4())[:8],
                name=f"case_{task_id[:8] if task_id else uuid.uuid4().hex[:8]}",
                query=query,
                expected_tool_use=expected_tool_use if expected_tool_use else None,
                reference=reference,
                trajectory_match_mode="in_order",  # Default: accept tools in order
                metadata={
                    "source_step_id": task_start.step_id,
                    "source_agent_id": task_start.agent_id,
                }
            )
            
            cases.append(case)
        
        return cases
    
    def _extract_query(self, task_start_step: TrajectoryStep) -> Optional[str]:
        """
        Extract the user query from a TASK_START step.
        
        Args:
            task_start_step: The TASK_START step
            
        Returns:
            The extracted query string, or None if not found
        """
        input_data = task_start_step.input_data
        
        # Try different common field names
        query = (
            input_data.get("query") or
            input_data.get("task_description") or
            input_data.get("prompt") or
            input_data.get("user_input") or
            input_data.get("message")
        )
        
        if query and isinstance(query, str):
            return query
        
        return None
    
    def _extract_tool_calls(self, 
                           trajectory: ExecutionTrajectory,
                           task_id: Optional[str] = None) -> List[ExpectedToolUse]:
        """
        Extract expected tool calls from trajectory.
        
        Args:
            trajectory: The execution trajectory
            task_id: Filter to specific task (optional)
            
        Returns:
            List of ExpectedToolUse objects
        """
        expected_tools = []
        
        # Get all tool calls
        tool_calls = trajectory.get_tool_calls()
        
        # Filter by task if specified
        if task_id:
            tool_calls = [tc for tc in tool_calls if tc.task_id == task_id]
        
        # Convert to ExpectedToolUse
        for tool_call in tool_calls:
            tool_name = tool_call.input_data.get("tool_name")
            if not tool_name:
                continue
            
            tool_input = None
            if self.include_tool_inputs:
                tool_input = tool_call.input_data.get("tool_input")
            
            expected_tool = ExpectedToolUse(
                tool_name=tool_name,
                tool_input=tool_input,
                match_mode=self.default_match_mode
            )
            expected_tools.append(expected_tool)
        
        return expected_tools
    
    def _extract_reference(self, 
                          trajectory: ExecutionTrajectory,
                          task_id: Optional[str] = None) -> Optional[str]:
        """
        Extract the reference (expected) response from trajectory.
        
        Looks for LLM_RESPONSE or TASK_END steps to get the final response.
        
        Args:
            trajectory: The execution trajectory
            task_id: Filter to specific task (optional)
            
        Returns:
            The reference response string, or None if not found
        """
        # Try to get from LLM_RESPONSE steps first
        llm_responses = trajectory.get_steps_by_type(StepType.LLM_RESPONSE)
        
        if task_id:
            llm_responses = [lr for lr in llm_responses if lr.task_id == task_id]
        
        # Get the last LLM response
        if llm_responses:
            last_response = llm_responses[-1]
            content = (
                last_response.output_data.get("response") or
                last_response.output_data.get("content") or
                last_response.output_data.get("text")
            )
            if content:
                return content if isinstance(content, str) else str(content)
        
        # Try task end steps
        task_ends = trajectory.get_steps_by_type(StepType.TASK_END)
        
        if task_id:
            task_ends = [te for te in task_ends if te.task_id == task_id]
        
        if task_ends:
            last_task_end = task_ends[-1]
            result = (
                last_task_end.output_data.get("result") or
                last_task_end.output_data.get("response") or
                last_task_end.output_data.get("content")
            )
            if result:
                return result if isinstance(result, str) else str(result)
        
        return None
    
    def convert_and_save(self, 
                        trajectory: Union[ExecutionTrajectory, Dict[str, Any]],
                        output_path: Union[str, Path],
                        evalset_name: Optional[str] = None) -> EvalSet:
        """
        Convert trajectory to EvalSet and save to file.
        
        Args:
            trajectory: ExecutionTrajectory or dict
            output_path: Path to save the EvalSet JSON
            evalset_name: Name for the EvalSet
            
        Returns:
            The created EvalSet
        """
        eval_set = self.convert(trajectory, evalset_name)
        eval_set.to_file(output_path)
        return eval_set
    
    def batch_convert(self, 
                     trajectories: List[Union[ExecutionTrajectory, Dict[str, Any]]],
                     evalset_name: Optional[str] = None,
                     merge: bool = True) -> EvalSet:
        """
        Convert multiple trajectories to a single EvalSet.
        
        Args:
            trajectories: List of trajectories to convert
            evalset_name: Name for the merged EvalSet
            merge: If True, merge into single EvalSet; if False, return first only
            
        Returns:
            Merged EvalSet if merge=True, otherwise first converted EvalSet
        """
        if not trajectories:
            # Return empty EvalSet
            return EvalSet(
                name=evalset_name or "empty_evalset",
                cases=[]
            )
        
        # Convert first trajectory
        first_eval_set = self.convert(trajectories[0], evalset_name)
        
        if not merge or len(trajectories) == 1:
            return first_eval_set
        
        # Merge remaining trajectories
        all_cases = list(first_eval_set.cases)
        
        for traj in trajectories[1:]:
            eval_set = self.convert(traj)
            all_cases.extend(eval_set.cases)
        
        # Create merged EvalSet
        merged_name = evalset_name or f"merged_{len(trajectories)}_trajectories"
        merged = EvalSet(
            name=merged_name,
            cases=all_cases,
            metadata={
                "merged_trajectory_count": len(trajectories),
                "source_trajectory_ids": [
                    t.trajectory_id if isinstance(t, ExecutionTrajectory) 
                    else t.get("trajectory_id", "unknown")
                    for t in trajectories
                ]
            }
        )
        
        return merged
