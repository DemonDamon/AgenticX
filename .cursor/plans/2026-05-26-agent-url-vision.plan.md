# Near：让 AI 自己抓网页 + 看图（裸装可用的 URL 视觉理解闭环）

> **Plan-Id**: `2026-05-26-agent-url-vision`
> 范围：`agenticx/` Python 运行时 + 工具注册 + 系统提示。**不动** `desktop/`、`enterprise/`、现有 user 侧 `image_inputs` 链路、现有 `web_search` 工具。
> 遵循 `no-scope-creep.mdc`：每个改动必须能追溯到下面的 FR / AC。

---

## 背景 / 问题陈述（Composer 2.5 必读）

### 用户体感（来自老板真实反馈）
甩给 Near 一个网页链接（如微信公众号文章 URL），希望它像豆包一样直接描述「第一幅图是什么」。当前 Near 在测试机上看似能跑（因为该机器恰好装了外部 `BasicWebCrawler/`），但**新用户裸装后没有任何 MCP / 外部爬虫，整条链路无法跑通**。

### 端到端依赖链 & 现状
| 步骤 | 现状 |
|------|------|
| ① 拉网页 HTML | ❌ STUDIO_TOOLS 里**没有 web_fetch**，`web_search`（`agent_tools.py:3772`）只做搜索引擎查询，不能直接抓 URL 内容 |
| ② 从 HTML 抽出图片 URL | ❌ 无原生工具 |
| ③ 下载图片到本地 | ❌ 无原生工具 |
| ④ 让模型「看」这张图 | ❌ `image_inputs` 通道（`server.py:1298`）**只接收用户输入侧**；工具产物只能以字符串路径形式回给模型，模型自己看不到 bytes |

### 解决思路
一次性补齐两个 native 工具 + 一条运行时注入通路，让裸装 Near 也能完成「URL → 抓图 → 看图」闭环：

- **`web_fetch(url)`** — 拉网页，返回 markdown 化正文 + 内嵌图片 URL 列表
- **`view_image(target)`** — 把本地路径 / http(s) URL / data URL 的图，以多模态消息形式塞回下一轮 LLM
- **runtime scratchpad 桥** — 工具产物里的图字节通过 `session.scratchpad` 转成下一轮 user 多模态 content

---

## 设计要点

### 工具组合方式（模型自然调用）
```
用户: 帮我看下 https://mp.weixin.qq.com/s/xxx 的第一幅图
模型: web_fetch(url="https://mp.weixin.qq.com/s/xxx")
工具: 返回 markdown 正文 + image_urls=["https://mmbiz.qpic.cn/.../cover.jpg", ...]
模型: view_image(target="https://mmbiz.qpic.cn/.../cover.jpg", note="封面图")
工具: 把图 bytes 入 scratchpad，返回占位字符串
runtime: 下一轮自动把图作为 user 多模态 content 塞给 LLM
模型: 真实描述视觉内容
```

### 为什么用 scratchpad 桥而不是直接把图放进 tool message
OpenAI 协议 `role: "tool"` 消息的 `content` 在多数 provider 实现里**只支持字符串**（LiteLLM 多 provider 兼容性差）。把图字节挂到下一条 **user-equivalent** message 上，与现有 `image_inputs` 走同一个 LLM 接口，零兼容风险。

### 为什么 web_fetch 不自动调用 view_image
- 不是所有 URL 任务都需要看图（可能只要正文摘要）
- 模型自主决定**先 fetch 再 view**与豆包行为更接近，token 也更省
- meta_agent prompt 里加引导，让 LLM 自己挑

---

## Requirements

### FR-1：新增 native 工具 `web_fetch`

- 文件：`agenticx/cli/agent_tools.py`
- 注册位置：`STUDIO_TOOLS` 列表中，紧挨 `web_search` 工具定义之后（便于人工 review 关联性）
- 工具 schema：
  ```json
  {
    "name": "web_fetch",
    "description": "Fetch a single web URL and return its readable text content plus a list of in-page image URLs. Use this when the user provides a URL whose content you need to understand. Returns markdown-ish text (HTML stripped) and a structured tail block '[discovered_images]' listing absolute image URLs in source order. Combine with view_image when visual content matters. Does not follow redirects across origins beyond 5 hops. Max page size 2 MB.",
    "parameters": {
      "type": "object",
      "properties": {
        "url": {
          "type": "string",
          "description": "Absolute http(s) URL to fetch."
        },
        "max_images": {
          "type": "integer",
          "description": "Cap on how many image URLs to return (default 20, hard max 50)."
        }
      },
      "required": ["url"]
    }
  }
  ```
- 实现 `_tool_web_fetch(arguments, session)`：
  1. 校验：仅放行 `http://` / `https://`；其它协议返回 `ERROR: only http(s) URLs are supported`
  2. `httpx.AsyncClient(timeout=15.0, follow_redirects=True, max_redirects=5)` 拉取
     - 对 `127.0.0.1` / `localhost` host 必须 `httpx.AsyncHTTPTransport()` 绕系统代理（参考 `feishu_longconn.py` 同款坑）
     - **不**透传 Cookie / Auth；UA 留 httpx 默认
  3. 校验响应：
     - `status_code != 200` → `ERROR: http {status}`
     - `Content-Type` 不以 `text/html` / `application/xhtml` / `text/plain` / `text/markdown` 开头 → `ERROR: unsupported content-type {ct}`
     - response body > 2 MB → `ERROR: page exceeds 2MB limit`
  4. 提取正文 & 图片 URL：
     - **不引入** `beautifulsoup4` 等新依赖；用 stdlib `html.parser` 实现一个轻量 extractor（参考 `agenticx/tools/` 是否已有类似 helper；若无则就近新建 `agenticx/tools/html_extractor.py`，仅做 HTMLParser 子类）
     - 抽取 `<title>`、`<meta property="og:title">`、`<meta name="description">`
     - 抽取所有 `<img src>` 与 `<meta property="og:image">`、`<source srcset>` 的第一项；按 base URL 解析为绝对 URL（用 `urllib.parse.urljoin`）；去重保持顺序
     - 正文文本：去除 `<script>`、`<style>`、`<noscript>` 后取可见文本，**用换行/段落分割**，**不**做复杂的 markdown 还原（保持简单）
  5. 返回字符串格式（让模型一眼能读懂）：
     ```
     Title: <title>
     URL: <final url after redirects>

     <body text, truncated to ~12000 chars; if truncated, append "...[truncated, total ~N chars]">

     [discovered_images]
     1. https://...
     2. https://...
     ```
     若无图，仅省略 `[discovered_images]` 段（不输出空段）
  6. 长度约束：正文部分硬截到 **12 KB 字符**（约 3–4k token，与 `tool_result_budget` 默认窗口对齐），超长截断并附 `...[truncated, total ~N chars]`
- 并发安全：加入 `_CONCURRENCY_SAFE_STUDIO_TOOLS`

### FR-2：新增 native 工具 `view_image`

- 文件：`agenticx/cli/agent_tools.py`
- 注册位置：紧挨 `web_fetch` 之后
- 工具 schema：
  ```json
  {
    "name": "view_image",
    "description": "Load an image so the model can visually inspect it in the next turn. Accepts a local absolute/relative file path, a http(s) URL (e.g. one returned by web_fetch's [discovered_images]), or a data:image/* URL. Use when visual content is necessary to answer (e.g. user asked 'describe the first image'). Returns an error if the current model is not vision-capable. Each turn caps total attached images at 4.",
    "parameters": {
      "type": "object",
      "properties": {
        "target": {"type": "string", "description": "File path, http(s) URL, or data:image/* URL."},
        "note": {"type": "string", "description": "Optional short label used in the placeholder text (e.g. 'cover image')."}
      },
      "required": ["target"]
    }
  }
  ```
- 实现 `_tool_view_image(arguments, session)`：
  1. 解析 target：
     - `data:image/*;base64,...` → 直接接受
     - `http://` / `https://` → 用 `httpx.AsyncClient(timeout=10.0, follow_redirects=True)` 拉取；同 FR-1 的 localhost 代理绕过
     - 其它 → `_resolve_workspace_path(raw, session, pick_existing=True)`，与 `_tool_liteparse` 同款
  2. 字节限制：单图 ≤ 8 MB（与 `server.py:1300` `max_data_url_chars=8_000_000` 对齐）→ `ERROR: image exceeds 8MB limit`
  3. MIME 校验：取 magic bytes（PNG/JPEG/WEBP/GIF/BMP）；不是已知图像 → `ERROR: unsupported image type`
  4. 视觉模型校验：调用 FR-3 的 `is_vision_capable(provider, model)`；不支持 → `ERROR: current model '{model}' does not support vision; switch to a vision-capable model first.`
  5. 成功路径：
     - 追加 `{name, data_url, mime_type, size, source, note}` 到 `session.scratchpad["__pending_visual_attachments__"]`
     - 单轮上限 4 张（与 `_normalize_image_inputs` 的 `max_images=4` 对齐）；超出返回 `ERROR: too many pending visual attachments (max 4 per turn)`，**不**截断
     - 返回字符串：`"[image loaded: {name} ({size_kb} KB, {mime}); will be visually attached in next turn{note_clause}]"`
- 并发安全：加入 `_CONCURRENCY_SAFE_STUDIO_TOOLS`

### FR-3：视觉模型判定函数下沉

- 新建 `agenticx/llms/vision.py`：
  ```python
  #!/usr/bin/env python3
  """Vision capability inference for LLM providers and models.

  Author: Damon Li
  """

  def is_vision_capable(provider_name: str, model_name: str) -> bool:
      ...
  ```
- 内置规则（**只**抽取现有 know-how，不引入新判定）：
  - MiniMax M2 系列：非视觉（参考 `server.py` 现有 `_minimax_m2_family_no_vision`）
  - Zhipu GLM-5 / glm-5-*（名称不含 `vl|vision|4v|5v`）：非视觉（参考 `_zhipu_glm5_family_no_vision`）
  - 其它：默认 True（保留与现状一致的乐观策略）
- `server.py:1865-1872` 改为调用该函数；旧的 `_minimax_m2_family_no_vision` / `_zhipu_glm5_family_no_vision` 保留作 thin wrapper（方便 grep）。

### FR-4：runtime 注入路径

- 文件：`agenticx/runtime/agent_runtime.py`
- 找到工具结果回填后、下一次 LLM 调用前的位置（即将构造 `messages` 发给 provider 处）
- 增加步骤：
  1. `pending = session.scratchpad.pop("__pending_visual_attachments__", [])`
  2. `pending` 非空 → 构造一条 `role: "user"` 多模态消息追加到 messages：
     ```python
     {
       "role": "user",
       "content": [
         {"type": "text", "text": "<system-injected> attached images requested via view_image tool:"},
         *[{"type": "image_url", "image_url": {"url": item["data_url"]}} for item in pending],
       ],
     }
     ```
  3. 追加位置：在 `role: "tool"` 消息之后、再触发下一次 LLM 调用之前
  4. 同步把简化版（不带 `data_url`，仅 `name/mime_type/size/source`）写入 `session.chat_history` 该轮元数据，便于 `messages.json` 审计与历史重放
- **关键约束**：
  - 该注入**只在本轮 LLM tool-call → 续答循环内**生效；新用户 turn 开始时 pending 必须为空（`pop` 已保证）
  - 不修改原 `image_inputs` 用户路径（`server.py:2390-2400`）
  - 与 `tool_result_budget` / `apply_tool_result_budget` 兼容：image 注入是 user message，**不**走 tool_result 预算，不要被误判为大 tool 产物归档

### FR-5：meta_agent system prompt 引导

- 文件：`agenticx/runtime/prompts/meta_agent.py`
- 在已有 tool usage 指引段末尾增加（英文，遵循 `google-python-style.mdc`）：
  > When the user provides a URL whose content matters, prefer `web_fetch(url=...)` to retrieve the page text plus its `[discovered_images]`. If visual analysis is required (e.g. user asks about an image, cover, screenshot), follow up with `view_image(target=...)` using either an image URL from `[discovered_images]`, a local file path produced by other tools, or a `data:image/*` URL. Only `view_image` when visual content is necessary to answer; do not preemptively view every image. Each turn caps total visual attachments at 4.
- **不要**改其它已存在的 prompt 段。

### NFR-1：不引入新运行时依赖
- 仅使用 `httpx`（已是依赖）、stdlib `html.parser` / `base64` / `mimetypes` / `urllib.parse`。
- **不**新增 `beautifulsoup4` / `readability-lxml` / `trafilatura` 等（超出本范围）。

### NFR-2：安全
- `web_fetch` / `view_image` 的 http(s) 请求**不**透传任何 Cookie / Auth header
- 仅放行 `http` / `https` / `data` / 本地路径
- 不缓存图片字节到磁盘
- 不做 SSRF 黑名单扩展

### NFR-3：可观测
- 两个工具的结果走 `record_tool_result_meta`（已有），记录 `tool_name` 与 size_bytes
- 失败用 `ERROR: <reason>` 前缀，不要 raise

---

## 验收标准（AC）

- **AC-1（核心，端到端裸装）**：在一台**未安装任何外部 MCP / 爬虫**的视觉模型 session 中，输入「帮我看下 https://mp.weixin.qq.com/s/blO_z1iw_V7yi83RDgW62w 的第一幅图是什么」→ 模型自然调用 `web_fetch` → 再调用 `view_image` → 真实描述封面图视觉内容（颜色、文字、布局）；**不出现**「我无法解析本地图片文件的视觉内容…如果你上传到对话框我就能分析」之类回退文案。
- **AC-2（视觉模型守卫）**：非视觉模型（MiniMax M2 / GLM-5 非 5v）下调 `view_image` 立即返回 `ERROR: current model ... does not support vision...`，**不**塞 scratchpad；`web_fetch` 仍可用（仅文本）。
- **AC-3（上限）**：单轮调 `view_image` 5 次 → 第 5 次返回 `ERROR: too many pending visual attachments`，前 4 次生效。
- **AC-4（跨 turn 一致性）**：上一轮已注入并被 LLM 消费的图，不会在下一轮被重复塞回。
- **AC-5（用户侧无回归）**：原有用户粘贴/拖拽/上传图（`payload.image_inputs`）链路行为不变；`server.py:2390-2400` 无回归。
- **AC-6（web_fetch 健壮性）**：测试以下输入都返回明确 `ERROR:` 字符串、不抛异常：① `file:///etc/passwd` 等非 http(s) 协议；② 404 / 500 响应；③ Content-Type 是 `application/pdf` / `image/png`；④ 响应体 > 2 MB；⑤ 超时 URL。
- **AC-7（view_image 健壮性）**：测试以下输入都返回明确 `ERROR:`：① > 8 MB 图；② 坏 MIME；③ 不存在的本地路径；④ 远程超时；⑤ 非 http/https/data/路径 的 target。
- **AC-8（messages.json）**：能在该轮的持久化中看到 `tool_calls = [{"name": "web_fetch", ...}, {"name": "view_image", ...}]` 与对应 tool result；视觉注入的合成 user message 也被持久化（Desktop 历史重放时不丢上下文）。
- **AC-9（不引入新依赖）**：`pyproject.toml` / `requirements.txt` 无新增条目。

---

## 任务拆分（Composer 2.5 按序执行）

- [ ] **T1** 新建 `agenticx/llms/vision.py`，实现 `is_vision_capable(provider, model)`；`server.py` 原 `_minimax_m2_family_no_vision` / `_zhipu_glm5_family_no_vision` 改为 thin wrapper 调用新函数。
- [ ] **T2** 新建 `agenticx/tools/html_extractor.py`：基于 stdlib `html.parser.HTMLParser`，提供 `extract_readable_text(html, base_url) -> {title, text, images: list[str], canonical_url}`；不引入新依赖。
- [ ] **T3** `agenticx/cli/agent_tools.py`：
  - 加 `_tool_web_fetch(arguments, session)` 与 STUDIO_TOOLS 条目
  - 加 `_tool_view_image(arguments, session)` 与 STUDIO_TOOLS 条目
  - 两者加入 `_CONCURRENCY_SAFE_STUDIO_TOOLS`
  - `dispatch_tool_async` 的 dispatch 表里挂上
- [ ] **T4** `agenticx/runtime/agent_runtime.py`：在 LLM 调用前注入 scratchpad pending visual attachments → 多模态 user message；同步写 chat_history 简化元数据。
- [ ] **T5** `agenticx/runtime/prompts/meta_agent.py`：追加 FR-5 的引导段。
- [ ] **T6** 单测：
  - `tests/test_html_extractor.py`：覆盖 `<title>`、og:image、相对 URL `urljoin`、`<script>` 去除、空页面、最大字符截断。
  - `tests/test_web_fetch_tool.py`：mock `httpx.AsyncClient.get`，覆盖成功 / 非 http(s) / 404 / 错误 content-type / 超大 body / 超时。
  - `tests/test_view_image_tool.py`：覆盖 data: URL / 本地 path / https URL（mock httpx）/ 非视觉模型拒绝 / 4 张上限 / 超大图。
  - `tests/test_agent_runtime_visual_injection.py`：mock LLM provider，验证 scratchpad pending → 下一轮 messages 含 `image_url` content；消费后 pending 清空。
- [ ] **T7** 文档：在 `docs/guides/` 下新增 `agent-url-vision.md`（≤ 100 行），描述 `web_fetch + view_image` 组合使用方式与限制。**不**新建无关文档、**不**改其它 guide。

---

## 不在本次范围（明确排除）

- ❌ 不动 `desktop/` 任何代码（前端无需感知；Desktop 端的 `image_inputs` paste/drag/attach 链路不变）
- ❌ 不动 `enterprise/`、不动 Go gateway
- ❌ 不引入 `beautifulsoup4` / `readability-lxml` / `trafilatura` 等可选依赖
- ❌ 不修改 `_normalize_image_inputs` 现有用户侧路径
- ❌ 不实现「自动识别 tool result 里的图并自动注入」（保持模型显式调 view_image，可控可观测）
- ❌ 不实现 web_fetch 的 JavaScript 渲染（headless browser 超范围）
- ❌ 不实现 PDF / Office 文档抓取（liteparse 已覆盖本地解析）
- ❌ 不动 `_tool_web_search` 已有实现
- ❌ 不在 `_tool_liteparse` / `_tool_file_read` 末尾追加 view_image hint（先观察 web_fetch + meta prompt 引导是否够用，避免噪音；下版本再决定）

---

## 给 Composer 2.5 的踩坑提示

1. `httpx` 请求 **必须** 对 `127.0.0.1` / `localhost` 用 `AsyncHTTPTransport()` 绕系统代理（`feishu_longconn.py` 已有此坑笔记）。
2. `_resolve_workspace_path` 在 `pick_existing=True` 时会按 session `taskspaces` 解析相对路径；**不要**自行实现，直接复用与 `_tool_liteparse` 同款调用方式。
3. base64 编码用 `base64.b64encode(b).decode("ascii")`，**不要**混入换行。
4. 多模态消息的 `image_url.url` 必须是完整 `data:image/<mime>;base64,...`，**不要**写裸 base64。
5. `html.parser.HTMLParser` 是同步的、容错的；不要尝试 lxml/bs4。处理 `<script>`/`<style>` 用一个 `_skip_depth` 计数器即可。
6. `urllib.parse.urljoin` 用来把相对 `src` 转绝对；公众号 / 微博等站点常用 `//mmbiz.qpic.cn/...` 协议相对 URL，确保 `urljoin` 能正确补 https:。
7. **不要** 顺手「优化」`apply_tool_result_budget` / `tool_result_budget.py`，与本任务无关。
8. **不要** 把 `web_fetch` / `view_image` 暴露给 sub-agent 默认工具集之外的新 surface（保持 STUDIO_TOOLS 注册一致，不动 `team_manager.py` / `meta_tools.py`）。
9. 测试时 mock `httpx.AsyncClient.get` 的返回要正确设置 `.status_code` / `.content` / `.headers["content-type"]` / `.url`。
10. AC-1 必须**真实**用 `https://mp.weixin.qq.com/s/blO_z1iw_V7yi83RDgW62w` 跑一次（不要仅 mock），并把对话片段贴在 PR 描述里作为证据。

---

## 验收清单（Composer 2.5 完成后自查）

- [ ] T1–T7 全部完成
- [ ] `ruff check agenticx/cli/agent_tools.py agenticx/runtime/agent_runtime.py agenticx/llms/vision.py agenticx/tools/html_extractor.py` 通过
- [ ] 所有新增 pytest 文件全绿：
  ```
  pytest tests/test_html_extractor.py tests/test_web_fetch_tool.py tests/test_view_image_tool.py tests/test_agent_runtime_visual_injection.py -x
  ```
- [ ] 手动用 AC-1 公众号 URL 端到端验证一次，对话片段截图或 transcript 贴 PR
- [ ] `git diff --stat` 不含本范围外文件（无 `desktop/` / `enterprise/`）
- [ ] `pyproject.toml` / `requirements.txt` 无变更（AC-9）
- [ ] commit 用 `/commit --spec=.cursor/plans/2026-05-26-agent-url-vision.plan.md` 自动注入 Plan-Id 与 Plan-File trailer；保留 `Made-with: Damon Li`

---

**Made-with: Damon Li**
