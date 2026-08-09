This is a local-region prompt for GPT Image 2 High. Copy and use it directly to render the lower-right auxiliary region containing planned evolution capabilities and the status/connection legend. It is self-contained and does not depend on any chat context.

# Evolution Capabilities and Legend

## Scope

Render only the lower-right auxiliary region. It contains two clearly separated local blocks: the planned Evolution Capabilities block above and the compact Status and Connection Legend below.

## Canvas placement

Place the complete auxiliary region at x 84–98 and y 68–96 of the final 16:9 canvas. Evolution occupies approximately the upper 55% of this region; Legend occupies the lower 40%, with a visible gap between them.

## Local nodes

Evolution block:

- **Evolution Capabilities | Planned**
- **Agent Evolution | Planned**
- **Fine-grained Multi-tenant RBAC | Planned**
- **Cluster Agent Runtime | Planned**

Legend block:

- Light-blue solid frame — **Implemented**
- White solid blue frame — **External / Pluggable**
- Gray-blue dashed frame — **Planned**
- Thick solid line — **Default path**
- Thin solid line — **Capability call**
- Thin dashed line — **Evolution relation**

## Internal layout

Use a small gray-blue dashed Evolution container with three stacked planned rows. Beneath it, use a compact unframed or lightly framed legend with six aligned symbol-label rows. Keep the two blocks visually independent.

## Internal connections

Do not connect the three planned rows to each other. The legend contains only non-directional sample strokes and frame swatches; these are symbols, not architecture connections.

## Interface ports

- `EVOLUTION.W.CORE`: center of the Evolution container’s west edge; short thin dashed leftward stub; reserved assembly label **“Evolution direction”**.

The Legend has no interface port.

## Do not draw

- Do not draw the complete dashed line to the central framework.
- Do not connect Evolution to the default thick solid path.
- Do not draw arrows from legend samples.
- Do not add unlisted roadmap claims.
- Do not merge the Legend into the Evolution dashed container.

## Rendering constraints

Use `#EDF4F8` fill and `#8CAAB8` dashed borders for planned items. Match legend swatches exactly to the global states and line styles. Use `#174A6E`, `#203642`, and `#607985` for readable text. Flat vector, no gradients or shadows. Keep samples large enough to distinguish at 2K and ensure no stub or sample crosses text.
