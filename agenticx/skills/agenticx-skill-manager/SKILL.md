---
name: agenticx-skill-manager
description: Guide for managing AgenticX skills including listing, searching, installing, uninstalling, publishing, and running a skill registry server. Use when the user wants to manage skills, find available skills, publish custom skills, set up a skill registry, or understand the skill ecosystem.
metadata:
  author: AgenticX
  version: "0.3.4"
---

# AgenticX Skill Manager

Guide for managing the AgenticX skill ecosystem.

## What Are Skills?

Skills are self-contained instruction bundles (SKILL.md + optional resources) that teach AI agents how to perform specific tasks. AgenticX is compatible with the Anthropic Agent Skills specification.

## Skill Discovery Paths

The skill loader scans these directories (highest priority first):

| Priority | Path | Scope |
|----------|------|-------|
| 1 | `./.agents/skills` | Project (Cherry Studio compatible) |
| 2 | `./.agent/skills` | Project |
| 3 | `~/.agents/skills` | Global |
| 4 | `~/.agent/skills` | Global |
| 5 | `./.claude/skills` | Project |
| 6 | `~/.claude/skills` | Global |
| 7 | Built-in (agenticx package) | Framework |

## CLI Commands

### List Skills

```bash
# List all locally discovered skills
agx skills list

# Include remote registry skills
agx skills list --remote

# Output as JSON
agx skills list --format json
```

### Search Skills

```bash
# Search by keyword
agx skills search "pdf"
agx skills search "workflow"

# Search in remote registry
agx skills search "data analysis" --remote
```

### Install a Skill

```bash
# Install from registry
agx skills install pdf-processor

# Install to specific path
agx skills install pdf-processor --path ./.agents/skills
```

### Uninstall a Skill

```bash
agx skills uninstall pdf-processor
```

### Publish a Skill

```bash
# Publish to default registry
agx skills publish ./my-skills/data-analyzer

# Publish to a specific registry URL
agx skills publish ./my-skills/data-analyzer --registry http://registry.example.com:8321
```

### Run a Skill Registry Server

```bash
# Start local registry (default port 8321)
agx skills serve

# Custom port
agx skills serve --port 9000
```

## Creating a Skill

### Skill Structure

```
my-skill/
├── SKILL.md          # Required: frontmatter + instructions
├── scripts/          # Optional: executable code
├── references/       # Optional: additional documentation
└── assets/           # Optional: templates, images, data
```

### SKILL.md Format

```markdown
---
name: my-skill
description: What this skill does and when to use it. Be specific about triggers.
metadata:
  author: your-name
  version: "1.0"
---

# My Skill

Instructions for the AI agent to follow when this skill is activated.

## Steps
1. First step
2. Second step

## Examples
- Example usage pattern
```

### Key Rules

- **name**: lowercase, hyphens only, max 64 chars, must match directory name
- **description**: max 1024 chars, include both what it does AND when to trigger
- **Body**: under 500 lines; split large content into `references/` files

## Programmatic Access

### SkillBundleLoader

```python
from agenticx.tools.skill_bundle import SkillBundleLoader

loader = SkillBundleLoader()
skills = loader.scan()

for skill in skills:
    print(f"{skill.name}: {skill.description}")

# Get specific skill
meta = loader.get_skill("agenticx-quickstart")
content = loader.get_skill_content("agenticx-quickstart")
```

### SkillRegistryClient

```python
from agenticx.skills import SkillRegistryClient

client = SkillRegistryClient(base_url="http://localhost:8321")
results = client.search("pdf")
client.install("pdf-processor")
```

## Skill Gating

Skills can declare environment requirements in frontmatter:

```yaml
metadata:
  agenticx:
    gate:
      os: ["linux", "darwin"]
      requires_bins: ["ffmpeg"]
      requires_env: ["API_KEY"]
```

Skills that fail gating are silently skipped during scan.

## Skill Sync

Sync skills between directories:

```python
from agenticx.tools.skill_sync import sync_skills, check_skills_sync

# Check sync status
status = check_skills_sync()

# Sync .agents/skills → .claude/skills
sync_skills()
```
