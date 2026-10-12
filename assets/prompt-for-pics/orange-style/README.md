# Vitality Orange Architecture Visuals

Brand alignment for README architecture diagrams (2026-09-28).

## Logo reference

- Mark: `desktop/assets/near-box-logo-mark.png` / `desktop/assets/icon.png`
- Primary orange: `#F97316` / sampled `#F87000`
- Accent: `#FB923C`
- Deep: `#C2410C` / `#7C2D12`
- Warm dark bg: `#0C0A08`
- Cream text: `#FFF7ED`

## Generated assets

| Diagram | ZH | EN |
| --- | --- | --- |
| Core / Runtime (底层框架) | `assets/AgenticX 产品与技术架构信息图.png` | `assets/AgenticX Product and Technology Architecture.png` |
| Near Desktop | `desktop/assets/near-desktop-architecture-zh.png` | `desktop/assets/near-desktop-architecture-en.png` |
| Enterprise | `enterprise/assets/enterprise-architecture-zh.png` | `enterprise/assets/enterprise-architecture-en.png` |

Unified copies also live under `desktop/assets/`:

- `agenticx-core-architecture-{zh,en}.png`
- `near-desktop-architecture-{zh,en}.png`
- `enterprise-architecture-{zh,en}.png`

## Source & regeneration

All six diagrams are generated from `gen_arch.py` as whiteboard-friendly SVG (real `<text>` nodes, no raster text):

```bash
python3 assets/prompt-for-pics/orange-style/gen_arch.py diagrams/arch-final
npx -y @larksuite/whiteboard-cli@^0.2.12 -i diagrams/arch-final/core-zh/diagram.svg -o diagrams/arch-final/core-zh/diagram.png -f svg
```

The same SVGs are published as editable Feishu whiteboards.

## README header logo

Transparent SVG, switched by `prefers-color-scheme` in README:

- `assets/agenticx-logo-orange-dark.svg` — light wordmark for dark themes
- `assets/agenticx-logo-orange-light.svg` — dark wordmark for light themes
