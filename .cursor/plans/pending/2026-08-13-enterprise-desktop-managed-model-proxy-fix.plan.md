# Enterprise Desktop Managed Model Proxy Fix Plan

Planned-with: GPT-5.5
Suggested-Impl-Model: composer-2.5-fast

> **For agentic workers:** Implement this plan task-by-task. Keep the scope limited to Enterprise Desktop managed-model proxy routing and Desktop bootstrap API base URL generation.

## Goal

Fix Enterprise Desktop account-bound chat failures where managed model ids containing nested slashes are rejected by the Gateway with `managed model must be provider/model`, and prevent Desktop bootstrap from returning an internal `0.0.0.0` API base URL.

## Architecture

Desktop stores Enterprise-managed models as visible model ids such as `provider/model` or `provider/family/model`. When Desktop talks through the Web Portal proxy, the proxy must enforce visibility but must not destructively split nested model ids before forwarding to the Gateway. Bootstrap must return a client-facing Portal API base derived from request Host / forwarded headers, not from the internal Next.js request URL.

## Tech Stack

- Next.js route handlers in `enterprise/apps/web-portal/src/app/api/desktop/**`
- TypeScript helper modules in `enterprise/apps/web-portal/src/lib/**`
- Vitest tests in `enterprise/apps/web-portal`

## In Scope

- Preserve full Enterprise managed model ids in the Desktop Portal proxy request body.
- Keep existing live model visibility checks before forwarding.
- Generate Desktop `apiBaseUrl` from a client-facing origin.
- Add focused regression tests for nested managed model ids and reverse-proxy bootstrap origin.

## Out of Scope

- Do not change Gateway authorization semantics.
- Do not change model assignment, quota, audit, or runtime provider storage schemas.
- Do not change Desktop UI model picker behavior.
- Do not add migration logic for existing local Desktop config; users can refresh or re-login to overwrite stale bootstrap data.

## Root Cause And Evidence

The failure path is:

1. Desktop logs in with an Enterprise account and receives visible model ids from `GET /api/desktop/bootstrap`.
2. Desktop sends chat to the local runtime using provider `enterprise` and a model id such as `chinamobile/kimi/kimi-k3`.
3. The local runtime uses the Web Portal Desktop proxy base `/api/desktop/v1`.
4. `enterprise/apps/web-portal/src/lib/gateway-forward.ts` previously split the model id at the first `/`, forwarding body model `kimi/kimi-k3` with header `x-agenticx-provider: chinamobile`.
5. Gateway `resolveManagedModelCandidate()` in `enterprise/apps/gateway/internal/server/managed_model_routing.go` sees the body model still contains `/`, parses it as provider `kimi`, then rejects it because the header provider is `chinamobile`.

The correct proxy behavior is to leave the body model as `chinamobile/kimi/kimi-k3`; Gateway can then resolve provider `chinamobile` and model `kimi/kimi-k3` consistently.

The second issue is independent but in the same login/bootstrap path: `enterprise/apps/web-portal/src/app/api/desktop/bootstrap/route.ts` used `new URL(request.url).origin`, which can reflect an internal listener such as `http://0.0.0.0:3000` under container or reverse-proxy deployment. `enterprise/apps/web-portal/src/lib/desktop-device-auth.ts` already provides `requestOriginFromRequest()` for this exact client-facing-origin need.

## File Structure

- Modify: `enterprise/apps/web-portal/src/lib/gateway-forward.ts`
  - Responsibility: Prepare and authorize Desktop proxy requests before forwarding to Gateway.
- Modify: `enterprise/apps/web-portal/src/lib/gateway-forward.test.ts`
  - Responsibility: Regression tests for managed model visibility and request body preservation.
- Modify: `enterprise/apps/web-portal/src/app/api/desktop/bootstrap/route.ts`
  - Responsibility: Return Desktop bootstrap metadata, including `apiBaseUrl`.
- Modify: `enterprise/apps/web-portal/src/app/api/desktop/bootstrap/__tests__/route.test.ts`
  - Responsibility: Regression tests for bootstrap transport and client-facing API base URL.

## Functional Requirements

### FR-1: Preserve Full Managed Model IDs In Portal Proxy

`prepareGatewayForward()` must continue to verify that `parsed.model` is visible to the authenticated Desktop user, but it must not split the model id into a provider header and bare model body.

Acceptance criteria:

- Given visible model id `openai-main/gpt-4o`, the forwarded JSON body keeps `model: "openai-main/gpt-4o"`.
- Given visible nested model id `chinamobile/kimi/kimi-k3`, the forwarded JSON body keeps `model: "chinamobile/kimi/kimi-k3"`.
- `providerHint` is empty for these managed model ids so the Gateway does not receive a conflicting `x-agenticx-provider` header.
- Hidden model ids still return HTTP 403 with the existing Chinese error message.

Implementation anchor:

```ts
// enterprise/apps/web-portal/src/lib/gateway-forward.ts
if (typeof parsed.model === "string" && parsed.model.includes("/")) {
  const effectiveModels = await listAvailableModelsForUser(...);
  const isVisible = effectiveModels.some((m) => m.id === parsed.model);
  if (!isVisible) {
    return { error: { status: 403, code: "40301", message: "该模型已不在您的可见范围内，请刷新模型列表后重新选择" } };
  }
  // Do not split parsed.model. Leave forwardBody unchanged.
}
return { forwardBody, providerHint: "" };
```

### FR-2: Use Client-Facing Origin For Desktop Bootstrap API Base

`GET /api/desktop/bootstrap` must build `apiBaseUrl` from `requestOriginFromRequest(request)` instead of `new URL(request.url).origin`.

Acceptance criteria:

- A normal request to `http://localhost:3000/api/desktop/bootstrap` still returns `http://localhost:3000/api/desktop/v1`.
- A reverse-proxy request whose internal URL is `http://0.0.0.0:3000/api/desktop/bootstrap` but headers contain `host: portal.example.invalid` and `x-forwarded-proto: https` returns `https://portal.example.invalid/api/desktop/v1`.
- Direct Gateway eligibility and `NEXT_PUBLIC_GATEWAY_PUBLIC_BASE_URL` behavior remain unchanged.

Implementation anchor:

```ts
// enterprise/apps/web-portal/src/app/api/desktop/bootstrap/route.ts
import { requestOriginFromRequest } from "../../../../lib/desktop-device-auth";

const origin = requestOriginFromRequest(request);
const apiBaseUrl = `${origin}/api/desktop/v1`;
```

## Tasks

### Task 1: Add Failing Regression Coverage For Nested Managed Models

**Files:**

- Modify: `enterprise/apps/web-portal/src/lib/gateway-forward.test.ts`

Steps:

- [ ] Add `chinamobile/kimi/kimi-k3` to the mocked `listAvailableModelsForUser()` result.
- [ ] Change the existing split test to assert that `openai-main/gpt-4o` remains intact.
- [ ] Add a nested-id test:

```ts
it("keeps nested managed model ids intact", async () => {
  const raw = JSON.stringify({
    model: "chinamobile/kimi/kimi-k3",
    messages: [{ role: "user", content: "hi" }],
    stream: true,
  });
  const result = await prepareGatewayForward(raw, {
    userId: "u1",
    email: "admin@agenticx.local",
    deptId: null,
  });
  expect("error" in result).toBe(false);
  if ("error" in result) return;
  expect(result.providerHint).toBe("");
  const body = JSON.parse(result.forwardBody) as { model: string };
  expect(body.model).toBe("chinamobile/kimi/kimi-k3");
});
```

Expected before implementation: test fails because `forwardBody.model` becomes `kimi/kimi-k3` and `providerHint` becomes `chinamobile`.

### Task 2: Preserve Body Model In `prepareGatewayForward()`

**Files:**

- Modify: `enterprise/apps/web-portal/src/lib/gateway-forward.ts`

Steps:

- [ ] Keep JSON parsing and visibility enforcement unchanged.
- [ ] Delete the split block that computes `[providerId, ...rest]`, rewrites body `model`, and sets `providerHint`.
- [ ] Update the function comment to document why nested model ids must remain intact.

Expected after implementation: `prepareGatewayForward()` returns the original `rawBody` and empty `providerHint` for visible managed model ids.

### Task 3: Add Bootstrap Reverse-Proxy Origin Coverage

**Files:**

- Modify: `enterprise/apps/web-portal/src/app/api/desktop/bootstrap/__tests__/route.test.ts`

Steps:

- [ ] Add a production-mode test with `NEXT_PUBLIC_GATEWAY_PUBLIC_BASE_URL` unset.
- [ ] Call `GET()` with internal URL `http://0.0.0.0:3000/api/desktop/bootstrap`.
- [ ] Set headers `host` and `x-forwarded-proto`.
- [ ] Assert `json.data.apiBaseUrl` uses the header-derived public origin.

Example assertion:

```ts
expect(json.data.apiBaseUrl).toBe("https://portal.example.invalid/api/desktop/v1");
```

### Task 4: Use `requestOriginFromRequest()` In Bootstrap Route

**Files:**

- Modify: `enterprise/apps/web-portal/src/app/api/desktop/bootstrap/route.ts`

Steps:

- [ ] Import `requestOriginFromRequest` from `../../../../lib/desktop-device-auth`.
- [ ] Replace `new URL(request.url).origin` with `requestOriginFromRequest(request)`.
- [ ] Leave `resolveDesktopInferenceApiBase()` and direct Gateway eligibility logic unchanged.

### Task 5: Verify

**Commands:**

```bash
pnpm -C enterprise/apps/web-portal test src/lib/gateway-forward.test.ts src/app/api/desktop/bootstrap/__tests__/route.test.ts
```

Expected output:

```text
Test Files  2 passed (2)
Tests  7 passed (7)
```

Also run IDE lint diagnostics on:

- `enterprise/apps/web-portal/src/lib/gateway-forward.ts`
- `enterprise/apps/web-portal/src/lib/gateway-forward.test.ts`
- `enterprise/apps/web-portal/src/app/api/desktop/bootstrap/route.ts`
- `enterprise/apps/web-portal/src/app/api/desktop/bootstrap/__tests__/route.test.ts`

Expected result: no linter errors.

## No-Scope-Creep Guardrails

- Do not edit `enterprise/apps/gateway/internal/server/managed_model_routing.go` for this fix; Gateway already accepts full `provider/model` body values.
- Do not add support for ambiguous body-model-with-header nested ids in Gateway unless a separate API compatibility requirement is approved.
- Do not edit Docker compose files or deployment scripts for this fix.
- Do not write real organization domains, PATs, API keys, or customer identifiers into tests or docs.

## Suggested Commit Shape

One focused commit is sufficient after validation:

```text
fix(web-portal): preserve managed desktop model ids
```

Required trailers, with actual model metadata filled by the committer:

```text
Plan-File: .cursor/plans/2026-08-13-enterprise-desktop-managed-model-proxy-fix.plan.md
Plan-Model: GPT-5.5
Impl-Model: <actual implementation model>
Made-with: Damon Li
```
