# README 与架构绘图提示词更新计划

Planned-with: GPT-5.6 Sol
Suggested-Impl-Model: Composer 2.5 Fast（文档改写与中英逐项对照，成本低且能力足够）

## 目标

基于仓库真实实现更新中英文 README 的产品定位、架构说明与能力摘要，并在 `docs/prompt-for-pics/` 形成总架构、Near Desktop、AgenticX Enterprise 三类架构图的中英文六份专业绘图提示词。

## 根因与证据

- `README.md` 与 `README_ZN.md` 仍以五层框架概览为主，没有清楚表达 AgenticX Core / Near Desktop / Enterprise 三条产品线及其关系。
- README 引用的 `assets/AgenticX System Architecture.png` 与 `assets/AgenticX 系统架构总览图.png` 当前不在仓库内；本次按用户选择暂不切换图片路径，避免再引入未生成的新资源路径。
- `docs/prompt-for-pics/` 仅有 `desktop_cn.md` 与 `enterprise_cn.md`，缺少总图及全部英文等价版本。
- `desktop_cn.md` 将远程单实例后端和 Cluster Runtime 混为未来能力；实码中 `remote_server` 已落地，而 Cluster/HA 尚非 Near 默认链路。
- `enterprise_cn.md` 未表现 Portal BFF，且混淆了 Desktop `agx-server` 与 Enterprise Edge Agent；Enterprise Edge Agent 已达 MVP，但未进入默认生产主链路，Cluster Runtime 仍未开始。

## In Scope

- 修改 `README.md`、`README_ZN.md` 的首屏定位、系统架构说明、核心能力组织和近期状态表达。
- 保留现有 README 图片引用，不创建或假定图片文件已经生成。
- 新建总架构中英文提示词。
- 重写 Near Desktop、Enterprise 中文提示词并新增逐项等价英文版。
- 六份提示词统一遵循根目录 `「文本转绘图描述」规约.md` 的四段结构与固定技术参数句。

## Out of Scope

- 不生成 PNG/SVG 架构图。
- 不修改任何运行时代码、Desktop、Enterprise 应用逻辑或现有功能状态。
- 不补齐 README 当前失效图片文件。
- 不将规划中、可选、MVP 能力改写为默认已上线能力。
- 不顺手更新其他文档或清理用户现有未提交文件。

## 实施任务

### 任务 1：建立三图统一视觉语法

**文件：**
- 新建：`docs/prompt-for-pics/overall_cn.md`
- 新建：`docs/prompt-for-pics/overall_en.md`
- 修改：`docs/prompt-for-pics/desktop_cn.md`
- 新建：`docs/prompt-for-pics/desktop_en.md`
- 修改：`docs/prompt-for-pics/enterprise_cn.md`
- 新建：`docs/prompt-for-pics/enterprise_en.md`

**FR-1：总图**
- 采用“中央 AgenticX 主框架 + 顶部产品入口 + 底部平台支撑 + 两侧生态集成”的 AgentScope 式布局。
- 中央明确 Studio Runtime、Agent Runtime、编排执行、Tools/MCP、Memory/Knowledge、LLM、Skills/Hooks。
- Near 与 Enterprise 是建立在 AgenticX 能力之上的不同产品面，不互相包含。
- 规划能力用灰蓝虚线独立表达。

**FR-2：Near**
- 默认主链路为 Near Desktop → 本机 `agx serve / agx-server` → 工具/模型/本地数据。
- 远程单实例后端标为“可选 · 已落地”；Cluster/HA 单独标“规划中”。
- IM sidecar 从 Electron 主进程侧出发，注明仅本地模式自动拉起。
- Lite 模式、Enterprise Edge Agent 不进入图。

**FR-3：Enterprise**
- 员工主链路为 Web Portal → Portal BFF → Go AI Gateway → 上游兼容模型。
- 控制面与在线网关面分离；Gateway 明确不是完整 Agent Runtime。
- 数据面区分 PG/MySQL、Redis 和 JSONL 审计职责。
- Edge Agent 标为“MVP · 未进默认链路”；Cluster Runtime 标为“未来 · 未开始”。

**FR-4：双语等价**
- 每对中英文提示词保持相同编号、节点数量、容器、箭头、状态、色值与图例。
- 仅翻译展示文本，技术专名保持一致。

**AC-1：**
- `docs/prompt-for-pics/` 恰好包含上述六份提示词。
- 每份均含 `[主题与布局设想]`、`[视觉模块详解]`、`[风格与配色方案]`、`[技术参数建议]`。
- 中文版与英文版逐项编号可一一对应。
- 六份均含清晰度、16:9、2K、标准流程图符号、矢量扁平化、专业学术图表约束。
- 任何规划或 MVP 能力均未接入默认粗实线主链路。

### 任务 2：更新双语 README

**文件：**
- 修改：`README_ZN.md`
- 修改：`README.md`

**落点：**
- 首屏标题、副标题和导航：文件开头至 Vision/Vision 段。
- 系统架构：`## 系统架构` / `## System Architecture`。
- 核心功能：重新组织为 Core、Near Desktop、Enterprise、Ecosystem 四个产品视角，保留必要技术事实。
- 开发进展：减少陈旧 M1-M18 路线图对首要信息的干扰，突出 v0.5.0 当前能力与明确规划边界。

**FR-5：产品关系**
- AgenticX 是底层多智能体框架与 Runtime。
- Near 是本机优先的桌面智能体工作台。
- Enterprise 是企业访问、治理与合规网关产品线。
- 三者共享能力但部署链路不同，尤其不能把 Go Gateway 描述为 Python Agent Runtime。

**FR-6：真实性**
- 版本信息与 `pyproject.toml` 的 `0.5.0` 对齐。
- Near 不再宣称 Pro/Lite 双模式；远程后端是可选已落地，Cluster/HA 是规划。
- Enterprise 员工聊天经 Portal BFF；Edge Agent 为非默认 MVP；Cluster Runtime 不宣称已实现。

**AC-2：**
- 中英文 README 的章节顺序、能力边界与状态限定语一致。
- README 不新增不存在的图片路径。
- `rg` 检查不再出现 Near “Pro/Lite dual mode / Pro/Lite 双模式”。
- `rg` 检查 Enterprise Gateway 附近明确出现“not a full Agent Runtime / 不等同于完整 Agent Runtime”。
- Markdown 标题、链接和代码围栏结构完整。

### 任务 3：验证

**命令：**
- `git diff --check`
- 用 `rg` 对六份提示词检查四段标题、状态关键词和固定技术参数。
- 用脚本或人工对照检查中英文提示词编号集合一致。
- 检查 `git diff -- README.md README_ZN.md docs/prompt-for-pics .cursor/plans/2026-08-08-readme-architecture-prompts.plan.md`，确保无范围外改动。

**AC-3：**
- `git diff --check` 返回 0。
- 六份提示词结构检查通过。
- README 中英文边界描述一致。
- 本次仅修改计划、两个 README 与六份提示词。

## 实施与验证结果

- 已完成 `README.md`、`README_ZN.md` 的产品定位、架构边界、CLI、Studio、Near、Enterprise、安全、会话持久化、存储成熟度和 v0.5.0 状态修订。
- 已形成 `overall`、`desktop`、`enterprise` 三组中英文六份提示词，每组中英文均为 9 个对应视觉章节。
- 已纠正关键边界：Studio 是 REST + SSE API 后端；Near 远程单实例后端为可选已落地；Enterprise 员工链路经过 Portal BFF；Go Gateway 不是完整 Agent Runtime；Enterprise Edge Agent 为非默认 MVP；Cluster Runtime 未开始。
- 已执行 `git diff --check`，退出码为 0。
- 已执行六文件结构脚本，输出 `all six prompts passed`。
- 已检查过时表述，`Pro/Lite dual mode`、默认数据库会话、Studio Web UI、Core / Studio `tenant_id` 已落地主张均无匹配。
- IDE 文档诊断无错误。
