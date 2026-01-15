"""
Smoke Tests for GuideRails Output Validation (AIGNE Internalization - P1)

测试覆盖：
- 正常路径：通过/中止/修改输出
- 边界情况：禁用 GuideRails、空验证器列表、最大修改次数限制

运行方式：
    pytest -q tests/test_smoke_aigne_guiderails.py
    pytest -q -k "smoke_aigne_guiderails"
"""

import pytest
from unittest.mock import MagicMock

from agenticx.core.guiderails import (
    GuideRails,
    GuideRailsAction,
    GuideRailsResult,
    GuideRailsConfig,
    GuideRailsContext,
    GuideRailsAbortError,
    GuideRailsRunResult,
    BaseGuideRailsValidator,
)


# =============================================================================
# Test Fixtures
# =============================================================================

@pytest.fixture
def sample_output():
    """Sample agent output for testing."""
    return {"response": "Hello, world!", "confidence": 0.9}


@pytest.fixture
def sample_context():
    """Sample context for testing."""
    return GuideRailsContext(
        agent_id="test_agent",
        task_id="test_task",
        metadata={"test": True}
    )


@pytest.fixture
def default_config():
    """Default GuideRails config."""
    return GuideRailsConfig()


# =============================================================================
# GuideRailsResult Tests
# =============================================================================

class TestGuideRailsResult:
    """Tests for GuideRailsResult."""
    
    def test_allow_factory(self):
        """Test GuideRailsResult.allow() factory method."""
        result = GuideRailsResult.allow(output={"test": "data"}, reason="All good")
        
        assert result.action == GuideRailsAction.PASS
        assert result.output == {"test": "data"}
        assert result.reason == "All good"
    
    def test_modify_factory(self):
        """Test GuideRailsResult.modify() factory method."""
        result = GuideRailsResult.modify(output={"modified": True}, reason="Needs fix")
        
        assert result.action == GuideRailsAction.MODIFY
        assert result.output == {"modified": True}
        assert result.reason == "Needs fix"
    
    def test_abort_factory(self):
        """Test GuideRailsResult.abort() factory method."""
        result = GuideRailsResult.abort(reason="Invalid output")
        
        assert result.action == GuideRailsAction.ABORT
        assert result.output is None
        assert result.reason == "Invalid output"


# =============================================================================
# Validator Tests
# =============================================================================

class TestBaseGuideRailsValidator:
    """Tests for BaseGuideRailsValidator."""
    
    def test_custom_validator(self, sample_output, sample_context):
        """Test creating a custom validator."""
        class CustomValidator(BaseGuideRailsValidator):
            def validate(self, output, context):
                if "error" in str(output).lower():
                    return GuideRailsResult.abort("Contains error")
                return GuideRailsResult.allow()
        
        validator = CustomValidator()
        result = validator.validate(sample_output, sample_context)
        
        assert result is not None
        assert result.action == GuideRailsAction.PASS
    
    def test_custom_validator_abort(self, sample_context):
        """Test custom validator that aborts."""
        class ErrorValidator(BaseGuideRailsValidator):
            def validate(self, output, context):
                return GuideRailsResult.abort("Found error in output")
        
        validator = ErrorValidator()
        result = validator.validate({"error": "something"}, sample_context)
        
        assert result.action == GuideRailsAction.ABORT
        assert "error" in result.reason.lower()


# =============================================================================
# GuideRails Core Tests
# =============================================================================

class TestGuideRails:
    """Tests for GuideRails core functionality."""
    
    def test_run_with_no_validators(self, sample_output, sample_context):
        """Test running GuideRails with no validators."""
        guiderails = GuideRails(validators=[])
        
        result = guiderails.run(sample_output, sample_context)
        
        assert result.action == GuideRailsAction.PASS
        assert result.output == sample_output
        assert result.validator_count == 0
        assert not result.modified
    
    def test_run_disabled(self, sample_output, sample_context):
        """Test running GuideRails when disabled."""
        validator = MagicMock(return_value=GuideRailsResult.abort("Should not run"))
        guiderails = GuideRails(validators=[validator], config=GuideRailsConfig(enabled=False))
        
        result = guiderails.run(sample_output, sample_context)
        
        assert result.action == GuideRailsAction.PASS
        assert result.output == sample_output
        # Validator should not be called
        validator.assert_not_called()
    
    def test_run_all_pass(self, sample_output, sample_context):
        """Test running GuideRails where all validators pass."""
        def pass_validator(output, context):
            return GuideRailsResult.allow()
        
        guiderails = GuideRails(validators=[pass_validator, pass_validator])
        result = guiderails.run(sample_output, sample_context)
        
        assert result.action == GuideRailsAction.PASS
        assert result.output == sample_output
        assert result.validator_count == 2
        assert not result.modified
    
    def test_run_with_abort(self, sample_output, sample_context):
        """Test running GuideRails where a validator aborts."""
        def abort_validator(output, context):
            return GuideRailsResult.abort("Invalid content detected")
        
        guiderails = GuideRails(validators=[abort_validator])
        result = guiderails.run(sample_output, sample_context)
        
        assert result.action == GuideRailsAction.ABORT
        assert result.output == sample_output
        assert "Invalid content" in result.reasons[0]
        assert result.validator_count == 1
    
    def test_run_with_modify(self, sample_output, sample_context):
        """Test running GuideRails where a validator modifies output."""
        def modify_validator(output, context):
            modified = output.copy()
            modified["modified"] = True
            return GuideRailsResult.modify(output=modified, reason="Added flag")
        
        guiderails = GuideRails(validators=[modify_validator])
        result = guiderails.run(sample_output, sample_context)
        
        assert result.action == GuideRailsAction.MODIFY
        assert result.output["modified"] is True
        assert result.modified is True
        assert "Added flag" in result.reasons[0]
    
    def test_run_multiple_modifications(self, sample_output, sample_context):
        """Test running GuideRails with multiple modifications."""
        def modify1(output, context):
            modified = output.copy()
            modified["step1"] = True
            return GuideRailsResult.modify(output=modified, reason="Step 1")
        
        def modify2(output, context):
            modified = output.copy()
            modified["step2"] = True
            return GuideRailsResult.modify(output=modified, reason="Step 2")
        
        guiderails = GuideRails(validators=[modify1, modify2])
        result = guiderails.run(sample_output, sample_context)
        
        assert result.action == GuideRailsAction.MODIFY
        assert result.output["step1"] is True
        assert result.output["step2"] is True
        assert len(result.reasons) == 2
    
    def test_run_max_modifications_limit(self, sample_output, sample_context):
        """Test that max_modifications limit is respected."""
        def modify_validator(output, context):
            modified = output.copy()
            modified["count"] = modified.get("count", 0) + 1
            return GuideRailsResult.modify(output=modified, reason="Modify")
        
        config = GuideRailsConfig(max_modifications=2)
        guiderails = GuideRails(
            validators=[modify_validator] * 5,  # 5 validators
            config=config
        )
        
        result = guiderails.run(sample_output, sample_context)
        
        assert result.action == GuideRailsAction.MODIFY
        # Should stop after 2 modifications
        assert result.output.get("count", 0) <= 2
    
    def test_run_modify_not_allowed(self, sample_output, sample_context):
        """Test that modify action aborts when not allowed."""
        def modify_validator(output, context):
            return GuideRailsResult.modify(output={"modified": True}, reason="Try modify")
        
        config = GuideRailsConfig(allow_modify=False)
        guiderails = GuideRails(validators=[modify_validator], config=config)
        
        result = guiderails.run(sample_output, sample_context)
        
        # Should abort when modify is not allowed
        assert result.action == GuideRailsAction.ABORT
        assert "Try modify" in result.reasons[0]
    
    def test_run_validator_returns_none(self, sample_output, sample_context):
        """Test validator that returns None (skip)."""
        def skip_validator(output, context):
            return None
        
        def pass_validator(output, context):
            return GuideRailsResult.allow()
        
        guiderails = GuideRails(validators=[skip_validator, pass_validator])
        result = guiderails.run(sample_output, sample_context)
        
        assert result.action == GuideRailsAction.PASS
        assert result.validator_count == 2
    
    def test_run_validator_returns_bool(self, sample_output, sample_context):
        """Test validator that returns bool."""
        def bool_validator(output, context):
            return True  # Should be converted to GuideRailsResult.allow()
        
        guiderails = GuideRails(validators=[bool_validator])
        result = guiderails.run(sample_output, sample_context)
        
        assert result.action == GuideRailsAction.PASS
    
    def test_run_validator_returns_false(self, sample_output, sample_context):
        """Test validator that returns False (abort)."""
        def false_validator(output, context):
            return False  # Should be converted to GuideRailsResult.abort()
        
        guiderails = GuideRails(validators=[false_validator])
        result = guiderails.run(sample_output, sample_context)
        
        assert result.action == GuideRailsAction.ABORT
    
    def test_run_stop_on_first_abort(self, sample_output, sample_context):
        """Test that execution stops on first abort."""
        def abort_validator(output, context):
            return GuideRailsResult.abort("First abort")
        
        def never_called_validator(output, context):
            # Should never be called
            return GuideRailsResult.allow()
        
        config = GuideRailsConfig(stop_on_first_abort=True)
        guiderails = GuideRails(
            validators=[abort_validator, never_called_validator],
            config=config
        )
        
        result = guiderails.run(sample_output, sample_context)
        
        assert result.action == GuideRailsAction.ABORT
        assert result.validator_count == 2  # Count includes all validators
        # But only first validator should have been executed
    
    def test_run_with_context(self, sample_output):
        """Test that context is passed to validators."""
        received_context = None
        
        def context_validator(output, context):
            nonlocal received_context
            received_context = context
            return GuideRailsResult.allow()
        
        context = GuideRailsContext(agent_id="test_agent", task_id="test_task")
        guiderails = GuideRails(validators=[context_validator])
        guiderails.run(sample_output, context)
        
        assert received_context is not None
        assert received_context.agent_id == "test_agent"
        assert received_context.task_id == "test_task"
    
    def test_run_result_summary(self, sample_output, sample_context):
        """Test GuideRailsRunResult.summary() method."""
        def abort_validator(output, context):
            return GuideRailsResult.abort("Reason 1")
        
        guiderails = GuideRails(validators=[abort_validator])
        result = guiderails.run(sample_output, sample_context)
        
        summary = result.summary()
        assert "action=abort" in summary.lower()
        assert "reason" in summary.lower()


# =============================================================================
# Edge Cases
# =============================================================================

class TestEdgeCases:
    """Tests for edge cases and error handling."""
    
    def test_validator_raises_exception(self, sample_output, sample_context):
        """Test validator that raises an exception."""
        def error_validator(output, context):
            raise ValueError("Validator error")
        
        guiderails = GuideRails(validators=[error_validator])
        
        # Should propagate exception
        with pytest.raises(ValueError, match="Validator error"):
            guiderails.run(sample_output, sample_context)
    
    def test_validator_returns_invalid_type(self, sample_output, sample_context):
        """Test validator that returns invalid type."""
        def invalid_validator(output, context):
            return "invalid"  # Not GuideRailsResult, bool, or None
        
        guiderails = GuideRails(validators=[invalid_validator])
        
        with pytest.raises(TypeError, match="must return GuideRailsResult"):
            guiderails.run(sample_output, sample_context)
    
    def test_empty_output(self, sample_context):
        """Test GuideRails with empty output."""
        def pass_validator(output, context):
            return GuideRailsResult.allow()
        
        guiderails = GuideRails(validators=[pass_validator])
        result = guiderails.run(None, sample_context)
        
        assert result.action == GuideRailsAction.PASS
        assert result.output is None
    
    def test_config_override(self, sample_output, sample_context):
        """Test that config can be overridden in run()."""
        def modify_validator(output, context):
            return GuideRailsResult.modify(output={"modified": True})
        
        default_config = GuideRailsConfig(allow_modify=False)
        override_config = GuideRailsConfig(allow_modify=True)
        
        guiderails = GuideRails(validators=[modify_validator], config=default_config)
        
        # With default config, should abort
        result1 = guiderails.run(sample_output, sample_context)
        assert result1.action == GuideRailsAction.ABORT
        
        # With override config, should modify
        result2 = guiderails.run(sample_output, sample_context, config=override_config)
        assert result2.action == GuideRailsAction.MODIFY


# =============================================================================
# Integration Tests
# =============================================================================

class TestIntegration:
    """Integration tests for GuideRails."""
    
    def test_multiple_validator_types(self, sample_output, sample_context):
        """Test mixing different validator types."""
        class ClassValidator(BaseGuideRailsValidator):
            def validate(self, output, context):
                return GuideRailsResult.allow(reason="Class validator")
        
        def function_validator(output, context):
            return GuideRailsResult.allow(reason="Function validator")
        
        def bool_validator(output, context):
            return True
        
        guiderails = GuideRails(validators=[
            ClassValidator(),
            function_validator,
            bool_validator
        ])
        
        result = guiderails.run(sample_output, sample_context)
        
        assert result.action == GuideRailsAction.PASS
        assert result.validator_count == 3
    
    def test_complex_modification_chain(self, sample_output, sample_context):
        """Test a chain of modifications."""
        def step1(output, context):
            modified = output.copy()
            modified["step"] = 1
            return GuideRailsResult.modify(output=modified, reason="Step 1")
        
        def step2(output, context):
            modified = output.copy()
            modified["step"] = 2
            return GuideRailsResult.modify(output=modified, reason="Step 2")
        
        def final_check(output, context):
            if output.get("step") == 2:
                return GuideRailsResult.allow(reason="Final check passed")
            return GuideRailsResult.abort("Final check failed")
        
        guiderails = GuideRails(validators=[step1, step2, final_check])
        result = guiderails.run(sample_output, sample_context)
        
        assert result.action == GuideRailsAction.MODIFY
        assert result.output["step"] == 2
        assert len(result.reasons) == 3


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
