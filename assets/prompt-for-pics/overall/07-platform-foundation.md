This is a local-region prompt for GPT Image 2 High. Copy and use it directly to render the Platform Foundation region of the AgenticX architecture diagram. It is self-contained and does not depend on any chat context.

# Platform Foundation | Built-in / Optional

## Scope

Render only the bottom platform foundation: safety, observability/evaluation, storage, and runtime/deployment.

## Canvas placement

Place a wide horizontal gray-blue container at x 18–82 and y 76–94 of the final 16:9 canvas.

## Local nodes

1. **Safety Building Blocks**
   - Policy · Guardrails · Permissions
   - Audit · Sandbox
2. **Observability and Evaluation**
   - Trace · Metrics
   - OpenTelemetry
   - EvalSet · LLM Judge
3. **Storage**
   - SQLite · PostgreSQL · Redis
   - Chroma · Milvus · Qdrant
   - Neo4j · Object Storage
   - Small tag: **“Adapter maturity varies”**
4. **Runtime and Deployment**
   - Local process
   - Docker
   - Remote service

## Internal layout

Use four equal-height groups in one row. The Storage group may be slightly wider. Represent databases and vector stores with simple cylinders; use rounded rectangles for all other elements. Keep the outer foundation band visually supportive, not dominant.

## Internal connections

Use a thin solid horizontal foundation bus along the upper interior edge. Connect each of the four groups to this bus with one short vertical line. Keep these local lines free of crossings.

## Interface ports

- `FOUNDATION.N.RUNTIME`: north edge at full-canvas x 22 (about 6.25% of this region's width); short thick solid upward stub; reserved assembly label **“Platform services”**. Align it vertically with `RUNTIME.S.FOUNDATION`.

## Do not draw

- Do not draw the complete line to Agent Runtime.
- Do not include Evolution capabilities in this region.
- Do not treat every storage adapter as equally mature; retain the maturity tag.
- Do not use cylinders for safety, observability, or deployment items.

## Rendering constraints

Use `#EDF4F8` foundation fill, solid blue borders, `#174A6E` titles, `#203642` body text, and `#607985` secondary text. Use only simple flat vector symbols. No gradients, 3D effects, or heavy shadows. Keep database cylinders minimal and consistent. No line crosses text or a node.
