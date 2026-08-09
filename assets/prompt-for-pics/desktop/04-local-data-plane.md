GPT Image 2 High — LOCAL REGION PROMPT: LOCAL DATA PLANE

This is a self-contained English prompt for rendering one local region of the “Near Desktop Architecture” infographic with GPT Image 2 High. Draw only this region and its short interface-port stubs.

# Scope

Render **“Local Data Plane | Implemented”**, the local storage area inside the User Device.

# Canvas placement

- Full composition: 2560 × 1440, 16:9.
- Region bounding box: x 8–66, y 76–92.
- Light-blue horizontal area with a solid implemented frame.
- Align the four storage nodes beneath runtime data lanes at nominal x 38, 46, 54, and 62.

# Local nodes

1. Cylinder: **Local Configuration**
   - `~/.agenticx/config.yaml`
2. Cylinder: **Sessions and Roles**
   - `sessions · avatars · groups`
3. Cylinder: **Memory and Knowledge**
   - `SQLite · Chroma · graph (optional)`
4. File shape: **Runtime Data**
   - `workspace · logs · layout`

# Internal layout

- Arrange all four storage nodes in one horizontal row.
- Order from left to right: Local Configuration; Sessions and Roles; Memory and Knowledge; Runtime Data.
- Use standard database cylinders for the first three and a standard file/document symbol for Runtime Data.
- Keep all labels fully legible; wrap titles to at most two lines.

# Internal connections

- Draw no lines among storage nodes.
- Local interface stubs may terminate at the top edge of their corresponding storage node.

# Interface ports

Draw only short stubs; do not draw complete cross-region lines.

- `DAT.IN.CONFIG_RUNTIME`: top boundary, nominal x 38, y 76; thin solid bidirectional stub to Local Configuration.
- `DAT.IN.SESSIONS_RUNTIME`: top boundary, x 46, y 76; thin solid bidirectional stub to Sessions and Roles.
- `DAT.IN.MEMORY_RUNTIME`: top boundary, x 54, y 76; thin solid bidirectional stub to Memory and Knowledge.
- `DAT.IN.RUNTIME_RUNTIME`: top boundary, nominal x 62, y 76; thin solid bidirectional stub to Runtime Data.
- `DAT.IN.CONFIG_DESKTOP`: top boundary, immediately left of `DAT.IN.CONFIG_RUNTIME` at nominal x 38, y 76; thin solid bidirectional stub to Local Configuration.
- `DAT.IN.RUNTIME_DESKTOP`: top boundary, immediately right of `DAT.IN.RUNTIME_RUNTIME` at nominal x 62, y 76; thin solid bidirectional stub to Runtime Data.

# Do not draw

- Do not draw Desktop, Agent Runtime, execution, external, remote, or HA nodes.
- Do not complete any Local Read / Write or Settings and Layout Persistence line.
- Do not add cloud storage or imply remote persistence.
- Do not change **graph (optional)** to implemented-by-default wording.

# Rendering constraints

- Flat vector style, 2K-ready, crisp English text.
- Use `#DCEFFC` and white fills with blue outlines; body text `#203642`; secondary text `#607985`.
- No gradients, 3D, neon, glass, or heavy shadows.
- Implemented status must remain explicit.
- Stubs must not cross storage titles, path text, or each other.
