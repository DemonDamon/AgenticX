"""
Smoke tests for VeADK Trace to EvalSet Converter feature.

Tests the conversion of ExecutionTrajectory to EvalSet format.
"""

import pytest
from datetime import datetime, UTC
from agenticx.evaluation.trace_converter import TraceToEvalSetConverter
from agenticx.evaluation.evalset import EvalSet, EvalCase
from agenticx.observability.trajectory import (
    ExecutionTrajectory, TrajectoryStep, StepType, StepStatus
)


class TestTraceToEvalSetConverter:
    """Test suite for Trace to EvalSet conversion."""
    
    @pytest.fixture
    def converter(self):
        """Create a converter instance."""
        return TraceToEvalSetConverter()
    
    @pytest.fixture
    def simple_trajectory(self):
        """Create a simple trajectory with one task and tool call."""
        traj = ExecutionTrajectory(trajectory_id="test_traj_001")
        
        # Add TASK_START step
        task_start = TrajectoryStep(
            step_type=StepType.TASK_START,
            status=StepStatus.COMPLETED,
            task_id="task_001",
            input_data={
                "task_description": "Calculate 2 + 2",
                "query": "What is 2 + 2?"
            }
        )
        traj.add_step(task_start)
        
        # Add TOOL_CALL step
        tool_call = TrajectoryStep(
            step_type=StepType.TOOL_CALL,
            status=StepStatus.COMPLETED,
            task_id="task_001",
            input_data={
                "tool_name": "calculator",
                "tool_input": {"a": 2, "b": 2}
            }
        )
        traj.add_step(tool_call)
        
        # Add TOOL_RESULT step
        tool_result = TrajectoryStep(
            step_type=StepType.TOOL_RESULT,
            status=StepStatus.COMPLETED,
            task_id="task_001",
            output_data={"result": 4}
        )
        traj.add_step(tool_result)
        
        # Add LLM_RESPONSE step
        llm_response = TrajectoryStep(
            step_type=StepType.LLM_RESPONSE,
            status=StepStatus.COMPLETED,
            task_id="task_001",
            output_data={
                "response": "2 + 2 equals 4",
                "content": "2 + 2 equals 4"
            }
        )
        traj.add_step(llm_response)
        
        # Add TASK_END step
        task_end = TrajectoryStep(
            step_type=StepType.TASK_END,
            status=StepStatus.COMPLETED,
            task_id="task_001",
            output_data={"result": "2 + 2 equals 4"}
        )
        traj.add_step(task_end)
        
        traj.finalize(StepStatus.COMPLETED, {"success": True})
        return traj
    
    def test_convert_simple_trajectory(self, converter, simple_trajectory):
        """Test converting a simple trajectory to EvalSet."""
        eval_set = converter.convert(simple_trajectory)
        
        assert isinstance(eval_set, EvalSet)
        assert len(eval_set.cases) > 0
        assert eval_set.name.startswith("trace_")
        
    def test_extracted_query(self, converter, simple_trajectory):
        """Test that query is extracted correctly."""
        eval_set = converter.convert(simple_trajectory)
        
        assert len(eval_set.cases) > 0
        case = eval_set.cases[0]
        assert case.query == "What is 2 + 2?"
    
    def test_extracted_tool_calls(self, converter, simple_trajectory):
        """Test that tool calls are extracted."""
        eval_set = converter.convert(simple_trajectory)
        
        case = eval_set.cases[0]
        assert case.expected_tool_use is not None
        assert len(case.expected_tool_use) > 0
        assert case.expected_tool_use[0].tool_name == "calculator"
    
    def test_extracted_reference(self, converter, simple_trajectory):
        """Test that reference response is extracted."""
        eval_set = converter.convert(simple_trajectory)
        
        case = eval_set.cases[0]
        assert case.reference is not None
        assert "4" in case.reference
    
    def test_empty_trajectory(self, converter):
        """Test converting empty trajectory (no tasks)."""
        traj = ExecutionTrajectory(trajectory_id="empty_traj")
        traj.finalize(StepStatus.COMPLETED)
        
        eval_set = converter.convert(traj)
        
        assert isinstance(eval_set, EvalSet)
        assert len(eval_set.cases) == 0
    
    def test_convert_from_dict(self, converter, simple_trajectory):
        """Test converting from dict representation."""
        traj_dict = simple_trajectory.to_dict()
        eval_set = converter.convert(traj_dict)
        
        assert isinstance(eval_set, EvalSet)
        assert len(eval_set.cases) > 0
    
    def test_custom_evalset_name(self, converter, simple_trajectory):
        """Test setting custom EvalSet name."""
        eval_set = converter.convert(simple_trajectory, evalset_name="my_custom_set")
        
        assert eval_set.name == "my_custom_set"
    
    def test_tool_input_not_included_by_default(self, converter, simple_trajectory):
        """Test that tool inputs are not included by default."""
        converter_no_input = TraceToEvalSetConverter(include_tool_inputs=False)
        eval_set = converter_no_input.convert(simple_trajectory)
        
        case = eval_set.cases[0]
        assert case.expected_tool_use[0].tool_input is None
    
    def test_tool_input_included_when_requested(self, converter, simple_trajectory):
        """Test that tool inputs are included when requested."""
        converter_with_input = TraceToEvalSetConverter(include_tool_inputs=True)
        eval_set = converter_with_input.convert(simple_trajectory)
        
        case = eval_set.cases[0]
        assert case.expected_tool_use[0].tool_input is not None
    
    def test_multiple_tasks_extraction(self, converter):
        """Test extraction from trajectory with multiple tasks."""
        traj = ExecutionTrajectory(trajectory_id="multi_task_traj")
        
        # First task
        task_start_1 = TrajectoryStep(
            step_type=StepType.TASK_START,
            status=StepStatus.COMPLETED,
            task_id="task_001",
            input_data={"query": "Task 1"}
        )
        traj.add_step(task_start_1)
        
        # Second task
        task_start_2 = TrajectoryStep(
            step_type=StepType.TASK_START,
            status=StepStatus.COMPLETED,
            task_id="task_002",
            input_data={"query": "Task 2"}
        )
        traj.add_step(task_start_2)
        
        traj.finalize(StepStatus.COMPLETED)
        
        eval_set = converter.convert(traj)
        assert len(eval_set.cases) == 2
        assert eval_set.cases[0].query == "Task 1"
        assert eval_set.cases[1].query == "Task 2"
    
    def test_batch_convert_empty_list(self, converter):
        """Test batch convert with empty list."""
        eval_set = converter.batch_convert([])
        
        assert isinstance(eval_set, EvalSet)
        assert len(eval_set.cases) == 0
    
    def test_batch_convert_single_trajectory(self, converter, simple_trajectory):
        """Test batch convert with single trajectory."""
        eval_set = converter.batch_convert([simple_trajectory])
        
        assert len(eval_set.cases) > 0
    
    def test_batch_convert_multiple_trajectories(self, converter, simple_trajectory):
        """Test batch convert with multiple trajectories."""
        traj1 = simple_trajectory
        
        traj2 = ExecutionTrajectory(trajectory_id="test_traj_002")
        task_start = TrajectoryStep(
            step_type=StepType.TASK_START,
            status=StepStatus.COMPLETED,
            task_id="task_101",
            input_data={"query": "Another query"}
        )
        traj2.add_step(task_start)
        traj2.finalize(StepStatus.COMPLETED)
        
        eval_set = converter.batch_convert([traj1, traj2], merge=True)
        
        assert len(eval_set.cases) == 2
    
    def test_metadata_preserved(self, converter, simple_trajectory):
        """Test that trajectory metadata is preserved."""
        eval_set = converter.convert(simple_trajectory)
        
        assert "source_trajectory_id" in eval_set.metadata
        assert eval_set.metadata["source_trajectory_id"] == "test_traj_001"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
