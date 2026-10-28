import type { AuthStrategy } from "./types";

/** Test / demo stand-in for a B-layer customer IAM plugin. */
export const fakeCustomerIamStrategy: AuthStrategy = {
  id: "fake-customer-iam",
  protocol: "custom",
  resolveEndpoints(config) {
    const authorizationUrl =
      typeof config.authorizationUrl === "string" ? config.authorizationUrl : undefined;
    return { authorizationUrl };
  },
};
