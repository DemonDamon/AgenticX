---
source: https://ark.volcengine.com/region:cn-beijing/docs/cloud-sandbox-reference
fetched: 2026-10-24
title: 云沙箱参考
---

# 云沙箱参考

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

本文介绍 Managed Agents 云端沙箱预安装的编程语言、数据库、常用工具（Utilities）和基础资源规格，便于在配置环境或评估任务依赖时快速参考。

云端沙箱运行在方舟提供的隔离 Linux 容器中。运行时、数据库客户端和常用命令行工具已预安装，Agent 可以直接使用。

> 本文中规格描述适用于 `cloud` 类型的 Environments。

## 编程语言

预装常见编程语言及其对应的包管理工具，可直接用于脚本执行、项目构建和依赖安装。

| 编程语言 | 版本 | 包管理工具 |
| --- | --- | --- |
| Python | 3.12+ | pip, uv |
| Node.js | 20+ | npm, yarn, pnpm |
| Go | 1.25+ | go modules |
| Rust | 1.77+ | cargo |
| Java | 21+ | maven, gradle |
| Ruby | 3.3+ | bundler, gem |
| PHP | 8.3+ | composer |
| C/C++ | GCC 13+ | make, cmake |

## 数据库

默认提供轻量数据库和数据库客户端，适合本地数据处理，或连接外部数据库/实例。

| 数据库 | 描述 |
| --- | --- |
| SQLite | 已预安装，可立即使用 |
| PostgreSQL 客户端 | 用于连接外部数据库的 `psql` 客户端。 |
| Redis 客户端 | 用于连接外部 Redis 实例的 `redis-cli`。 |

- SQLite 可在本地使用。
- 数据库服务器，例如 PostgreSQL 和 Redis，默认不在沙箱环境中运行。沙箱提供用于连接的客户端工具。

## Utilities 工具

内置多类常用工具，覆盖系统操作、开发构建、文件搜索、进程查看和文本处理等场景。

### 系统工具

| 工具 | 描述 |
| --- | --- |
| `git` | 版本控制。 |
| `curl`, `wget` | HTTP 客户端。 |
| `jq` | JSON 处理。 |
| `tar`, `zip`, `unzip` | 归档、压缩与解压工具。 |
| `ssh`, `scp` | 远程访问与文件传输工具（需要启用网络）。 |
| `tmux`, `screen` | 终端多路复用工具。 |

### 开发工具

| 工具 | 描述 |
| --- | --- |
| `make`, `cmake` | 构建系统。 |
| `ripgrep` (`rg`) | 快速文件搜索。 |
| `tree` | 目录结构可视化。 |
| `htop` | 进程监控。 |

### 文本处理

| 工具 | 描述 |
| --- | --- |
| `sed`, `awk`, `grep` | 流式文本处理工具。 |
| `vim`, `nano` | 文本编辑器。 |
| `diff`, `patch` | 文件比较与补丁工具。 |

## 沙箱规格

以下为云端沙箱的基础资源规格，可用于评估运行时资源和网络能力。

| 属性 | 具体配置 |
| --- | --- |
| 操作系统 | Ubuntu 22.04 LTS |
| 架构 | x86_64 (amd64) |
| 内存 | 4 GB |
| 磁盘空间 | 10 GB |
| 网络 | 默认开启 |

## 关键目录及 Agent 权限

云端沙箱的文件系统按用途划分为**工作区**、**挂载目录**和**临时目录**三类。挂载目录 `/mnt` 下进一步区分只读的知识与资源（Memory、Skills、上传文件）和读写的产出与存储（Outputs、Storage）。Agent 通过标准文件工具访问这些目录，权限由平台强制约束。

### 目录布局

```text
/
├── workspace/                # 工作区，读写，Agent 的主要工作目录
│   └── AGENTS.md             # System Prompt，只读
├── mnt/                      # 挂载目录
│   ├── memory/               # Agent Memory，只读，见 persistent-memory
│   ├── skills/               # Agent Skills，只读，见 skills
│   └── session/
│       ├── uploads/          # 用户上传文件挂载目录，只读，见 upload-and-mount-files
│       ├── outputs/          # Agent 产出目录，读写，通过 Files API 注册和下载
│       └── storage/          # 通过 Session resources 挂载的 TOS 目录，读写
└── tmp/                      # 临时目录，读写
```

### 目录权限

| 目录 | 用途 | Agent 读权限 | Agent 写权限 |
| --- | --- | --- | --- |
| `$HOME` | 用户 Home | ✓ | ✓ |
| `/workspace` | 工作区，Agent 的主要工作目录 | ✓ | ✓ | \
|  |  |  |  | \
|  | **注意**：`/workspace/AGENTS.md`（System Prompt）为 read-only 权限。 |  |  |
| `/mnt` | 挂载目录 | ✓ | ✓ |
| `/mnt/memory` | Agent Memory 目录，参见 [Memory](persistent-memory.md) | ✓ | ✗ |
| `/mnt/skills` | Agent Skills 目录，参见 [Skills](skills.md) | ✓ | ✗ |
| `/mnt/session/uploads` | Files API 上传文件挂载目录，参见 [上传并挂载文件](upload-and-mount-files.md) | ✓ | ✗ |
| `/mnt/session/outputs` | Agent 产出目录。写入这里的文件会注册到 Files API；需要将产物写入自己的 TOS Bucket 时，为 Environment 配置 `config.tos` | ✓ | ✓ |
| `/mnt/session/storage` | Session 的 TOS 资源挂载目录，详情请参见 [上传与挂载文件](upload-and-mount-files.md) | ✓ | ✓ |
| `/tmp` | 临时目录 | ✓ | ✓ |
| 其它任意路径 | - | ✗ | ✗ |

### 区分产物存储与 TOS 资源挂载

`/mnt/session/outputs` 和 `/mnt/session/storage` 都可能关联 TOS，但用途不同：

| 能力 | 沙箱路径 | 用途 |
| --- | --- | --- |
| Environment 产物存储 | `/mnt/session/outputs` | Agent 写入最终交付物。不配置 `config.tos` 时使用方舟公共 TOS；需要写入自己的 TOS Bucket 时配置该字段。Agent 使用的沙箱路径不变。 |
| Session TOS 资源 | `/mnt/session/storage` | 将已有 TOS 对象作为 Session 输入或共享数据挂载到沙箱，通过 `resources` 配置。 |

Environment 产物存储的配置方法，详情请参见 [配置产物存储](configure-cloud-environment.md#configure-output-storage)。

### 使用规则

Agent 在沙箱中读写文件时应遵循以下规则，避免误改只读资源或将中间产物遗留到用户可见目录：

- **主要工作目录**：使用 `/workspace` 存放项目文件、中间构建产物、脚本执行结果等 Agent 的主要工作内容。
- **读取用户输入**：从 `/mnt/session/uploads` 读取用户通过 Files API 上传的文件；该目录只读，如需修改，请在 `/workspace` 或 `/mnt/session/outputs` 下创建派生文件。
- **写入最终产物**：将需要回传给用户的最终交付物写入 `/mnt/session/outputs`；写入此目录的文件会注册到 Files API，并按 Environment 或 Session 覆写指定的位置存储。
- **跨 Session 复用数据**：需要让多个 Session 读写同一批业务文件时，通过 Session `resources` 将 TOS 目录挂载到 `/mnt/session/storage`。
- **临时文件**：使用 `/tmp` 存放临时缓存和命令中间结果；生命周期随 Session。
- **只读挂载**：不要修改 `/mnt/memory`、`/mnt/skills`、`/mnt/session/uploads`；这些目录承载 Agent 的记忆、能力和用户输入资源。
- **产物路径回报**：如生成了最终交付文件，在最终响应中告知用户对应的文件路径。
