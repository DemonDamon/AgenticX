GPT Image 2 High — Master Orchestration Prompt

Use this prompt directly with GPT Image 2 High to compose the complete diagram from the separately rendered regional prompts. This file defines global composition and cross-region routing only; do not invent or repeat any region's internal nodes or internal connections.

# Objective

Create a crisp, professional, flat-vector architecture infographic titled “AgenticX Enterprise Architecture”. The core message is:

“The current production path consists of enterprise access, Portal BFF, the control plane, Go AI Gateway, data infrastructure, and upstream compatible models. The Go Gateway provides compliance and model relay; it is not a full Agent Runtime. Edge Agent has reached MVP status but is not on the default path, while Cluster Runtime remains a future direction.”

# Canvas and composition

- 16:9 landscape canvas, 2K resolution, page background `#F8FBFD`.
- Use normalized full-canvas coordinates: `x=0` is the left edge, `x=100` is the right edge, `y=0` is the top edge, and `y=100` is the bottom edge.
- Allocate approximately 75% of the width to the current runnable system on the left and 25% to external/evolution regions on the right.
- Current runnable system uses four top-to-bottom layers:
  1. Enterprise Access Layer
  2. Enterprise Control Plane
  3. Online Request and Gateway Plane
  4. Enterprise Data Infrastructure
- The primary chat path reads left to right. Control relationships read top to bottom. Evolution relationships are dashed.
- Use these exact region bounds. The functional panels are non-overlapping; the private deployment boundary intentionally contains the current-system panels as a background scaffold:

| Region | Normalized bounds |
|---|---|
| Title | `x=3–97, y=1–6` |
| Enterprise Private Deployment Domain | `x=3–76, y=7–95` |
| Enterprise Access | `x=5–74, y=10–22` |
| Enterprise Control Plane | `x=5–39, y=25–44` |
| Web Portal and Portal BFF | `x=5–39, y=47–70` |
| Go AI Gateway | `x=42–74, y=47–70` |
| Enterprise Data Infrastructure | `x=5–74, y=74–93` |
| Upstream Compatible Model Services | `x=78–96, y=47–58` |
| Agent Runtime Evolution Area | `x=78–96, y=61–81` |
| Status and Connection Legend | `x=78–96, y=84–97` |

- Reserve these routing gutters and keep them free of nodes and text:
  - Left-edge vertical gutter `x=3–5, y=22–80` for employee ingress and governance persistence.
  - Center vertical gutter `x=39–42, y=22–74` between Control/Portal and Gateway; its upper portion carries the separated direct API request/response lanes.
  - Upper horizontal gutter `x=39–97, y=22–25` for the future Control-to-Cluster route.
  - Inter-plane horizontal gutter `x=5–74, y=44–47` for direct API request/response and configuration ingress.
  - Portal/Gateway corridor `x=39–42, y=52–60` for parallel portal request/response lanes.
  - Boundary egress corridor `x=74–78, y=47–70` for model request/response and optional Edge routing.
  - Data-access gutter `x=5–74, y=70–74`.
  - Outer-right evolution gutter `x=96–97, y=25–72`.
- The four thick horizontal online lanes are fixed and parallel: Gateway-to-model request at `y=52`, Portal-to-Gateway request at `y=54`, Gateway-to-model response at `y=56`, and Gateway-to-Portal response at `y=58`. They must have zero crossings.

# Regional assembly order

Render and assemble in this order:

1. `08-deployment-boundary.md` — background boundary, layer bands, and title.
2. `01-enterprise-access.md` — top access band.
3. `02-control-plane.md` — upper-left governance region.
4. `03-web-portal-bff.md` — center-left online entry region.
5. `04-go-ai-gateway.md` — central visual focus.
6. `06-data-infrastructure.md` — bottom infrastructure band.
7. `05-upstream-model-services.md` — external cloud outside the private boundary.
8. `07-agent-runtime-evolution.md` — right-side non-default evolution area.
9. `09-legend.md` — lower-right status and connection key.
10. Add only the cross-region routes listed below, then perform collision and label checks.

# Deployment boundary

The light gray-blue boundary labeled “Enterprise Private Deployment Domain | Current Runnable System” encloses Web Portal and Portal BFF, Admin Console and its governance cards, Go AI Gateway, PostgreSQL/MySQL, Redis, and the append-only audit log. The upstream model-services cloud stays outside the boundary. The Agent Runtime evolution area sits to the right of the boundary and is not part of the current default production path.

# Global visual language

- Brand blue `#1677C8`
- Accent blue `#2F9EE5`
- Deep-blue text and primary path `#174A6E`
- Gateway light-blue fill `#DCEFFC`
- Deployment gray-blue fill `#EDF4F8`
- Body text `#203642`
- Secondary text `#607985`
- Evolution dashed line `#8CAAB8`
- Use only blue, cyan-blue, gray-blue, and white.
- Implemented: light-blue solid frame.
- External or optional: white solid blue frame.
- MVP, non-default: blue-gray dashed frame.
- Future, not started: gray-blue dashed frame.
- Online request path: thick solid deep-blue line.
- Control and data access: thin solid blue line.
- Optional or evolution relation: thin dashed gray-blue line.
- Bidirectional relations use clear arrowheads at both ends.
- No gradients, neon, glassmorphism, 3D effects, complex illustrations, heavy shadows, vendor logos, or unverified model-vendor names.
- Use standard cylinders for databases, a simple cloud outline for external models, a file shape for the audit log, and consistent rounded rectangles elsewhere.
- English node titles: about 24 characters maximum per line, no more than two lines. Each card: no more than four short phrases. Preserve padding; never shrink text to force a fit.

# Stable interface-port convention

Every port is a short border stub with a small unobtrusive port ID placed just outside its owning region. Port stubs inherit the connection style but stop before entering a routing corridor. Regional prompts draw stubs only. This master draws every complete cross-region route. Coordinates below are nominal full-canvas coordinates for the corridor-facing end of each stub; where a region border is offset, the regional prompt gives the border anchor.

| Port ID | Nominal coordinate | Alignment |
|---|---|---|
| `ACC-EMP-OUT` | `(3.6, 22)` | Employee downward lane to Portal left edge |
| `ACC-ADMIN-OUT` | `(20, 22)` | Administrator downward lane to Control |
| `ACC-API-OUT` | `(40, 22)` | Direct API request lane |
| `ACC-API-RESP` | `(39, 22)` | Direct API response lane |
| `CTL-ADMIN-IN` | `(20, 25)` | Control top edge |
| `CTL-CFG-OUT` | `(40.5, 36)` | Control right stub into center gutter |
| `CTL-DB-OUT` | `(4.4, 41)` | Control left stub into left gutter |
| `CTL-FUTURE-OUT` | `(40.5, 25)` | Control top-right stub into upper gutter |
| `POR-CHAT-IN` | `(3.6, 54)` | Portal left stub aligned to Chat Workspace |
| `POR-BFF-REQ` | `(40.5, 54)` | Portal request lane |
| `POR-BFF-RESP` | `(40.5, 58)` | Portal response lane |
| `POR-DB-OUT` | `(20, 70)` | Portal persistence lane |
| `GTW-PORTAL-IN` | `(40.5, 54)` | Gateway portal-request lane |
| `GTW-PORTAL-RESP` | `(40.5, 58)` | Gateway portal-response lane |
| `GTW-API-IN` | `(50, 45.3)` | Gateway top request stub |
| `GTW-API-RESP` | `(54, 46.1)` | Gateway top response stub |
| `GTW-CFG-IN` | `(68, 45.3)` | Gateway top configuration stub |
| `GTW-MODEL-OUT` | `(77, 52)` | External model-request lane |
| `GTW-MODEL-IN` | `(77, 56)` | External model-response lane |
| `GTW-DB-OUT` | `(46, 70)` | Gateway relational-store lane |
| `GTW-REDIS-OUT` | `(58, 70)` | Gateway Redis lane |
| `GTW-AUDIT-OUT` | `(69, 70)` | Gateway audit-fallback lane |
| `GTW-EDGE-OUT` | `(77, 66)` | Optional Edge lane |
| `DAT-DB-GOV` | `(4.4, 80)` | Relational-store governance lane at left stub |
| `DAT-DB-SESSION` | `(20, 74)` | Relational-store session lane |
| `DAT-DB-GTW` | `(46, 74)` | Relational-store Gateway lane |
| `DAT-REDIS-IN` | `(58, 74)` | Redis lane |
| `DAT-AUDIT-IN` | `(69, 74)` | Audit-file lane |
| `MOD-REQ-IN` | `(77, 52)` | Model-cloud request lane |
| `MOD-RESP-OUT` | `(77, 56)` | Model-cloud response lane |
| `EVO-EDGE-IN` | `(77, 66)` | Edge left stub |
| `EVO-CLUSTER-IN` | `(97, 72)` | Cluster right stub into outer-right gutter |

# Cross-region connection manifest

| Source port | Target port | Label | Line style | Routing corridor |
|---|---|---|---|---|
| `ACC-EMP-OUT` | `POR-CHAT-IN` | none | thick solid, one-way | Straight down the left-edge gutter from `(3.6,22)` to `(3.6,54)`; enters Portal at its left edge and never approaches Gateway |
| `ACC-ADMIN-OUT` | `CTL-ADMIN-IN` | none | thin solid, one-way | Straight down from `(20,22)` to `(20,25)` |
| `ACC-API-OUT` | `GTW-API-IN` | `Direct JWT / PAT` | thick solid, one-way | `(40,22)` straight down the center gutter to `(40,45.3)`, then right to `(50,45.3)`; exactly one bend |
| `POR-BFF-REQ` | `GTW-PORTAL-IN` | `JWT + Provider Context` | thick solid, one-way | Straight horizontal at `y=54` across `x=39–42`; zero crossings |
| `GTW-PORTAL-RESP` | `POR-BFF-RESP` | `Standard / Streaming Response` | thick solid, one-way | Straight horizontal at `y=58` across `x=42–39`; parallel to the Portal request and zero crossings |
| `GTW-API-RESP` | `ACC-API-RESP` | `Standard / Streaming Response` | thick solid, one-way | `(54,46.1)` left to `(39,46.1)`, then straight up to `(39,22)`; exactly one bend and parallel separation from the request lane |
| `CTL-CFG-OUT` | `GTW-CFG-IN` | `Configuration Snapshot / Hot Reload` | thin solid, one-way | `(40.5,36)` right to `(68,36)`, then down to `(68,45.3)`; exactly one bend |
| `CTL-DB-OUT` | `DAT-DB-GOV` | `Governance Configuration` | thin solid, bidirectional | Straight down the left-edge gutter from `(4.4,41)` to `(4.4,80)` |
| `POR-DB-OUT` | `DAT-DB-SESSION` | `Session Ownership / Message Persistence` | thin solid, bidirectional | Straight down from `(20,70)` to `(20,74)`; the data endpoint may show the shorter local label `Sessions and Messages` |
| `GTW-DB-OUT` | `DAT-DB-GTW` | `Usage and Audit Index` | thin solid, one-way | Straight down from `(46,70)` to `(46,74)` |
| `GTW-REDIS-OUT` | `DAT-REDIS-IN` | `Cache / Rate Limits` | thin solid, bidirectional | Straight down from `(58,70)` to `(58,74)` |
| `GTW-AUDIT-OUT` | `DAT-AUDIT-IN` | `Append-only Audit Fallback` | thin solid, one-way | Straight down from `(69,70)` to `(69,74)` |
| `GTW-MODEL-OUT` | `MOD-REQ-IN` | `Model Request` | thick solid, one-way | Straight horizontal at `y=52` across `x=74–78`; zero crossings |
| `MOD-RESP-OUT` | `GTW-MODEL-IN` | `Standard / Streaming Response` | thick solid, one-way | Straight horizontal at `y=56` across `x=78–74`; parallel to the model request and zero crossings |
| `GTW-EDGE-OUT` | `EVO-EDGE-IN` | `Optional Task Routing / Model Relay` | thin dashed, bidirectional | Straight horizontal at `y=66` across `x=74–78`; isolated from every thick online lane |
| `CTL-FUTURE-OUT` | `EVO-CLUSTER-IN` | `Future Governance and Scheduling` | thin dashed, one-way | `(40.5,25)` right along the upper gutter to `(97,25)`, then down the outer-right gutter to `(97,72)`; exactly one bend and no contact with the thick online path |

# Routing rules

- The main request path is `Enterprise Employee → Chat Workspace → Portal BFF → Go AI Gateway → Upstream Compatible Model Services`; it must be visually continuous and have zero crossings.
- The employee never connects directly to Go AI Gateway.
- Web Portal never has a thick direct connection to Enterprise Edge Agent or Cluster Agent Runtime.
- Target capabilities never join the current default thick solid path.
- All thin control/data lines are orthogonal and use at most one bend.
- All dashed evolution lines are orthogonal and use at most one bend.
- Keep request and response lanes parallel and visibly distinct.
- Arrowheads and labels must not enter any node, card, title, note, or legend. No arrow may cross text or another node.
- If a route would collide, move its reserved corridor or endpoint alignment; do not add extra bends.

# Final rendering constraints

Maintain high contrast, consistent stroke widths, precise alignment, generous whitespace, and crisp legible text. Use standard flowchart symbols and a restrained professional academic-diagram style. Preserve the explicit current, MVP, future, optional, and external semantics. Make the note that the Go AI Gateway is an enterprise compliance gateway and model relay—not a full Agent Runtime—prominent but restrained.
