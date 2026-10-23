import { Readable } from "node:stream";
import { MailerPort, type MailMessage } from "../src/infrastructure/mail/mailer";
import { StoragePort, type ObjectInfo, type ObjectSummary, type UploadTarget } from "../src/infrastructure/storage/storage";

/** Almacenamiento en memoria con la misma semántica que R2 para lo que la app necesita (PUT firmado con tipo y tamaño exactos). */
export class MemoryStorage extends StoragePort {
  readonly objects = new Map<string, { body: Buffer; contentType: string; lastModified: Date }>();
  private readonly signed = new Map<string, { key: string; contentType: string; size: number; expiresAt: number }>();

  async checkBucket(): Promise<void> {}

  async createUploadUrl(key: string, contentType: string, sizeBytes: number, ttlSeconds: number): Promise<UploadTarget> {
    const url = `memory://r2/${encodeURIComponent(key)}?sig=${this.signed.size}`;
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.signed.set(url, { key, contentType, size: sizeBytes, expiresAt });
    return { url, method: "PUT", headers: { "Content-Type": contentType }, expiresAt: new Date(expiresAt) };
  }

  /** Lo que haría el navegador contra R2: si el tipo o el tamaño no coinciden con lo firmado, 403. */
  receive(url: string, headers: Record<string, string>, body: Buffer): number {
    const grant = this.signed.get(url);
    if (!grant || grant.expiresAt < Date.now()) return 403;
    if (headers["Content-Type"] !== grant.contentType || body.length !== grant.size) return 403;
    this.objects.set(grant.key, { body, contentType: grant.contentType, lastModified: new Date() });
    return 200;
  }

  async head(key: string): Promise<ObjectInfo | null> {
    const o = this.objects.get(key);
    return o ? { size: o.body.length, contentType: o.contentType } : null;
  }

  async getBuffer(key: string, maxBytes: number): Promise<Buffer> {
    const o = this.objects.get(key);
    if (!o) throw new Error("NoSuchKey");
    if (o.body.length > maxBytes) throw new Error("OBJECT_TOO_LARGE");
    return o.body;
  }

  async getStream(key: string) {
    const o = this.objects.get(key);
    if (!o) throw new Error("NoSuchKey");
    return { stream: Readable.from(o.body), contentType: o.contentType, size: o.body.length };
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body, contentType, lastModified: new Date() });
  }

  async deleteMany(keys: string[]): Promise<void> {
    for (const k of keys) this.objects.delete(k);
  }

  async deletePrefix(prefix: string): Promise<number> {
    const doomed = [...this.objects.keys()].filter((k) => k.startsWith(prefix));
    for (const k of doomed) this.objects.delete(k);
    return doomed.length;
  }

  async list(prefix: string, limit: number): Promise<ObjectSummary[]> {
    return [...this.objects.entries()]
      .filter(([k]) => k.startsWith(prefix))
      .slice(0, limit)
      .map(([key, o]) => ({ key, lastModified: o.lastModified }));
  }

  keysUnder(prefix: string): string[] {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix));
  }
}

export class MemoryMailer extends MailerPort {
  readonly sent: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
  /** Último correo enviado a esa dirección. */
  lastTo(email: string): MailMessage | null {
    return [...this.sent].reverse().find((m) => m.to === email) ?? null;
  }
}

export const memoryStorage = new MemoryStorage();
export const memoryMailer = new MemoryMailer();
