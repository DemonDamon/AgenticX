Create a polished English architecture infographic from the following prompt using [@tool:generate_image_gpt_image_2_high:GPT Image 2 High:https://lovart-persist-us.oss-us-east-1.aliyuncs.com/web/icon/chatgpt.svg] that can render technical diagrams accurately.

[Theme and Layout]

Draw a horizontal ecosystem architecture diagram titled “AgenticX Product and Technology Architecture”. Use the professional visual language of a mature multi-agent framework diagram, but do not copy any third-party graphics, logos, or exact layout details.

Core message:

“AgenticX provides a unified multi-agent framework and Agent Runtime. Near Desktop and AgenticX Enterprise are two product forms built on this capability system, serving a local-first personal workspace and enterprise governance respectively.”

Use a “central framework + top product entries + bottom platform foundation + side ecosystems” layout:

1. Top: product and developer entry points, about 18% of the canvas
2. Center: AgenticX core framework, about 52%, as the visual focus
3. Left and right: protocols, models, tools, and domain ecosystem, about 18%
4. Bottom: security, observability, and storage, about 12%

The primary flow runs from top to bottom. Ecosystem connections enter through reserved ports on the edges of the central framework. No peripheral arrow may cross central modules. Use no more than two levels of bordered containers.

[Detailed Visual Modules]

I. Top — “Product and Developer Entry Points”

Use three cards of equal height:

1. “Near Desktop | Local-first”
   - Electron + React
   - Multi-pane · Avatars · Group Chat
   - Workspace · Terminal · Automation

2. “AgenticX Enterprise | Governance”
   - Web Portal
   - Admin Console
   - Go AI Gateway

3. “Developer Entry Points”
   - Python SDK
   - agx CLI
   - REST API + SSE

Near and Enterprise must appear as peer product surfaces. Neither may contain the other.

Draw a thick solid bidirectional arrow from “Near Desktop” to the central “Studio Runtime”, labeled “HTTP / SSE”.

Connect “Developer Entry Points” to “Studio Runtime” and “Core SDK Runtime” with solid lines labeled “Service API” and “Embedded API”.

Draw a thin dashed line from “AgenticX Enterprise” to the central framework, labeled “Capability reuse / future integration”. Inside the Enterprise card, state clearly: “The current online path uses an independent Go Gateway, not the Python Agent Runtime.”

II. Upper Center — “Studio Runtime | Implemented”

Use a deep blue–violet horizontal container with a thin chrome-silver edge (faint electric bloom allowed) and these modules from left to right:

- “Studio Server”
  Subtitle: “FastAPI · REST API · SSE”
- “Sessions and Messages”
- “Meta-Agent”
- “Teams and Delegation”
- “Avatars and Group Chat”
- “Workspace and Approval”

Run one electric-blue primary line (faint blue–violet glow allowed) through these modules to express request intake, session loading, agent execution, and event return.

III. Center — “Agent Runtime and Orchestration | Implemented”

Use the largest deep blue–violet core container on the canvas (edges may carry a faint electric-blue / violet bloom), arranged as a two-row grid.

First row:

1. “Agent Runtime”
   - Think–Act loop
   - Streaming events
   - Context compaction

2. “Orchestration and Collaboration”
   - Workflow · Flow
   - Conditional · Parallel
   - Multi-agent delegation

3. “Reliability and Control”
   - Retry · Failover
   - Loop detection
   - Token budget
   - Human-in-the-loop

Second row:

1. “Tools · MCP”
   - Built-in tools
   - MCP Hub
   - Computer Use
   - Sandbox execution

2. “Memory · Knowledge”
   - Workspace memory
   - Session retrieval
   - Knowledge Base RAG
   - GraphRAG

3. “LLM · Skills · Hooks”
   - Multi-provider adapters
   - Skills lifecycle
   - Hook event extensions
   - AGX Bundle

Connect Studio Runtime and Agent Runtime with a thick solid bidirectional line labeled “Python calls / RuntimeEvent”.

Connect the Tools, Memory, and LLM cards to Agent Runtime with short solid lines. Do not draw long cross-card arrows.

IV. Lower Center — “Core SDK Runtime | Implemented”

Place a narrower deep blue-gray band below the central core containing:

- “Agent · Task · Tool”
- “ReActAgent”
- “AgentExecutor”
- “Task Validation”
- “A2A AgentCard”

Connect the “Python SDK” entry directly to this area, emphasizing that the embeddable SDK path does not depend on Near Desktop.

V. Left — “Open Protocol and Interaction Ecosystem”

Use a dark-fill container with a solid electric-blue border and stack:

- “A2A | Agent Interoperability”
- “MCP | Tools and Resources”
- “AG-UI | Streaming Interaction”
- “REST / SSE / WebSocket”

Use only thin solid lines to connect this container to one “Protocol Port” on the edge of the central framework. Do not route separate lines through internal nodes.

VI. Right — “Models, Tools, and Domain Extensions”

Use three vertical groups:

1. “Model Services”
   - Cloud-compatible models
   - Local models
   - Custom providers

2. “Tool and Data Ecosystem”
   - MCP Server
   - OpenAPI
   - Files and terminal
   - Data connectors

3. “Domain Extensions”
   - GUI Agent
   - Deep Research
   - Coding Agents
   - IM Gateway
   - Claude Code Bridge

Connect the external ecosystem to the right edge of the central framework using thin solid lines. Do not show unverified vendor logos.

VII. Bottom — “Platform Foundation | Built-in / Optional”

Use a deep-ink horizontal container with a thin chrome-silver edge and four groups:

1. “Safety Building Blocks”
   - Policy · Guardrails · Permissions
   - Audit · Sandbox

2. “Observability and Evaluation”
   - Trace · Metrics
   - OpenTelemetry
   - EvalSet · LLM Judge

3. “Storage”
   - SQLite · PostgreSQL · Redis
   - Chroma · Milvus · Qdrant
   - Neo4j · Object Storage
   - Small tag: “Adapter maturity varies”

4. “Runtime and Deployment”
   - Local process
   - Docker
   - Remote service

Use simple cylinders for databases and vector stores. Use rounded rectangles for all other elements.

VIII. “Evolution Capabilities | Planned”

Place a small muted violet-gray dashed container in the lower-right corner containing only:

- “Agent Evolution | Planned”
- “Fine-grained Multi-tenant RBAC | Planned”
- “Cluster Agent Runtime | Planned”

This dashed container must not join the default thick solid path. It may connect to the edge of the central framework through one thin dashed line labeled “Evolution direction”.

IX. Status and Connection Legend

Place a compact legend in the lower-right area:

- Electric-blue solid frame: “Implemented”
- Dark-fill electric-blue solid frame: “External / Pluggable”
- Muted violet-gray dashed frame: “Planned”
- Thick solid line (faint blue–violet glow allowed): “Default path”
- Thin solid line: “Capability call”
- Thin dashed line: “Evolution relation”

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
- Central deep blue–violet fill: #182033
- Platform deep-ink fill: #0E121C
- Primary path: #3D8BFF (faint blue→violet glow allowed; avoid loud neon)
- Planned dashed line: #6A6480

Lighting: soft studio light from above-left for gentle depth and chrome edge reflections. Do not use heavy dramatic shadows that obscure text.

Allowed: deep-black background, thin polished chrome-silver / electric-blue borders, faint blue–violet bloom on primary containers, very soft blue→violet path highlights, sparse bright white specular points.

Forbidden: magenta or cyan as primary accents, large light academic white backgrounds, heavy drop shadows, photoreal 3D icon piles, rendering every module as a literal metal ring knot, decorative character illustrations, green / orange status colors, or rainbow blocks that overpower hierarchy. Nodes remain flat rounded rectangles / standard cylinders.

Primary colors: black, chrome silver, electric blue, violet–purple, and white specular. Distinguish capability status with borders, line styles, and explicit status text.

Use one consistent corner radius. English node titles should be no longer than about 24 characters per line and use at most two lines. Each card may contain at most four short phrases. Preserve sufficient internal padding; never shrink text merely to fit long content.

The primary path must have zero crossings. Secondary connections must use orthogonal lines with at most one bend. No arrow may cross text or a card.

[Technical Parameters]

All text must be crisp and legible: light silver / white on deep backgrounds with high contrast. Use a 16:9 aspect ratio at about 2560×1440. Use standard flowchart symbols. Dark-field brand infographic style—flat vector structure plus logo-aligned premium chrome light, not a light academic paper diagram and not a full-frame 3D metal sculpture.
