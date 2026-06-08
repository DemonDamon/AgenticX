#!/usr/bin/env bash
# CI / 本地：按是否注入 CSC_LINK 选择签名或免签名 electron-builder 配置。
set -euo pipefail

ARCH="${1:?usage: ci-package-mac.sh <arm64|x64>}"

if [[ -n "${CSC_LINK:-}" ]]; then
  export CSC_IDENTITY_AUTO_DISCOVERY=true
  CONFIG="electron-builder.signing.yml"
  echo "==> macOS package: signed + notarize (when APPLE_* set)"
else
  export CSC_IDENTITY_AUTO_DISCOVERY=false
  CONFIG="electron-builder.yml"
  echo "==> macOS package: unsigned (no CSC_LINK)"
fi

npx electron-builder --mac "--${ARCH}" --config "${CONFIG}" --publish never

if [[ -n "${CSC_LINK:-}" ]]; then
  APP="release/mac-${ARCH}/Near.app"
  echo "==> Verifying code signature on ${APP}"
  codesign -dv --verbose=2 "${APP}" 2>&1 | head -20
  codesign --verify --deep --strict --verbose=2 "${APP}"
  if command -v spctl >/dev/null 2>&1; then
    spctl -a -vv --type execute "${APP}" 2>&1 || true
  fi
fi
