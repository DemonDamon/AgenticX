This is the master orchestration prompt for GPT Image 2 High. Copy and use it directly to assemble the complete diagram from the numbered regional prompts. It is self-contained and does not depend on any chat context.

# AgenticX Product and Technology Architecture — Master Orchestration

## Output and composition

Create a crisp English architecture infographic titled **“AgenticX Product and Technology Architecture”** on a 16:9, 2K canvas (target 2560 × 1440). Use a flat vector, professional academic architecture-diagram style. The visual grammar may resemble a mature multi-agent framework diagram, but do not copy third-party graphics, logos, or exact layouts.

Core message: **“AgenticX provides a unified multi-agent framework and Agent Runtime. Near Desktop and AgenticX Enterprise are two product forms built on this capability system, serving a local-first personal workspace and enterprise governance respectively.”**

Use normalized canvas coordinates where x and y are percentages from the upper-left:

- Title strip: x 3–97, y 2–7.
- Top product and developer entries: x 18–82, y 8–20; approximately 18% of visual weight.
- Central framework: x 18–82, y 22–73; approximately 52% and the visual focus.
  - Studio Runtime band: x 20–80, y 23–34.
  - Agent Runtime and Orchestration: x 20–80, y 36–60.
  - Core SDK Runtime band: x 24–76, y 63–72.
- Left protocol ecosystem: x 2–16, y 27–63.
- Right models, tools, and domain ecosystem: x 84–98, y 24–64.
- Bottom platform foundation: x 18–82, y 76–94; approximately 12% of visual weight.
- Lower-right auxiliary region: x 84–98, y 68–96, containing Evolution above Legend.

Keep a clear 1.5–2% gutter between regions. Use no more than two levels of bordered containers. The top-to-bottom default path is visually dominant. Near Desktop and AgenticX Enterprise are peer product surfaces; neither contains the other. The Enterprise current online path uses an independent Go AI Gateway, not the Python Agent Runtime. The embeddable Python SDK path does not depend on Near Desktop.

## Unified visual system

- Brand blue: `#1677C8`
- Accent blue: `#2F9EE5`
- Deep-blue text and primary path: `#174A6E`
- Central implemented fill: `#DCEFFC`
- Platform gray-blue fill: `#EDF4F8`
- Page background: `#F8FBFD`
- Body text: `#203642`
- Secondary text: `#607985`
- Planned-state dashed line: `#8CAAB8`
- External/pluggable surfaces: white fill with solid blue border.
- Implemented surfaces: light-blue fill with solid frame.
- Planned surfaces: gray-blue fill with dashed frame.

Use only blue, cyan-blue, gray-blue, and white. No green, orange, rainbow colors, gradients, neon, glassmorphism, 3D icons, heavy shadows, or character illustrations. Use one consistent corner radius. Use rounded rectangles except for simple database and vector-store cylinders in the platform region. Keep titles at roughly 24 characters per line and at most two lines. Keep at most four short phrases per card, with generous padding. Never shrink text merely to force a fit.

## Line and routing grammar

- **Default path:** thick solid deep-blue line, 5–6 px at 2K.
- **Capability call:** thin solid brand-blue line, 2–3 px.
- **Evolution relation:** thin dashed `#8CAAB8` line, 2–3 px.
- Bidirectional relationships use arrowheads at both ends.
- The primary path must have zero crossings.
- Secondary lines must be orthogonal and have at most one 90-degree bend.
- No arrow may cross a node, card, title, body text, or another arrow label.
- Peripheral connections may enter only named reserved edge ports on the central framework. They must never traverse central modules.
- Draw each cross-region connection only in the final assembly. Regional images expose 12–18 px short outward-facing port stubs and do not draw complete cross-region lines.

## Named routing corridors

- `C-TOP-DIRECT`: clear vertical lanes from top cards to matching northern central ports; x follows the source and target port.
- `C-TOP-RIGHT`: protected vertical lane at x 78.5–80.5 from the Developer/Enterprise cards to north-east central ports; it skirts all central cards.
- `C-CENTER-VERTICAL`: protected vertical lane at x 49–51 between Studio, Agent Runtime, and Foundation-facing ports.
- `C-CENTER-RIGHT`: protected vertical lane at x 77–79 inside the central outer gutter, used by the direct Embedded API route to Core SDK; never enter an internal module.
- `C-LEFT-GUTTER`: horizontal lane x 16–20 aligned to the central west-edge protocol port.
- `C-RIGHT-GUTTER`: horizontal lanes x 80–84 aligned to three central east-edge ecosystem ports.
- `C-BOTTOM-GUTTER`: protected straight vertical lane at x 21.5–22.5 from y 60–76, entirely left of the Core SDK band at x 24–76.
- `C-AUX-RIGHT`: horizontal lane x 80–84 aligned to the Evolution port.

## Stable interface-port registry

Port IDs must be printed only as tiny production annotations if useful; the visible user-facing labels remain the connection labels.

- Top entries: `TOP.NEAR.S`, `TOP.ENT.S`, `TOP.DEV.SVC.S`, `TOP.DEV.EMBED.S`
- Studio: `STUDIO.N.NEAR`, `STUDIO.N.SVC`, `STUDIO.N.ENT`, `STUDIO.S.RUNTIME`
- Agent Runtime: `RUNTIME.N.STUDIO`, `RUNTIME.W.PROTOCOL`, `RUNTIME.E.MODEL`, `RUNTIME.E.TOOL`, `RUNTIME.E.DOMAIN`, `RUNTIME.S.FOUNDATION`, `RUNTIME.E.EVOLUTION`
- Core SDK: `SDK.N.DEV`
- Left ecosystem: `PROTOCOL.E.CORE`
- Right ecosystem: `ECOSYS.MODEL.W`, `ECOSYS.TOOL.W`, `ECOSYS.DOMAIN.W`
- Platform: `FOUNDATION.N.RUNTIME`
- Evolution: `EVOLUTION.W.CORE`

## Complete cross-region connection manifest

Draw exactly these full cross-region lines during assembly:

1. `TOP.NEAR.S` → `STUDIO.N.NEAR`; label **“HTTP / SSE”**; thick solid, bidirectional; corridor `C-TOP-DIRECT`; exact route: vertical from the center-bottom of Near to the center-top reserved Near port on Studio.
2. `TOP.DEV.SVC.S` → `STUDIO.N.SVC`; label **“Service API”**; thin solid, single arrow toward Studio; corridor `C-TOP-RIGHT`; exact route: down from the Developer card, then one leftward bend into Studio’s north-east service port.
3. `TOP.DEV.EMBED.S` → `SDK.N.DEV`; label **“Embedded API”**; thin solid, single arrow toward SDK; corridor `C-CENTER-RIGHT`; exact route: down the protected right-side central gutter, then one leftward bend into the SDK north-east port. It must not touch Near or pass through Studio/Agent Runtime cards.
4. `TOP.ENT.S` → `STUDIO.N.ENT`; label **“Capability reuse / future integration”**; thin dashed, single arrow toward Studio; corridor `C-TOP-RIGHT`; exact route: vertical to Studio’s far north-east reserved port. This is not part of the default path.
5. `STUDIO.S.RUNTIME` ↔ `RUNTIME.N.STUDIO`; label **“Python calls / RuntimeEvent”**; thick solid, bidirectional; corridor `C-CENTER-VERTICAL`; exact route: short vertical connection between the two regions.
6. `PROTOCOL.E.CORE` → `RUNTIME.W.PROTOCOL`; label **“Protocol Port”**; thin solid, single arrow toward Runtime; corridor `C-LEFT-GUTTER`; exact route: one horizontal line from the left ecosystem east edge to the Runtime west reserved port.
7. `ECOSYS.MODEL.W` → `RUNTIME.E.MODEL`; label **“Model adapters”**; thin solid, single arrow toward Runtime; corridor `C-RIGHT-GUTTER`; exact route: horizontal, aligned to the upper east reserved port.
8. `ECOSYS.TOOL.W` → `RUNTIME.E.TOOL`; label **“Tools and data”**; thin solid, single arrow toward Runtime; corridor `C-RIGHT-GUTTER`; exact route: horizontal, aligned to the middle east reserved port.
9. `ECOSYS.DOMAIN.W` → `RUNTIME.E.DOMAIN`; label **“Domain extensions”**; thin solid, single arrow toward Runtime; corridor `C-RIGHT-GUTTER`; exact route: horizontal, aligned to the lower east reserved port.
10. `RUNTIME.S.FOUNDATION` → `FOUNDATION.N.RUNTIME`; label **“Platform services”**; thick solid, single arrow toward Foundation; corridor `C-BOTTOM-GUTTER`; exact route: straight vertical at full-canvas x 22 from Runtime y 60 to Foundation y 76. This line stays entirely inside the clear x 20–24 gap left of the Core SDK band and has zero bends.
11. `EVOLUTION.W.CORE` → `RUNTIME.E.EVOLUTION`; label **“Evolution direction”**; thin dashed, single arrow toward Runtime; corridor `C-AUX-RIGHT`; exact route: horizontal from Evolution’s west port to Runtime’s lower east reserved port. It must not join any thick solid path.

Do not add any other cross-region lines. In particular, do not connect Near directly to Core SDK, do not connect Enterprise to the default Python runtime path, and do not fan peripheral lines into internal central cards.

## Generation and assembly order

1. Establish the 16:9 grid, title, region bounds, empty gutters, and all routing corridors.
2. Render the central framework regions in order: Studio, Agent Runtime, Core SDK.
3. Render the top peer product/developer entries.
4. Render left and right ecosystems.
5. Render the bottom platform foundation.
6. Render Evolution and Legend in the lower-right auxiliary region.
7. Align all stable interface ports, then draw the eleven cross-region lines from the manifest.
8. Draw regional internal connections from each regional prompt.
9. Verify zero crossings on the thick default path; verify every thin line is orthogonal with at most one bend.
10. Final legibility pass: no line through text or cards, no clipped labels, high contrast, consistent strokes and corner radii.

Do not duplicate regional node lists or regional internal-layout details in this master prompt; those are defined exclusively in `01-top-entries.md` through `08-evolution-legend.md`.
