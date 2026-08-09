GPT Image 2 High — LOCAL REGION PROMPT: REMOTE BACKEND

This is a self-contained English prompt for rendering one local region of the “Near Desktop Architecture” infographic with GPT Image 2 High. Draw only this region and its short interface-port stubs.

# Scope

Render **“Remote Backend | Optional · Implemented”** as an implemented single-server alternative to the default local backend.

# Canvas placement

- Full composition: 2560 × 1440, 16:9.
- Region bounding box: x 72–96, y 42–62, outside the User Device.
- White container with solid brand-blue border `#1677C8`.
- Leave the lower-left edge and bottom edge clear for interface stubs.

# Local nodes

- **Remote agx serve**
- **Single Server URL**
- **Token Authentication**

# Internal layout

- Place Remote agx serve as the primary node.
- Place Single Server URL and Token Authentication as two smaller supporting cards beneath it.
- Keep the content clearly single-server, not clustered or replicated.

# Internal connections

- Use containment and alignment only; do not invent arrows between the three local nodes.
- Interface stubs may anchor to Remote agx serve without adding another label.

# Interface ports

Draw only short stubs; do not draw complete cross-region lines.

- `REM.IN.DESKTOP`: lower-left boundary at x 72, y 57; thin dashed bidirectional stub.
- `REM.OUT.HA_EVOLUTION`: bottom boundary at x 84, y 62; thin dashed downward stub.

# Do not draw

- Do not draw Near Desktop, Local Agent Runtime, external services, or Cluster / HA internals.
- Do not complete the remote_server alternative line or Future Evolution line.
- Do not route the desktop alternative through Local Agent Runtime.
- Do not imply local and remote backends are active-active.
- Do not label this region planned; it is **Optional · Implemented**.

# Rendering constraints

- Flat vector style with crisp English text.
- Optional · Implemented must use a white fill and solid blue frame.
- Port lines are thin dashed because they participate in alternative/future paths.
- Use only the specified blue, cyan-blue, gray-blue, white, and text colors.
- No gradients, glow, glass, 3D, or heavy shadows.
