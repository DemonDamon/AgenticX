#!/usr/bin/env bash
# Machi / AgenticX CLI 一键安装脚本
# 用法: curl -sSL https://raw.githubusercontent.com/agenticx/agenticx/main/install.sh | bash
set -e

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()    { echo -e "${BOLD}[Machi]${NC} $*"; }
success() { echo -e "${GREEN}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
die()     { echo -e "${RED}[✗]${NC} $*" >&2; exit 1; }

info "开始安装 AgenticX CLI (agx)..."
echo ""

# ── 1. 检测 Python ──────────────────────────────────────────────
PYTHON=""
for cmd in python3 python; do
  if command -v "$cmd" &>/dev/null; then
    VER=$("$cmd" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null || echo "0.0")
    MAJOR="${VER%%.*}"
    MINOR="${VER#*.}"
    if [ "$MAJOR" -ge 3 ] && [ "$MINOR" -ge 10 ]; then
      PYTHON="$cmd"
      break
    fi
  fi
done

if [ -z "$PYTHON" ]; then
  die "未找到 Python 3.10+。\n请先安装 Python：https://www.python.org/downloads/\n或使用 Homebrew：brew install python@3.11"
fi

PY_VERSION=$("$PYTHON" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')")
success "检测到 Python ${PY_VERSION} (${PYTHON})"

# ── 2. 安装 agenticx ─────────────────────────────────────────────
info "安装 agenticx 包..."
if "$PYTHON" -m pip install --upgrade agenticx -q; then
  success "agenticx 安装成功"
else
  warn "pip 直接安装失败，尝试 --user 模式..."
  "$PYTHON" -m pip install --user --upgrade agenticx -q \
    || die "安装失败，请尝试手动运行：$PYTHON -m pip install agenticx"
fi

# ── 3. 确认 agx 命令可用 ──────────────────────────────────────────
AGX_PATH=$(command -v agx 2>/dev/null || "$PYTHON" -m pip show agenticx 2>/dev/null | grep -i "^Location" | awk '{print $2}' | xargs -I{} echo "{}/../../../bin/agx" || echo "")

if command -v agx &>/dev/null; then
  AGX_VER=$(agx --version 2>/dev/null || echo "unknown")
  success "agx 命令可用: ${AGX_VER}"
else
  # 常见 --user 安装路径
  USER_BIN="$HOME/.local/bin"
  if [[ "$PATH" != *"$USER_BIN"* ]]; then
    warn "agx 命令未在 PATH 中找到。"
    echo ""
    echo "  请将以下内容添加到 ~/.zshrc 或 ~/.bash_profile，然后重启终端："
    echo ""
    echo "    export PATH=\"\$HOME/.local/bin:\$PATH\""
    echo ""
    echo "  或直接运行："
    echo "    echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.zshrc && source ~/.zshrc"
  else
    warn "agx 安装完成但未能直接调用，请重启终端后再试。"
  fi
fi

echo ""
info "安装完成！重新打开 Machi 即可使用。"
info "如有问题，请访问：https://github.com/agenticx/agenticx"
