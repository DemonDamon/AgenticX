# AgenticX · Git Hooks

> 本地 pre-commit / commit-msg 防御，用于阻止凭据 / 客户识别字样进入开源仓。

## 安装

第一次 clone 本仓库后运行：

```bash
./.githooks/install.sh
```

该脚本只做一件事：`git config core.hooksPath .githooks`。每次 commit 都会自动跑：

1. **pre-commit**：扫 staged 内容 + 文件路径
2. **commit-msg**：扫本次 commit message

命中任何一条高危 pattern 会**阻止提交**并打印命中行。

## 配置文件

```
.githooks/
├── install.sh             激活 hook（会加入 core.hooksPath）
├── pre-commit             扫 staged diff + 文件名
├── commit-msg             扫 commit message
├── patterns.txt           通用敏感模式（随仓库公开）
├── patterns.local.txt     个人敏感关键词（必须 gitignore）
└── README.md
```

### patterns.txt（随仓发布）

- GitHub PAT / OAuth token
- AWS Access Key / Secret
- OpenAI / Anthropic / 各家 LLM Provider API Key
- 通用 API Bearer Token pattern
- 私钥头部

### patterns.local.txt（本地）

存放**你个人**敏感关键词：
- 具体客户简称 / 客户公司名
- 客户内部项目代号
- 个人可能误引用的路径（如本地业务目录名）

**必须放在 `.gitignore` 排除**，不得提交。

首次使用：

```bash
cp .githooks/patterns.local.txt.example .githooks/patterns.local.txt
# 编辑填入你的敏感关键词（一行一个）
```

## 绕过（紧急场景）

极少数情况下需要合法提交命中 pattern 的内容（比如本复盘文档就含 pattern 示例）：

```bash
git commit --no-verify       # 跳过 pre-commit 和 commit-msg
```

**使用前请双重确认内容不会真正泄露**。

## 与 CI 的关系

- **本地 hook**：第一道防线，低成本高收益
- **GitHub Actions / gitleaks**（见 `.github/workflows/security-scan.yml`）：第二道防线，覆盖所有开发者

两者互补，不可替代。

## 相关

- 事故复盘：[`docs/plans/2026-04-21-leak-incident-postmortem.md`](../docs/plans/2026-04-21-leak-incident-postmortem.md)
- 安全基线：[`enterprise/SECURITY.md`](../enterprise/SECURITY.md)
