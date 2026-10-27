---
source: https://docs.bigmodel.cn/cn/managed-agents/sandbox-reference
fetched: 2026-10-23
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 预装沙箱环境

本页列出云沙箱的预装内容与运行契约：语言运行时、数据库、常用工具、目录结构与网络行为。会话中 Agent 的所有工具调用（bash、文件操作）都发生在这个环境里；需要额外依赖时用 Environment 的 **packages** 声明增装，见[配置运行环境](cloud-environment.md)。

> [!TIP]
>
> 基础系统：**Ubuntu 24.04 LTS**，架构 **linux/amd64（x86\_64）**，时区 Etc/UTC，locale C.UTF-8。下列版本为当前镜像基线，平台会随镜像发布滚动升级 patch 版本。

## 编程语言

| 语言 / 运行时 | 版本 | 包管理器 / 构建工具 |
| - | - | - |
| Python（默认） | 3.11（并存 3.10 / 3.12 / 3.13） | pip、uv |
| Node.js | 22.x | npm、pnpm、Yarn |
| Bun | 1.3 | bun |
| Go | 1.24 | Go modules |
| Rust | 1.96 | Cargo |
| Java | OpenJDK 21 | Maven、Gradle |
| Ruby | 3.3 | RubyGems、Bundler |
| PHP | 8.3 | Composer |
| C / C++ | GCC/G++ 13、Clang 18 | make、CMake、Ninja、Autotools |

## 数据库

| 组件 | 版本 | 说明 |
| - | - | - |
| SQLite | 3.45 | 嵌入式，含 sqlite3 CLI 与开发头文件，直接可用 |
| PostgreSQL | 16 | server、contrib、psql 已安装；**默认不启动**，按任务显式初始化并启动 |
| Redis | 7 | server 与 redis-cli 已安装；**默认不启动** |
| Docker CLI | 29.x | 含 Buildx、Compose；仅 CLI，沙箱内不运行 Docker daemon |

## 常用工具

### 系统与开发工具

* **源码与文本**：git、ripgrep、curl、wget、jq、yq、sed、awk、grep、diff、patch、vim、nano
* **构建与调试**：make、CMake、Ninja、Autoconf/Automake、pkg-config、gdb、lldb、strace、valgrind、lsof、file
* **归档与传输**：tar、zip/unzip、xz、rsync、OpenSSH client、netcat、fuse3
* **终端与进程**：bash、tmux、screen、tree、procps、sudo、less

### 文档与媒体处理

| 类别 | 工具 |
| - | - |
| Office | LibreOffice Writer / Calc / Impress |
| 通用文档 | Pandoc |
| PDF | Poppler（pdftotext）、qpdf、pdftk、wkhtmltopdf |
| TeX | XeLaTeX、latexmk、TeX Live |
| 图像 / 音视频 | ImageMagick、FFmpeg |
| OCR | Tesseract（含英文语言包） |
| 字体 | Noto CJK / Emoji、Liberation、DejaVu、文泉驿、IPA、TeX Gyre 等，覆盖中日韩与 Emoji |

### 浏览器自动化

Playwright（Python 与 Node 同版本）+ 共享 Chromium（Chrome for Testing），配合 Xvfb 虚拟显示，可直接做网页截图、抓取与端到端测试。

### Python 预装包（节选）

Python 3.11 环境预装了数据分析与文档处理常用包（精确版本以 hash lock 固定）：

numpy、pandas、scipy、scikit-learn、scikit-image、matplotlib、seaborn、networkx、requests、beautifulsoup4、lxml、openpyxl、xlsxwriter、python-docx、python-pptx、pypdf、pdfplumber、pdfminer.six、pikepdf、pdf2image、reportlab、pillow、opencv-python-headless、pytesseract、imageio、mediapipe、onnxruntime、markitdown、markdown、mkdocs、flask、playwright、psutil 等。

### Node 全局工具（节选）

typescript、ts-node、tsx、playwright、sharp、marked、mermaid-cli、markdownlint、pdf-lib、pdfjs-dist、pptxgenjs、docx、react / react-dom 等。

## 目录、用户与端口

| 项目 | 值与说明 |
| - | - |
| Agent 运行用户 | **root**。安全边界是沙箱隔离与网络策略，而非容器内非 root 用户 |
| 默认工作目录 | **/workspace**，Agent 的临时工作区。默认不跨轮保留，见[创建会话](create-session.md#跨轮保留沙箱文件) |
| Skills 挂载 | `/workspace/skills/<目录名>/`，每个挂载 Skill 的内容目录 |
| 上传文件挂载 | **/mnt/session/uploads**，会话挂载的 File Resource，**只读** |
| 产出目录 | **/mnt/session/outputs**，**读写**；跨轮保留，会话结束时其中的文件会被编目为可下载的 Session File，见[文件](files.md) |

默认情况下，**/tmp** 与运行期安装的包（如 `pip install`）不跨轮保留；开启 checkpoint 后会随系统盘快照恢复。需要稳定复现的依赖仍应写进 Environment **packages**，见[配置运行环境](cloud-environment.md)。

## 网络与安全

* 镜像内不包含任何 API Key、Session token 或云存储凭据；Agent 只拿到单次执行所需的运行时配置。
* 出站网络受 Environment 网络策略控制（unrestricted / limited + allowed\_hosts），并统一限制为 HTTP/HTTPS 端口 80/443；由平台侧网关强制执行。
* File 与 Memory 内容通过平台侧挂载暴露为文件，沙箱不获得底层存储的访问凭据。

## 多线程与平台工具

Multi Agent 共享同一 Session 的 Hand 文件工作区，各线程的 Harness、对话历史和工具配置独立。不要把“共享文件”理解为“自动共享对话”。提交长期产物仍使用 /mnt/session/outputs；跨轮中间文件尽量通过 checkpoint，跨 Session 业务状态使用 Memory Store。

web\_search/web\_fetch 在平台侧执行，不依赖手工安装搜索 CLI；当前不能用沙箱联网配置承诺 Web 工具域名过滤。GitHub 仓库资源和外部凭据需要单独授权。

## 下一步

> **[配置运行环境](cloud-environment.md)**
>
> 在基线之上声明 packages 与网络策略

> **[文件](files.md)**
>
> 向沙箱挂载输入文件、下载产出文件

> **[本页对应 OpenAPI](api-reference.md#environments)**
>
> Environment 与会话所用沙箱


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.