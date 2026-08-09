This is a local-region prompt for GPT Image 2 High. Copy and use it directly to render the top entry region of the AgenticX architecture diagram. It is self-contained and does not depend on any chat context.

# Product and Developer Entry Points

## Scope

Render only the top region titled **“Product and Developer Entry Points”**. Show Near Desktop and AgenticX Enterprise as equal peer products, plus a developer entry surface.

## Canvas placement

On the final 16:9 canvas, occupy x 18–82 and y 8–20. Keep the region shallow and horizontal. Leave clear space below every interface port.

## Local nodes

1. **Near Desktop | Local-first**
   - Electron + React
   - Multi-pane · Avatars · Group Chat
   - Workspace · Terminal · Automation
2. **AgenticX Enterprise | Governance**
   - Web Portal
   - Admin Console
   - Go AI Gateway
   - Small statement: **“Current online path: independent Go Gateway, not Python Agent Runtime.”**
3. **Developer Entry Points**
   - Python SDK
   - agx CLI
   - REST API + SSE

## Internal layout

Use three equal-height cards in one row: Near on the left, Enterprise in the middle, Developer on the right. Keep Near and Enterprise equal in size and visual hierarchy. Use concise English typography and generous padding.

## Internal connections

No internal arrows between the three cards. Their peer relationship is expressed by alignment and equal visual weight, not containment or connecting lines.

## Interface ports

Expose only short downward stubs:

- `TOP.NEAR.S`: center-bottom of Near; thick solid deep-blue bidirectional stub; visible connection label reserved for assembly: **“HTTP / SSE”**.
- `TOP.ENT.S`: center-bottom of Enterprise; thin dashed gray-blue downward stub; reserved label: **“Capability reuse / future integration”**.
- `TOP.DEV.SVC.S`: bottom edge of Developer at 38% card width; thin solid downward stub; reserved label: **“Service API”**.
- `TOP.DEV.EMBED.S`: bottom edge of Developer at 72% card width; thin solid downward stub; reserved label: **“Embedded API”**.

## Do not draw

- Do not draw complete lines to Studio, Agent Runtime, or Core SDK.
- Do not place Enterprise inside Near or Near inside Enterprise.
- Do not imply that Enterprise currently runs through the Python Agent Runtime.
- Do not connect Near to the Python SDK.
- Do not add third-party logos.

## Rendering constraints

Use flat vector cards, one consistent corner radius, white or very light-blue fills, blue borders, and no gradients or shadows. Preserve the global palette: `#1677C8`, `#2F9EE5`, `#174A6E`, `#DCEFFC`, `#EDF4F8`, `#F8FBFD`, `#203642`, `#607985`, `#8CAAB8`. Keep all text crisp at 2K. No line or stub may cross text.
