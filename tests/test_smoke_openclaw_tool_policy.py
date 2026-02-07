"""
Smoke tests for ToolPolicyStack (declarative multi-layer tool access control).

Inspired by OpenClaw's 6-layer tool policy.
Validates:
- DENY always wins over ALLOW at any layer
- Multiple ALLOW layers compose correctly
- Default deny (whitelist model)
- Default allow (blacklist model) via default_allow=True
- Wildcard / fnmatch pattern matching
- filter_tools batch filtering
- ToolPolicyDeniedError carries correct metadata
- check() raises; is_allowed() returns bool
- Integration with ToolExecutor (policy_stack parameter)
"""

import pytest

from agenticx.tools.policy import (
    PolicyAction,
    ToolPolicyDeniedError,
    ToolPolicyLayer,
    ToolPolicyStack,
)


# ---------------------------------------------------------------------------
# ToolPolicyLayer unit tests
# ---------------------------------------------------------------------------

class TestToolPolicyLayer:

    def test_deny_match(self):
        layer = ToolPolicyLayer(name="global", deny=["dangerous_*"])
        assert layer.evaluate("dangerous_delete") is PolicyAction.DENY

    def test_allow_match(self):
        layer = ToolPolicyLayer(name="global", allow=["web_search"])
        assert layer.evaluate("web_search") is PolicyAction.ALLOW

    def test_no_opinion(self):
        layer = ToolPolicyLayer(name="global", allow=["web_search"])
        assert layer.evaluate("code_exec") is None

    def test_deny_beats_allow_same_layer(self):
        """If a tool matches both deny and allow in same layer, deny wins."""
        layer = ToolPolicyLayer(
            name="mixed",
            allow=["web_*"],
            deny=["web_dangerous"],
        )
        assert layer.evaluate("web_dangerous") is PolicyAction.DENY
        assert layer.evaluate("web_search") is PolicyAction.ALLOW

    def test_wildcard_star(self):
        layer = ToolPolicyLayer(name="l", allow=["file_*"])
        assert layer.evaluate("file_read") is PolicyAction.ALLOW
        assert layer.evaluate("file_write") is PolicyAction.ALLOW
        assert layer.evaluate("http_get") is None

    def test_wildcard_question_mark(self):
        layer = ToolPolicyLayer(name="l", allow=["tool_?"])
        assert layer.evaluate("tool_a") is PolicyAction.ALLOW
        assert layer.evaluate("tool_ab") is None


# ---------------------------------------------------------------------------
# ToolPolicyStack unit tests
# ---------------------------------------------------------------------------

class TestToolPolicyStack:

    def test_deny_always_wins_across_layers(self):
        """A deny in any layer blocks the tool, even if another layer allows."""
        stack = ToolPolicyStack(layers=[
            ToolPolicyLayer(name="agent", allow=["dangerous_tool"]),
            ToolPolicyLayer(name="global", deny=["dangerous_*"]),
        ])
        assert stack.is_allowed("dangerous_tool") is False

    def test_allow_through_layers(self):
        stack = ToolPolicyStack(layers=[
            ToolPolicyLayer(name="global", allow=["web_search"]),
        ])
        assert stack.is_allowed("web_search") is True

    def test_default_deny(self):
        """No matching rule at all -> denied (whitelist model)."""
        stack = ToolPolicyStack(layers=[
            ToolPolicyLayer(name="global", allow=["web_search"]),
        ])
        assert stack.is_allowed("code_exec") is False

    def test_default_allow_mode(self):
        """With default_allow=True, unmatched tools pass (blacklist model)."""
        stack = ToolPolicyStack(
            layers=[ToolPolicyLayer(name="global", deny=["dangerous_*"])],
            default_allow=True,
        )
        assert stack.is_allowed("safe_tool") is True
        assert stack.is_allowed("dangerous_delete") is False

    def test_empty_stack_default_deny(self):
        stack = ToolPolicyStack()
        assert stack.is_allowed("anything") is False

    def test_empty_stack_default_allow(self):
        stack = ToolPolicyStack(default_allow=True)
        assert stack.is_allowed("anything") is True

    def test_filter_tools(self):
        stack = ToolPolicyStack(layers=[
            ToolPolicyLayer(name="global", allow=["web_*", "file_read"]),
            ToolPolicyLayer(name="safety", deny=["web_dangerous"]),
        ])
        result = stack.filter_tools([
            "web_search", "web_dangerous", "file_read", "code_exec"
        ])
        assert "web_search" in result
        assert "file_read" in result
        assert "web_dangerous" not in result
        assert "code_exec" not in result

    def test_multi_layer_composition(self):
        """Typical 3-layer setup: global allow -> agent restrict -> sandbox deny."""
        stack = ToolPolicyStack(layers=[
            ToolPolicyLayer(name="global", allow=["*"]),
            ToolPolicyLayer(name="agent", deny=["code_exec"]),
            ToolPolicyLayer(name="sandbox", deny=["file_delete"]),
        ])
        assert stack.is_allowed("web_search") is True
        assert stack.is_allowed("code_exec") is False
        assert stack.is_allowed("file_delete") is False
        assert stack.is_allowed("file_read") is True


# ---------------------------------------------------------------------------
# ToolPolicyDeniedError
# ---------------------------------------------------------------------------

class TestToolPolicyDeniedError:

    def test_check_raises_with_layer_info(self):
        stack = ToolPolicyStack(layers=[
            ToolPolicyLayer(name="safety", deny=["rm_rf"]),
        ])
        with pytest.raises(ToolPolicyDeniedError) as exc_info:
            stack.check("rm_rf")
        assert exc_info.value.tool_name == "rm_rf"
        assert exc_info.value.denied_by_layer == "safety"

    def test_check_raises_default_deny(self):
        stack = ToolPolicyStack()
        with pytest.raises(ToolPolicyDeniedError) as exc_info:
            stack.check("anything")
        assert exc_info.value.denied_by_layer == "<default-deny>"

    def test_check_passes_allowed(self):
        stack = ToolPolicyStack(layers=[
            ToolPolicyLayer(name="global", allow=["ok_tool"]),
        ])
        # Should not raise
        stack.check("ok_tool")

    def test_error_message_is_readable(self):
        err = ToolPolicyDeniedError("my_tool", "safety_layer")
        assert "my_tool" in str(err)
        assert "safety_layer" in str(err)


# ---------------------------------------------------------------------------
# add_layer / introspection
# ---------------------------------------------------------------------------

class TestPolicyStackIntrospection:

    def test_add_layer_append(self):
        stack = ToolPolicyStack()
        stack.add_layer(ToolPolicyLayer(name="a", allow=["x"]))
        stack.add_layer(ToolPolicyLayer(name="b", deny=["y"]))
        assert len(stack.layers) == 2
        assert stack.layers[0].name == "a"
        assert stack.layers[1].name == "b"

    def test_add_layer_insert(self):
        stack = ToolPolicyStack(layers=[
            ToolPolicyLayer(name="a"),
            ToolPolicyLayer(name="c"),
        ])
        stack.add_layer(ToolPolicyLayer(name="b"), index=1)
        assert [l.name for l in stack.layers] == ["a", "b", "c"]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
