---
name: oss-visual-branding
description: Generate high-quality visual branding assets (Logo, Banner, animated GIF, transparent SVG) for open-source projects. Use when the user needs to create or redesign a GitHub README banner, project logo, animated showcase GIF, or transparent-background SVG for an open-source repository or tech product.
---

# OSS Visual Branding

Generate production-ready visual assets for open-source projects: static banners, logos, animated GIFs, and transparent SVGs.

## Workflow

```
1. Design static image (GPT Image 2)
2. [Optional] Generate animation (Gemini Omni → ffmpeg → GIF)
3. [Optional] Create transparent SVG (Python flood-fill + vector text)
```

## Step 1: Static Banner / Logo

### Model & Parameters

- Model: `gpt-image-2`, quality: `high`
- Aspect ratio: `21:9` for GitHub banner, `1:1` for logo/icon
- Use `references` parameter with existing brand assets for style consistency

### Prompt Structure

```
A [style] banner/logo for '[ProjectName]'. [Background: pure black / dark navy].
Center: [main visual element with detailed description].
[Surrounding effects: particles, glow, light trails].
Below: large [weight] white text '[ProjectName]' in [font style].
Subtitle: '[tagline]' in muted grey.
Style: [reference aesthetic — e.g., Anthropic, Vercel, Linear].
```

### Key Principles

- One iconic visual element + dark background + bold brand name
- Prefer geometric/abstract forms over literal illustrations
- Ensure recognizability at 32px (favicon) scale
- Reference top OSS projects for composition style

## Step 2: Animated GIF

### Pipeline

```
Static PNG → crop to 16:9 → Gemini video → ffmpeg → optimized GIF
```

### Crop to 16:9

```bash
ffmpeg -y -i input.png -vf "crop=2048:1152:320:0" output_16_9.png
```

### Video Generation

- Model: `gemini-omni-flash-preview`
- First keyframe: cropped 16:9 image (MUST match aspect ratio exactly)
- Duration: 6-8 seconds
- Resolution: 720p
- Audio: disabled

### Animation Prompt Template

```
A subtle, elegant animation of [subject]. [Slow motion: gentle rotation,
pulsing light, drifting particles]. The text '[text]' remains perfectly
still and stable. The background stays completely static. All motion is
very slow, smooth, and hypnotic — like a premium product showcase loop.
```

Critical rules:
- Explicitly state text must NOT move
- Explicitly state background must NOT change
- Keep motion subtle (5-10 degree rotation, gentle pulse)

### ffmpeg GIF Conversion (two-pass palette)

```bash
ffmpeg -y -i input.mp4 \
  -vf "fps=12,scale=800:-1:flags=lanczos,split[s0][s1];\
[s0]palettegen=max_colors=128:stats_mode=diff[p];\
[s1][p]paletteuse=dither=floyd_steinberg" \
  -loop 0 output.gif
```

Parameters:
- `fps=12`: balance smoothness vs file size
- `scale=800:-1`: optimal for GitHub display
- `max_colors=128`: sufficient for dark-theme graphics
- `stats_mode=diff`: optimize palette for frame differences
- Target: < 10MB for GitHub

## Step 3: Transparent SVG

Use when logo/banner must work on any background (light/dark mode).

### Approach: Hybrid SVG

Complex light effects cannot be vectorized. Use:
- Graphic: rasterized PNG with transparent background (base64 embedded)
- Text: SVG `<text>` elements (crisp at any scale)

### Background Removal

Run `scripts/remove_bg.py input.png output.png` for flood-fill removal. Core logic:
1. Calculate luminance; label connected dark regions
2. Identify border-connected regions as background
3. `distance_transform_edt` for smooth alpha falloff
4. Gaussian blur (r=3) for anti-aliasing
5. Keep bright pixels (luminance > 30) fully opaque

### SVG Assembly

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 W H">
  <image href="data:image/png;base64,..." width="W" height="H"/>
  <text x="50%" y="..." text-anchor="middle"
        font-family="Inter, sans-serif" font-size="180"
        fill="#ffffff">ProjectName</text>
</svg>
```

## GitHub README Usage

```html
<p align="center">
  <img src="assets/banner.gif" width="800">
</p>
```

## Agent Architecture Banners

When designing banners showing multi-agent systems:
- Each agent must have a distinct, non-overlapping role
- Use planetary orbit metaphor (central orchestrator + orbiting nodes)
- Color-code each agent (blue, green, purple, amber, pink)
- Label by exclusive job: Coding, Research, Writing, Data, Review
