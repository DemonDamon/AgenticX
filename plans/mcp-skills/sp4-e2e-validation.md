# SP4: 端到端验收与回归 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 双 AgenticX 实例（一个 Server、一个 Host）跑通 skills 全链路，验证规范核心语义（digest 校验、审批作废、来源隔离、缓存隔离），并保证存量路径零回归。

**Architecture:** 以 SP2 的 server 与 SP1 的 host 互连做黑盒验收；篡改、换文件、同名注入三类对抗用例验证治理语义；最后全量回归 + PR 整理。

**前置:** SP1–SP3 全部完成。

---

### Task 1: 双实例全链路验收

**Files:**
- Test: `tests/test_skills_e2e.py`

**内容:**
- [ ] 进程 A：`agx skills serve`（测试内起 stdio/HTTP server），注册表预置：本地多文件 skill、旧版单文件 skill、GEPA 蒸馏产物各一条
- [ ] 进程 B：MCP Hub 连接 A → `agx skills list --remote` 断言三条可见且来源标签正确
- [ ] 安装一条：审批（digest 集合写入）→ SKILL.md 读入 → 注入 skill_bundle 加载路径 → BaseTool 可用
- [ ] 旧版单文件条目在 host 侧呈现为单文件 manifest（兼容视图生效）
- [ ] `--include-gate` 过滤：低 gate 条目不出现在 list 中

### Task 2: 对抗性用例（治理语义）

**Files:**
- Test: `tests/test_skills_e2e.py`（续）

**内容:**
- [ ] **篡改检测**：server 端发布后改动一个支撑文件字节（不 bump version）→ host 读取该文件 digest 校验失败 → 内容拒绝 + 条目刷新 + 既有审批作废，重新审批前不可激活
- [ ] **清单增删**：server 端往 skill 加一个文件 → host 侧旧审批失效（digest 集合不匹配）；移除文件同理
- [ ] **同名不替换**：server A、server B 各有同名 skill → host 统一索引中两条并列，`skill_id` 不同；任一安装不影响另一条
- [ ] **越界读取**：构造引用 manifest 外 URI 的读取 → 拒绝
- [ ] **缓存隔离**：缓存落盘后重启 host → filesystem discovery 扫不到缓存目录中的 skill（仅经 MCP 路径可见），origin 标记不丢失

### Task 3: 回归与静态检查

**内容:**
- [ ] `pytest tests/ -k "skill or bundle or mcp or registry or learning"` 全绿
- [ ] 全量 `pytest tests/` 无新增失败（对照 main 基线）
- [ ] 无 skills-capable server 配置时，MCP Hub / skill_bundle / 注册表行为与 main 一致（零行为漂移）
- [ ] `pyproject.toml` 无新增必装依赖（复用现有 `mcp` extra）

### Task 4: 文档与 PR 整理

**内容:**
- [ ] `conclusions/skills_module_conclusion.md` 增补「Skills over MCP 接入」一节（manifest 模型、两端架构、治理语义），登记进 `registry.json`
- [ ] README 的 Skills & Self-Evolution 小节补两行：skills 扩展 Host/Server 双端支持
- [ ] 按仓库 Conventional Commits 分主题提交（协议基座 / host / server / 治理 / 验收）
- [ ] PR 描述含验收命令与输出摘录；关联 master plan 链接

**完成标志:** MASTER-PLAN 验收标准小节的全部命令与断言在干净环境可复现。
