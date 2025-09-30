# AgenticX 安装指南

## Python 依赖安装

AgenticX 的 Python 依赖已在 `requirements.txt` 和 `pyproject.toml` 中定义，可以通过以下方式安装：

```bash
# 使用 pip 安装
pip install -r requirements.txt

# 或者安装开发版本
pip install -e .
```

## 系统级依赖

为了支持完整的文档处理功能，需要安装以下系统级依赖：

### macOS 安装

```bash
# 安装 antiword（用于处理旧版 .doc 文件）
brew install antiword

# 安装 tesseract（用于 OCR 文字识别）
brew install tesseract
# 可选：安装额外语言包（包含中文等多语言支持）
# brew install tesseract-lang

# 安装 poppler（用于 PDF 转图像，OCR 功能必需）
brew install poppler
```

### Ubuntu/Debian 安装

```bash
# 安装 antiword
sudo apt-get update
sudo apt-get install antiword

# 安装 tesseract
sudo apt-get install tesseract-ocr
# 可选：安装中文语言包
# sudo apt-get install tesseract-ocr-chi-sim tesseract-ocr-chi-tra

# 安装 poppler（用于 PDF 转图像，OCR 功能必需）
sudo apt-get install poppler-utils
```

### CentOS/RHEL 安装

```bash
# 安装 antiword
sudo yum install antiword

# 安装 tesseract
sudo yum install tesseract
# 可选：安装中文语言包
# sudo yum install tesseract-langpack-chi_sim tesseract-langpack-chi_tra

# 安装 poppler（用于 PDF 转图像，OCR 功能必需）
sudo yum install poppler-utils
```

## 文档处理功能

安装完成后，AgenticX 将支持以下文档格式：

- **PDF 文件**: 使用 PyMuPDF、pypdf 或 PyPDF2
- **Word 文档**: 
  - `.docx` 文件：使用 python-docx
  - `.doc` 文件：使用 antiword（系统依赖）
- **PowerPoint 文档**: 使用 python-pptx
- **OCR 功能**: 使用 pytesseract + tesseract（系统依赖）处理扫描版 PDF

## 验证安装

可以运行以下命令验证系统依赖是否正确安装：

```bash
# 验证 antiword
antiword -h

# 验证 tesseract
tesseract --version

# 验证 poppler
pdftoppm -h
```

## 故障排除

### antiword 问题
- 如果遇到编码问题，可以尝试设置环境变量：`export LANG=zh_CN.UTF-8`

### tesseract 问题
- 确保安装了中文语言包
- 检查 tesseract 数据路径：`tesseract --list-langs`

### Python 依赖问题
- 建议使用虚拟环境：`python -m venv venv && source venv/bin/activate`
- 如果遇到编译问题，可能需要安装系统开发工具