export DATABASE_DIALECT=mysql
export DATABASE_URL='mysql://agenticx:Agenticx%402024@10.17.65.55:32719/agenticx'
export REDIS_URL='redis://192.168.16.66:6379/0'

export JWT_PRIVATE_KEY="$(cat /opt/agenticx-enterprise/secrets/auth_private.pem)"
export JWT_PUBLIC_KEY="$(cat /opt/agenticx-enterprise/secrets/auth_public.pem)"
export AUTH_COOKIE_SECURE=false
# 正式环境建议替换为真实后台管理员密码；临时 smoke 可先保留。
export ADMIN_CONSOLE_LOGIN_PASSWORD='placeholder'


export DEFAULT_TENANT_ID="01J00000000000000000000001"
export DEFAULT_DEPT_ID="01J00000000000000000000003"
export AGX_PROVIDER_SECRET_KEY="YwEGYMZbs6qr7mUq7JexNDHXEYGIl9HxhcjfcNLNOKc="

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


export AUTH_DEV_OWNER_PASSWORD="placeholder"
export ADMIN_CONSOLE_LOGIN_PASSWORD='placeholder'
export ADMIN_CONSOLE_SESSION_SECRET='a39cc40efbe88dd7c0386cedfe9c50336f366febd26f92febb421c169afedb64'
export AGX_PROVIDER_SECRET_KEY="${AGX_PROVIDER_SECRET_KEY:-02NTklHdNtFY5quCQTLWYC5tB63f6Xgj49mZYFCoLl4=}"
export GATEWAY_INTERNAL_TOKEN="${GATEWAY_INTERNAL_TOKEN:-agenticx-internal-token-change-me}"
export GATEWAY_INTERNAL_BASE_URL="${GATEWAY_INTERNAL_BASE_URL:-http://192.168.16.66}"
export GATEWAY_INTERNAL_URL="${GATEWAY_INTERNAL_URL:-http://192.168.16.66}"
export GATEWAY_REMOTE_PROVIDERS_URL="${GATEWAY_REMOTE_PROVIDERS_URL:-http://192.168.16.66/api/internal/providers}"
export GATEWAY_REMOTE_CHANNELS_URL="${GATEWAY_REMOTE_CHANNELS_URL:-http://192.168.16.66/api/internal/channels}"
export GATEWAY_REMOTE_PRICING_CONFIG_URL="${GATEWAY_REMOTE_PRICING_CONFIG_URL:-http://192.168.16.66/api/internal/pricing-snapshot}"
export GATEWAY_REMOTE_POLICY_SNAPSHOT_URL="${GATEWAY_REMOTE_POLICY_SNAPSHOT_URL:-http://192.168.16.66/api/internal/policy-snapshot}"
export GATEWAY_REMOTE_MCP_SERVERS_URL="${GATEWAY_REMOTE_MCP_SERVERS_URL:-http://192.168.16.66/api/internal/mcp-servers-snapshot}"
export GATEWAY_CHANNEL_REGISTRY="${GATEWAY_CHANNEL_REGISTRY:-on}"
export GATEWAY_COMPLETIONS_URL="${GATEWAY_COMPLETIONS_URL:-http://192.168.16.66/v1/chat/completions}"
export NEXT_PUBLIC_ADMIN_CONSOLE_URL="${NEXT_PUBLIC_ADMIN_CONSOLE_URL:-http://192.168.16.66:3001}"
export WEB_PORTAL_PUBLIC_BASE_URL="${WEB_PORTAL_PUBLIC_BASE_URL:-https://test.pal.cmccfund.com:3000}"
export NEXT_PUBLIC_GATEWAY_PUBLIC_BASE_URL="${NEXT_PUBLIC_GATEWAY_PUBLIC_BASE_URL:-http://192.168.16.66:3000}"