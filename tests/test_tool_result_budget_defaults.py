from agenticx.runtime.tool_result_budget import ToolResultBudgetConfig


def test_keep_rounds_default_is_8():
    cfg = ToolResultBudgetConfig()
    assert cfg.keep_rounds == 8
