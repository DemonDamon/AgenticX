GPT Image 2 High — Local Region Prompt: Agent Runtime Evolution

Use this prompt directly with GPT Image 2 High to render only the Agent Runtime Evolution region. Do not rely on any chat context.

# Scope

Render “Agent Runtime Evolution Area”, clearly separated from the current online path. It contains one existing MVP that is not on the default path and one future runtime that has not started.

# Canvas placement

Use normalized full-canvas bounds `x=78–96, y=61–81`, exactly matching `00-master.md`. This gray-blue dashed container is outside the private deployment boundary, below the external model cloud `y=47–58`, and above the legend `y=84–97`. Keep the left edge clear at `y=66` and the right edge clear at `y=72`; keep the outer-right gutter `x=96–97` unobstructed.

# Local nodes

1. “Enterprise Edge Agent | MVP”
   - “Go sidecar”
   - “Task sandbox and trace”
   - “Model calls through Gateway”
   - Status: “Exists · Not on Default Path”

2. “Cluster Agent Runtime | Future”
   - “K8s / multi-replica”
   - “Unified scheduling and high availability”
   - Status: “Not Started”

# Internal layout

Stack Enterprise Edge Agent in the upper portion, approximately `y=63–69`, and Cluster Agent Runtime in the lower portion, approximately `y=71–79`. Use a white Edge node with a blue-gray dashed border. Use a lower-emphasis gray-blue dashed frame for Cluster Runtime. Preserve obvious visual separation and status hierarchy.

# Internal connections

Do not connect Edge Agent to Cluster Runtime. Their maturity levels and roles are independent in this diagram.

# Interface ports

- `EVO-EDGE-IN`: border anchor `(78,66)`, corridor-facing nominal coordinate `(77,66)`; thin dashed bidirectional stub aligned with Enterprise Edge Agent.
- `EVO-CLUSTER-IN`: border anchor `(96,72)`, corridor-facing nominal coordinate `(97,72)`; thin dashed inbound stub aligned with Cluster Agent Runtime and the outer-right evolution gutter.

Show only short labeled stubs. The master prompt completes all cross-region routes.

# Do not draw

- Do not place either node on the current default thick solid request path.
- Do not draw a thick solid line from Web Portal to Edge Agent or Cluster Runtime.
- Do not merge Enterprise Edge Agent with or rename it as Near Desktop’s Python `agx-server`.
- Do not depict Cluster Runtime as implemented or MVP; it is future and not started.
- Do not place this evolution area inside the current private-deployment boundary.
- Do not complete lines to Gateway or Control Plane.

# Rendering constraints

Use evolution dashed line `#8CAAB8`, gray-blue/white fills, explicit status text, and restrained emphasis. Dashed relations are thin and orthogonal with at most one bend. Keep typography crisp and high-contrast. Flat vector only; no gradients, neon, glassmorphism, 3D, complex illustration, or heavy shadows.
