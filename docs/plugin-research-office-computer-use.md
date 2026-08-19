# Office 文档 Plugin 与 Computer Use 调研

> 调研日期：2026-07-21
>
> 范围：P0 文件级 Office 文档能力；P1 浏览器 Computer Use 能力。

## 结论摘要

P0 值得优先落地。DOCX、XLSX、PPTX、PDF 的读取、提取、结构化生成、局部修改和格式检查，已有成熟的开源库可以支撑第一版。真正困难的是复杂排版的高保真 round-trip、PPT 自动布局、Excel 复杂公式/图表/宏兼容，以及 PDF 正文原地重排。

P1 也适合落地，但应优先采用浏览器 DOM/Accessibility Tree，而不是默认使用截图坐标点击。Microsoft Playwright MCP 已提供成熟的浏览器 MCP 基础；AgenticX 现有 Computer Use Resolver 可以作为视觉兜底，但还需要补齐权限、确认、状态验证、重试和审计。

## 当前仓库能力盘点

### Enterprise Plugin

当前插件协议位于 `enterprise/plugins/`，通过 YAML manifest 描述插件，Gateway 与管理台共同消费。

已有类型：

| 类型 | 当前状态 | 代表能力 |
| --- | --- | --- |
| `rule-pack` | 已实现 | PII、金融、医疗规则 |
| `tool-pack` | 协议已定义，部分为 stub | 文档审查、水印 |
| `theme-pack` | 协议已定义，基本为 stub | 默认主题 |
| WASM Gateway Plugin | 已有运行时骨架 | WAF、关键词改写、审计标记、Bearer 提取 |

已有目录包括：

- `enterprise/plugins/moderation-pii-baseline`
- `enterprise/plugins/moderation-finance`
- `enterprise/plugins/moderation-medical`
- `enterprise/plugins/tool-doc-review`
- `enterprise/plugins/tool-watermark`
- `enterprise/plugins/theme-default`
- `enterprise/plugins/wasm-audit-tagger`
- `enterprise/plugins/wasm-bearer-extractor`
- `enterprise/plugins/wasm-keyword-rewrite`
- `enterprise/plugins/wasm-waf-basic`

协议文档：[`enterprise/docs/plugin-protocol/README.md`](../enterprise/docs/plugin-protocol/README.md)

### AgenticX 工具基础设施

仓库已有以下可复用基础：

- MCP Client 与 MCP Hub：聚合多个 MCP Server，并把远程工具纳入工具解析链。
- API Connector Resolver：优先通过 API/MCP 解决任务。
- Computer Use Resolver：截图 → 视觉模型分析 → 点击/输入/滚动 → 再截图的基础闭环。
- Desktop Adapter：已有 PyAutoGUI 适配和相关测试。
- MinerU MCP：已有文档解析方向的接入。

相关文件：

- [`agenticx/tools/mcp_hub.py`](../agenticx/tools/mcp_hub.py)
- [`agenticx/tools/resolvers/api_connector_resolver.py`](../agenticx/tools/resolvers/api_connector_resolver.py)
- [`agenticx/tools/resolvers/computer_use_resolver.py`](../agenticx/tools/resolvers/computer_use_resolver.py)
- [`examples/agenticx-for-guiagent`](../examples/agenticx-for-guiagent)

## P0：文件级 Office 文档 Plugin

### P0 目标

交付一个统一的 `office-docs` tool-pack，支持本地文件的读取、结构化生成、局部修改、格式转换、渲染预览和确定性校验。

第一阶段不承诺成为通用 Word/Excel/PowerPoint 编辑器，也不承诺对任意复杂历史文件做到无损 round-trip。

### 推荐底层技术栈

| 格式 | 推荐库 | 适合能力 | 主要限制 |
| --- | --- | --- | --- |
| DOCX | `python-docx` | 段落、标题、样式、表格、图片、页眉页脚 | 复杂 OOXML 特性覆盖不完整 |
| XLSX | `openpyxl` | 单元格、工作表、样式、公式、基础图表 | 宏、复杂图表和部分高级特性需谨慎 |
| PPTX | `python-pptx` | 幻灯片、文本框、图片、表格、基础图表、形状 | 高级主题、动画、复杂布局支持有限 |
| PDF | `pypdf` | 拆分、合并、裁剪、旋转、水印、表单、文本提取 | 不适合正文原地重排 |
| 转换/渲染 | LibreOffice headless / UNO | Office 格式转换、PDF 导出、渲染验收 | 转换结果仍需按样例文件验证 |

官方资料：

- [`python-docx`](https://python-docx.readthedocs.io/en/latest/)
- [`openpyxl`](https://openpyxl.readthedocs.io/en/stable/)
- [`python-pptx`](https://python-pptx.readthedocs.io/en/latest/)
- [`pypdf`](https://pypdf.readthedocs.io/en/stable/)
- [`LibreOffice 启动参数`](https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html)

### Plugin 工具面

建议初版提供以下工具：

```text
inspect_document
extract_text
extract_tables
create_docx
patch_docx
create_xlsx
patch_xlsx
create_pptx
patch_pptx
merge_pdf
split_pdf
watermark_pdf
convert_document
render_and_validate
```

所有写操作都应输出新文件或显式指定覆盖策略，默认不覆盖原文件。

建议统一返回：

```json
{
  "input": "/workspace/input.docx",
  "output": "/workspace/output.docx",
  "changes": ["修改第 3 节标题", "新增 2 行表格"],
  "preview": ["/tmp/output/page-1.png"],
  "validation": {
    "opened_successfully": true,
    "page_count": 8,
    "warnings": []
  }
}
```

### P0 优先场景

1. **企业文档审查**：标题层级、编号、字体、间距、敏感信息、目录和引用检查。
2. **报告生成**：Markdown/JSON → DOCX/PDF，并输出页面预览。
3. **数据报告**：CSV/JSON → XLSX、图表和 PDF 摘要。
4. **指定位置局部修改**：按段落、表格、工作表、幻灯片或页面对象修改，而不是让模型自由重写整个文件。

### P0 验收标准

- 能读取 DOCX/XLSX/PPTX/PDF，并返回结构化文本、表格或页面信息。
- 能生成最小可用的 DOCX、XLSX、PPTX 和 PDF。
- 能按明确定位修改指定段落、单元格或幻灯片对象。
- 默认生成新文件，原文件保持不变。
- 生成文件可以被对应解析器重新打开。
- Office 文件经 LibreOffice 转 PDF 后，页面数量、关键文本和关键表格通过校验。
- 对不支持的复杂特性返回明确 warning，不静默破坏原文件。
- 所有文件路径受 workspace 沙箱约束，不能任意访问用户目录。
- 每个工具调用记录输入文件、输出文件、修改摘要、警告和校验结果。

### P0 明确不做

- 第一阶段不做完整 Office GUI 克隆。
- 不保证任意复杂 PPT 的自动美术排版。
- 不承诺 PDF 正文任意位置原地编辑和自动重排。
- 不默认支持带宏文件的安全执行。
- 不把模型生成的完整 XML 直接作为写入接口。

## P1：浏览器 Computer Use

### P1 目标

让 AgenticX 能在受控浏览器中完成登录后的网页任务，同时具备状态展示、用户确认、域名限制、失败恢复和操作审计。

### 推荐执行层级

```text
API / MCP
    ↓
DOM / Accessibility Tree
    ↓
浏览器截图辅助定位
    ↓
视觉模型兜底
```

浏览器任务默认不应直接走屏幕坐标。只有页面没有可用 DOM/ARIA 信息、Canvas/远程桌面或编辑器封装严重时，才进入截图视觉路径。

### 推荐基础设施

#### Playwright MCP

Microsoft 的 Playwright MCP 使用 Playwright，并通过结构化 Accessibility Snapshot 让 LLM 操作网页，不依赖纯截图或专用视觉模型。

参考：[microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp)

适合：

- 在线 Office、企业后台和管理系统。
- 页面表单、表格、审批、上传下载。
- 需要登录态持久化的浏览器任务。
- 需要结构化页面状态和确定性操作的场景。

#### Browser Use

Browser Use 是较成熟的开源浏览器 Agent 项目，提供浏览器状态、持久化上下文和自定义工具扩展。

参考：[browser-use/browser-use](https://github.com/browser-use/browser-use)

它更偏端到端浏览器 Agent，可作为对比实现或外部适配器，不建议直接替代 AgenticX 自身的权限和审计层。

### P1 在 AgenticX 中的适配方式

建议新增一个 `BrowserResolver`，优先接入 Playwright MCP 或内部 Playwright Adapter：

```text
任务意图
  ↓
BrowserResolver 判断是否为浏览器任务
  ↓
创建隔离 browser context
  ↓
获取 accessibility snapshot
  ↓
模型选择结构化 action
  ↓
执行 action
  ↓
读取页面状态和截图
  ↓
完成条件验证 / 重试 / 请求确认
```

建议 action schema：

```json
{
  "action": "click",
  "target": {
    "role": "button",
    "name": "保存"
  },
  "requires_confirmation": true,
  "expected_state": "document_saved"
}
```

比直接返回 `click_at(x, y)` 更容易审计、重试和防止误操作。

### P1 必须具备的安全控制

- 域名白名单和导航限制。
- 下载目录限制。
- 文件上传路径限制。
- 登录态按任务/分身隔离。
- 发送、删除、支付、提交审批等动作默认需要确认。
- 每一步保存 action、页面快照、结果和失败原因。
- 支持用户立即暂停、接管和终止。
- MCP Server 本身不作为安全边界，真正的权限必须由 AgenticX 客户端和执行沙箱控制。

Playwright MCP 文档也明确说明其本身不是安全边界，因此不能只依赖 MCP 参数实现隔离。

### P1 验收标准

- 能在隔离 browser context 中打开允许的站点。
- 能通过 Accessibility Snapshot 完成导航、点击、输入、滚动和读取。
- 能上传/下载受限目录内的文件。
- 能持久化任务级登录态，但不同分身/任务之间不串 session。
- 高风险动作能暂停并等待用户确认。
- 用户可以中途接管或终止任务。
- 页面状态不符合预期时不会盲目继续点击。
- 失败后至少支持一次基于新快照的恢复尝试。
- 任务完成必须有可验证结果，例如页面状态、下载文件、成功提示或目标文本。
- 所有操作可追溯到任务、分身、会话和具体 action。

### P1 明确不做

- 第一阶段不做通用远程桌面控制。
- 不默认允许任意 shell、任意文件路径或任意域名访问。
- 不把 CAPTCHA、反爬绕过、支付和高风险外部操作作为默认能力。
- 不把截图坐标点击作为唯一执行接口。

## 开源方案对比

| 项目 | 定位 | 适合借鉴的部分 | 不建议直接依赖的部分 |
| --- | --- | --- | --- |
| Playwright MCP | 浏览器 MCP | Accessibility Tree、工具定义、浏览器状态 | 权限边界和业务审计需自建 |
| Browser Use | 浏览器 Agent | Agent loop、状态管理、恢复策略 | 云服务和模型层不应绑定 |
| Agent S | 桌面 GUI Agent | 规划、grounding、记忆、GUI loop | 生产权限与企业集成需要重做 |
| OSWorld | Computer Use benchmark | 回归任务和验证体系 | 不是生产运行时 |
| OpenHands | 软件工程 Agent 平台 | SDK、工具编排、任务运行模型 | 目标场景不是 Office 文档编辑 |

参考：

- [Agent S](https://github.com/simular-ai/Agent-S)
- [OSWorld](https://github.com/xlang-ai/OSWorld)
- [OpenHands](https://github.com/OpenHands/OpenHands)

## 推荐实施顺序

### P0-A：基础文档读写

- 统一文件类型识别和路径沙箱。
- 实现 `inspect_document`、`extract_text`、`extract_tables`。
- 覆盖 DOCX、XLSX、PPTX、PDF 的最小样例。

### P0-B：结构化生成与局部修改

- 实现 DOCX/XLSX/PPTX 生成。
- 支持按对象定位的局部 patch。
- 默认生成新文件。

### P0-C：渲染与校验

- 接入 LibreOffice 转换。
- 输出 PDF/PNG 预览。
- 增加文本、页数、表格和关键视觉区域校验。

### P1-A：浏览器 Adapter

- 接入 Playwright MCP 或内部 Playwright Adapter。
- 建立 browser context、域名白名单、文件目录和 session 隔离。

### P1-B：确认与审计

- 加入高风险 action 确认。
- 支持暂停、接管、终止。
- 记录 action、snapshot、结果和恢复过程。

### P1-C：Computer Use 回归集

- 建立本地网页任务集。
- 参考 OSWorld 的任务描述和验证方式。
- 为上传、下载、表单提交、在线 Office 编辑增加端到端测试。

## 总体判断

P0 的工程风险主要集中在文件兼容和视觉验收，适合做成 AgenticX 的正式能力；P1 的工程风险主要集中在权限、安全、状态验证和长链路恢复，适合先做受控浏览器任务。

不建议一开始把“Office 文件 API”和“桌面 GUI Agent”混成一个 plugin。推荐保持两条路径：

```text
office-docs：结构化、可审计、稳定
browser-computer-use：网页交互、状态感知、可接管
desktop-computer-use：最后兜底、强确认、高审计
```

