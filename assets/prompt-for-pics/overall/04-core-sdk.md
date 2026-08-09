This is a local-region prompt for GPT Image 2 High. Copy and use it directly to render the Core SDK Runtime region of the AgenticX architecture diagram. It is self-contained and does not depend on any chat context.

# Core SDK Runtime | Implemented

## Scope

Render only the embeddable Python Core SDK Runtime. Make it explicit that this SDK path is independently consumable and does not depend on Near Desktop.

## Canvas placement

Place a narrower horizontal band at x 24–76 and y 63–72 of the final 16:9 canvas, below Agent Runtime and above Platform Foundation.

## Local nodes

1. **Agent · Task · Tool**
2. **ReActAgent**
3. **AgentExecutor**
4. **Task Validation**
5. **A2A AgentCard**

## Internal layout

Use five compact modules in one evenly spaced row inside a light-blue implemented container. Keep equal heights and align all labels centrally.

## Internal connections

Draw a thin solid left-to-right SDK composition line linking the five modules in listed order. This is a local structural relationship, not the system-wide default path.

## Interface ports

- `SDK.N.DEV`: north edge at 88% region width; short thin solid upward stub; reserved assembly label **“Embedded API”**.

## Do not draw

- Do not draw the complete Developer Entry connection.
- Do not connect the SDK to Near Desktop.
- Do not imply that using Python SDK requires Studio Runtime, Electron, or the Near application.
- Do not add Agent Runtime or Platform Foundation nodes.

## Rendering constraints

Use implemented styling with `#DCEFFC` fill and solid `#1677C8` border. Use `#174A6E` titles and `#203642` body text. Flat vector, consistent corner radius, high contrast, no gradients or shadows. Keep the interface stub clear of labels and cards.
