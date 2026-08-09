GPT Image 2 High — LOCAL REGION PROMPT: NEAR DESKTOP

This is a self-contained English prompt for rendering one local region of the “Near Desktop Architecture” infographic with GPT Image 2 High. Draw only this region and its short interface-port stubs.

# Scope

Render **“Near Desktop | Implemented”**, including its implemented product-experience strip. This region represents the Electron desktop application, not the agent runtime or storage plane.

# Canvas placement

- Full composition: 2560 × 1440, 16:9.
- Region bounding box in normalized full-canvas coordinates: x 8–29, y 15–72.
- White rounded container with solid sky-blue border `#2F9EE5`.
- Keep the right edge clear at y 28 and y 65 for outgoing interfaces.

# Local nodes

1. **React Multi-pane UI**
   - Chat · Avatars · Group Chat
   - Settings · History · Workspace
2. **Zustand State**
   - Panes · Messages · Models
   - Streaming State · Tokens
3. **Electron Main Process**
   - Windows and processes
   - IPC and OS integration
   - Automation and sidecars
4. Borderless strip: **Extended Experiences | Implemented**
   - Voice Focus
   - Automation
   - Claude Code Bridge
   - Code Index
   - Data Sources

# Internal layout

- Stack React Multi-pane UI, Zustand State, and Electron Main Process from top to bottom.
- Place the Extended Experiences strip at the bottom of the container, below the three main modules.
- Use small flat monochrome blue icons only in the experience strip.
- Keep Zustand visually between React and Electron as an internal state layer.

# Internal connections

- Draw one thin solid bidirectional line between **React Multi-pane UI** and **Electron Main Process**, routed beside Zustand, labeled **“Preload IPC”**.
- Do not draw a separate arrow from Zustand to any cross-system destination.
- Do not connect the Extended Experiences strip to anything.

# Interface ports

Draw only short stubs; do not draw complete cross-region lines.

- `DSK.IN.USER`: left boundary, y 27; thick solid bidirectional stub.
- `DSK.OUT.RUNTIME_HTTP`: right boundary, y 28; thick solid bidirectional stub.
- `DSK.OUT.NATIVE_EXEC`: right boundary, y 65; thin solid bidirectional stub, locally anchored to Electron Main Process.
- `DSK.OUT.DATA_CONFIG`: bottom boundary, x 20, y 72; thin solid bidirectional stub.
- `DSK.OUT.DATA_RUNTIME`: bottom boundary, x 27, y 72; thin solid bidirectional stub.
- `DSK.OUT.CHANNEL_SYNC`: top boundary, x 23, y 15; thin solid bidirectional stub, locally anchored to Electron Main Process.
- `DSK.OUT.REMOTE_BACKEND`: lower-right boundary, x 29, y 71; thin dashed bidirectional stub.

# Do not draw

- Do not draw User, Local Agent Runtime, execution, data, external, remote, or HA nodes.
- Do not complete any cross-region connection.
- Do not imply that channel sidecars start by default when a remote backend is selected.
- Do not expand the internal implementation of Extended Experiences.
- Do not add cross-system arrows for Zustand.

# Rendering constraints

- Flat vector style, crisp English text, high contrast, no gradients or shadows.
- Use `#1677C8`, `#2F9EE5`, `#174A6E`, `#DCEFFC`, white, `#203642`, and `#607985`.
- One consistent corner radius; ample padding; no title longer than two lines.
- Implemented status must be explicit and use a solid light-blue frame.
- Internal lines must be orthogonal, avoid text and nodes, and have at most one bend.
