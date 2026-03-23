# Avatar & Group Chat

## Overview

Avatars are persistent agent identities with their own memory, personality, and session history. Group Chat brings multiple avatars together into a collaborative conversation.

## Creating an Avatar

Avatars are managed through the Studio UI or programmatically:

```python
from agenticx.avatar import AvatarRegistry

registry = AvatarRegistry()

avatar = registry.create(
    name="Alice",
    role="Senior Frontend Engineer",
    goal="Help with React and TypeScript development",
    backstory="10 years of experience building large-scale web applications.",
    provider="openai",
    model="gpt-4o"
)
```

## Group Chat

Create a group with multiple avatars:

```python
from agenticx.avatar import GroupChat

group = GroupChat(
    name="Engineering Team",
    members=["Alice", "Bob", "Charlie"],  # Avatar names
    routing_strategy="meta-routed"  # or "user-directed", "round-robin"
)

# The Meta-Agent acts as project manager, routing tasks to appropriate members
group.send("Alice, can you review the authentication PR?")
```

## Routing Strategies

### User-Directed (`@mention`)
The user explicitly routes to a specific avatar using `@Name`:

```
@Alice Can you review this React component?
```

### Meta-Routed
The Meta-Agent (acting as project manager) decides which avatar should handle each message based on their roles and the task at hand.

### Round-Robin
Messages are distributed sequentially to each avatar in order.

## Smart `@mention` Parsing

The group router normalizes mentions — it matches both full names and short slug IDs, handles full-width `＠`, and ignores trailing punctuation. So `@alice`, `@Alice`, `＠Alice,` all route to the same avatar.

## Avatar Memory

Each avatar maintains its own persistent memory:

- Session history (`agent_messages.json`)
- Context files (`context_files_refs.json`)
- Daily memory compression via `MemoryHook`
- Inheritable sessions via `inherit_from_session_id`

## Delegation

The Meta-Agent can delegate tasks to avatars:

```python
# Meta-Agent tool call (internal)
delegate_to_avatar(
    avatar_id="alice",
    task="Review the authentication PR and provide feedback",
    context={"pr_url": "https://github.com/..."}
)
```

Delegation runs in a real avatar session — history and outputs are fully traceable. The delegation status is visible to the frontend via `/api/subagents/status`.

## Studio UI

In the Machi Desktop app, the Avatar sidebar shows all registered avatars and their current status. Click any avatar to open a dedicated chat pane, or create a group to bring multiple avatars together.
