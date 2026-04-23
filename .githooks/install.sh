#!/usr/bin/env bash
# AgenticX · Git hooks installer
#
# 激活 .githooks/ 目录作为本仓的 hooksPath，并创建本地敏感词文件。

set -eu

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}[install] 配置 git core.hooksPath = .githooks${NC}"
git config core.hooksPath .githooks

# 确保 hook 脚本可执行
chmod +x .githooks/pre-commit .githooks/commit-msg .githooks/install.sh 2>/dev/null || true

# 首次创建本地敏感词文件
if [ ! -f .githooks/patterns.local.txt ]; then
  cp .githooks/patterns.local.txt.example .githooks/patterns.local.txt
  echo -e "${YELLOW}[install] 已创建 .githooks/patterns.local.txt（请编辑填入你的客户/项目敏感词）${NC}"
else
  echo -e "${GREEN}[install] 已存在 .githooks/patterns.local.txt${NC}"
fi

echo ""
echo -e "${GREEN}✓ Git hooks 已激活${NC}"
echo ""
echo "后续 commit 会自动扫描："
echo "  - staged 内容与文件路径（pre-commit）"
echo "  - commit message（commit-msg）"
echo ""
echo "紧急绕过：git commit --no-verify"
echo "详见：.githooks/README.md"
