GPT Image 2 High — LOCAL REGION PROMPT: EXTERNAL CAPABILITIES

This is a self-contained English prompt for rendering one local region of the “Near Desktop Architecture” infographic with GPT Image 2 High. Draw only this region and its short interface-port stubs.

# Scope

Render **“External Capabilities | On-demand”** outside the User Device. These are externally reached capabilities, not components of the default local device boundary.

# Canvas placement

- Full composition: 2560 × 1440, 16:9.
- Region bounding box: x 72–96, y 8–38.
- White container with solid light-blue border.
- Keep left-edge ports aligned to y 18, 25, and 32; reserve a top port at x 82, y 8.

# Local nodes

- Rounded rectangle: **Feishu / WeChat Channels**
- Cloud shape: **Compatible Model Services**
- Rounded rectangle: **Remote MCP Server**
- Rounded rectangle: **Skill / Bundle Registry**

# Internal layout

- Use a compact vertical stack.
- Place Feishu / WeChat Channels at the top, adjacent to the top interface.
- Then place Compatible Model Services, Remote MCP Server, and Skill / Bundle Registry in that order, aligned respectively with y 18, y 25, and y 32.
- Keep all nodes inside the external container with equal left/right padding.

# Internal connections

- Do not connect external capability nodes to one another.
- Each short interface stub terminates only at its corresponding node.

# Interface ports

Draw only short stubs; do not draw complete cross-region lines.

- `EXT.IN.CHANNELS`: top boundary, x 82, y 8; thin solid bidirectional stub to Feishu / WeChat Channels.
- `EXT.IN.MODEL`: left boundary, y 18; thin solid bidirectional stub to Compatible Model Services.
- `EXT.IN.MCP`: left boundary, y 25; thin solid bidirectional stub to Remote MCP Server.
- `EXT.IN.REGISTRY`: left boundary, y 32; thin solid bidirectional stub to Skill / Bundle Registry.

# Do not draw

- Do not draw Agent Runtime, Electron Main Process, remote backend, or Cluster / HA.
- Do not complete Model Request / Stream, MCP Protocol, Search / Install, or channel-sync lines.
- Do not imply Feishu / WeChat sidecars start by default in remote-backend mode.
- Do not mark the external capabilities as part of the thick default path.

# Rendering constraints

- Flat vector style, crisp English text, no gradients or 3D.
- White fill, solid light-blue frame, blue/cyan-blue/gray-blue palette only.
- On-demand semantics must be explicit.
- Interface stubs must remain thin solid and must not cross node text.
