GPT Image 2 High — MASTER ORCHESTRATION PROMPT

This is a self-contained master prompt for assembling a precise English architecture infographic from separately rendered regions. Use GPT Image 2 High. Do not infer missing details from any conversation.

# Objective

Create a polished horizontal architecture infographic titled **“Near Desktop Architecture”**. Core message:

“Near is a local-first multi-agent desktop workspace. Its default path combines the Electron desktop shell with a local Agent Runtime. An implemented remote single-server backend is also available, while Cluster / HA remains a planned direction.”

# Canvas and coordinate system

- 16:9 landscape canvas, 2560 × 1440 (2K).
- Use normalized coordinates: x = 0–100 from left to right, y = 0–100 from top to bottom.
- Page background: `#F8FBFD`.
- Title band: x 5–96, y 1–6.
- User icon zone: x 1–5, y 22–32.
- Device boundary: x 5–69, y 8–94. Light gray-blue fill `#EDF4F8`; subtle solid outline; label at x 7–42, y 9–12: **“User Device | macOS / Windows; Linux is a build target”**.
- Region 01, Near Desktop: x 8–29, y 15–72.
- Region 02, Local Agent Runtime: x 33–66, y 15–54; this is the largest and strongest visual focus.
- Region 03, Local Execution Plane: x 33–66, y 58–72.
- Region 04, Local Data Plane: x 8–66, y 76–92.
- Region 05, External Capabilities: x 72–96, y 8–38, outside the device boundary.
- Region 06, Remote Backend: x 72–96, y 42–62, outside the device boundary.
- Region 07, Cluster / HA: x 75–96, y 66–82, outside the device boundary. Keep x 69–74 clear as a routing corridor.
- Region 08, Legend: x 72–96, y 85–97.

Maintain visible gutters between all regions. Use no more than two levels of bordered containers. Region prompts own all internal nodes and internal connections; this master owns every complete cross-region connection.

Place one simple flat **“User”** icon in the User icon zone, with source port `USR.OUT.DESKTOP` on its right edge at y 27. This global icon is not a separate bordered region.

# Global visual system

- Brand blue: `#1677C8`.
- Accent blue: `#2F9EE5`.
- Deep-blue text and primary path: `#174A6E`.
- Runtime light-blue fill: `#DCEFFC`.
- Device boundary: `#EDF4F8`.
- Page background: `#F8FBFD`.
- Body text: `#203642`.
- Secondary text: `#607985`.
- Planned-state dashed line: `#8CAAB8`.
- Use only blue, cyan-blue, gray-blue, and white.
- No green, orange, purple, rainbow colors, gradients, neon, glassmorphism, 3D icons, heavy shadows, or decorative illustrations.
- Flat vector style; standard flowchart symbols; one consistent corner radius.
- Crisp English text with high contrast. Node titles: about 24 characters maximum per line, no more than two lines. Each card: at most four short phrases. Preserve padding; never shrink text to force content to fit.

# Status and line semantics

- Implemented region: light-blue or white fill with a solid light-blue frame.
- Optional · Implemented region: white fill with a solid blue frame.
- Planned region: low-emphasis gray-blue dashed frame.
- Default path: thick solid deep-blue line, 5–6 px at 2K.
- On-demand call: thin solid blue line, 2–3 px.
- Alternative path or future evolution: thin dashed blue/gray-blue line, 2–3 px, with explicit status wording.
- Bidirectional flows use arrowheads at both ends.
- The default path must have zero crossings.
- Secondary connections must be orthogonal and have at most one 90-degree bend.
- No arrow, line, or label may cross any node or text.

# Stable interface port convention

Port IDs are uppercase and stable: `<REGION>.<IN|OUT>.<SEMANTIC>`. Draw only a 12–20 px short port stub inside each region. Keep port IDs available as production annotations, but omit the IDs from the final public-facing artwork unless needed for assembly.

# Cross-region connection manifest

Each connection below has exactly one owner: this master file. Region files draw only their local port stubs.

1. `USR.OUT.DESKTOP` → `DSK.IN.USER`
   - Label: **“Chat · Configuration · Workspace”**
   - Style: thick solid, bidirectional
   - Route: straight horizontal through the left gutter at y 27.

2. `DSK.OUT.RUNTIME_HTTP` → `RUN.IN.DESKTOP_HTTP`
   - Forward label: **“HTTP Requests”**
   - Return label: **“SSE Streaming Events”**
   - Tag: **“127.0.0.1 | Default Local Path”**
   - Style: thick solid, bidirectional
   - Route: straight horizontal through the primary corridor x 29–33 at y 28.

3. `RUN.OUT.TOOL_EXEC` → `EXE.IN.RUNTIME_TOOL`
   - Label: **“Tool Call / Result”**
   - Style: thick solid, bidirectional
   - Route: straight vertical at x 57 through y 54–58.

4. `DSK.OUT.NATIVE_EXEC` → `EXE.IN.DESKTOP_NATIVE`
   - Label: **“IPC / OS Capability”**
   - Style: thin solid, bidirectional
   - Route: straight horizontal at y 65 through x 29–36.

5. `RUN.OUT.DATA_CONFIG` → `DAT.IN.CONFIG_RUNTIME`
   - Collective label for connections 5–8: **“Local Read / Write”**
   - Style: thin solid, bidirectional
   - Route: straight vertical at x 38 through y 54–76, using the open gap beside the execution cards.

6. `RUN.OUT.DATA_SESSIONS` → `DAT.IN.SESSIONS_RUNTIME`
   - Style and collective label: same as connection 5
   - Route: straight vertical at x 46 through y 54–76, using the dedicated gap between execution cards.

7. `RUN.OUT.DATA_MEMORY` → `DAT.IN.MEMORY_RUNTIME`
   - Style and collective label: same as connection 5
   - Route: straight vertical at x 54 through y 54–76, using the dedicated gap between execution cards.

8. `RUN.OUT.DATA_RUNTIME` → `DAT.IN.RUNTIME_RUNTIME`
   - Style and collective label: same as connection 5
   - Route: straight vertical at x 62 through y 54–76, using the open gap beside the execution cards.

9. `DSK.OUT.DATA_CONFIG` → `DAT.IN.CONFIG_DESKTOP`
   - Collective label for connections 9–10: **“Settings and Layout Persistence”**
   - Style: thin solid, bidirectional
   - Route: leave at x 20, y 72; one bend at x 38, y 72; enter vertically at x 38, y 76. Offset the short final segment slightly left of connection 5.

10. `DSK.OUT.DATA_RUNTIME` → `DAT.IN.RUNTIME_DESKTOP`
    - Style and collective label: same as connection 9
    - Route: leave at x 27, y 72; one bend at x 62, y 72; enter vertically at x 62, y 76. Offset the short final segment slightly right of connection 8.

11. `RUN.OUT.MODEL` → `EXT.IN.MODEL`
    - Label: **“Model Request / Stream”**
    - Style: thin solid, bidirectional
    - Route: straight horizontal at y 18 through x 66–72.

12. `RUN.OUT.MCP` → `EXT.IN.MCP`
    - Label: **“MCP Protocol”**
    - Style: thin solid, bidirectional
    - Route: straight horizontal at y 25 through x 66–72.

13. `RUN.OUT.REGISTRY` → `EXT.IN.REGISTRY`
    - Label: **“Search / Install”**
    - Style: thin solid, bidirectional
    - Route: straight horizontal at y 32 through x 66–72.

14. `DSK.OUT.CHANNEL_SYNC` → `EXT.IN.CHANNELS`
    - Label: **“Local mode starts sidecars / Message sync”**
    - Style: thin solid, bidirectional
    - Route: one bend through the top routing corridor: from x 23, y 15 vertically to x 23, y 8, then horizontally to x 82, y 8. The External region provides a short local stub from its top port to the channel node.
    - Semantic guardrail: do not imply that IM sidecars start by default in remote-backend mode.

15. `DSK.OUT.REMOTE_BACKEND` → `REM.IN.DESKTOP`
    - Label: **“remote_server | Replaces Local Backend”**
    - Style: thin dashed, bidirectional, explicitly **Optional · Implemented**
    - Route: one bend: from x 29, y 71 horizontally through the clear lower corridor to x 72, y 71, then vertically to x 72, y 57. Keep it distinct from the y 72 data-persistence corridor. The Remote region provides a short local stub to its bottom-left interface.
    - This route must not pass through Local Agent Runtime. Local and remote backends are alternatives, not an active-active default.

16. `REM.OUT.HA_EVOLUTION` → `HA.IN.REMOTE_EVOLUTION`
    - Label: **“Future Evolution”**
    - Style: thin dashed, explicitly **Planned**
    - Route: straight vertical at x 84 through y 62–66.
    - It must never join the thick default path.

# Generation and assembly order

1. Establish the 16:9 page, title, palette, typography, device boundary, region rectangles, and empty routing corridors.
2. Render regions in this order: 02 Runtime, 01 Desktop, 03 Execution, 04 Data, 05 External, 06 Remote, 07 Cluster / HA, 08 Legend.
3. Confirm every region exposes the named ports at the exact coordinates above.
4. Draw the three thick default-path connections first: user-to-desktop, desktop-to-runtime, then runtime-to-tool-execution.
5. Draw the remaining solid on-demand connections in their assigned corridors.
6. Draw dashed alternative and future lines last.
7. Place line labels in gutters, never over containers, nodes, or other labels.
8. Final QA: all source facts are present; implemented/optional/planned semantics remain distinct; primary path has zero crossings; every secondary line is orthogonal with no more than one bend; no complete cross-region line is duplicated inside a region.

# Do not draw

- Do not add region-internal nodes or connections from this master prompt.
- Do not rename Local Agent Runtime to “Edge Agent”.
- Do not merge the two execution types.
- Do not show Local and Remote backends as active-active.
- Do not add invented services, databases, protocols, deployment states, or arrows.
