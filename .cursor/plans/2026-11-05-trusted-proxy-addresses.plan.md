# trusted-proxy-addresses

Planned-with: gpt-6.1-sol
Suggested-Impl-Model: gpt-6.1-sol

Baseline: a680b0663fe4f1ecf1afe5c4ac52b124df57a5b6.

## Evidence and changes
Gateway Router in `enterprise/apps/gateway/internal/server/server.go` unconditionally uses middleware.RealIP. Forwarded headers therefore replace the peer address used by policy and audit, even for a direct caller.
FR1: Introduce a configured trusted-proxy middleware. Socket peer is authoritative by default; only configured CIDRs can supply XFF/X-Real-IP. Parse from right to left until the first untrusted hop; validate every address, IPv6/mapped IPv4 and duplicate headers; malformed input falls back to peer. Reject invalid or /0 trust configuration at startup.
FR2: Integrate with existing config/New/Router without changing auth, quotas or client-facing protocol. Document the environment option and ingress responsibility to overwrite untrusted client headers.
AC: Add `internal/server/trusted_proxy_test.go`: direct spoof, no config, trusted single/multiple hop, trusted suffix plus spoof prefix, invalid chain, repeated XFF, IPv6/mapped IPv4, XFF precedence. Verify Router/audit/policy use the resulting RemoteAddr. Run gateway server/config tests and race.
Out of scope: Desktop login rate limiting, deployment proxy configuration, global rate limits.

## Validation
`go test ./internal/config ./internal/server`: passed. `go test -race ./internal/config ./internal/server`: passed. Router integration confirms forwarded address normalization is active only for configured peers; existing policy/audit paths consume this RemoteAddr. `git diff --check`: clean.

## CI follow-up

The published PR initially ran only database contracts, secret scanning and static analysis; no automatic Go unit tests covered the trusted-proxy change. Add a path-scoped `gateway-regressions.yml` that reads the Go version from the module and runs config/server tests with race detection and vet. Pull requests targeting contribution branches are included. Remove the security workflow's PR base-branch restriction while retaining its main/master push filter. This does not change the advisory-only dependency audit or unrelated application tests.
