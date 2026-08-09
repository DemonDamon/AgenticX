GPT Image 2 High — Local Region Prompt: Enterprise Access

Use this prompt directly with GPT Image 2 High to render only the Enterprise Access region. Do not rely on any chat context.

# Scope

Render the top region titled “Enterprise Access Layer | Implemented”. It represents the three enterprise actors and their approved entry points.

# Canvas placement

Use normalized full-canvas bounds `x=5–74, y=10–22`, exactly matching `00-master.md`. Place this shallow light-blue band inside the private deployment boundary `x=3–76, y=7–95`. Keep the three actor/entry pairs visually aligned to their distinct outbound lanes: employee to the Portal via the left-edge gutter, administrator straight down to Control, and API client through the center gutter to Gateway.

# Local nodes

- Person icon: “Enterprise Employee”
- Entry label: “Web Portal”
- Person icon: “Platform Administrator”
- Entry label: “Admin Console”
- Application icon: “Enterprise App / API Client”
- Entry label: “Go AI Gateway”

# Internal layout

Arrange three evenly spaced actor-and-entry pairs from left to right. Each actor sits above its entry label. Use a light-blue implemented frame, compact standard icons, consistent rounded labels, and generous horizontal spacing.

# Internal connections

Within each pair, draw one short downward arrow:

- Enterprise Employee → Web Portal
- Platform Administrator → Admin Console
- Enterprise App / API Client → Go AI Gateway

These short actor-to-entry arrows are the only internal connections in this region.

# Interface ports

- `ACC-EMP-OUT`: border anchor `(5,22)`, corridor-facing nominal coordinate `(3.6,22)`; thick solid outbound stub into the left-edge gutter toward Portal.
- `ACC-ADMIN-OUT`: nominal coordinate `(20,22)` on the bottom edge; thin solid outbound stub toward Control.
- `ACC-API-OUT`: nominal coordinate `(40,22)` on the bottom edge; thick solid outbound request stub aligned with the center gutter.
- `ACC-API-RESP`: nominal coordinate `(39,22)` on the bottom edge; thick solid inbound response stub, separated from `ACC-API-OUT`.

Show only short labeled stubs. The master prompt completes all cross-region routes.

# Do not draw

- Do not connect Enterprise Employee directly to Go AI Gateway.
- Do not draw the full route into Web Portal, Control Plane, or Gateway.
- Do not draw Gateway internals, governance cards, databases, model services, or evolution nodes.
- Do not add any fourth actor, login mechanism, product logo, or vendor logo.

# Rendering constraints

Use the global blue/cyan-blue/gray-blue/white palette, flat vector styling, solid implemented framing, crisp English text, and no gradients, 3D, glass effects, neon, or heavy shadows. Keep all labels within two lines and preserve ample padding.
