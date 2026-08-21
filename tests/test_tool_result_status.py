#!/usr/bin/env python3
"""Tests for tool result -> tool_status classification.

Author: Damon Li
"""

from __future__ import annotations

import json

from agenticx.runtime.tool_result_status import result_is_error, tool_status_for_result


def test_error_prefix_string_is_an_error() -> None:
    assert tool_status_for_result("ERROR: query is required") == "error"


def test_json_error_payload_is_an_error() -> None:
    """实测回归：tool_search 少传 query 时返回的就是这个，历史上被记成 done。

    记成 done 的后果不只是图标：前端把 toolStatus=="error" 当作关键状态强制展开过程卡，
    报成 done 就会被折叠进「已完成 N 个步骤」，用户完全看不到这一步失败了。
    """
    assert tool_status_for_result(json.dumps({"error": "query is required"})) == "error"


def test_ok_false_payload_is_an_error() -> None:
    assert tool_status_for_result(json.dumps({"ok": False, "error": "boom", "hits": []})) == "error"


def test_dict_result_is_classified_without_serializing() -> None:
    assert result_is_error({"error": "nope"}) is True
    assert result_is_error({"ok": True, "error": None}) is False


def test_ok_true_wins_over_an_empty_error_field() -> None:
    assert tool_status_for_result(json.dumps({"ok": True, "error": ""})) == "done"


def test_plain_success_payloads_stay_done() -> None:
    assert tool_status_for_result(json.dumps({"results": [1, 2]})) == "done"
    assert tool_status_for_result("all good") == "done"
    assert tool_status_for_result("") == "done"
    assert tool_status_for_result(None) == "done"


def test_prose_mentioning_error_is_not_an_error() -> None:
    """判定取保守的一侧：正文里提到 error 不该把成功的一步染红。"""
    assert tool_status_for_result("no error occurred while reading the file") == "done"
    assert tool_status_for_result('the config key is "error_log"') == "done"


def test_malformed_json_is_not_an_error() -> None:
    assert tool_status_for_result('{"error": ') == "done"
