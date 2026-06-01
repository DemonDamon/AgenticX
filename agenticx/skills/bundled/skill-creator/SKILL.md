---
name: skill-creator
description: Create or update AgenticX skills from a live conversation workflow. Use when the user asks to save, persist, or encapsulate a multi-step procedure as a local skill, when tool calls were repeated too often, or when refining SKILL.md frontmatter and discoverability after skill_manage.
requires_tools:
  - skill_use
  - skill_manage
  - skill_list
---

# Skill Creator (AgenticX)

Guide for turning a **successful conversation workflow** into a discoverable skill under `~/.agenticx/skills/`.

For listing, installing, or registry operations, use the separate **agenticx-skill-manager** skill.

## When to use

- User says: 「落盘 skill」「封装成 skill」「工具调用太多，保存成 skill」
- You completed a non-trivial task (roughly 5+ tool calls) and the steps should be reused
- An existing agent-created skill needs a clearer `description` or body after `skill_manage` patch

## Capture intent (from current chat)

Before writing anything, extract from **this conversation**:

1. **Goal** — what the skill enables the agent to do
2. **Trigger** — phrases/contexts when the skill should activate (put in `description`, not only the body)
3. **Inputs/outputs** — formats, files, APIs, edge cases the user corrected
4. **Proven steps** — the sequence that actually worked (not aspirational steps)

Confirm the skill `name` (hyphen-case, e.g. `a-stock-daily-report`) with the user if unclear.

## SKILL.md anatomy

```
my-skill/
├── SKILL.md          # required
├── scripts/          # optional — deterministic helpers
└── references/       # optional — long docs loaded on demand
```

### Frontmatter (required)

```yaml
---
name: my-skill          # MUST match skill_manage name= parameter
description: One line on what it does AND when to trigger it (pushy but accurate).
---
```

- **`name`** — lowercase hyphen-case identifier; **required** for Desktop Skills scan
- **`description`** — primary trigger signal; include when-to-use phrases
- Optional: `version`, `title`, `requires_tools`, `metadata` — AgenticX allows these; do not omit `name`

Keep the body under ~500 lines; split heavy detail into `references/`.

## Persist (mandatory path)

1. **`skill_use(skill-creator)`** — you are here; follow this guide
2. Draft full `SKILL.md` text (frontmatter + body)
3. **`skill_manage(action='create', name='<dir-name>', content='<full SKILL.md>')`**
   - Or `from_path` / `from_url` for large files
   - **Never** `bash_exec` / `file_write` directly into `~/.agenticx/skills/`
4. Read the tool result:
   - `discoverable: true` → skill appears in **Settings → Skills**
   - `frontmatter_fixed` non-empty → tell the user what was auto-corrected (e.g. injected `name`)
   - `ERROR` → do not claim success; fix and retry
5. **`skill_list`** — optional double-check the name appears

## Writing quality

- Imperative steps; concrete commands and paths
- Include failure modes you hit in this session (proxy issues, missing deps, etc.)
- No conversation transcript dumps — actionable procedure only
- Security: no exfiltration, no misleading or destructive instructions

## Minimal template

```markdown
---
name: example-skill
description: Do X when the user mentions Y or Z. Use for ...
---

# Example Skill

## When to use
- ...

## Steps
1. ...
2. ...

## Verification
- How to confirm success
```

## Patch existing skills

`skill_manage(action='patch', name='...', old_string='...', new_string='...')`

After patch, verify `discoverable: true` in the response before telling the user it is visible in Settings.
