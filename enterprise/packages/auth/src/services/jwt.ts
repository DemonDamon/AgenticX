import {
  exportPKCS8,
  exportSPKI,
  generateKeyPair,
  importPKCS8,
  importSPKI,
  JWTPayload,
  jwtVerify,
  SignJWT,
} from "jose";
import type { AuthContext } from "../types";

type JwtConfig = {
  issuer?: string;
  audience?: string;
  accessTtlSeconds?: number;
  refreshTtlSeconds?: number;
  privateKeyPem?: string;
  publicKeyPem?: string;
};

type SignedToken = {
  token: string;
  expiresInSeconds: number;
};

type Claims = AuthContext & {
  typ: "access" | "refresh";
};

export class JwtService {
  private readonly issuer: string;
  private readonly audience: string;
  private readonly accessTtlSeconds: number;
  private readonly refreshTtlSeconds: number;
  private privateKey?: unknown;
  private publicKey?: unknown;
  private readonly initPromise: Promise<void>;

  public constructor(config: JwtConfig = {}) {
    this.issuer = config.issuer ?? "agenticx-enterprise";
    this.audience = config.audience ?? "agenticx-clients";
    this.accessTtlSeconds = config.accessTtlSeconds ?? 3600;
    this.refreshTtlSeconds = config.refreshTtlSeconds ?? 7 * 24 * 3600;
    this.initPromise = this.bootstrap(config.privateKeyPem, config.publicKeyPem);
  }

  private async bootstrap(privateKeyPem?: string, publicKeyPem?: string): Promise<void> {
    const resolvedPrivateKeyPem = privateKeyPem ?? process.env.AUTH_JWT_PRIVATE_KEY;
    const resolvedPublicKeyPem = publicKeyPem ?? process.env.AUTH_JWT_PUBLIC_KEY;

    if (resolvedPrivateKeyPem && resolvedPublicKeyPem) {
      this.privateKey = await importPKCS8(resolvedPrivateKeyPem, "RS256");
      this.publicKey = await importSPKI(resolvedPublicKeyPem, "RS256");
      return;
    }

    const allowEphemeralKeys = process.env.NODE_ENV !== "production" && process.env.ALLOW_EPHEMERAL_JWT_KEYS === "true";
    if (!allowEphemeralKeys) {
      throw new Error("AUTH_JWT_PRIVATE_KEY and AUTH_JWT_PUBLIC_KEY are required.");
    }

    // 仅允许在显式开发模式下生成临时密钥。
    const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
    this.privateKey = privateKey;
    this.publicKey = publicKey;

    if (!process.env.AUTH_JWT_PRIVATE_KEY || !process.env.AUTH_JWT_PUBLIC_KEY) {
      const generatedPrivatePem = await exportPKCS8(privateKey);
      const generatedPublicPem = await exportSPKI(publicKey);
      process.env.AUTH_JWT_PRIVATE_KEY ??= generatedPrivatePem;
      process.env.AUTH_JWT_PUBLIC_KEY ??= generatedPublicPem;
    }
  }

  private async ensureReady(): Promise<{ privateKey: unknown; publicKey: unknown }> {
    await this.initPromise;
    if (!this.privateKey || !this.publicKey) {
      throw new Error("JWT keys are not initialized.");
    }
    return {
      privateKey: this.privateKey,
      publicKey: this.publicKey,
    };
  }

  private async sign(claims: Claims, ttlSeconds: number): Promise<SignedToken> {
    const { privateKey } = await this.ensureReady();
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT(claims as JWTPayload)
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setSubject(claims.userId)
      .setIssuedAt(now)
      .setExpirationTime(now + ttlSeconds)
      .sign(privateKey as Parameters<SignJWT["sign"]>[0]);
    return {
      token,
      expiresInSeconds: ttlSeconds,
    };
  }

  public async signAccessToken(context: AuthContext): Promise<SignedToken> {
    return this.sign({ ...context, typ: "access" }, this.accessTtlSeconds);
  }

  public async signRefreshToken(context: AuthContext): Promise<SignedToken> {
    return this.sign({ ...context, typ: "refresh" }, this.refreshTtlSeconds);
  }

  private async verify(token: string, expectedType: Claims["typ"]): Promise<AuthContext | null> {
    const { publicKey } = await this.ensureReady();
    try {
      const { payload } = await jwtVerify(token, publicKey as Parameters<typeof jwtVerify>[1], {
        issuer: this.issuer,
        audience: this.audience,
      });
      if (payload.typ !== expectedType) return null;

      const userId = payload.userId;
      const tenantId = payload.tenantId;
      const email = payload.email;
      const sessionId = payload.sessionId;
      const scopes = payload.scopes;
      const deptId = payload.deptId;

      if (
        typeof userId !== "string" ||
        typeof tenantId !== "string" ||
        typeof email !== "string" ||
        typeof sessionId !== "string" ||
        !Array.isArray(scopes)
      ) {
        return null;
      }

      return {
        userId,
        tenantId,
        deptId: typeof deptId === "string" ? deptId : null,
        email,
        sessionId,
        scopes: scopes.filter((scope): scope is string => typeof scope === "string"),
      };
    } catch {
      return null;
    }
  }

  public async verifyAccessToken(token: string): Promise<AuthContext | null> {
    return this.verify(token, "access");
  }

  public async verifyRefreshToken(token: string): Promise<AuthContext | null> {
    return this.verify(token, "refresh");
  }
}

