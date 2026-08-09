Create a polished English architecture infographic from the following prompt using [@tool:generate_image_gpt_image_2_high:GPT Image 2 High:https://lovart-persist-us.oss-us-east-1.aliyuncs.com/web/icon/chatgpt.svg] that can render technical diagrams accurately.

[Theme and Layout]

Draw an enterprise-grade horizontal layered architecture diagram titled “AgenticX Enterprise Architecture”. Core message:

“The current production path consists of enterprise access, Portal BFF, the control plane, Go AI Gateway, data infrastructure, and upstream compatible models. The Go Gateway provides compliance and model relay; it is not a full Agent Runtime. Edge Agent has reached MVP status but is not on the default path, while Cluster Runtime remains a future direction.”

Use a layout with “current runnable system on the left, about 75% + Agent Runtime evolution area on the right, about 25%”.

Inside the current system, use four top-to-bottom layers:

1. Enterprise Access Layer
2. Enterprise Control Plane
3. Online Request and Gateway Plane
4. Enterprise Data Infrastructure

The primary chat path runs left to right. Control relationships run top to bottom. Evolution relationships use dashed lines. The primary path must have zero crossings, and target capabilities must not join the current default thick solid path.

[Detailed Visual Modules]

I. Top — “Enterprise Access Layer | Implemented”

Use a deep blue–violet horizontal container with a thin chrome-silver edge and three roles and entry points:

1. Person icon — “Enterprise Employee”
   → “Web Portal”

2. Person icon — “Platform Administrator”
   → “Admin Console”

3. Application icon — “Enterprise App / API Client”
   → “Go AI Gateway”

The employee must not connect directly to Go AI Gateway. The path must enter Web Portal first.

II. Upper Left — “Enterprise Control Plane | Implemented”

Use a large dark-fill container with a solid electric-blue border and a thin metallic highlight.

Place this core node at the top:

“Admin Console”

Below it, arrange six governance cards in a two-row, three-column grid:

- “Identity and Access”
- “Models and Channels”
- “Policy Rules”
- “Tokens and Quotas”
- “Audit Search”
- “Compliance and Operations”

Do not place “Sessions and History” inside Admin Console. It belongs to the Web Portal workspace and business data.

Draw a thin solid bidirectional arrow from the control plane to the database, labeled “Governance Configuration”.

Merge “Models and Channels”, “Policy Rules”, and “Tokens and Quotas” into one thin solid connection to Go AI Gateway, labeled “Configuration Snapshot / Hot Reload”.

State clearly that the control plane manages governance and configuration. It does not perform model inference or full agent execution.

III. Center Left — “Web Portal and Portal BFF | Implemented”

Use a dark-fill container with a solid electric-blue border containing, from left to right:

- “Chat Workspace”
- “Sessions and History”
- “Visible Model Validation”
- “Portal BFF”

Draw a thick solid line from “Enterprise Employee” to “Chat Workspace”.

Draw a thick solid line from “Chat Workspace” to “Portal BFF”, labeled “POST /api/chat/completions”.

Connect Portal BFF to the database with a thin solid bidirectional line labeled “Session Ownership / Message Persistence”.

Connect Portal BFF to Go AI Gateway with a thick solid line labeled “JWT + Provider Context”.

IV. Center — “Go AI Gateway | Online Path · Implemented”

Use the largest deep blue–violet core container (edges may carry a faint electric-blue / violet bloom) and make “Go AI Gateway” the visual focus.

Arrange six continuous processing nodes from left to right:

1. “Authentication and Identity”
   Subtitle: “JWT / PAT · Tenant / Dept / User”

2. “Quota and Rate Limits”
   Subtitle: “TPM / RPM · Budget”

3. “Cache and Request Policy”
   Subtitle: “Exact / Semantic Cache · Policy”

4. “Model and Channel Routing”
   Subtitle: “Channel · KeyPool · Relay”

5. “Response Policy”
   Subtitle: “Stream Inspection · Redaction”

6. “Audit and Usage”
   Subtitle: “Audit Chain · Token Usage”

Run one continuous electric-blue thick solid line through all six nodes (faint blue–violet glow allowed).

At the bottom of the Gateway container, add one borderless capability strip:

- “Cross-border Compliance”
- “Wasm Hooks”
- “MCP Host / Proxy”
- “Failover”

Do not add more internal arrows to this strip.

Draw another thick solid line from Enterprise API Client to the Gateway, labeled “Direct JWT / PAT”.

Return a thick solid line from the Gateway to Portal BFF and the API client, labeled “Standard / Streaming Response”.

Below the container, display this prominent but restrained note:

“Current responsibility: enterprise compliance gateway and model request relay, not a full Agent Runtime”

V. Middle Right — “Upstream Compatible Model Services | External”

Place this outside the “Enterprise Private Deployment Domain” and use a simple cloud outline.

Inside, place:

- “OpenAI-compatible API”
- “Enterprise-dedicated Model Service”
- “Other Compatible Providers”

Draw a thick solid line from “Model and Channel Routing” to the external model cloud, labeled “Model Request”.

Label the return arrow “Standard / Streaming Response”.

Do not include unverified model vendor names or logos.

VI. Bottom — “Enterprise Data Infrastructure | Implemented”

Use a deep blue-gray horizontal container containing:

1. Standard cylinder — “PostgreSQL (Default) / MySQL (Optional)”
   - Identity and access
   - Sessions and history
   - Runtime configuration
   - Token usage
   - Policy and audit index

2. Standard cylinder — “Redis | Optional”
   - Exact / semantic cache
   - Distributed TPM / RPM limits
   - In-memory fallback when absent

3. File shape — “Append-only Audit Log”
   - JSONL hash chain
   - Must-succeed local fallback

Connect Portal BFF to the database with a thin solid bidirectional line labeled “Sessions and Messages”.

Connect Admin Console to the database with a thin solid bidirectional line labeled “Governance Configuration”.

Connect Gateway to the database with a thin solid line labeled “Usage and Audit Index”.

Connect Gateway to Redis with a thin solid bidirectional line labeled “Cache / Rate Limits”.

Connect Gateway to the audit log with a thin solid line labeled “Append-only Audit Fallback”.

Do not present temporary chat session state as a primary Redis responsibility.

VII. Right — “Agent Runtime Evolution Area”

Use a separate large muted violet-gray dashed container with clear visual distance from the current online path.

Stack these nodes:

1. “Enterprise Edge Agent | MVP”
   - Go sidecar
   - Task sandbox and trace
   - Model calls through Gateway
   - Status: “Exists · Not on Default Path”

Use a dark-fill node with a muted violet-gray dashed border. Do not merge it with or rename it as Near Desktop’s Python `agx-server`.

2. “Cluster Agent Runtime | Future”
   - K8s / multi-replica
   - Unified scheduling and high availability
   - Status: “Not Started”

Use a low-emphasis muted violet-gray dashed frame.

Draw a thin dashed bidirectional line between Gateway and Edge Agent, labeled “Optional Task Routing / Model Relay”.

Draw a thin dashed line from the control plane to Cluster Runtime, labeled “Future Governance and Scheduling”.

Do not draw a thick solid line directly from Web Portal to Edge Agent or Cluster Runtime.

VIII. Deployment Boundary

Use one deep-ink outer boundary with a thin chrome-silver edge around:

- Web Portal and Portal BFF
- Admin Console
- Go AI Gateway
- PostgreSQL / MySQL
- Redis
- Append-only audit log

Label the boundary:

“Enterprise Private Deployment Domain | Current Runnable System”

Upstream model services remain outside the deployment boundary.

The Agent Runtime evolution area sits to the right of the deployment boundary and is not part of the current default production path.

IX. Status and Connection Legend

Place one consistent legend in the lower-right corner:

- Electric-blue solid frame: “Implemented”
- Dark-fill electric-blue solid frame: “External / Optional”
- Muted violet-gray dashed frame: “MVP · Non-default”
- Fainter muted violet-gray dashed frame: “Future · Not Started”
- Thick solid line (faint blue–violet glow allowed): “Online request path”
- Thin solid line: “Control and data access”
- Thin dashed line: “Optional / Evolution relation”

[Style and Color Palette]

Match the brand logo (interlocking chrome ring sphere): “premium chrome · dark studio”. Pure black field, polished chrome-silver metal character, electric blue and violet–purple iridescent highlights, bright white specular points—cinematic and premium like a high-end tech product reveal. The architecture diagram itself stays 2D, flat, and readable; do not render nodes as Hopf / Borromean 3D ring knots.

- Page background: #05060A (pure black)
- Chrome silver: #C8D0DC (borders / thin highlights)
- Brand electric blue: #2F7BFF
- Accent violet: #8B5CFF
- Bright white specular: #FFFFFF (edge points only, sparingly)
- Mirror-silver body text: #E8EEF8
- Secondary text: #8B95A8 (matches logo subtitle grey)
- Container dark fill: #12161F
- Gateway deep blue–violet fill: #182033
- Deployment deep-ink fill: #0E121C
- Primary path: #3D8BFF (faint blue→violet glow allowed; avoid loud neon)
- Evolution dashed line: #6A6480

Lighting: soft studio light from above-left for gentle depth and chrome edge reflections. Do not use heavy dramatic shadows that obscure text.

Allowed: deep-black background, thin polished chrome-silver / electric-blue borders, faint blue–violet bloom on primary containers, very soft blue→violet path highlights, sparse bright white specular points.

Forbidden: magenta or cyan as primary accents, large light academic white backgrounds, heavy drop shadows, photoreal 3D icon piles, rendering every module as a literal metal ring knot, complex decorative illustrations, green / orange status colors, or rainbow blocks that overpower hierarchy. Use standard cylinders for databases, a simple cloud outline for external models, and flat rounded rectangles for all other components.

Primary colors: black, chrome silver, electric blue, violet–purple, and white specular. Distinguish capability status through borders, line styles, and explicit status text.

English node titles should be no longer than about 24 characters per line and use at most two lines. Each card may contain at most four short phrases. Preserve sufficient padding; never shrink text merely to fit long content.

The primary path must have zero crossings. Secondary connections must use orthogonal lines with at most one bend. No arrow may cross text or a node.

[Technical Parameters]

All text must be crisp and legible: light silver / white on deep backgrounds with high contrast. Use a 16:9 aspect ratio at about 2560×1440. Use standard flowchart symbols. Dark-field brand infographic style—flat vector structure plus logo-aligned premium chrome light, not a light academic paper diagram and not a full-frame 3D metal sculpture.
