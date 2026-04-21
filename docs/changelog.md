# Changelog

All notable changes to AgenticX are documented here.

## Latest

See [GitHub Releases](https://github.com/DemonDamon/AgenticX/releases) for the full changelog.

### Added

- MCP Settings (Machi Desktop): added brand auto-discovery for local MCP configs (Cursor, Trae, Claude Desktop/Code, OpenClaw, Hermes, Codex, Windsurf, Continue, Cline, Zed, VS Code, Gemini CLI, Cherry detect-only).
- MCP Settings (Machi Desktop): added built-in Monaco JSON editor and backend raw file APIs (`GET/PUT /api/mcp/raw`) with parse and schema validation flow.
- MCP Settings (Machi Desktop): added ModelScope marketplace integration (`GET /api/mcp/marketplace`, `GET /api/mcp/marketplace/{id}`, `POST /api/mcp/marketplace/install`).
- MCP Settings (Machi Desktop): added discovery API (`GET /api/mcp/discover`) and corresponding Electron preload/main IPC bridges.
- Testing: added MCP discovery/schema/API unit tests and Playwright smoke specs for MCP discovery/marketplace/editor flows.

---

## Roadmap

See [Roadmap →](roadmap.md) for upcoming features.
