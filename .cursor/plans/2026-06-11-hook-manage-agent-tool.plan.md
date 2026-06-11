# hook_manage Agent Tool

**Plan-Id:** 2026-06-11-hook-manage-agent-tool  
**Date:** 2026-06-11  
**Status:** Implemented

## Background

The Hooks management UI (settings panel) shows 7 bundled hooks and an "外部导入钩子" section,
but provided no way for users to create hooks through conversation with Meta-Agent, avatars,
or group chats.

## Goal

Allow any conversation context (Meta-Agent / avatar / group chat) to create, delete, list,
and toggle declarative hooks that persist to `~/.agenticx/config.yaml` and immediately appear
in the Desktop Hooks management UI.

## FR

- FR-1: `hook_manage` tool with `action = create | delete | list | toggle`
- FR-2: `create` validates event/type/required body fields and appends to `hooks.declarative[]`
- FR-3: `delete` removes by name; `toggle` sets `enabled` flag; `list` returns current state
- FR-4: After write, `invalidate_hooks_list_cache()` is called so `GET /api/hooks` returns fresh data
- FR-5: Tool is always available (no `AGX_HOOK_MANAGE` env gate required — writes only to config.yaml)

## Implementation

### Changed Files

- `agenticx/cli/agent_tools.py`
  - Added `hook_manage` JSON schema to `STUDIO_TOOLS` (index 17, before `skill_import_repo`)
  - Added `_tool_hook_manage()` function (~90 lines)
  - Added dispatch branch `if name == "hook_manage":` before `skill_manage`

### Supported declarative hook fields

| Field | Required | Notes |
|-------|----------|-------|
| name | always | unique key |
| event | create | before_tool_call / after_tool_call / session_start / session_end |
| type | create | command / http / prompt / agent |
| command | type=command | shell command, supports {tool} placeholder |
| url | type=http | https endpoint |
| prompt | type=prompt/agent | model prompt text |
| matcher | optional | glob filter on tool name |
| block_on_failure | optional | default false |
| timeout_seconds | optional | 1-600, default 30 |

## AC

- [x] `hook_manage` appears in `STUDIO_TOOLS` at index 17
- [x] `action='list'` returns `{ok, hooks[], count}` JSON
- [x] `action='create'` validates required fields and writes to config.yaml
- [x] `action='delete'` removes entry by name
- [x] `action='toggle'` updates `enabled` flag
- [x] `invalidate_hooks_list_cache()` called after every write
- [x] Smoke test passes (`python -c ...`)
