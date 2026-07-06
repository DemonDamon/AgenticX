#!/usr/bin/env bash
set -euo pipefail

# Ensure the script runs from repo root no matter where it is called.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

echo "==> Clean old artifacts"
rm -rf dist/ build/ *.egg-info/

echo "==> Build package"
env -u all_proxy -u ALL_PROXY python -m build

echo "==> Upload package"
env -u all_proxy -u ALL_PROXY python -m twine upload dist/*

echo "==> Done"
