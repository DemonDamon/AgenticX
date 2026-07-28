#!/usr/bin/env bash
# Example env loader for HTTP test stacks (compose *_test.yml / test.yml).
# Copy to a local untracked file (e.g. load-test-runtime-env.local.sh), fill secrets,
# then:  set -a; source ./load-test-runtime-env.local.sh; set +a
#
# Do NOT commit real host IPs, DB DSNs, PEM paths, or passwords.

set -euo pipefail

SECRET_DIR="${SECRET_DIR:-./secrets}"

export DATABASE_DIALECT="${DATABASE_DIALECT:-postgresql}"
export DATABASE_URL="${DATABASE_URL:?Set DATABASE_URL to your test database DSN}"
export REDIS_URL="${REDIS_URL:?Set REDIS_URL (e.g. redis://redis:6379/0)}"

if [[ -z "${JWT_PRIVATE_KEY:-}" && -f "${SECRET_DIR}/auth_private.pem" ]]; then
  JWT_PRIVATE_KEY="$(cat "${SECRET_DIR}/auth_private.pem")"
  export JWT_PRIVATE_KEY
fi
if [[ -z "${JWT_PUBLIC_KEY:-}" && -f "${SECRET_DIR}/auth_public.pem" ]]; then
  JWT_PUBLIC_KEY="$(cat "${SECRET_DIR}/auth_public.pem")"
  export JWT_PUBLIC_KEY
fi
: "${JWT_PRIVATE_KEY:?Set JWT_PRIVATE_KEY or provide ${SECRET_DIR}/auth_private.pem}"
: "${JWT_PUBLIC_KEY:?Set JWT_PUBLIC_KEY or provide ${SECRET_DIR}/auth_public.pem}"

# HTTP test environments usually need Secure cookies off.
export AUTH_COOKIE_SECURE="${AUTH_COOKIE_SECURE:-false}"

export DEFAULT_TENANT_ID="${DEFAULT_TENANT_ID:?DEFAULT_TENANT_ID is required}"
export DEFAULT_DEPT_ID="${DEFAULT_DEPT_ID:-default}"

if [[ -z "${ADMIN_CONSOLE_LOGIN_PASSWORD:-}" && -f "${SECRET_DIR}/admin_password" ]]; then
  ADMIN_CONSOLE_LOGIN_PASSWORD="$(cat "${SECRET_DIR}/admin_password")"
fi
if [[ -z "${AUTH_DEV_OWNER_PASSWORD:-}" && -n "${ADMIN_CONSOLE_LOGIN_PASSWORD:-}" ]]; then
  AUTH_DEV_OWNER_PASSWORD="${ADMIN_CONSOLE_LOGIN_PASSWORD}"
fi
if [[ -z "${ADMIN_CONSOLE_SESSION_SECRET:-}" && -f "${SECRET_DIR}/admin_session_secret" ]]; then
  ADMIN_CONSOLE_SESSION_SECRET="$(cat "${SECRET_DIR}/admin_session_secret")"
fi
if [[ -z "${AGX_PROVIDER_SECRET_KEY:-}" && -f "${SECRET_DIR}/agx_provider_secret_key" ]]; then
  AGX_PROVIDER_SECRET_KEY="$(cat "${SECRET_DIR}/agx_provider_secret_key")"
fi
if [[ -z "${GATEWAY_INTERNAL_TOKEN:-}" && -f "${SECRET_DIR}/gateway_internal_token" ]]; then
  GATEWAY_INTERNAL_TOKEN="$(cat "${SECRET_DIR}/gateway_internal_token")"
fi

export ADMIN_CONSOLE_LOGIN_PASSWORD="${ADMIN_CONSOLE_LOGIN_PASSWORD:?ADMIN_CONSOLE_LOGIN_PASSWORD is required}"
export AUTH_DEV_OWNER_PASSWORD="${AUTH_DEV_OWNER_PASSWORD:-$ADMIN_CONSOLE_LOGIN_PASSWORD}"
export ADMIN_CONSOLE_SESSION_SECRET="${ADMIN_CONSOLE_SESSION_SECRET:?ADMIN_CONSOLE_SESSION_SECRET is required}"
export AGX_PROVIDER_SECRET_KEY="${AGX_PROVIDER_SECRET_KEY:?AGX_PROVIDER_SECRET_KEY is required}"
export GATEWAY_INTERNAL_TOKEN="${GATEWAY_INTERNAL_TOKEN:?GATEWAY_INTERNAL_TOKEN is required}"

# Prefer docker DNS names inside the compose network; override for split-host labs.
export GATEWAY_BASE_URL="${GATEWAY_BASE_URL:-http://gateway-a:8088}"
export GATEWAY_INTERNAL_BASE_URL="${GATEWAY_INTERNAL_BASE_URL:-$GATEWAY_BASE_URL}"
export GATEWAY_INTERNAL_URL="${GATEWAY_INTERNAL_URL:-$GATEWAY_INTERNAL_BASE_URL}"
export GATEWAY_COMPLETIONS_URL="${GATEWAY_COMPLETIONS_URL:-${GATEWAY_BASE_URL}/v1/chat/completions}"
export NEXT_PUBLIC_GATEWAY_BASE="${NEXT_PUBLIC_GATEWAY_BASE:-http://nginx}"
export NEXT_PUBLIC_ADMIN_CONSOLE_URL="${NEXT_PUBLIC_ADMIN_CONSOLE_URL:-http://admin-console:3001}"

export GATEWAY_REMOTE_PROVIDERS_URL="${GATEWAY_REMOTE_PROVIDERS_URL:-${NEXT_PUBLIC_ADMIN_CONSOLE_URL}/api/internal/providers}"
export GATEWAY_REMOTE_CHANNELS_URL="${GATEWAY_REMOTE_CHANNELS_URL:-${NEXT_PUBLIC_ADMIN_CONSOLE_URL}/api/internal/channels}"
export GATEWAY_REMOTE_PRICING_CONFIG_URL="${GATEWAY_REMOTE_PRICING_CONFIG_URL:-${NEXT_PUBLIC_ADMIN_CONSOLE_URL}/api/internal/pricing-snapshot}"
export GATEWAY_REMOTE_MCP_SERVERS_URL="${GATEWAY_REMOTE_MCP_SERVERS_URL:-${NEXT_PUBLIC_ADMIN_CONSOLE_URL}/api/internal/mcp-servers-snapshot}"
export GATEWAY_CHANNEL_REGISTRY="${GATEWAY_CHANNEL_REGISTRY:-on}"
