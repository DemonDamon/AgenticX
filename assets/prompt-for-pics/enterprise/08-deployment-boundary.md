GPT Image 2 High — Local Region Prompt: Deployment Boundary

Use this prompt directly with GPT Image 2 High to render only the background deployment boundary and layer scaffold. Do not rely on any chat context.

# Scope

Render the composition scaffold for “AgenticX Enterprise Architecture”: the current-system deployment boundary, four layer bands, title, and reserved external/evolution spaces. Do not render any functional nodes or the legend.

# Canvas placement

Use a 16:9 landscape 2K canvas with normalized full-canvas coordinates. Place the title in `x=3–97, y=1–6` and the private deployment boundary in `x=3–76, y=7–95`, exactly matching `00-master.md`. Reserve these non-overlapping regional boxes in the scaffold: Access `x=5–74, y=10–22`; Control `x=5–39, y=25–44`; Portal `x=5–39, y=47–70`; Gateway `x=42–74, y=47–70`; Data `x=5–74, y=74–93`; external models `x=78–96, y=47–58`; evolution `x=78–96, y=61–81`; legend `x=78–96, y=84–97`.

# Local nodes

- Title: “AgenticX Enterprise Architecture”
- Outer boundary label: “Enterprise Private Deployment Domain | Current Runnable System”
- Four subtle layer labels, top to bottom:
  1. “Enterprise Access Layer”
  2. “Enterprise Control Plane”
  3. “Online Request and Gateway Plane”
  4. “Enterprise Data Infrastructure”
- Reserved external label: “External”
- Reserved right-side label: “Agent Runtime Evolution Area”

# Internal layout

Draw one light gray-blue outer boundary at `x=3–76, y=7–95` around the spaces reserved for Web Portal and Portal BFF, Admin Console, Go AI Gateway, PostgreSQL/MySQL, Redis, and append-only audit log. Use subtle horizontal layer bands or labels inside the boundary without boxing every future node.

Keep the exact gutters from the master visually open: `x=3–5`, `x=39–42`, `x=74–78`, `y=22–25`, `y=44–47`, `y=70–74`, `y=81–84`, and outer-right `x=96–97`. Leave the upstream-model-services box and the evolution box visibly outside the boundary. The legend begins at `y=84`, so it cannot overlap the evolution box ending at `y=81` or the data box ending at `x=74`.

# Internal connections

Draw no architecture connections in this regional render.

# Interface ports

No functional interface ports. Reserve unlabeled egress gaps in the boundary for:

- the Gateway-to-model request/response corridor at `(76,52)` and `(76,56)`;
- the Gateway-to-Edge dashed corridor at `(76,66)`;
- the Control-Plane-to-Cluster dashed route along `y=25` and the outer-right gutter `x=96–97`.

These are open routing gaps only, not nodes or arrows.

# Do not draw

- Do not draw functional nodes, regional internals, architecture arrows, port IDs, or the legend.
- Do not enclose upstream model services in the private boundary.
- Do not enclose the Agent Runtime evolution area in the current runnable-system boundary.
- Do not imply that MVP or future capabilities are on the default production path.

# Rendering constraints

Use deployment fill `#EDF4F8`, page background `#F8FBFD`, global blue/cyan-blue/gray-blue/white palette, and restrained borders. The boundary must be visually subordinate to functional regions. Keep all text crisp and high-contrast. Flat vector, standard academic architecture style, no gradients, neon, glassmorphism, 3D, complex illustration, or heavy shadows.
