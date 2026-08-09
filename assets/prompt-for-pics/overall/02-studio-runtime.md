This is a local-region prompt for GPT Image 2 High. Copy and use it directly to render the Studio Runtime region of the AgenticX architecture diagram. It is self-contained and does not depend on any chat context.

# Studio Runtime | Implemented

## Scope

Render only the implemented Studio Runtime band, representing service intake, session handling, Meta-Agent execution coordination, collaboration surfaces, and event return.

## Canvas placement

Place it inside the central framework at x 20–80 and y 23–34 of the final 16:9 canvas. Use a light-blue horizontal container.

## Local nodes

From left to right:

1. **Studio Server** — FastAPI · REST API · SSE
2. **Sessions and Messages**
3. **Meta-Agent**
4. **Teams and Delegation**
5. **Avatars and Group Chat**
6. **Workspace and Approval**

## Internal layout

Use six compact modules in one evenly spaced row. The Studio Server may be slightly wider to fit its subtitle. Keep all module centers aligned on one horizontal axis.

## Internal connections

Run one deep-blue thick solid primary line through the six modules from left to right, with a return arrowhead indicating event return. It expresses request intake → session loading → agent execution → delegation/collaboration → workspace/approval → event return. Keep this line within the region and visually behind or between modules without crossing text.

## Interface ports

Expose only short outward stubs:

- `STUDIO.N.NEAR`: north edge at 18% width; thick solid bidirectional upward stub.
- `STUDIO.N.SVC`: north edge at 76% width; thin solid upward stub.
- `STUDIO.N.ENT`: north edge at 92% width; thin dashed upward stub.
- `STUDIO.S.RUNTIME`: center-bottom; thick solid bidirectional downward stub; reserved label **“Python calls / RuntimeEvent”**.

## Do not draw

- Do not draw complete connections to top entries or Agent Runtime.
- Do not add Agent Runtime, Core SDK, ecosystem, or platform nodes.
- Do not fan external lines into individual Studio modules.
- Do not show Enterprise as part of Studio’s current default path.

## Rendering constraints

Use implemented styling: `#DCEFFC` fill, solid `#1677C8` frame, `#174A6E` primary path and titles, `#203642` body text. Flat vector, consistent corner radius, no gradients, no heavy shadows. Keep the primary internal path free of crossings. No port stub or arrow may touch text.
