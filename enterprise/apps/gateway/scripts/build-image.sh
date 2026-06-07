#!/usr/bin/env bash
# Build the enterprise gateway container image.
# Usage (from repo root):
#   bash enterprise/apps/gateway/scripts/build-image.sh
#   IMAGE=ghcr.io/agenticx/enterprise-gateway:v0.1.0 bash enterprise/apps/gateway/scripts/build-image.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
ENTERPRISE_DIR="${ROOT}/enterprise"
IMAGE="${IMAGE:-ghcr.io/agenticx/enterprise-gateway:latest}"
DOCKERFILE="${ENTERPRISE_DIR}/apps/gateway/Dockerfile"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 1
fi

echo "[build-image] context=${ENTERPRISE_DIR} image=${IMAGE}"
docker build -f "${DOCKERFILE}" -t "${IMAGE}" "${ENTERPRISE_DIR}"
echo "[build-image] done: ${IMAGE}"
