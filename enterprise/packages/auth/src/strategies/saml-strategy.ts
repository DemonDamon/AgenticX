import type { AuthStrategy } from "./types";

export const samlStrategy: AuthStrategy = {
  id: "saml",
  protocol: "saml",
};
