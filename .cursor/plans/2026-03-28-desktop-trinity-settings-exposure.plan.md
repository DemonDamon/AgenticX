# 2026-03-28 Desktop Trinity Settings Exposure

## Goal

Expose Agent Harness Trinity runtime toggles in Machi Desktop settings so users can view and change them via GUI.

## Scope

- Desktop settings UI (`通用`) adds visible switches for:
  - `AGX_SKILL_PROTOCOL`
  - `AGX_SESSION_SUMMARY`
  - `AGX_LEARNING_ENABLED`
- Electron preload/main IPC adds load/save endpoints for Trinity config.
- Config persistence to `~/.agenticx/config.yaml` under `agent_harness_trinity`.
- Local backend startup maps persisted values to environment variables.

## Out of Scope

- Runtime hot reload without restart.
- Non-Desktop (CLI/Studio web) configuration UX.

## Acceptance Criteria

- AC-1: User can see all three Trinity switches in `设置 -> 通用`.
- AC-2: Toggling switches persists values to config file through IPC.
- AC-3: On next full app restart, local backend process reads toggles and exports matching env vars.
- AC-4: Failed load/save surfaces explicit error state in UI.

## Verification

- Build `desktop` successfully.
- Manually toggle switches and confirm persistence + restart guidance.
