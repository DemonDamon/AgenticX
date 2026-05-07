#!/usr/bin/env bash
# Generate a local-only RSA keypair + self-signed X.509 certificate for the
# mock SAML IdP fixture. Output goes to ./.fixture/ and MUST NOT be uploaded
# to production environments.
#
# Usage:
#   bash scripts/sso/mock-saml-idp/setup-keypair.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURE_DIR="$SCRIPT_DIR/.fixture"
mkdir -p "$FIXTURE_DIR"
chmod 700 "$FIXTURE_DIR" 2>/dev/null || true

PRIVATE_KEY="$FIXTURE_DIR/idp-private.pem"
CERT="$FIXTURE_DIR/idp-cert.pem"
KEY_INFO="$FIXTURE_DIR/idp-key-info.txt"

if [ -f "$PRIVATE_KEY" ] && [ -f "$CERT" ]; then
  echo "[mock-saml-idp] keypair already exists at $FIXTURE_DIR" >&2
  exit 0
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required but not found in PATH" >&2
  exit 1
fi

openssl genpkey -algorithm RSA -out "$PRIVATE_KEY" -pkeyopt rsa_keygen_bits:2048 >/dev/null 2>&1
chmod 600 "$PRIVATE_KEY"

openssl req -new -x509 -key "$PRIVATE_KEY" -out "$CERT" -days 3650 \
  -subj "/CN=AgenticX Mock SAML IdP/O=AgenticX Local Fixture" >/dev/null 2>&1

cat > "$KEY_INFO" <<EOF
mock-saml-idp keypair generated $(date -u +%Y-%m-%dT%H:%M:%SZ)
Subject: AgenticX Mock SAML IdP
Validity: 3650 days
Files: idp-private.pem, idp-cert.pem
This keypair is local-only and MUST NOT be deployed to production.
EOF

echo "[mock-saml-idp] generated keypair at $FIXTURE_DIR" >&2
