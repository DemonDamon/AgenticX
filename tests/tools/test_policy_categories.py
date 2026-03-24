#!/usr/bin/env python3
"""Tests for CategoryPolicy integration with ToolPolicyStack.

Author: Damon Li
"""

import pytest
from agenticx.tools.policy import (
    ToolPolicyStack,
    ToolPolicyLayer,
    CategoryPolicy,
    ToolPolicyDeniedError,
)


def test_category_deny_blocks_tool():
    """Tools in a denied category should be blocked."""
    categories = CategoryPolicy(
        tool_categories={
            "finance_*": "financial",
            "password_*": "credentials",
        },
        denied_categories={"financial", "credentials"},
    )
    stack = ToolPolicyStack(
        layers=[
            ToolPolicyLayer(name="global", allow=["*"]),
        ],
        category_policy=categories,
    )
    assert stack.is_allowed("finance_transfer") is False
    assert stack.is_allowed("password_lookup") is False
    assert stack.is_allowed("file_read") is True


def test_category_deny_overrides_layer_allow():
    """Category deny should override layer allow."""
    categories = CategoryPolicy(
        tool_categories={"bank_*": "financial"},
        denied_categories={"financial"},
    )
    stack = ToolPolicyStack(
        layers=[
            ToolPolicyLayer(name="permissive", allow=["bank_*"]),
        ],
        category_policy=categories,
    )
    with pytest.raises(ToolPolicyDeniedError):
        stack.check("bank_transfer")


def test_first_access_tracking():
    """First-access tools should be flagged for approval."""
    categories = CategoryPolicy(
        tool_categories={},
        denied_categories=set(),
        require_first_access_approval=True,
    )
    stack = ToolPolicyStack(
        layers=[ToolPolicyLayer(name="global", allow=["*"])],
        category_policy=categories,
    )
    assert categories.is_first_access("new_app_tool") is True
    categories.mark_approved("new_app_tool")
    assert categories.is_first_access("new_app_tool") is False
