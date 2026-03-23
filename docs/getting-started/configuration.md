# Configuration

AgenticX uses `~/.agenticx/config.yaml` as its global configuration file.

## Global Config

```yaml
# ~/.agenticx/config.yaml

# Default LLM provider
default_provider: openai
default_model: gpt-4o

# Runtime settings
AGX_MAX_TOOL_ROUNDS: 20

# Studio server
studio:
  host: 0.0.0.0
  port: 8000

# Memory settings
memory:
  backend: sqlite   # sqlite | redis | postgresql
  path: ~/.agenticx/workspace
```

## Provider Configuration

Configure LLM providers in config or via environment variables:

=== "OpenAI"

    ```yaml
    providers:
      openai:
        api_key: ${OPENAI_API_KEY}
        default_model: gpt-4o
    ```

=== "Anthropic"

    ```yaml
    providers:
      anthropic:
        api_key: ${ANTHROPIC_API_KEY}
        default_model: claude-3-5-sonnet-20241022
    ```

=== "Ollama (local)"

    ```yaml
    providers:
      ollama:
        base_url: http://localhost:11434
        default_model: llama3.2
    ```

=== "MiniMax"

    ```yaml
    providers:
      minimax:
        api_key: ${MINIMAX_API_KEY}
        default_model: minimax-m1
    ```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key | — |
| `ANTHROPIC_API_KEY` | Anthropic API key | — |
| `AGX_MAX_TOOL_ROUNDS` | Max tool call rounds per agent turn | `20` |
| `AGX_CHROMIUM_QUIET` | Suppress Chromium logs in Desktop | `false` |

## Workspace & Identity

Agent identities and memory are stored in `~/.agenticx/workspace/`. Each avatar gets its own subdirectory with session history, memories, and context files.

## Project-level Config

For per-project settings, create `agenticx.yaml` in your project root:

```yaml
organization_id: my-org
default_llm:
  provider: openai
  model: gpt-4o-mini
tools:
  mcp_servers:
    - name: filesystem
      command: npx
      args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
```
