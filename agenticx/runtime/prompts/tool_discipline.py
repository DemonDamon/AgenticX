#!/usr/bin/env python3
"""Per-tool usage rules that ride the tool's own ``description``.

Author: Damon Li

这些文字原来整段住在 system prompt 里：``show_widget`` 一个工具的"硬性纪律"就
占了 2938 字符（约 839 token），``query_data_source`` 865 字符，
``skill_manage`` 的使用规范 1408 字符——不管这一轮用不用得上，每个请求都在发。

现在按"触发 vs 用法"拆开：

* **触发规则**（什么时候必须用这个工具、不许用什么替代）留在 system prompt。
  模型必须先知道该出图，才谈得上去调 ``show_widget``。
* **用法细则**（格式怎么写、参数怎么填、有哪些坑）搬到工具自己的
  ``description``。

好处是这些细则从此跟着工具走：ToolSearch 把工具延迟掉时它们一起消失，工具被
加载时它们又原样回来——正好是需要它们的时候。
"""

from __future__ import annotations

SHOW_WIDGET_USAGE = (
    "\n\n=== 渲染细则（中文） ===\n"
    "【格式选择】流程图/架构图/链路图/时序图 → widget_format='mermaid'（自动布局，避免节点重叠）；"
    "自由矢量插图或 Mermaid 无法表达的几何 → 'svg'；"
    "需要交互或数据驱动（折线/饼图/动态筛选）→ 'html' + Chart.js/D3，脚本只能从 CDN 白名单加载。\n"
    "【Mermaid 规范】widget_code 直接从 flowchart / sequenceDiagram 等声明开始，不要包 Markdown 代码围栏；"
    "节点优先短标签，长标签用 <br/> 拆行，不要塞整段；按结构选 TB 或 LR，避免同层塞过多节点；"
    "不要在 Mermaid 里写大段自定义 HTML/CSS。\n"
    "【SVG 规范】文字用 var(--text-primary) / var(--text-muted)；背景与边框用 var(--surface-card) / "
    "var(--border-subtle)；强调色用 rgb(var(--theme-color-rgb))；箭头 marker 用 stroke=\"context-stroke\" "
    "跟随连线颜色；模块用圆角矩形，层间用箭头连接，中文标签要完整可读。\n"
    "【SVG 尺寸】viewBox=\"0 0 W H\" 的 W/H 必须完整包住所有图形与文字并留 ≥24px 边距；"
    "表格/热力图/多行对比等内容越多 H 越大（按行数预估，禁止所有图共用同一固定高度）；"
    "单元格文字不得与相邻格重叠，标签列与数据列之间留足 x 间距；"
    "长句用 <foreignObject> 换行或拆成多行 <tspan>，禁止把多段文字堆在同一坐标。\n"
    "【主题自适应】落盘 HTML/SVG 或独立预览页禁止把背景/正文色写死为仅深色（如 #0d1117 / #e6edf3）；"
    "页面用 CSS 变量 + @media (prefers-color-scheme: light)（及可选 html[data-theme=light|dark|dim]）；"
    "SVG 内同样用 CSS 变量定义 --svg-bg* / --svg-text* 并提供 light 覆盖；"
    "Mermaid 初始化按当前主题选 default（浅色）或 dark，不要写死 theme:'dark'。\n"
    "【CDN 白名单】HTML 模式仅允许 cdnjs.cloudflare.com、esm.sh、cdn.jsdelivr.net、unpkg.com。\n"
    "【其它】每次调用只渲染一个 widget；title 必填且简短（显示在工具卡标题）。"
    "禁止用 ImageGen/截图/HTML 文件落盘替代——纯矢量 SVG、Mermaid 或 sandbox iframe 内 HTML 即可。\n"
    "【时间序列行情】K 线用 chart_type:'candlestick'，宏观趋势用 chart_type:'line'；"
    "用户同时关注多只股票时用 watchlist 数组一次出图（Desktop 顶部 Tab 可切换），不要拆成多个 widget；"
    "保留 attribution / data_source_label 来源角标。\n"
)

QUERY_DATA_SOURCE_USAGE = (
    "\n\n=== 取数细则（中文） ===\n"
    "【默认窗口】股价 K 线默认取 days:60（约 3 个月）。用户说「最近走势 / 最近一周 / 近期表现」等泛化"
    "表述时也按 60 天取，保证图表不稀疏；仅当用户明确要极短窗口（如「对比昨天和前天」）才用更小 days。\n"
    "【只查一次】返回结果已裁剪为 date/OHLC/volume，完整 60 行可一次拿全。禁止因为「看起来被截断」"
    "就用更小 days 反复重查同一支股票——同一 symbol 至多查一次。\n"
    "【出图方式】股票图必须用结构化 stock_chart JSON（单股 points 或多股 watchlist），把返回的 OHLCV 行"
    "原样填进 points；严禁手写 <div>+ECharts <script> HTML 画股票图（会出现白字看不见、图稀疏等问题）。\n"
    "【失败处理】数据源返回凭证缺失/连接失败时，先尝试免费替代源（如 akshare / world_bank）；"
    "全部失败必须明确告知用户「当前数据源暂不可用，无法核实最新数据」，严禁编造具体数值。\n"
)

SKILL_MANAGE_USAGE = (
    "\n\n=== 落盘细则（中文，必须遵守） ===\n"
    "【入口唯一】禁止用 bash_exec / file_write / file_edit 直接写入 ~/.agenticx/skills/；"
    "唯一落盘入口是 skill_manage。所有参数必须在同一次调用中完整填写，禁止发出空参数 {}。\n"
    "【先提炼再落盘】用户说「落盘 skill / 封装成 skill / 工具调用太多」时，先 skill_use(skill-creator) "
    "提炼 workflow，再 skill_manage 落盘。\n"
    "【小文件】action='create'、name=<skill目录名>、content=<完整 SKILL.md 文本>（仅当 SKILL.md 足够小）。\n"
    "【大文件/批量】禁止把 SKILL.md 全文塞进 content 经 LLM context 中转。优先："
    "skill_import_repo(repo='owner/name', dry_run=true) 预览 → dry_run=false 一次安装；"
    "或 skill_manage(action='create', name=..., from_url=<raw.githubusercontent.com/.../SKILL.md>)；"
    "或 bash_exec 下载到本地后 skill_manage(from_path=<绝对路径>)。"
    "ZIP 单包同理：下载解压后用 from_path/from_url，不要 file_read 全文再 content=。\n"
    "【格式】SKILL.md 必须以 YAML frontmatter 开头：---\\nname: <名称>\\ndescription: <描述>\\n---，"
    "后接正文。名称只含字母/数字/连字符/下划线，支持子路径如 engineering/tdd，禁止空格和前导点。\n"
    "【自检】落盘后必须调用 skill_list 或读取返回的 discoverable 字段自检。仅当 discoverable=true 时"
    "才可对用户声称「已在设置 → Skills 可见」；若 frontmatter_fixed 非空，须在回复中说明自动补全项。\n"
    "【重试】禁止在 <think> 里想好参数后发空调用；若上一次报参数缺失，必须重新构造完整参数重试。\n"
)
