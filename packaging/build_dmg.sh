#!/usr/bin/env bash
# End-to-end: PyInstaller backend -> desktop/bundled-backend -> Electron DMG.
# Usage:
#   packaging/build_dmg.sh [arm64|x64|universal]
#   SKIP_BACKEND=1 packaging/build_dmg.sh arm64   # reuse existing packaging/dist/<arch>/agx-server
# Author: Damon Li

set -euo pipefail

ARCH="${1:-arm64}"
SKIP_BACKEND="${SKIP_BACKEND:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DESKTOP_DIR="$PROJECT_ROOT/desktop"

if [[ "$ARCH" != "arm64" && "$ARCH" != "x64" && "$ARCH" != "universal" ]]; then
  echo "Usage: $0 [arm64|x64|universal]"
  exit 1
fi

echo "=== Building Machi ($ARCH) ==="

copy_arm64() {
  mkdir -p "$DESKTOP_DIR/bundled-backend/arm64"
  # onedir: 可执行 + _internal/ 一起平铺
  cp -R "$SCRIPT_DIR/dist/arm64/agx-server/." "$DESKTOP_DIR/bundled-backend/arm64/"
  chmod +x "$DESKTOP_DIR/bundled-backend/arm64/agx-server"
}

copy_x64() {
  mkdir -p "$DESKTOP_DIR/bundled-backend/x64"
  cp -R "$SCRIPT_DIR/dist/x64/agx-server/." "$DESKTOP_DIR/bundled-backend/x64/"
  chmod +x "$DESKTOP_DIR/bundled-backend/x64/agx-server"
}

# 合并双侧 Mach-O（_internal 里的 .dylib/.so 分架构），非 Mach-O 保留基底侧。
_merge_universal_file() {
  local base="$1" other="$2"
  local archs_base archs_other
  archs_base="$(lipo -archs "$base" 2>/dev/null || true)"
  archs_other="$(lipo -archs "$other" 2>/dev/null || true)"
  [[ -z "$archs_base" || -z "$archs_other" ]] && return 2  # 非 Mach-O，保留 base
  for arch in $archs_other; do
    [[ " $archs_base " == *" $arch "* ]] && return 2  # 架构已包含，跳过
  done
  lipo -create "$base" "$other" -output "$base.universal" 2>/dev/null \
    && mv "$base.universal" "$base" \
    || rm -f "$base.universal"
}

copy_universal() {
  local dst="$DESKTOP_DIR/bundled-backend/universal"
  local a_int="$SCRIPT_DIR/dist/arm64/agx-server/_internal"
  local x_int="$SCRIPT_DIR/dist/x64/agx-server/_internal"
  mkdir -p "$dst"
  lipo -create \
    "$SCRIPT_DIR/dist/arm64/agx-server/agx-server" \
    "$SCRIPT_DIR/dist/x64/agx-server/agx-server" \
    -output "$dst/agx-server"
  chmod +x "$dst/agx-server"
  # _internal 基底用 arm64 侧，再从 x64 侧补齐/合并
  cp -R "$a_int/." "$dst/_internal/"
  while IFS= read -r -d '' rel; do
    local base="$dst/_internal/$rel"
    local other="$x_int/$rel"
    if [[ ! -f "$base" ]]; then
      mkdir -p "$(dirname "$base")"
      cp "$other" "$base"
    else
      _merge_universal_file "$base" "$other"
    fi
  done < <(cd "$x_int" && find . -type f ! -name '.DS_Store' -print0)
}

if [[ -z "$SKIP_BACKEND" ]]; then
  if [[ "$ARCH" == "universal" ]]; then
    echo "--- Step 1: Python backend arm64 + x64 ---"
    "$SCRIPT_DIR/build_backend.sh" arm64
    "$SCRIPT_DIR/build_backend.sh" x64
    echo "--- Step 2: lipo universal agx-server ---"
    copy_universal
  else
    echo "--- Step 1: Python backend ($ARCH) ---"
    "$SCRIPT_DIR/build_backend.sh" "$ARCH"
    echo "--- Step 2: Copy to desktop/bundled-backend ---"
    if [[ "$ARCH" == "arm64" ]]; then
      copy_arm64
    else
      copy_x64
    fi
  fi
else
  echo "--- Step 1: Skipping backend build (SKIP_BACKEND=1) ---"
  if [[ "$ARCH" == "universal" ]]; then
    if [[ ! -f "$SCRIPT_DIR/dist/arm64/agx-server/agx-server" || ! -f "$SCRIPT_DIR/dist/x64/agx-server/agx-server" ]]; then
      echo "✗ Need packaging/dist/{arm64,x64}/agx-server/agx-server when using SKIP_BACKEND with universal"
      exit 1
    fi
    copy_universal
  elif [[ "$ARCH" == "arm64" ]]; then
    if [[ ! -f "$SCRIPT_DIR/dist/arm64/agx-server/agx-server" ]]; then
      echo "✗ Missing packaging/dist/arm64/agx-server/agx-server"
      exit 1
    fi
    copy_arm64
  else
    if [[ ! -f "$SCRIPT_DIR/dist/x64/agx-server/agx-server" ]]; then
      echo "✗ Missing packaging/dist/x64/agx-server/agx-server"
      exit 1
    fi
    copy_x64
  fi
fi

echo "--- Step 3: Desktop npm ci ---"
cd "$DESKTOP_DIR"
npm ci

echo "--- Step 4: vite + electron tsc ---"
npm run build

echo "--- Step 5: electron-builder ---"
if [[ "$ARCH" == "universal" ]]; then
  npx electron-builder --mac universal
else
  npx electron-builder --mac "--$ARCH"
fi

echo "=== Done. Outputs under $DESKTOP_DIR/release/ ==="
ls -lh "$DESKTOP_DIR/release/"*.dmg 2>/dev/null || true
ls -lh "$DESKTOP_DIR/release/"*.zip 2>/dev/null || true
