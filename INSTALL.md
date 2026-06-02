# AgenticX / Near 安装指南

> **依赖单一来源**：Python 包与版本范围以仓库根目录 `pyproject.toml` 为准。  
> `requirements.txt` 为核心依赖的只读镜像；可复现环境可用 `requirements.lock`（`uv pip compile pyproject.toml -o requirements.lock`）。

## Python 依赖安装

```bash
# 推荐：可编辑安装（开发）
pip install -e .

# Near Desktop / 本地 agx serve（知识库、MCP、文档解析运行时）
pip install -e ".[desktop-runtime]"

# 开发 + 测试
pip install -e ".[dev]"

# 或使用 uv（更快）
pip install uv
uv pip install -e ".[desktop-runtime,dev]"
```

不建议长期使用 `pip install -r requirements.txt` 作为唯一入口（易与 `pyproject.toml` 漂移）。锁定版本：

```bash
uv pip compile pyproject.toml --extra desktop-runtime -o requirements.lock
uv pip install -r requirements.lock
```

一键脚本（从 PyPI 安装 CLI，非源码树）：

```bash
curl -sSL https://raw.githubusercontent.com/DemonDamon/AgenticX/main/install.sh | bash
```

## 系统级依赖

### 文档与 OCR

| 能力 | macOS | Ubuntu/Debian |
|------|-------|----------------|
| 旧版 `.doc` | `brew install antiword` | `sudo apt-get install antiword` |
| OCR | `brew install tesseract` | `sudo apt-get install tesseract-ocr` |
| 扫描 PDF 转图 | `brew install poppler` | `sudo apt-get install poppler-utils` |

可选中文 OCR：`tesseract-lang` / `tesseract-ocr-chi-sim`。

### Office / PDF（Near 知识库与 liteparse）

| 能力 | macOS |
|------|-------|
| `.xlsx` / `.xls` 等（LibreOffice 转换） | `brew install --cask libreoffice` |
| liteparse CLI（PDF/DOCX 等） | `npm i -g @llamaindex/liteparse` |

未安装 LibreOffice 时，知识库 UI 应提示且不支持列表中不应包含 xlsx。

### 飞书长连接（可选）

```bash
pip install "lark-oapi>=1.3.0"
agx feishu   # 需配置 ~/.agenticx/config.yaml 中 gateway / feishu
```

## 支持的文档格式（概要）

- **PDF**：PyMuPDF / pypdf（`[document]` 或 `[desktop-runtime]`）
- **Word**：`.docx`（python-docx）；`.doc`（antiword）
- **PowerPoint**：python-pptx
- **OCR**：pytesseract + 系统 tesseract

## 验证安装

```bash
antiword -h
tesseract --version
pdftoppm -h
agx --version
python -c "import agenticx; print('ok')"
```

## 故障排除

- **编码**：`export LANG=zh_CN.UTF-8`（antiword 中文）
- **tesseract 语言**：`tesseract --list-langs`
- **虚拟环境**：`python -m venv .venv && source .venv/bin/activate`
- **chromadb / onnxruntime**：桌面端请安装 `[desktop-runtime]`，不要只装核心依赖
