GPT Image 2 High — Local Region Prompt: Enterprise Data Infrastructure

Use this prompt directly with GPT Image 2 High to render only the Enterprise Data Infrastructure region. Do not rely on any chat context.

# Scope

Render “Enterprise Data Infrastructure | Implemented”, containing the durable relational store, optional Redis acceleration and limits, and the must-succeed append-only audit fallback.

# Canvas placement

Use normalized full-canvas bounds `x=5–74, y=74–93`, exactly matching `00-master.md`. This light-blue container stays inside the private deployment boundary. Align the relational database across the left and center-left, Redis under Gateway center, and the audit log under Gateway right; keep the top edge clear at `x=20,46,58,69` and the left edge clear at `y=80`.

# Local nodes

1. Standard cylinder: “PostgreSQL (Default) / MySQL (Optional)”
   - “Identity and access”
   - “Sessions and history”
   - “Runtime configuration”
   - “Token usage”
   - “Policy and audit index”

2. Standard cylinder: “Redis | Optional”
   - “Exact / semantic cache”
   - “Distributed TPM / RPM limits”
   - “In-memory fallback when absent”

3. File shape: “Append-only Audit Log”
   - “JSONL hash chain”
   - “Must-succeed local fallback”

# Internal layout

Arrange the relational database as the largest item on the left, approximately `x=6–50`; Redis in the center, approximately `x=52–62`; and the audit file on the right, approximately `x=64–73`. Use standard flowchart symbols and balanced spacing. If needed, split the relational database’s five responsibilities into two compact text rows without shrinking typography.

# Internal connections

Do not draw connections among the database, Redis, and audit log. They have distinct responsibilities and receive their relationships through interface ports.

# Interface ports

- `DAT-DB-GOV`: border anchor `(5,80)`, corridor-facing nominal coordinate `(4.4,80)`; thin solid bidirectional stub, local label `Governance Configuration`.
- `DAT-DB-SESSION`: nominal coordinate `(20,74)` on the top edge; thin solid bidirectional stub, local label `Sessions and Messages`.
- `DAT-DB-GTW`: nominal coordinate `(46,74)` on the top edge; thin solid inbound stub, local label `Usage and Audit Index`.
- `DAT-REDIS-IN`: nominal coordinate `(58,74)` on the top edge; thin solid bidirectional stub, local label `Cache / Rate Limits`.
- `DAT-AUDIT-IN`: nominal coordinate `(69,74)` on the top edge; thin solid inbound stub, local label `Append-only Audit Fallback`.

Show only short labeled stubs. The master prompt completes all cross-region routes.

# Do not draw

- Do not present temporary chat-session state as a primary Redis responsibility.
- Do not imply Redis is mandatory.
- Do not omit the in-memory fallback when Redis is absent.
- Do not omit the audit log’s must-succeed local fallback or JSONL hash chain.
- Do not draw Portal, Admin Console, Gateway, external models, or evolution nodes.
- Do not complete any cross-region connection.

# Rendering constraints

Use a light-blue implemented container, standard database cylinders, one file symbol, global palette, and high-contrast text. Keep each responsibility short and legible. Port stubs are orthogonal and terminate at the region edge. Flat vector only; no gradients, neon, glassmorphism, 3D, complex illustrations, or heavy shadows.
