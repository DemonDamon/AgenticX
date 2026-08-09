GPT Image 2 High — Local Region Prompt: Go AI Gateway

Use this prompt directly with GPT Image 2 High to render only the Go AI Gateway region. Do not rely on any chat context.

# Scope

Render “Go AI Gateway | Online Path · Implemented” as the largest and strongest current-system component. It is the enterprise compliance gateway and model-request relay. It is explicitly not a full Agent Runtime.

# Canvas placement

Use normalized full-canvas bounds `x=42–74, y=47–70`, exactly matching `00-master.md`. Align Portal request/response on the left at `y=54/58` and model request/response on the right at `y=52/56`. Reserve the top edge for direct API and configuration ingress, the bottom edge for three data lanes, and the right edge at `y=66` for the optional Edge route.

# Local nodes

Six continuous processing nodes, left to right:

1. “Authentication and Identity” — `JWT / PAT · Tenant / Dept / User`
2. “Quota and Rate Limits” — `TPM / RPM · Budget`
3. “Cache and Request Policy” — `Exact / Semantic Cache · Policy`
4. “Model and Channel Routing” — `Channel · KeyPool · Relay`
5. “Response Policy” — `Stream Inspection · Redaction`
6. “Audit and Usage” — `Audit Chain · Token Usage`

Borderless capability strip at the bottom:

- “Cross-border Compliance”
- “Wasm Hooks”
- “MCP Host / Proxy”
- “Failover”

Prominent restrained note below the container:

“Current responsibility: enterprise compliance gateway and model request relay, not a full Agent Runtime”

# Internal layout

Arrange the six processing nodes as one continuous horizontal chain. Make the first and fourth nodes easy to align with request ingress and model egress. Place the borderless capability strip below the chain, separated by whitespace rather than another frame. Place the responsibility note directly below the container.

# Internal connections

Run one continuous deep-blue thick solid line through all six processing nodes from left to right. The response direction may use a parallel internal return lane through the appropriate response stages, but it must remain visually subordinate and collision-free.

Do not draw any internal arrows into or between items in the capability strip.

# Interface ports

- `GTW-PORTAL-IN`: border anchor `(42,54)`, corridor-facing nominal coordinate `(40.5,54)`; thick solid inbound stub.
- `GTW-PORTAL-RESP`: border anchor `(42,58)`, corridor-facing nominal coordinate `(40.5,58)`; thick solid outbound response stub.
- `GTW-API-IN`: border anchor `(50,47)`, corridor-facing nominal coordinate `(50,45.3)`; thick solid inbound stub.
- `GTW-API-RESP`: border anchor `(54,47)`, corridor-facing nominal coordinate `(54,46.1)`; thick solid outbound response stub.
- `GTW-CFG-IN`: border anchor `(68,47)`, corridor-facing nominal coordinate `(68,45.3)`; thin solid inbound stub.
- `GTW-MODEL-OUT`: border anchor `(74,52)`, corridor-facing nominal coordinate `(77,52)`; thick solid outbound request stub.
- `GTW-MODEL-IN`: border anchor `(74,56)`, corridor-facing nominal coordinate `(77,56)`; thick solid inbound response stub.
- `GTW-DB-OUT`: nominal coordinate `(46,70)` on the bottom edge; thin solid outbound stub.
- `GTW-REDIS-OUT`: nominal coordinate `(58,70)` on the bottom edge; thin solid bidirectional stub.
- `GTW-AUDIT-OUT`: nominal coordinate `(69,70)` on the bottom edge; thin solid outbound stub.
- `GTW-EDGE-OUT`: border anchor `(74,66)`, corridor-facing nominal coordinate `(77,66)`; thin dashed bidirectional stub isolated from thick online lanes.

Show only short labeled stubs. The master prompt completes all cross-region routes.

# Do not draw

- Do not call or depict this component as a full Agent Runtime.
- Do not place Edge Agent, Cluster Runtime, databases, Portal nodes, external providers, or governance cards inside the Gateway.
- Do not add arrows to the capability strip.
- Do not complete any cross-region connection.
- Do not add vendor logos or unsupported capabilities.

# Rendering constraints

Use Gateway fill `#DCEFFC`, deep-blue primary path `#174A6E`, brand/accent-blue borders, and high-contrast text. This is the visual focus but must remain clean and restrained. The primary chain has zero crossings. Secondary lines are orthogonal with at most one bend and never cross text or nodes. Flat vector, consistent rounded rectangles, no gradients, neon, glassmorphism, 3D, complex illustrations, or heavy shadows.
