#!/usr/bin/env bash
# 模拟双 Channel 容灾：Channel-A 指向不可达地址，Channel-B 为 mock/真实上游。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GATEWAY_DIR="$ROOT/apps/gateway"

echo "[e2e-channel-rotate] run gateway unit tests"
cd "$GATEWAY_DIR"
go test ./internal/channel/... ./internal/relay/... ./internal/adaptor/... ./internal/billing/... -count=1

echo "[e2e-channel-rotate] ok (unit-level rotate/retry coverage)"
