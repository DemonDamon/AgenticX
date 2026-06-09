#!/usr/bin/env bash
# CI / 本地：按是否注入 CSC_LINK 选择签名或免签名 electron-builder 配置。
set -euo pipefail

ARCH="${1:?usage: ci-package-mac.sh <arm64|x64>}"

prepare_signing_cert() {
  if [[ -z "${CSC_LINK:-}" ]]; then
    return 1
  fi

  if [[ -z "${CSC_KEY_PASSWORD:-}" ]]; then
    echo "::error::CSC_KEY_PASSWORD is not set. GitHub → Settings → Secrets → add CSC_KEY_PASSWORD (your .p12 export password)."
    exit 1
  fi

  local p12_file="${RUNNER_TEMP:-/tmp}/near-codesign.p12"

  if [[ -f "${CSC_LINK}" ]]; then
    p12_file="${CSC_LINK}"
    echo "==> Using CSC_LINK file path: ${p12_file}"
  else
    # GitHub Secret 应为 base64 -i DeveloperID.p12 的整段输出（可含换行，下面会剥掉）
    local clean_b64
    clean_b64="$(printf '%s' "${CSC_LINK}" | tr -d '[:space:]')"
    if ! printf '%s' "${clean_b64}" | base64 -d > "${p12_file}" 2>/dev/null; then
      echo "::error::CSC_LINK is not a valid file path and not valid base64. Run: base64 -i ~/Documents/AppleCerts/DeveloperID.p12"
      exit 1
    fi
    if [[ ! -s "${p12_file}" ]]; then
      echo "::error::Decoded CSC_LINK is empty. Re-copy base64 -i DeveloperID.p12 into the CSC_LINK secret."
      exit 1
    fi
    echo "==> Decoded CSC_LINK base64 to ${p12_file} ($(wc -c < "${p12_file}") bytes)"
  fi

  if ! openssl pkcs12 -in "${p12_file}" -passin "pass:${CSC_KEY_PASSWORD}" -noout 2>/dev/null; then
    echo "::error::Cannot open .p12 with CSC_KEY_PASSWORD. Password must match the .p12 export password."
    exit 1
  fi

  export CSC_LINK="${p12_file}"
}

if prepare_signing_cert; then
  export CSC_IDENTITY_AUTO_DISCOVERY=true
  CONFIG="electron-builder.signing.yml"
  echo "==> macOS package: signed + notarize (when APPLE_* set)"
else
  export CSC_IDENTITY_AUTO_DISCOVERY=false
  CONFIG="electron-builder.yml"
  echo "==> macOS package: unsigned (no CSC_LINK)"
fi

npx electron-builder --mac "--${ARCH}" --config "${CONFIG}" --publish never

if [[ "${CONFIG}" == "electron-builder.signing.yml" ]]; then
  APP="release/mac-${ARCH}/Near.app"
  echo "==> Verifying code signature on ${APP}"
  codesign -dv --verbose=2 "${APP}" 2>&1 | head -20
  codesign --verify --deep --strict --verbose=2 "${APP}"
  if command -v spctl >/dev/null 2>&1; then
    spctl -a -vv --type execute "${APP}" 2>&1 || true
  fi
fi
