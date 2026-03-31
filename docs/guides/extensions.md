# Extensions & Skill Ecosystem

AgenticX supports a three-layer extension model that lets you bring in domain knowledge, external tools, avatar presets, and memory templates—either hand-crafted or sourced from the community.

| Layer | What it is | Install path |
|-------|-----------|-------------|
| **Skill** | `SKILL.md` — domain knowledge instructions injected into agent context | `.agents/skills/`, `~/.agents/skills/`, or any configured directory |
| **MCP Server** | External capability via Model Context Protocol (tools, databases, web) | `~/.agenticx/mcp.json` |
| **AGX Bundle** | Package combining any of the above (skills + MCP + avatars + memory templates) | `~/.agenticx/skills/bundles/<bundle-name>/` |

---

## Skills

### What is a Skill?

A Skill is a `SKILL.md` file with optional YAML front matter that tells the agent *how to think* in a specific domain. Unlike MCP servers (which give the agent new tools), Skills give the agent new *knowledge and procedures*.

```
my-skill/
└── SKILL.md
```

```markdown
---
name: deep-research-sop
description: SOP for conducting exhaustive deep research
---

# Deep Research SOP

When asked to research a topic:
1. First, clarify the scope...
2. Search at least 3 independent sources...
...
```

### Where Skills are Discovered

`SkillBundleLoader` scans the following paths in priority order:

| Path | Scope |
|------|-------|
| `./.agents/skills/` | Current project |
| `./.agent/skills/` | Current project (alternate) |
| `~/.agents/skills/` | Global user |
| `~/.agent/skills/` | Global user (alternate) |
| `./.claude/skills/` | Claude Code compatible |
| `~/.claude/skills/` | Claude Code global |
| `~/.agenticx/skills/bundles/` | AGX Bundle installs |
| Built-in package skills | AgenticX defaults |

!!! tip "Existing Cursor / Claude skills work out of the box"
    Any `SKILL.md` you already have in `.cursor/skills/` or `.agents/skills/` is automatically picked up — no migration needed.

### Viewing Skills in Desktop

Open **Settings → 技能** tab to see all discovered skills, search by name or description, click any skill to view the full `SKILL.md` content, and refresh after adding new skills.

### Using Skills in Chat

Skills are automatically injected into the agent's context. You can also explicitly activate one:

```
skill_use("deep-research-sop")
```

Or list available skills:

```
skill_list()
```

---

## AGX Bundle

### What is an AGX Bundle?

An AGX Bundle is a distributable directory package identified by an `agx-bundle.yaml` manifest. It can contain any combination of:

- **Skills** — SKILL.md files
- **MCP Servers** — JSON configuration files
- **Avatar Presets** — YAML files for agent persona presets
- **Memory Templates** — Markdown templates for the memory pipeline

### Bundle Directory Layout

```
my-bundle/
├── agx-bundle.yaml            ← required manifest
├── skills/
│   └── deep-research/
│       └── SKILL.md
├── mcp/
│   └── web-crawler.json
├── avatars/
│   └── researcher.yaml
└── memory/
    └── research-workflow.md
```

### `agx-bundle.yaml` Format

```yaml
agx_bundle: "1.0"           # format version (required)
name: "deep-research-kit"   # bundle identifier (required)
version: "1.0.0"
description: "Complete deep research toolkit"
author: "Damon Li"
license: "MIT"

components:
  skills:
    - path: skills/deep-research/SKILL.md
      description: "Deep research SOP"

  mcp_servers:
    - name: web-crawler
      config_path: mcp/web-crawler.json
      description: "Web crawling MCP server"

  avatars:
    - name: researcher
      config_path: avatars/researcher.yaml
      description: "Research specialist avatar preset"

  memory_templates:
    - name: research-workflow
      path: memory/research-workflow.md
      description: "Memory template for research sessions"
```

All four `components` sections are optional — a bundle with only `skills` is perfectly valid.

### Security

The parser enforces:

- All paths must be **relative** (no absolute paths)
- Paths cannot **escape the bundle directory** (no `../` traversal)
- Invalid entries are skipped with a warning; the install does not abort

### Installing a Bundle

=== "Desktop GUI"

    1. Open **Settings → 技能** tab
    2. Scroll to **已安装扩展包**
    3. Paste the absolute path to your bundle directory in the input field
    4. Click **安装**

    The skills will appear in the skill list above, and any MCP servers will be merged into `~/.agenticx/mcp.json`.

=== "CLI (coming soon)"

    ```bash
    agx bundle install /path/to/my-bundle
    agx bundle list
    agx bundle uninstall deep-research-kit
    ```

=== "Python API"

    ```python
    from pathlib import Path
    from agenticx.extensions.installer import install_bundle, list_installed_bundles

    result = install_bundle(Path("/path/to/my-bundle"))
    if result.success:
        print(f"Installed {result.name} v{result.version}")
        print(f"Skills: {result.skills_installed}")
        print(f"MCP servers: {result.mcp_servers_installed}")

    for bundle in list_installed_bundles():
        print(bundle.name, bundle.version)
    ```

### What Happens on Install

| Component | Destination |
|-----------|------------|
| Skills | `~/.agenticx/skills/bundles/<name>/<skill-dir>/` |
| MCP servers | Merged into `~/.agenticx/mcp.json` under `mcpServers` |
| Avatar presets | `~/.agenticx/avatars/presets/<name>/<avatar>.yaml` |
| Memory templates | `~/.agenticx/workspace/memory_templates/<name>/` |
| Install record | `~/.agenticx/bundles.json` |

### Uninstalling a Bundle

=== "Desktop GUI"

    In **Settings → 技能 → 已安装扩展包**, click **卸载** next to the bundle name.

=== "Python API"

    ```python
    from agenticx.extensions.installer import uninstall_bundle

    uninstall_bundle("deep-research-kit")
    ```

---

## Skill Marketplace

### Configuring Registry Sources

Edit `~/.agenticx/config.yaml` to add registry sources:

```yaml
extensions:
  registries:
    - name: official
      url: https://registry.agxbuilder.com
      type: agx                          # AgenticX native registry
    - name: community
      url: https://example.com/agx-registry.json
      type: agx
    - name: clawhub
      url: https://clawhub.ai/api
      type: clawhub                      # ClawHub skills market
  scan_dirs:
    - ~/.agenticx/bundles
    - ~/.agenticx/skills/registry
```

Two registry types are supported:

| Type | Description |
|------|-------------|
| `agx` | AgenticX native registry — REST API compatible with `agenticx.skills.registry` |
| `clawhub` | ClawHub skills market — search and install `SKILL.md` files from [clawhub.ai](https://clawhub.ai) |

### Searching the Marketplace

=== "Desktop GUI"

    1. Open **Settings → 技能** tab
    2. Scroll to **浏览市场**
    3. Type a keyword in the search box and press Enter or click **搜索**
    4. Results show name, description, author, version, and source badge
    5. Click **安装** on any result

=== "Python API"

    ```python
    from agenticx.extensions.registry_hub import RegistryHub

    hub = RegistryHub.from_config()          # reads ~/.agenticx/config.yaml
    results = hub.search("deep research")

    for r in results:
        print(r.name, r.source_type, r.source)
        print(r.description)
        print(r.install_hint)
    ```

### Installing from a Registry

=== "Desktop GUI"

    Click the **安装** button on any marketplace search result.

=== "Python API"

    ```python
    result = hub.install("clawhub", "web-crawler-skill")
    if result.success:
        print(f"Installed to {result.installed_path}")
    ```

Skills installed from a registry are placed in `~/.agenticx/skills/registry/<skill-name>/SKILL.md` and are immediately available to `SkillBundleLoader`.

---

## Quick Reference

### Minimal Skill (no bundle needed)

Create `~/.agents/skills/my-skill/SKILL.md`:

```markdown
---
name: my-skill
description: What this skill does
---

Instructions for the agent...
```

Done. The skill is discovered automatically on next scan.

### Minimal Bundle (skills only)

```
my-bundle/
├── agx-bundle.yaml
└── skills/
    └── my-skill/
        └── SKILL.md
```

```yaml
# agx-bundle.yaml
agx_bundle: "1.0"
name: "my-bundle"
version: "1.0.0"
description: "My first AGX Bundle"
author: "me"

components:
  skills:
    - path: skills/my-skill/SKILL.md
      description: "My custom skill"
```

Install via Desktop GUI or:

```python
from pathlib import Path
from agenticx.extensions.installer import install_bundle
install_bundle(Path("./my-bundle"))
```

### Connect ClawHub Marketplace

Add to `~/.agenticx/config.yaml`:

```yaml
extensions:
  registries:
    - name: clawhub
      url: https://clawhub.ai/api
      type: clawhub
```

Then search in **Settings → 技能 → 浏览市场**.
