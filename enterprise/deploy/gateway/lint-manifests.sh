#!/usr/bin/env bash
# Lint K8s manifests under enterprise/deploy/gateway/
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FILES=(
  "$DIR/deployment.yaml"
  "$DIR/service.yaml"
  "$DIR/hpa.yaml"
)

yaml_syntax_check() {
  python3 - "$@" <<'PY'
import sys
try:
    import yaml
except ImportError:
    print("[lint] PyYAML not installed; skipping syntax check", file=sys.stderr)
    sys.exit(0)
for p in sys.argv[1:]:
    with open(p, encoding="utf-8") as f:
        list(yaml.safe_load_all(f))
    print(f"[lint] yaml ok: {p}")
PY
}

if command -v kubeconform >/dev/null 2>&1; then
  echo "[lint] kubeconform"
  kubeconform -summary "${FILES[@]}"
elif kubectl cluster-info >/dev/null 2>&1; then
  echo "[lint] kubectl apply --dry-run=client"
  kubectl apply --dry-run=client -f "$DIR/deployment.yaml" -f "$DIR/service.yaml" -f "$DIR/hpa.yaml"
else
  echo "[lint] offline yaml syntax (no cluster / kubeconform)"
  yaml_syntax_check "${FILES[@]}"
fi

echo "[lint] manifests OK"
