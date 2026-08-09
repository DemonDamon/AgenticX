Create a polished English architecture infographic from the following prompt using [@tool:generate_image_gpt_image_2_high:GPT Image 2 High:https://lovart-persist-us.oss-us-east-1.aliyuncs.com/web/icon/chatgpt.svg] that can render technical diagrams accurately.

[Theme and Layout]

Draw a horizontal architecture diagram titled “Near Desktop Architecture”. Core message:

“Near is a local-first multi-agent desktop workspace. Its default path combines the Electron desktop shell with a local Agent Runtime. An implemented remote single-server backend is also available, while Cluster / HA remains a planned direction.”

Use a three-part left-to-right layout:

1. Left: Near Desktop
2. Center: Local Agent Runtime as the visual focus
3. Right: external on-demand capabilities and optional remote runtime modes
4. Bottom: local data plane

Use one large deep-ink device boundary with a thin chrome-silver edge around Near Desktop, the Local Agent Runtime, and local data. Label it “User Device | macOS / Windows; Linux is a build target”.

Use thick solid lines with a faint blue–violet glow for the default path, thin solid lines for on-demand calls, thin dashed lines plus explicit status text for implemented but non-default capabilities, and muted violet-gray dashed containers for planned capabilities. Use no more than two levels of bordered containers.

[Detailed Visual Modules]

I. Left — “Near Desktop | Implemented”

Use a dark-fill rounded rectangle with a solid electric-blue border and a thin metallic highlight.

Place these modules from top to bottom:

1. “React Multi-pane UI”
   - Chat · Avatars · Group Chat
   - Settings · History · Workspace

2. “Zustand State”
   - Panes · Messages · Models
   - Streaming State · Tokens

3. “Electron Main Process”
   - Windows and processes
   - IPC and OS integration
   - Automation and sidecars

Connect “React Multi-pane UI” and “Electron Main Process” with a thin bidirectional solid line labeled “Preload IPC”. Zustand is an internal UI state layer and should not have a separate cross-system arrow.

Place a simple “User” icon outside the left edge and connect it to Near Desktop with a thick solid line labeled “Chat · Configuration · Workspace”.

II. Center — “Local Agent Runtime | Default · Implemented”

Use the largest deep blue–violet core container on the canvas (edges may carry a faint electric-blue / violet bloom). Do not call it “Edge Agent”, to avoid confusion with the Enterprise Edge Agent.

Place this core node at the top:

“agx serve / agx-server”

Subtitle: “Python Studio + Agent Runtime | REST API + SSE”

Arrange the capability cards below as a two-row grid.

First row:

- “Sessions and Messages”
- “Meta-Agent · Delegation”
- “Avatars · Group Chat”
- “Streaming · Approval”

Second row:

- “Tools · MCP”
- “Skills · Hooks”
- “Memory · Session Search”
- “Knowledge Base · LLM Routing”

Draw a thick solid bidirectional connection from “Electron Main Process” to “agx serve / agx-server”:

- Forward label: “HTTP Requests”
- Return label: “SSE Streaming Events”
- Add a small tag: “127.0.0.1 | Default Local Path”

III. Lower Center — “Local Execution Plane | Implemented”

Place two cards side by side below the Runtime container:

1. “Runtime Tool Execution”
   - Files · Bash · LiteParse
   - MCP stdio · Knowledge Search

2. “Desktop Native Execution”
   - Embedded terminal · node-pty
   - Computer Use · Native Connectors

Connect Agent Runtime to “Runtime Tool Execution” with a thick solid line labeled “Tool Call / Result”.

Connect Electron Main Process to “Desktop Native Execution” with a thin solid line labeled “IPC / OS Capability”.

Do not merge these two execution planes into one ambiguous node.

IV. Bottom — “Local Data Plane | Implemented”

Place a deep blue-gray horizontal area at the bottom of the device boundary containing four storage nodes:

1. Cylinder — “Local Configuration”
   `~/.agenticx/config.yaml`

2. Cylinder — “Sessions and Roles”
   `sessions · avatars · groups`

3. Cylinder — “Memory and Knowledge”
   `SQLite · Chroma · graph (optional)`

4. File shape — “Runtime Data”
   `workspace · logs · layout`

Connect Agent Runtime to all four nodes with thin solid lines labeled collectively “Local Read / Write”.

Connect Near Desktop to “Local Configuration” and “Runtime Data” with thin solid lines labeled “Settings and Layout Persistence”.

V. Upper Right — “External Capabilities | On-demand”

Use a dark-fill container with a solid electric-blue border and a thin chrome-silver highlight outside the device boundary.

Stack these nodes:

- Cloud shape — “Compatible Model Services”
- Rounded rectangle — “Remote MCP Server”
- Rounded rectangle — “Skill / Bundle Registry”
- Rounded rectangle — “Feishu / WeChat Channels”

Connect Local Agent Runtime with thin solid lines:

- Model services: “Model Request / Stream”
- MCP Server: “MCP Protocol”
- Registry: “Search / Install”

Connect Electron Main Process to the external channels with a thin solid line labeled “Local mode starts sidecars / Message sync”.

Do not imply that IM sidecars start by default in remote-backend mode.

VI. Middle Right — “Remote Backend | Optional · Implemented”

Use a dark-fill container with a solid electric-blue border containing:

- “Remote agx serve”
- “Single Server URL”
- “Token Authentication”

Draw a thin dashed line directly from Near Desktop to this area, labeled:

“remote_server | Replaces Local Backend”

This line must not pass through the Local Agent Runtime. Local and remote backends are alternatives, not an active-active default.

VII. Lower Right — “Cluster / HA | Planned”

Use a low-emphasis muted violet-gray dashed container containing:

- “Unified Endpoint”
- “Multi-replica Agent Runtime”
- “Shared Session and Runtime Resources”

Connect only from “Remote Backend” to this area with a thin dashed line labeled “Future Evolution”. It must not join the default thick solid path.

VIII. “Extended Experiences | Implemented”

At the bottom of the Near Desktop container, add one borderless capability strip with small icons and short labels:

- “Voice Focus”
- “Automation”
- “Claude Code Bridge”
- “Code Index”
- “Data Sources”

This strip only represents product experiences. Do not expand internal implementation or add extra connections.

IX. Status and Connection Legend

Place a compact legend in the lower-right corner:

- Electric-blue solid frame: “Implemented”
- Dark-fill electric-blue solid frame: “Optional · Implemented”
- Muted violet-gray dashed frame: “Planned”
- Thick solid line (faint blue–violet glow allowed): “Default path”
- Thin solid line: “On-demand call”
- Thin dashed line: “Alternative path / Future evolution”

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
- Runtime deep blue–violet fill: #182033
- Device boundary: #0E121C
- Primary path: #3D8BFF (faint blue→violet glow allowed; avoid loud neon)
- Planned dashed line: #6A6480

Lighting: soft studio light from above-left for gentle depth and chrome edge reflections. Do not use heavy dramatic shadows that obscure text.

Allowed: deep-black background, thin polished chrome-silver / electric-blue borders, faint blue–violet bloom on primary containers, very soft blue→violet path highlights, sparse bright white specular points.

Forbidden: magenta or cyan as primary accents, large light academic white backgrounds, heavy drop shadows, photoreal 3D icon piles, rendering every module as a literal metal ring knot, decorative character illustrations, green / orange status colors, or rainbow blocks that overpower hierarchy. Nodes remain flat rounded rectangles / standard cylinders / cloud shapes.

Primary colors: black, chrome silver, electric blue, violet–purple, and white specular. Distinguish capability status with borders, line styles, and explicit status text.

Use one consistent corner radius. English node titles should be no longer than about 24 characters per line and use at most two lines. Each card may contain at most four short phrases. Preserve sufficient padding; never shrink text merely to fit long content.

The primary path must have zero crossings. Secondary connections must use orthogonal lines with at most one bend. No arrow may cross text or a node.

[Technical Parameters]

All text must be crisp and legible: light silver / white on deep backgrounds with high contrast. Use a 16:9 aspect ratio at about 2560×1440. Use standard flowchart symbols. Dark-field brand infographic style—flat vector structure plus logo-aligned premium chrome light, not a light academic paper diagram and not a full-frame 3D metal sculpture.
