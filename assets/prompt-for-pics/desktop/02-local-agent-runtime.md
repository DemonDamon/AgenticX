GPT Image 2 High — LOCAL REGION PROMPT: LOCAL AGENT RUNTIME

This is a self-contained English prompt for rendering one local region of the “Near Desktop Architecture” infographic with GPT Image 2 High. Draw only this region and its short interface-port stubs.

# Scope

Render **“Local Agent Runtime | Default · Implemented”** as the visual focus. This is the default local Python Studio and Agent Runtime. It must never be called “Edge Agent”.

# Canvas placement

- Full composition: 2560 × 1440, 16:9.
- Region bounding box: x 33–66, y 15–54.
- Use the largest visually dominant light-blue container, fill `#DCEFFC`, solid border `#2F9EE5`.
- Preserve clear left, right, and bottom edges for named ports.

# Local nodes

Top core node:

- **agx serve / agx-server**
- Subtitle: **“Python Studio + Agent Runtime | REST API + SSE”**

Capability cards:

- Sessions and Messages
- Meta-Agent · Delegation
- Avatars · Group Chat
- Streaming · Approval
- Tools · MCP
- Skills · Hooks
- Memory · Session Search
- Knowledge Base · LLM Routing

# Internal layout

- Center the core node across the top.
- Below it, arrange eight equal capability cards in a two-row, four-column grid.
- First row: Sessions and Messages; Meta-Agent · Delegation; Avatars · Group Chat; Streaming · Approval.
- Second row: Tools · MCP; Skills · Hooks; Memory · Session Search; Knowledge Base · LLM Routing.
- Keep the core node clearly dominant without reducing card text.

# Internal connections

- Do not invent arrows among capability cards.
- Use spatial grouping under the core node to communicate inclusion.
- Local anchoring from each interface stub may terminate at the container edge or core-node vicinity without adding labeled internal flows.

# Interface ports

Draw only short stubs; do not draw complete cross-region lines.

- `RUN.IN.DESKTOP_HTTP`: left boundary, y 28; thick solid bidirectional stub.
- `RUN.OUT.TOOL_EXEC`: bottom boundary, x 57, y 54; thick solid bidirectional stub.
- `RUN.OUT.DATA_CONFIG`: bottom boundary, x 38, y 54; thin solid bidirectional stub.
- `RUN.OUT.DATA_SESSIONS`: bottom boundary, x 46, y 54; thin solid bidirectional stub.
- `RUN.OUT.DATA_MEMORY`: bottom boundary, x 54, y 54; thin solid bidirectional stub.
- `RUN.OUT.DATA_RUNTIME`: bottom boundary, x 62, y 54; thin solid bidirectional stub.
- `RUN.OUT.MODEL`: right boundary, y 18; thin solid bidirectional stub.
- `RUN.OUT.MCP`: right boundary, y 25; thin solid bidirectional stub.
- `RUN.OUT.REGISTRY`: right boundary, y 32; thin solid bidirectional stub.

# Do not draw

- Do not label this region “Edge Agent”.
- Do not draw Desktop, execution cards, storage nodes, external services, remote backend, or Cluster / HA.
- Do not complete cross-region arrows.
- Do not add capabilities, protocols, or deployment modes not listed above.

# Rendering constraints

- Flat vector, academic architecture-diagram quality, crisp English text.
- Use only the global blue/cyan-blue/gray-blue/white palette.
- No gradients, neon, glass, 3D, heavy shadows, or decorative art.
- Solid light-blue frame and explicit **Default · Implemented** status.
- Maintain ample gutters around all ports. No stub may cross a title, card, or subtitle.
