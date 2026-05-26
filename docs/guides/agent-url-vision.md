# URL Content and Visual Inspection

Near ships two built-in Studio tools that let Meta-Agent fetch a web page and inspect images without external MCP servers or local crawlers.

## Tools

### `web_fetch`

Fetches one `http(s)` URL and returns:

- page title
- final URL after redirects
- stripped readable text (HTML removed)
- optional `[discovered_images]` block listing absolute image URLs in source order

Limits:

- page body: 2 MB max
- returned text: ~12 KB (truncated with `...[truncated, total ~N chars]`)
- image URL list: default 20, hard max 50

### `view_image`

Loads one image from:

- `http(s)` URL (for example from `[discovered_images]`)
- local workspace file path
- `data:image/*;base64,...`

On success, the image bytes are queued in the session scratchpad and injected into the **next** LLM call as a multimodal user message. The tool returns a short placeholder string; the model sees the actual image on the following reasoning step.

Limits:

- single image: 8 MB max
- pending attachments per turn: 4 max
- non-vision models (MiniMax M2 family, Zhipu GLM-5 non-vision SKUs) are rejected with `ERROR: ... does not support vision`

## Typical workflow

1. User asks about a URL or its first image.
2. Agent calls `web_fetch(url=...)`.
3. If visual analysis is required, agent calls `view_image(target=<first discovered image URL>)`.
4. Runtime injects the image before the next model call.
5. Agent describes the visual content.

Example user prompt:

```text
帮我看下 https://example.com/article 的第一幅图是什么
```

## What this does not cover

- No JavaScript rendering (SPAs that require a browser still need MCP browser tools).
- No authenticated fetches (cookies / auth headers are not sent).
- No automatic image injection from arbitrary tool outputs; the model must call `view_image` explicitly.
- PDF / Office URLs are rejected (`liteparse` remains the path for local documents).

## Related code

- Tools: `agenticx/cli/agent_tools.py`
- HTML extraction: `agenticx/tools/html_extractor.py`
- Vision model guard: `agenticx/llms/vision.py`
- Runtime injection: `agenticx/runtime/agent_runtime.py`
- Meta prompt guidance: `agenticx/runtime/prompts/meta_agent.py`
