/**
 * `pg` 8.x + 新版连接串解析会把 `sslmode=require` 当作强校验链；本机跑 seed 连 Supabase
 * 时常遇到 `SELF_SIGNED_CERT_IN_CHAIN`（非密码错误，多为校验链 / 代理环境）。
 *
 * - 默认：主机名为 *.supabase.co 时使用 `rejectUnauthorized: false`，便于本地 seed。
 * - 强制严格：`DATABASE_SSL_REJECT_UNAUTHORIZED=true`
 * - 任意主机放宽：`DATABASE_SSL_REJECT_UNAUTHORIZED=false`
 */
function withProtocol(raw) {
  const trimmed = raw.trim();
  if (/^postgres(ql)?:\/\//i.test(trimmed)) return trimmed;
  return `postgresql://${trimmed}`;
}

function stripStrictSslParams(connectionString) {
  try {
    const url = new URL(withProtocol(connectionString));
    url.searchParams.delete("sslmode");
    url.searchParams.delete("sslrootcert");
    url.searchParams.delete("sslcert");
    url.searchParams.delete("sslkey");
    return url.toString();
  } catch {
    // URL 解析失败时，至少剔除最常见的 sslmode 参数，避免覆盖 ssl 对象。
    return connectionString
      .replace(/[?&]sslmode=[^&]*/gi, "")
      .replace(/[?&]sslrootcert=[^&]*/gi, "")
      .replace(/[?&]sslcert=[^&]*/gi, "")
      .replace(/[?&]sslkey=[^&]*/gi, "")
      .replace(/\?&/, "?")
      .replace(/[?&]$/, "");
  }
}

export function pgSeedClientOptions(connectionString) {
  let hostname = "";
  const rawConnectionString = connectionString.trim();
  const normalizedConnectionString = withProtocol(rawConnectionString);
  try {
    hostname = new URL(normalizedConnectionString).hostname || "";
  } catch {
    hostname = "";
  }

  const flag = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED?.trim().toLowerCase() ?? "";
  const forceStrict = flag === "1" || flag === "true" || flag === "yes";
  const forceRelax = flag === "0" || flag === "false" || flag === "no";

  const relaxTls = forceRelax || (!forceStrict && /\.supabase\.co$/i.test(hostname));

  if (!relaxTls) return { connectionString: normalizedConnectionString };
  return {
    connectionString: stripStrictSslParams(normalizedConnectionString),
    ssl: { rejectUnauthorized: false },
  };
}
