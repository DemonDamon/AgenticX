# External identity binding rollout

OIDC authentication resolves the verified token identity `(tenant, provider, issuer, sub)` before considering email. Changing the asserted email does not move an established identity to another local account. The subject comes from the verified ID token `sub`, independently of configurable business claim mappings.

## Migration and compatibility

Apply normal database migrations before deploying the application. PostgreSQL `0075_sso_identity_links` and MySQL `0049_sso_identity_links` add an empty link table. Existing users are linked lazily on their next verified sign-in. On application rollback, retain the additive table to preserve ownership history.

First email association, including JIT creation, requires explicit verification. Standard `email` uses `email_verified`. Custom email mapping must configure its matching verification claim through `SSO_OIDC_<PROVIDER>_CLAIM_EMAIL_VERIFIED` or the provider's `emailVerified` claim mapping. Standard email verification does not verify a different mapped address or a fallback email.

Established identities can sign in when later tokens omit email verification, provided the original local account remains active. Disabled, locked, deleted or replaced accounts never fall back to another email account. A provider can bind one stable subject to a local user; issuer changes and rebindings require an explicit administrative migration outside this change.

Admin login still requires a pre-provisioned account with `admin:enter`. SAML retains its assertion trust policy; transient NameIDs are not persisted as OIDC identity links.

Established identities re-read their account by user ID without taking the tenant write lock. Concurrent first associations share a tenant-row transaction lock. JIT conflicts never overwrite credentials, state or roles. Password hashing occurs outside the lock followed by a fresh transactional check. OIDC does not replay an old user snapshot into the account table after unlocking.

## Validation

Run the auth package tests, Portal/admin identity-login tests and migration/parity tests. Migrate disposable databases, set explicit `SSO_TEST_POSTGRES_URL` and/or `SSO_TEST_MYSQL_URL`, then run from `enterprise`:

```sh
pnpm exec vitest run packages/iam-core/src/repos/__tests__/sso-identity-links.db.test.ts
```

The synthetic-fixture suite covers exact matching, tenant isolation, immutable ownership, concurrent first bindings, rollback, soft deletion and JIT conflict safety. Do not use production databases.

Identity semantics follow [OpenID Connect Core, Claim Stability](https://openid.net/specs/openid-connect-core-1_0.html#ClaimStability): issuer and subject identify an account; email is not a stable identifier.
