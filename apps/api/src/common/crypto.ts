import crypto from "node:crypto";

/** Token opaco con 256 bits de entropía (base64url). */
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

/** Hash SHA-256 (hex) para almacenar tokens: en la base de datos nunca queda el token en claro. */
export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** AES-256-GCM para payloads sensibles de vida corta (p. ej. tokens en el outbox). */
export function encryptJson(key: string, value: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(key, "base64"), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64url");
}

export function decryptJson<T = unknown>(key: string, payload: string): T {
  const raw = Buffer.from(payload, "base64url");
  const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(key, "base64"), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  const dec = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
  return JSON.parse(dec.toString("utf8")) as T;
}

export function hmac(key: string, data: string): string {
  return crypto.createHmac("sha256", Buffer.from(key, "base64")).update(data).digest("base64url");
}
