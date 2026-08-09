GPT Image 2 High — Local Region Prompt: Web Portal and Portal BFF

Use this prompt directly with GPT Image 2 High to render only the Web Portal and Portal BFF region. Do not rely on any chat context.

# Scope

Render “Web Portal and Portal BFF | Implemented”, the employee-facing chat workspace, business session area, visible-model validation step, and BFF handoff into the online Gateway path.

# Canvas placement

Use normalized full-canvas bounds `x=5–39, y=47–70`, exactly matching `00-master.md`. Align the employee ingress to the left edge at `y=54`; align the Portal-to-Gateway request and response lanes to the right edge at `y=54` and `y=58`. Leave the bottom edge at `y=70` clear for database access.

# Local nodes

From left to right:

- “Chat Workspace”
- “Sessions and History”
- “Visible Model Validation”
- “Portal BFF”

# Internal layout

Arrange all four nodes in one horizontal row with equal vertical alignment. Keep “Chat Workspace” visually first and “Portal BFF” visually last. Preserve enough room under the row for a persistence port and enough room at the right edge for parallel request and response ports.

# Internal connections

- `POR-CHAT-IN` → Chat Workspace: short thick solid inbound segment.
- Chat Workspace → Portal BFF: thick solid forward line labeled `POST /api/chat/completions`.
- Sessions and History participates in the workspace flow and persistence context; connect it to the main workspace sequence with a short thin solid relation.
- Visible Model Validation sits on the forward sequence immediately before Portal BFF.

Keep the main internal request line continuous and free of crossings.

# Interface ports

- `POR-CHAT-IN`: border anchor `(5,54)`, corridor-facing nominal coordinate `(3.6,54)`; thick solid inbound stub aligned with Chat Workspace.
- `POR-BFF-REQ`: border anchor `(39,54)`, corridor-facing nominal coordinate `(40.5,54)`; thick solid outbound request stub.
- `POR-BFF-RESP`: border anchor `(39,58)`, corridor-facing nominal coordinate `(40.5,58)`; thick solid inbound response stub parallel to `POR-BFF-REQ`.
- `POR-DB-OUT`: nominal coordinate `(20,70)` on the bottom edge; thin solid bidirectional stub.

Show only short labeled stubs. The master prompt completes all cross-region routes.

# Do not draw

- Do not connect Enterprise Employee directly to Gateway.
- Do not draw a thick direct connection from Web Portal to Edge Agent or Cluster Runtime.
- Do not move Sessions and History into Admin Console.
- Do not draw databases, Gateway internals, external model services, or evolution nodes.
- Do not complete any cross-region line.

# Rendering constraints

Use a white fill, solid brand-blue frame, rounded cards, deep-blue primary path, and global palette. The primary internal path must have zero crossings. Any thin internal relation is orthogonal with at most one bend. No arrow crosses text or a node. Flat vector, crisp high-contrast English text, no gradients, neon, glass, 3D, or heavy shadows.
