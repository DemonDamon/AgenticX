#!/usr/bin/env bash
# Local smoke checklist for CC Bridge + Machi (manual).
# Prerequisites: agx serve running (Desktop), agx cc-bridge serve in another terminal.
#
# 1) Open Machi Settings → 工具 → 「Claude Code 本机 Bridge」: confirm URL + token (or hit GET below).
# 2) In chat: cc_bridge_start with cwd=repo path, then cc_bridge_send with session_id.
# 3) Verify files with bash_exec: test -f <path> && wc -l <path>
#
# Optional curl (replace TOKEN and PORT; use Desktop token in x-agx-desktop-token if AGX_DESKTOP_TOKEN is set):
#   curl -sS -H "x-agx-desktop-token: $AGX_DESKTOP_TOKEN" http://127.0.0.1:<serve>/api/cc-bridge/config | jq .

set -euo pipefail
echo "See comments in $0 — no automated checks (bridge + claude are environment-specific)."
