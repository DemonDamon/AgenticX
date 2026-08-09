This is a local-region prompt for GPT Image 2 High. Copy and use it directly to render the Models, Tools, and Domain Extensions region of the AgenticX architecture diagram. It is self-contained and does not depend on any chat context.

# Models, Tools, and Domain Extensions

## Scope

Render only the external/pluggable ecosystem on the right side: model services, tool/data integrations, and domain extensions.

## Canvas placement

Place a tall white container at x 84–98 and y 24–64 of the final 16:9 canvas. Maintain a clear left-side gutter toward the central framework.

## Local nodes

1. **Model Services**
   - Cloud-compatible models
   - Local models
   - Custom providers
2. **Tool and Data Ecosystem**
   - MCP Server
   - OpenAPI
   - Files and terminal
   - Data connectors
3. **Domain Extensions**
   - GUI Agent
   - Deep Research
   - Coding Agents
   - IM Gateway · Claude Code Bridge

## Internal layout

Use three vertically stacked groups in the listed order. Each group is a compact rounded card inside one white, solid-blue outer container. Preserve enough width for readable two-line titles.

## Internal connections

No arrows between the three groups. Each group independently terminates at its own west-edge interface port using only a short horizontal local stub.

## Interface ports

- `ECOSYS.MODEL.W`: west edge aligned with the center of Model Services; thin solid leftward stub; reserved label **“Model adapters”**.
- `ECOSYS.TOOL.W`: west edge aligned with Tool and Data Ecosystem; thin solid leftward stub; reserved label **“Tools and data”**.
- `ECOSYS.DOMAIN.W`: west edge aligned with Domain Extensions; thin solid leftward stub; reserved label **“Domain extensions”**.

## Do not draw

- Do not draw complete lines into the central framework.
- Do not route ecosystem lines through central modules.
- Do not merge the three ports into one.
- Do not show unverified vendor logos.
- Do not add platform storage or protocol nodes.

## Rendering constraints

Use external/pluggable styling: white fill, solid `#1677C8` borders, `#174A6E` titles, `#203642` body text, and `#607985` secondary text. Flat vector, consistent corner radius, no gradients, 3D, or heavy shadows. Keep port stubs horizontal and free of text.
