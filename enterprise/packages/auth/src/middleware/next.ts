import type { AuthContext } from "../types";
import { AuthService } from "../services/auth";

export type NextRouteHandlerContext = {
  auth: AuthContext | null;
};

export type NextRouteHandler = (request: Request, context: NextRouteHandlerContext) => Promise<Response>;

export type SessionMiddlewareOptions = {
  required?: boolean;
  requiredScopes?: string[];
};

function parseBearerToken(request: Request): string | null {
  const value = request.headers.get("authorization");
  if (!value) return null;
  const [scheme, token] = value.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

function hasRequiredScopes(auth: AuthContext | null, requiredScopes: string[]): boolean {
  if (!auth) return false;
  if (requiredScopes.length === 0) return true;
  return requiredScopes.every((scope) => auth.scopes.includes(scope));
}

function unauthorized(code: string, message: string, status = 401): Response {
  return new Response(JSON.stringify({ code, message }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

export function createSessionMiddleware(authService: AuthService) {
  return function withSession(handler: NextRouteHandler, options: SessionMiddlewareOptions = {}): (request: Request) => Promise<Response> {
    const required = options.required ?? true;
    const requiredScopes = options.requiredScopes ?? [];

    return async (request: Request): Promise<Response> => {
      const token = parseBearerToken(request);
      const auth = token ? await authService.verifyAccess(token) : null;

      if (required && !auth) {
        return unauthorized("40101", "Unauthorized");
      }

      if (!hasRequiredScopes(auth, requiredScopes)) {
        return unauthorized("40301", "Forbidden: insufficient scope", 403);
      }

      return handler(request, { auth });
    };
  };
}

