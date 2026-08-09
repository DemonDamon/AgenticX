GPT Image 2 High — LOCAL REGION PROMPT: LOCAL EXECUTION PLANE

This is a self-contained English prompt for rendering one local region of the “Near Desktop Architecture” infographic with GPT Image 2 High. Draw only this region and its short interface-port stubs.

# Scope

Render **“Local Execution Plane | Implemented”** with two distinct execution types. They must remain separate and unambiguous.

# Canvas placement

- Full composition: 2560 × 1440, 16:9.
- Region bounding box: x 33–66, y 58–72, inside the User Device.
- Use a restrained, borderless section title or a very light implemented section frame.
- Preserve four narrow vertical pass-through lanes near x 38, 46, 54, and 62 for master-owned data connections.

# Local nodes

1. **Desktop Native Execution**
   - Embedded terminal · node-pty
   - Computer Use · Native Connectors
2. **Runtime Tool Execution**
   - Files · Bash · LiteParse
   - MCP stdio · Knowledge Search

# Internal layout

- Place two cards side by side with clear separation.
- Put Desktop Native Execution on the left, centered around x 42.
- Put Runtime Tool Execution on the right, centered around x 58.
- Shape cards so the narrow vertical pass-through lanes remain unobstructed at x 38, 46, 54, and 62.
- Keep both cards equal in visual weight.

# Internal connections

- No connection between the two cards.
- Anchor the Desktop port stub to Desktop Native Execution.
- Anchor the Runtime port stub to Runtime Tool Execution.

# Interface ports

Draw only short stubs; do not draw complete cross-region lines.

- `EXE.IN.DESKTOP_NATIVE`: left boundary, y 65; thin solid bidirectional stub leading only to Desktop Native Execution.
- `EXE.IN.RUNTIME_TOOL`: top boundary, x 57, y 58; thick solid bidirectional stub leading only to Runtime Tool Execution.

# Do not draw

- Do not merge the two execution cards.
- Do not draw Agent Runtime, Electron Main Process, storage nodes, or external services.
- Do not complete the master-owned Tool Call / Result or IPC / OS Capability connections.
- Do not obstruct the four reserved data-connection lanes.

# Rendering constraints

- Flat vector style with crisp English text and high contrast.
- Implemented semantics: solid light-blue card frames.
- Use only blue, cyan-blue, gray-blue, white, and the specified text colors.
- No gradients, 3D, glow, heavy shadows, or decorative illustrations.
- Internal stubs and anchors must be orthogonal and must not cross text.
