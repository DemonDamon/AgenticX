# Installation

## Requirements

- Python 3.10+
- pip or uv

## Install from PyPI (Recommended)

```bash
pip install agenticx
```

For all optional features (document parsing, vector stores, etc.):

```bash
pip install "agenticx[all]"
```

## Install from Source

```bash
git clone https://github.com/DemonDamon/AgenticX.git
cd AgenticX

# Basic install
pip install -e .

# With all extras
pip install -e ".[all]"
```

## Environment Setup

```bash
# Required: at least one LLM provider key
export OPENAI_API_KEY="your-api-key"

# Optional providers
export ANTHROPIC_API_KEY="your-api-key"
export MOONSHOT_API_KEY="your-api-key"
```

Or use a `.env` file in your project root:

```bash
OPENAI_API_KEY=your-api-key
ANTHROPIC_API_KEY=your-api-key
```

## System Dependencies (Optional)

For advanced document processing features (PDF / Word / PPT parsing):

```bash
# macOS
brew install antiword tesseract

# Ubuntu/Debian
sudo apt-get install antiword tesseract-ocr
```

## Verify Installation

```bash
agx --version
```

You should see output like:

```
agx version 0.x.x
```

## Next Steps

- [Quick Start →](quickstart.md)
- [Configuration →](configuration.md)
