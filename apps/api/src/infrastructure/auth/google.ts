import { createHash } from "node:crypto";
import type { Env } from "../../config/env";

export interface GoogleProfile {
  /** Identificador estable de la cuenta de Google (claim `sub`). */
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

export interface GoogleAvatar {
  data: Buffer;
  mime: "image/jpeg" | "image/png" | "image/webp";
}

/** Puerto de Google (OpenID Connect, flujo de código + PKCE). En pruebas se sustituye por un doble. */
export abstract class GoogleOAuthPort {
  abstract readonly enabled: boolean;
  abstract authorizeUrl(params: { state: string; nonce: string; codeVerifier: string }): string;
  abstract exchange(code: string, codeVerifier: string, nonce: string): Promise<GoogleProfile>;
  abstract fetchAvatar(url: string): Promise<GoogleAvatar | null>;
}

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const MAX_AVATAR_BYTES = 3 * 1024 * 1024;

export const pkceChallenge = (verifier: string): string => createHash("sha256").update(verifier).digest("base64url");

export class GoogleOAuth extends GoogleOAuthPort {
  readonly enabled: boolean;
  private readonly redirectUri: string;

  constructor(private readonly env: Env) {
    super();
    this.enabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
    this.redirectUri = env.GOOGLE_REDIRECT_URI || `${env.PUBLIC_SITE_URL.replace(/\/$/, "")}/api/v1/auth/google/callback`;
  }

  authorizeUrl({ state, nonce, codeVerifier }: { state: string; nonce: string; codeVerifier: string }): string {
    const q = new URLSearchParams({
      client_id: this.env.GOOGLE_CLIENT_ID,
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      nonce,
      code_challenge: pkceChallenge(codeVerifier),
      code_challenge_method: "S256",
      prompt: "select_account",
    });
    return `${AUTH_URL}?${q.toString()}`;
  }

  /**
   * Canjea el código en el servidor (con el secreto del cliente y el verificador PKCE). El id_token llega directo del
   * endpoint de Google por TLS, así que basta validar sus afirmaciones (emisor, audiencia, vigencia y nonce).
   */
  async exchange(code: string, codeVerifier: string, nonce: string): Promise<GoogleProfile> {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.env.GOOGLE_CLIENT_ID,
        client_secret: this.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: this.redirectUri,
        grant_type: "authorization_code",
        code_verifier: codeVerifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`GOOGLE_TOKEN_${res.status}`);
    const { id_token: idToken } = (await res.json()) as { id_token?: string };
    const payload = idToken?.split(".")[1];
    if (!payload) throw new Error("GOOGLE_NO_ID_TOKEN");
    const c = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    if (c.iss !== "https://accounts.google.com" && c.iss !== "accounts.google.com") throw new Error("GOOGLE_BAD_ISSUER");
    if (c.aud !== this.env.GOOGLE_CLIENT_ID) throw new Error("GOOGLE_BAD_AUDIENCE");
    if (typeof c.exp !== "number" || c.exp * 1000 < Date.now()) throw new Error("GOOGLE_EXPIRED");
    if (c.nonce !== nonce) throw new Error("GOOGLE_BAD_NONCE");
    if (typeof c.sub !== "string" || typeof c.email !== "string") throw new Error("GOOGLE_INCOMPLETE");
    return {
      sub: c.sub,
      email: c.email,
      emailVerified: c.email_verified === true,
      name: typeof c.name === "string" ? c.name : null,
      picture: typeof c.picture === "string" ? c.picture : null,
    };
  }

  /** Descarga la foto de perfil. Solo https hacia googleusercontent.com, sin redirecciones, con tope de tamaño. */
  async fetchAvatar(url: string): Promise<GoogleAvatar | null> {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    if (u.protocol !== "https:" || !/(^|\.)googleusercontent\.com$/.test(u.hostname)) return null;
    const sized = url.replace(/=s\d+(-c)?$/, "=s400-c"); // pide una versión de buena calidad en vez de 96 px
    const res = await fetch(sized, { redirect: "error", signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (!res?.ok) return null;
    const mime = (res.headers.get("content-type") ?? "").split(";")[0]!.trim();
    if (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") return null;
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length < 1 || data.length > MAX_AVATAR_BYTES) return null;
    return { data, mime };
  }
}
