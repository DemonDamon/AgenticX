from __future__ import annotations

import json
from pathlib import Path

from jsonschema import Draft202012Validator


def _load_schema() -> dict:
    schema_path = Path("agenticx/cli/mcp_schema.json")
    return json.loads(schema_path.read_text(encoding="utf-8"))


def _validate(payload: dict) -> list:
    validator = Draft202012Validator(_load_schema())
    return list(validator.iter_errors(payload))


def test_valid_wrapped_stdio_server() -> None:
    errors = _validate(
        {
            "mcpServers": {
                "fetch": {
                    "command": "uvx",
                    "args": ["mcp-server-fetch"],
                    "env": {"A": "1"},
                    "timeout": 60
                }
            }
        }
    )
    assert errors == []


def test_valid_root_url_server() -> None:
    errors = _validate(
        {
            "web-reader": {
                "url": "https://example.com/mcp",
                "headers": {"Authorization": "Bearer x"}
            }
        }
    )
    assert errors == []


def test_invalid_when_missing_command_and_url() -> None:
    errors = _validate({"mcpServers": {"bad": {"args": ["x"]}}})
    assert errors


def test_invalid_when_both_command_and_url_provided() -> None:
    errors = _validate(
        {
            "mcpServers": {
                "bad": {
                    "command": "uvx",
                    "url": "https://example.com/mcp"
                }
            }
        }
    )
    assert errors
