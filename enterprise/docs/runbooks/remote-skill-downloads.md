# Remote Skill downloads

The Portal downloads a focused, assigned Skill only from HTTPS hosts listed in
`ENTERPRISE_SKILL_BUNDLE_HOST_ALLOWLIST` (comma-separated hostnames). Userinfo,
fragments and redirects are rejected. A supplied `bundleDigest` is checked against
the original response bytes before frontmatter is stripped. Legacy records without
a digest remain readable; a nonempty invalid digest is rejected.

DNS resolution, connection, TLS and body reading share a 2.5-second deadline.
Downloads above 24,000 bytes are rejected while reading, including chunked bodies.
The connection uses only the checked DNS addresses and continues to verify the
original TLS hostname. Compressed bodies are rejected rather than decompressed
outside the byte budget.

Private and loopback sources require both the host allowlist and the explicit
`ENTERPRISE_SKILL_BUNDLE_ALLOW_PRIVATE_NETWORK=true` setting. Keep this off unless
an internal source is required. Link-local addresses and the explicitly blocked
metadata addresses remain unavailable with this setting enabled. This is a
server-side deployment setting, not a per-Skill bypass.

Rejected or unavailable downloads leave the focused Skill body out of the prompt;
the catalog remains usable. Logs contain only the Skill identifier and a fixed
event name, not the body or URI.

Run the transport and prompt-contract tests from `enterprise`:

```sh
pnpm exec vitest run apps/web-portal/src/lib/__tests__/enterprise-skill-bundle.test.ts apps/web-portal/src/lib/__tests__/enterprise-skill-context.test.ts apps/web-portal/src/lib/__tests__/enterprise-skill-prompt.test.ts
```

The transport suite uses loopback TLS sockets and generates a one-day test
certificate with `openssl`; it does not contact a remote Skill host or check in a
private key.
