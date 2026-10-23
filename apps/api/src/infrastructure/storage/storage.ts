import { Readable } from "node:stream";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Env } from "../../config/env";

export interface UploadTarget {
  url: string;
  method: "PUT";
  /** Encabezados que el navegador debe enviar tal cual (están firmados). */
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface ObjectInfo {
  size: number;
  contentType: string | null;
}

export interface ObjectSummary {
  key: string;
  lastModified: Date;
}

/** Puerto de almacenamiento de objetos (Cloudflare R2). Todos los objetos son privados. */
export abstract class StoragePort {
  abstract checkBucket(): Promise<void>;
  /** URL PUT prefirmada: el navegador sube directo. Tipo y tamaño exactos van firmados, así que R2 rechaza cualquier otro. */
  abstract createUploadUrl(key: string, contentType: string, sizeBytes: number, ttlSeconds: number): Promise<UploadTarget>;
  abstract head(key: string): Promise<ObjectInfo | null>;
  abstract getBuffer(key: string, maxBytes: number): Promise<Buffer>;
  abstract getStream(key: string): Promise<{ stream: Readable; contentType: string | null; size: number | null }>;
  abstract put(key: string, body: Buffer, contentType: string): Promise<void>;
  abstract deleteMany(keys: string[]): Promise<void>;
  /** Borra todo lo que cuelga del prefijo (carpeta). Devuelve cuántos objetos eliminó. */
  abstract deletePrefix(prefix: string): Promise<number>;
  /** Lista objetos bajo un prefijo (hasta `limit`). */
  abstract list(prefix: string, limit: number): Promise<ObjectSummary[]>;
}

export class R2Storage extends StoragePort {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(env: Env) {
    super();
    this.bucket = env.R2_BUCKET;
    this.client = new S3Client({
      region: "auto",
      forcePathStyle: true,
      endpoint: env.R2_ENDPOINT || `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
      // R2 no admite los checksums opcionales que el SDK añade por omisión.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  /** R2 no se crea desde la app: el bucket se crea en el panel de Cloudflare. Aquí solo se comprueba que responde. */
  async checkBucket(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  async createUploadUrl(key: string, contentType: string, sizeBytes: number, ttlSeconds: number): Promise<UploadTarget> {
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: sizeBytes }),
      { expiresIn: ttlSeconds, signableHeaders: new Set(["content-type", "content-length"]) },
    );
    return { url, method: "PUT", headers: { "Content-Type": contentType }, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
  }

  async head(key: string): Promise<ObjectInfo | null> {
    try {
      const r = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: Number(r.ContentLength ?? 0), contentType: r.ContentType ?? null };
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404 || (err as { name?: string }).name === "NotFound") return null;
      throw err;
    }
  }

  async getBuffer(key: string, maxBytes: number): Promise<Buffer> {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (Number(r.ContentLength ?? 0) > maxBytes) throw new Error("OBJECT_TOO_LARGE");
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of r.Body as Readable) {
      total += (chunk as Buffer).length;
      if (total > maxBytes) throw new Error("OBJECT_TOO_LARGE");
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }

  async getStream(key: string) {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return { stream: r.Body as Readable, contentType: r.ContentType ?? null, size: r.ContentLength ?? null };
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, CacheControl: "private, max-age=31536000, immutable" }));
  }

  async deleteMany(keys: string[]): Promise<void> {
    const unique = [...new Set(keys.filter(Boolean))];
    for (let i = 0; i < unique.length; i += 1000) {
      const batch = unique.slice(i, i + 1000);
      const r = await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }));
      if (r.Errors?.length) throw new Error(`R2_DELETE_FAILED: ${r.Errors[0]!.Key} ${r.Errors[0]!.Code}`); // el evento se reintenta
    }
  }

  async deletePrefix(prefix: string): Promise<number> {
    if (!prefix.endsWith("/")) throw new Error("El prefijo debe terminar en «/»");
    let deleted = 0;
    let token: string | undefined;
    do {
      const page = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }));
      const keys = (page.Contents ?? []).map((o) => o.Key!).filter(Boolean);
      await this.deleteMany(keys);
      deleted += keys.length;
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return deleted;
  }

  async list(prefix: string, limit: number): Promise<ObjectSummary[]> {
    const out: ObjectSummary[] = [];
    let token: string | undefined;
    do {
      const page = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token, MaxKeys: Math.min(1000, limit - out.length) }));
      for (const o of page.Contents ?? []) if (o.Key) out.push({ key: o.Key, lastModified: o.LastModified ?? new Date() });
      token = page.IsTruncated && out.length < limit ? page.NextContinuationToken : undefined;
    } while (token);
    return out;
  }
}
