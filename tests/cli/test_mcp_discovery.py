from __future__ import annotations

from pathlib import Path

import pytest

from agenticx.cli.mcp_discovery import detect_all


@pytest.fixture
def fake_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    return tmp_path


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _by_brand(result: list) -> dict[str, object]:
    return {item.brand: item for item in result}


def test_detect_all_parses_multiple_formats(fake_home: Path) -> None:
    _write(
        fake_home / ".agenticx/mcp.json",
        '{"mcpServers":{"local":{"command":"uvx","args":["x"],"env":{"A":"1"}}}}',
    )
    _write(fake_home / ".cursor/mcp.json", '{"mcpServers":{"cursor":{"command":"node","args":["srv"]}}}')
    _write(
        fake_home / ".config/openclaw/openclaw.json5",
        """
        {
          mcp: {
            servers: {
              claw: { command: "npx", args: ["-y", "openclaw-mcp"] }
            }
          }
        }
        """,
    )
    _write(
        fake_home / ".hermes/config.yaml",
        """
mcp_servers:
  hermes:
    command: "python"
    args: ["-m", "hermes.mcp"]
""",
    )
    _write(
        fake_home / ".codex/config.toml",
        """
[mcp_servers.fetch]
command = "uvx"
args = ["mcp-server-fetch"]
""",
    )

    hits = _by_brand(detect_all(cwd=fake_home / "proj"))
    assert hits["agenticx"].parse_ok is True
    assert hits["agenticx"].server_count == 1
    assert hits["cursor"].parse_ok is True
    assert hits["openclaw"].parse_ok is True
    assert hits["hermes"].parse_ok is True
    assert hits["codex"].parse_ok is True
    assert hits["codex"].servers[0].name == "fetch"
    assert hits["codex"].servers[0].command == "uvx"


def test_detect_all_uses_cwd_override_for_cursor_and_trae(fake_home: Path) -> None:
    cwd = fake_home / "workspace"
    _write(cwd / ".cursor/mcp.json", '{"mcpServers":{"local-cursor":{"command":"x"}}}')
    _write(cwd / ".trae/mcp.json", '{"mcpServers":{"local-trae":{"command":"y"}}}')
    _write(fake_home / ".agenticx/mcp.json", "{}")

    hits = _by_brand(detect_all(cwd=cwd))
    assert hits["cursor"].exists is True
    assert Path(hits["cursor"].path) == cwd / ".cursor/mcp.json"
    assert hits["trae"].exists is True
    assert Path(hits["trae"].path) == cwd / ".trae/mcp.json"


def test_detect_all_reports_parse_error(fake_home: Path) -> None:
    _write(fake_home / ".agenticx/mcp.json", '{"mcpServers":{"ok":{"command":"uvx"}}}')
    _write(fake_home / ".cursor/mcp.json", '{"mcpServers": { bad json')

    hits = _by_brand(detect_all(cwd=fake_home / "w"))
    assert hits["cursor"].exists is True
    assert hits["cursor"].parse_ok is False
    assert hits["cursor"].parse_error


def test_detect_all_handles_missing_files(fake_home: Path) -> None:
    _write(fake_home / ".agenticx/mcp.json", "{}")
    hits = _by_brand(detect_all(cwd=fake_home / "w"))
    assert hits["windsurf"].exists is False
    assert hits["windsurf"].parse_ok is False
    assert hits["windsurf"].server_count == 0
    assert hits["cherry_studio"].exists is False
    assert hits["cherry_studio"].format == "detect-only"
