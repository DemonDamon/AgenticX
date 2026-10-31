# AGX Data Suite 文档

本目录存放 AgenticX **Data Suite** 的产品侧说明草稿与截图素材（管理台数据治理 / 看板 / 作业 / ID 映射 / 定时任务 / 自然语言取数等）。

## 飞书正本（请优先阅读）

完整、可演示的产品操作手册在飞书知识库，不依赖本仓库的本地草稿：

- 路径：`大型AI项目各类需求与技术方案` → `AgenticX项目研发` → `产品说明文档` → **Data Suite 产品操作手册**
- 链接：https://wv18cbjmgi0.feishu.cn/wiki/TTDwwY5RLisfV1kvMCwcYBUcnLb

同目录还有姊妹手册：

- **规则与知识套件 · 产品操作手册**：https://wv18cbjmgi0.feishu.cn/wiki/Jdscw3Ba4iioqhkFcANcbzTinWf

## 演示视频

讲解用 MP4（旁白 + 硬字幕）**不提交进 Git**（体积大）。请在上述 Data Suite 飞书手册的「演示视频」一节在线观看。

本地维护者若自行录制，文件通常落在未跟踪路径 `docs/agx-data-suite/shots/data-suite-ops-manual-demo.mp4`；本目录 `shots/.gitignore` 已忽略 `*.mp4` / `*.srt`，避免误提交。

## 本仓库文件

| 文件 | 说明 |
|------|------|
| `S2-产品操作手册-草稿.md` | 与飞书正本同步的 Markdown 草稿 |
| `S2-feishu-ops-manual.url` | 飞书正本快捷链接 |
| `shots/` | E2E / 手册用截图（不含演示视频） |
| `shots/safe-query-e2e/` | 安全问数 A1–A6 证据与清单 |
| `safe-query-w4-manual.md` | 安全问数讲解/执行 UI 手工说明 |


## 安全问数（Agent safe-query）

平台能力：写闸统一契约、NL2SQL 讲解/执行、知识图邻域读门面。管理台入口：`/admin/data-nl2sql`（自然语言取数）。

- E2E 验收清单与截图：[`shots/safe-query-e2e/A1-A6-checklist.md`](shots/safe-query-e2e/A1-A6-checklist.md)
- W4 手工说明：[`safe-query-w4-manual.md`](safe-query-w4-manual.md)
- Master plan：[`../plans/2026-10-31-agx-agent-safe-query-capability-master.md`](../plans/2026-10-31-agx-agent-safe-query-capability-master.md)
