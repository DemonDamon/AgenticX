GPT Image 2 High — Local Region Prompt: Status and Connection Legend

Use this prompt directly with GPT Image 2 High to render only the shared status and connection legend. Do not rely on any chat context.

# Scope

Render one compact legend that explains the diagram’s implemented, external/optional, MVP, future, online-path, control/data, and evolution semantics.

# Canvas placement

Use normalized full-canvas bounds `x=78–96, y=84–97`, exactly matching `00-master.md`. The legend starts below the evolution region ending at `y=81` and remains right of the data region ending at `x=74`; therefore it must not overlap Data, evolution nodes, external models, interface ports, or routing corridors.

# Local nodes

Legend entries:

- Light-blue solid frame: “Implemented”
- White solid blue frame: “External / Optional”
- Blue-gray dashed frame: “MVP · Non-default”
- Gray-blue dashed frame: “Future · Not Started”
- Thick solid line: “Online request path”
- Thin solid line: “Control and data access”
- Thin dashed line: “Optional / Evolution relation”

# Internal layout

Use one compact white legend card with a restrained blue-gray outline. Arrange frame-status samples first and line-style samples second. Align samples in a clean left column and labels in a clean right column. Keep spacing consistent and all labels on one or two lines.

# Internal connections

The three sample lines are legend symbols only. They do not connect to one another and are not architecture routes.

# Interface ports

No interface ports.

# Do not draw

- Do not add architecture nodes, arrows, deployment boundaries, or port IDs.
- Do not add colors or status categories beyond the listed entries.
- Do not allow any real cross-region route to pass through the legend.
- Do not imply that External / Optional, MVP · Non-default, or Future · Not Started are equivalent states.

# Rendering constraints

Use the global palette: light-blue implemented fill, white external/optional fill, blue-gray MVP dashed border, gray-blue future dashed border, deep-blue thick online-path sample, blue thin control/data sample, and `#8CAAB8` dashed evolution sample. Crisp high-contrast English text, flat vector style, no gradients, neon, glassmorphism, 3D, or heavy shadows.
