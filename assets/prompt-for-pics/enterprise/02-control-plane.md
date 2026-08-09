GPT Image 2 High — Local Region Prompt: Enterprise Control Plane

Use this prompt directly with GPT Image 2 High to render only the Enterprise Control Plane region. Do not rely on any chat context.

# Scope

Render “Enterprise Control Plane | Implemented”. This region manages enterprise governance and configuration. It does not perform model inference or full agent execution.

# Canvas placement

Use normalized full-canvas bounds `x=5–39, y=25–44`, exactly matching `00-master.md`. This white solid-blue container sits below Access and above Portal. Keep all governance cards, labels, and internal arrows inside the frame; the direct API request runs outside the frame in the adjacent center gutter and the response follows the right border.

# Local nodes

- Core node: “Admin Console”
- Governance cards:
  - “Identity and Access”
  - “Models and Channels”
  - “Policy Rules”
  - “Tokens and Quotas”
  - “Audit Search”
  - “Compliance and Operations”
- Restrained note: “Governance and configuration only · No inference or full agent execution”

# Internal layout

Center “Admin Console” at the top. Below it, arrange the six governance cards in a precise two-row, three-column grid. Place the responsibility note beneath the grid without competing with the title. Keep labels and cards clear of the right border used by the direct API response.

# Internal connections

Draw thin solid downward fan-out connections from “Admin Console” to the six governance cards. Keep them orthogonal, aligned, and free of label collisions.

Visually merge the outputs of “Models and Channels”, “Policy Rules”, and “Tokens and Quotas” into one short internal collector that terminates at `CTL-CFG-OUT`. Do not extend it beyond the region border.

# Interface ports

- `CTL-ADMIN-IN`: nominal coordinate `(20,25)` on the top edge, aligned with “Admin Console”; thin solid inbound stub.
- `CTL-CFG-OUT`: border anchor `(39,36)`, corridor-facing nominal coordinate `(40.5,36)`; thin solid outbound stub.
- `CTL-DB-OUT`: border anchor `(5,41)`, corridor-facing nominal coordinate `(4.4,41)`; thin solid bidirectional stub into the left-edge gutter.
- `CTL-FUTURE-OUT`: border anchor `(39,25)`, corridor-facing nominal coordinate `(40.5,25)`; thin dashed outbound stub into the upper routing gutter.

Show only short labeled stubs. The master prompt completes all cross-region routes.

# Do not draw

- Do not place “Sessions and History” inside this region.
- Do not draw inference, model execution, agent execution, or a direct model-service connection.
- Do not draw complete lines to Gateway, database, or Cluster Runtime.
- Do not duplicate Portal BFF, Gateway, or data-infrastructure nodes.

# Rendering constraints

Use white fill, solid sky-blue border, deep-blue headings, and the global restrained palette. Governance cards are consistent rounded rectangles. Thin internal lines are orthogonal and use at most one bend. Text remains crisp, high-contrast, and comfortably padded. Flat vector only; no gradients, neon, glassmorphism, 3D, or heavy shadows.
