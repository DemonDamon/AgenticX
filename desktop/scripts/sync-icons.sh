#!/usr/bin/env bash
set -euo pipefail

# Normalize desktop app icons from a single source image to keep
# development (icon.png) and packaged macOS app icon (icon.icns) visually aligned.

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

if ! command -v sips >/dev/null 2>&1; then
  echo "sips is required on macOS." >&2
  exit 1
fi
if ! command -v iconutil >/dev/null 2>&1; then
  echo "iconutil is required on macOS." >&2
  exit 1
fi

echo "Using source: ${SRC}"

# 1) Generate canonical icon.png (1024x1024) used by dock/dev.
sips -z 1024 1024 "${SRC}" --out "${ASSETS_DIR}/icon.png" >/dev/null

# 2) Generate .icns from the same source so DMG and dev stay consistent.
ICONSET_DIR="${ASSETS_DIR}/icon.iconset"
rm -rf "${ICONSET_DIR}"
mkdir -p "${ICONSET_DIR}"

for size in 16 32 128 256 512; do
  sips -z "${size}" "${size}" "${ASSETS_DIR}/icon.png" --out "${ICONSET_DIR}/icon_${size}x${size}.png" >/dev/null
done

sips -z 32 32 "${ASSETS_DIR}/icon.png" --out "${ICONSET_DIR}/icon_16x16@2x.png" >/dev/null
sips -z 64 64 "${ASSETS_DIR}/icon.png" --out "${ICONSET_DIR}/icon_32x32@2x.png" >/dev/null
sips -z 256 256 "${ASSETS_DIR}/icon.png" --out "${ICONSET_DIR}/icon_128x128@2x.png" >/dev/null
sips -z 512 512 "${ASSETS_DIR}/icon.png" --out "${ICONSET_DIR}/icon_256x256@2x.png" >/dev/null
sips -z 1024 1024 "${ASSETS_DIR}/icon.png" --out "${ICONSET_DIR}/icon_512x512@2x.png" >/dev/null

iconutil -c icns "${ICONSET_DIR}" -o "${ASSETS_DIR}/icon.icns"
rm -rf "${ICONSET_DIR}"

# 3) Keep Windows icon in sync (best effort).
if command -v magick >/dev/null 2>&1; then
  magick "${ASSETS_DIR}/icon.png" -define icon:auto-resize=256,128,64,48,32,16 "${ASSETS_DIR}/icon.ico"
  echo "Generated icon.ico via ImageMagick."
else
  echo "Skipped icon.ico generation (ImageMagick not installed)."
fi

echo "Done:"
echo "  - ${ASSETS_DIR}/icon.png"
echo "  - ${ASSETS_DIR}/icon.icns"
echo "  - ${ASSETS_DIR}/icon.ico (optional)"
