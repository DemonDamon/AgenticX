#!/usr/bin/env bash
set -euo pipefail

# Normalize desktop app icons from a single source image to keep
# development (icon.png) and packaged app icons visually aligned.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ASSETS_DIR="${DESKTOP_DIR}/assets"

SRC_DEFAULT="${ASSETS_DIR}/icon-master.png"
SRC_FALLBACK="${ASSETS_DIR}/icon.png"
SRC="${1:-${SRC_DEFAULT}}"

if [[ ! -f "${SRC}" ]]; then
  if [[ "${SRC}" == "${SRC_DEFAULT}" && -f "${SRC_FALLBACK}" ]]; then
    SRC="${SRC_FALLBACK}"
  else
    echo "Source icon not found: ${SRC}" >&2
    echo "Tip: provide a source png, e.g. ./scripts/sync-icons.sh assets/icon-master.png" >&2
    exit 1
  fi
fi

if ! python3 -c "from PIL import Image, ImageDraw, ImageOps" >/dev/null 2>&1; then
  echo "Pillow is required to render the rounded application icon." >&2
  exit 1
fi
echo "Using source: ${SRC}"

# Generate PNG, ICNS, and ICO from one transparent rounded tile.
python3 "${SCRIPT_DIR}/render-app-icon.py" \
  "${SRC}" \
  "${ASSETS_DIR}/icon.png" \
  --icns "${ASSETS_DIR}/icon.icns" \
  --ico "${ASSETS_DIR}/icon.ico"

echo "Done:"
echo "  - ${ASSETS_DIR}/icon.png"
echo "  - ${ASSETS_DIR}/icon.icns"
echo "  - ${ASSETS_DIR}/icon.ico"
