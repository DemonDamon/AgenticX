"""
Smoke Tests for Handoff Mechanism (AIGNE Internalization - P1)

测试覆盖：
- 正常切换路径
- 缺失 agent 边界情况
- 循环切换检测
- 事件创建和解析

运行方式：
    pytest -q tests/test_smoke_aigne_handoff.py
    pytest -q -k "smoke_aigne_handoff"
"""

import pytest
from datetime import datetime, timezone

from agenticx.core.handoff import (
    HandoffOutput,
    AgentHandoffEvent,
    AgentHandoffError,
    HandoffCycleError,
    HandoffTargetNotFoundError,
    is_handoff_output,
    parse_handoff_output,
    create_handoff_event,
    check_handoff_cycle,
)


# =============================================================================
# HandoffOutput Tests
# =============================================================================

class TestHandoffOutput:
    """Tests for HandoffOutput."""
    
    def test_create_with_agent_id(self):
        """Test creating HandoffOutput with agent ID."""
        handoff = HandoffOutput(
            target_agent_id="agent_123",
            reason="Need specialist",
            payload={"data": "test"}
        )
        
        assert handoff.target_agent_id == "agent_123"
        assert handoff.reason == "Need specialist"
        assert handoff.payload == {"data": "test"}
    
    def test_create_with_agent_name(self):
        """Test creating HandoffOutput with agent name."""
        handoff = HandoffOutput(
            target_agent_name="SpecialistAgent",
            reason="Domain expertise required"
        )
        
        assert handoff.target_agent_name == "SpecialistAgent"
        assert handoff.target_agent_id is None
    
    def test_get_target_identifier(self):
        """Test get_target_identifier() method."""
        # With ID
        handoff1 = HandoffOutput(target_agent_id="agent_123")
        assert handoff1.get_target_identifier() == "agent_123"
        
        # With name only
        handoff2 = HandoffOutput(target_agent_name="SpecialistAgent")
        assert handoff2.get_target_identifier() == "SpecialistAgent"
        
        # Neither (should return "unknown")
        handoff3 = HandoffOutput()
        assert handoff3.get_target_identifier() == "unknown"
    
    def test_ensure_target_success(self):
        """Test ensure_target() with valid target."""
        handoff = HandoffOutput(target_agent_id="agent_123")
        # Should not raise
        handoff.ensure_target()
    
    def test_ensure_target_failure(self):
        """Test ensure_target() without target raises ValueError."""
        handoff = HandoffOutput()
        
        with pytest.raises(ValueError, match="requires target_agent_id"):
            handoff.ensure_target()
    
    def test_metadata_field(self):
        """Test metadata field."""
        handoff = HandoffOutput(
            target_agent_id="agent_123",
            metadata={"priority": "high", "source": "test"}
        )
        
        assert handoff.metadata["priority"] == "high"
        assert handoff.metadata["source"] == "test"


# =============================================================================
# is_handoff_output Tests
# =============================================================================

class TestIsHandoffOutput:
    """Tests for is_handoff_output() function."""
    
    def test_handoff_output_instance(self):
        """Test with HandoffOutput instance."""
        handoff = HandoffOutput(target_agent_id="agent_123")
        assert is_handoff_output(handoff) is True
    
    def test_non_handoff_output(self):
        """Test with non-HandoffOutput values."""
        assert is_handoff_output("string") is False
        assert is_handoff_output({"key": "value"}) is False
        assert is_handoff_output(None) is False
        assert is_handoff_output(123) is False


# =============================================================================
# parse_handoff_output Tests
# =============================================================================

class TestParseHandoffOutput:
    """Tests for parse_handoff_output() function."""
    
    def test_parse_handoff_output_instance(self):
        """Test parsing HandoffOutput instance."""
        handoff = HandoffOutput(target_agent_id="agent_123")
        result = parse_handoff_output(handoff)
        
        assert result is handoff  # Should return same instance
    
    def test_parse_dict_with_handoff_key(self):
        """Test parsing dict with 'handoff' key."""
        data = {
            "handoff": {
                "target_agent_id": "agent_123",
                "reason": "Test handoff"
            }
        }
        
        result = parse_handoff_output(data)
        
        assert isinstance(result, HandoffOutput)
        assert result.target_agent_id == "agent_123"
        assert result.reason == "Test handoff"
    
    def test_parse_dict_with_target_keys(self):
        """Test parsing dict with target_agent_id/name keys."""
        data = {
            "target_agent_id": "agent_456",
            "reason": "Direct handoff"
        }
        
        result = parse_handoff_output(data)
        
        assert isinstance(result, HandoffOutput)
        assert result.target_agent_id == "agent_456"
    
    def test_parse_dict_with_target_name(self):
        """Test parsing dict with target_agent_name."""
        data = {
            "target_agent_name": "SpecialistAgent",
            "reason": "Name-based handoff"
        }
        
        result = parse_handoff_output(data)
        
        assert isinstance(result, HandoffOutput)
        assert result.target_agent_name == "SpecialistAgent"
    
    def test_parse_invalid_dict(self):
        """Test parsing invalid dict returns None."""
        data = {"some_other_key": "value"}
        result = parse_handoff_output(data)
        
        assert result is None
    
    def test_parse_non_dict_non_handoff(self):
        """Test parsing non-dict, non-HandoffOutput returns None."""
        assert parse_handoff_output("string") is None
        assert parse_handoff_output(123) is None
        assert parse_handoff_output(None) is None
    
    def test_parse_dict_with_invalid_handoff_data(self):
        """Test parsing dict with invalid handoff data."""
        data = {
            "handoff": "not_a_dict"
        }
        
        result = parse_handoff_output(data)
        # Should return None (handoff key exists but value is not dict)
        assert result is None


# =============================================================================
# create_handoff_event Tests
# =============================================================================

class TestCreateHandoffEvent:
    """Tests for create_handoff_event() function."""
    
    def test_create_basic_event(self):
        """Test creating a basic handoff event."""
        handoff = HandoffOutput(
            target_agent_id="target_agent",
            reason="Test handoff",
            payload={"data": "test"}
        )
        
        event = create_handoff_event(
            handoff=handoff,
            source_agent_id="source_agent",
            source_agent_name="SourceAgent",
            task_id="task_123"
        )
        
        assert isinstance(event, AgentHandoffEvent)
        assert event.type == "agent_handoff"
        assert event.source_agent_id == "source_agent"
        assert event.target_agent_id == "target_agent"
        assert event.reason == "Test handoff"
        assert event.payload == {"data": "test"}
        assert event.task_id == "task_123"
    
    def test_create_event_with_handoff_chain(self):
        """Test creating event with handoff chain."""
        handoff = HandoffOutput(target_agent_id="agent_c")
        chain = ["agent_a", "agent_b"]
        
        event = create_handoff_event(
            handoff=handoff,
            source_agent_id="agent_b",
            handoff_chain=chain
        )
        
        assert len(event.handoff_chain) == 3  # agent_a, agent_b, agent_c
        assert event.handoff_chain[-1] == "agent_c"
    
    def test_create_event_adds_source_to_chain(self):
        """Test that source agent is added to chain if not present."""
        handoff = HandoffOutput(target_agent_id="agent_b")
        
        event = create_handoff_event(
            handoff=handoff,
            source_agent_id="agent_a",
            handoff_chain=[]
        )
        
        assert "agent_a" in event.handoff_chain
        assert len(event.handoff_chain) == 2  # agent_a, agent_b
    
    def test_create_event_with_metadata(self):
        """Test creating event preserves handoff metadata."""
        handoff = HandoffOutput(
            target_agent_id="agent_123",
            metadata={"priority": "high"}
        )
        
        event = create_handoff_event(handoff=handoff)
        
        assert event.data["metadata"]["priority"] == "high"
    
    def test_create_event_generates_id_and_timestamp(self):
        """Test that event gets ID and timestamp."""
        handoff = HandoffOutput(target_agent_id="agent_123")
        event = create_handoff_event(handoff=handoff)
        
        assert event.id is not None
        assert isinstance(event.timestamp, datetime)


# =============================================================================
# check_handoff_cycle Tests
# =============================================================================

class TestCheckHandoffCycle:
    """Tests for check_handoff_cycle() function."""
    
    def test_no_cycle(self):
        """Test check_handoff_cycle with no cycle."""
        chain = ["agent_a", "agent_b"]
        # Should not raise
        check_handoff_cycle("agent_c", chain)
    
    def test_detect_cycle(self):
        """Test detection of handoff cycle."""
        chain = ["agent_a", "agent_b", "agent_c"]
        
        with pytest.raises(HandoffCycleError) as exc_info:
            check_handoff_cycle("agent_b", chain)  # agent_b is already in chain
        
        assert "cycle detected" in str(exc_info.value).lower()
        assert "agent_b" in exc_info.value.cycle_chain
    
    def test_detect_cycle_at_start(self):
        """Test detection of cycle back to first agent."""
        chain = ["agent_a", "agent_b"]
        
        with pytest.raises(HandoffCycleError):
            check_handoff_cycle("agent_a", chain)
    
    def test_max_chain_length_exceeded(self):
        """Test that max chain length is enforced."""
        long_chain = [f"agent_{i}" for i in range(10)]
        
        with pytest.raises(HandoffCycleError) as exc_info:
            check_handoff_cycle("agent_10", long_chain, max_chain_length=10)
        
        # Should raise because chain length (10) >= max_chain_length (10)
        assert isinstance(exc_info.value, HandoffCycleError)
    
    def test_max_chain_length_within_limit(self):
        """Test that chain within limit doesn't raise."""
        chain = [f"agent_{i}" for i in range(5)]
        # Should not raise
        check_handoff_cycle("agent_5", chain, max_chain_length=10)
    
    def test_empty_chain(self):
        """Test check_handoff_cycle with empty chain."""
        # Should not raise
        check_handoff_cycle("agent_a", [])


# =============================================================================
# Exception Tests
# =============================================================================

class TestHandoffExceptions:
    """Tests for handoff-related exceptions."""
    
    def test_agent_handoff_error(self):
        """Test AgentHandoffError creation."""
        error = AgentHandoffError(
            "Test error",
            source_agent_id="source",
            target_agent_id="target",
            reason="Test reason"
        )
        
        assert str(error) == "Test error"
        assert error.source_agent_id == "source"
        assert error.target_agent_id == "target"
        assert error.reason == "Test reason"
    
    def test_handoff_cycle_error(self):
        """Test HandoffCycleError creation."""
        cycle = ["agent_a", "agent_b", "agent_a"]
        error = HandoffCycleError(cycle)
        
        assert "cycle detected" in str(error).lower()
        assert error.cycle_chain == cycle
        assert isinstance(error, AgentHandoffError)
    
    def test_handoff_target_not_found_error(self):
        """Test HandoffTargetNotFoundError creation."""
        error = HandoffTargetNotFoundError("missing_agent")
        
        assert "not found" in str(error).lower()
        assert "missing_agent" in str(error)
        assert error.target_identifier == "missing_agent"
        assert isinstance(error, AgentHandoffError)


# =============================================================================
# Integration Tests
# =============================================================================

class TestIntegration:
    """Integration tests for handoff mechanism."""
    
    def test_full_handoff_flow(self):
        """Test complete handoff flow."""
        # 1. Agent creates HandoffOutput
        handoff = HandoffOutput(
            target_agent_id="specialist_agent",
            reason="Need domain expertise",
            payload={"task": "complex_task"}
        )
        
        # 2. Check if it's a handoff output
        assert is_handoff_output(handoff) is True
        
        # 3. Create event
        event = create_handoff_event(
            handoff=handoff,
            source_agent_id="general_agent",
            source_agent_name="GeneralAgent",
            task_id="task_123"
        )
        
        # 4. Verify event
        assert event.type == "agent_handoff"
        assert event.source_agent_id == "general_agent"
        assert event.target_agent_id == "specialist_agent"
        assert event.reason == "Need domain expertise"
    
    def test_handoff_chain_tracking(self):
        """Test handoff chain tracking across multiple handoffs."""
        chain = []
        
        # First handoff
        handoff1 = HandoffOutput(target_agent_id="agent_b")
        event1 = create_handoff_event(
            handoff=handoff1,
            source_agent_id="agent_a",
            handoff_chain=chain
        )
        chain = event1.handoff_chain.copy()
        
        # Second handoff
        handoff2 = HandoffOutput(target_agent_id="agent_c")
        event2 = create_handoff_event(
            handoff=handoff2,
            source_agent_id="agent_b",
            handoff_chain=chain
        )
        
        assert len(event2.handoff_chain) == 3
        assert event2.handoff_chain == ["agent_a", "agent_b", "agent_c"]
    
    def test_cycle_detection_in_chain(self):
        """Test cycle detection in handoff chain."""
        chain = ["agent_a", "agent_b", "agent_c"]
        
        # Try to handoff back to agent_b (creates cycle)
        with pytest.raises(HandoffCycleError) as exc_info:
            check_handoff_cycle("agent_b", chain)
        
        cycle = exc_info.value.cycle_chain
        assert cycle[-1] == "agent_b"
        assert cycle[cycle.index("agent_b")] == "agent_b"  # agent_b appears twice


# =============================================================================
# Edge Cases
# =============================================================================

class TestEdgeCases:
    """Tests for edge cases."""
    
    def test_handoff_output_with_both_id_and_name(self):
        """Test HandoffOutput with both ID and name."""
        handoff = HandoffOutput(
            target_agent_id="agent_123",
            target_agent_name="SpecialistAgent"
        )
        
        # get_target_identifier should prefer ID
        assert handoff.get_target_identifier() == "agent_123"
    
    def test_parse_handoff_output_with_nested_structure(self):
        """Test parsing handoff from nested structure."""
        data = {
            "result": "some_result",
            "handoff": {
                "target_agent_id": "agent_123",
                "reason": "Nested handoff"
            }
        }
        
        result = parse_handoff_output(data)
        
        assert isinstance(result, HandoffOutput)
        assert result.target_agent_id == "agent_123"
    
    def test_create_event_without_source(self):
        """Test creating event without source agent info."""
        handoff = HandoffOutput(target_agent_id="target")
        event = create_handoff_event(handoff=handoff)
        
        assert event.source_agent_id is None
        assert event.target_agent_id == "target"
    
    def test_check_cycle_with_same_agent(self):
        """Test cycle detection when handing off to same agent."""
        chain = ["agent_a"]
        
        with pytest.raises(HandoffCycleError):
            check_handoff_cycle("agent_a", chain)
    
    def test_handoff_output_with_empty_payload(self):
        """Test HandoffOutput with empty payload."""
        handoff = HandoffOutput(
            target_agent_id="agent_123",
            payload={}
        )
        
        assert handoff.payload == {}
        assert handoff.payload is not None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
