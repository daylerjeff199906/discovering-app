import { Readable } from "node:stream";
import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import type { Env } from "../../config/env";

export interface UploadPost {
  url: string;
  fields: Record<string, string>;
  expiresAt: Date;
}

export interface ObjectInfo {
  size: number;
  contentType: string | null;
}

/** Puerto de almacenamiento (S3 compatible). Todos los objetos son privados. */
export abstract class StoragePort {
  abstract ensureBucket(): Promise<void>;
  /** Formulario POST prefirmado que el navegador usa para subir directo, con límite de tamaño en el propio almacenamiento. */
  abstract createUploadPost(key: string, contentType: string, maxBytes: number, ttlSeconds: number): Promise<UploadPost>;
  abstract head(key: string): Promise<ObjectInfo | null>;
  abstract getBuffer(key: string, maxBytes: number): Promise<Buffer>;
  abstract getStream(key: string): Promise<{ stream: Readable; contentType: string | null; size: number | null }>;
  abstract put(key: string, body: Buffer, contentType: string): Promise<void>;
  abstract deleteMany(keys: string[]): Promise<void>;
}

export class S3Storage extends StoragePort {
  private readonly client: S3Client;
  /** Cliente solo para firmar con el endpoint que ve el navegador (puede diferir del interno). */
  private readonly signer: S3Client;

  constructor(private readonly env: Env) {
    super();
    const base = {
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
    };
    this.client = new S3Client({ ...base, endpoint: env.S3_ENDPOINT });
    this.signer = new S3Client({ ...base, endpoint: env.S3_PUBLIC_ENDPOINT });
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.env.S3_BUCKET }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.env.S3_BUCKET }));
    }
  }

  async createUploadPost(key: string, contentType: string, maxBytes: number, ttlSeconds: number): Promise<UploadPost> {
    const { url, fields } = await createPresignedPost(this.signer, {
      Bucket: this.env.S3_BUCKET,
      Key: key,
      Expires: ttlSeconds,
      Fields: { "Content-Type": contentType },
      Conditions: [["content-length-range", 1, maxBytes], ["eq", "$Content-Type", contentType]],
    });
    return { url, fields, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
  }

  async head(key: string): Promise<ObjectInfo | null> {
    try {
      const r = await this.client.send(new HeadObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }));
      return { size: Number(r.ContentLength ?? 0), contentType: r.ContentType ?? null };
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404 || (err as { name?: string }).name === "NotFound") return null;
      throw err;
    }
  }

  async getBuffer(key: string, maxBytes: number): Promise<Buffer> {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }));
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
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }));
    return { stream: r.Body as Readable, contentType: r.ContentType ?? null, size: r.ContentLength ?? null };
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key, Body: body, ContentType: contentType, CacheControl: "private, max-age=31536000, immutable" }));
  }

  async deleteMany(keys: string[]): Promise<void> {
    const unique = [...new Set(keys.filter(Boolean))];
    for (let i = 0; i < unique.length; i += 500) {
      const batch = unique.slice(i, i + 500);
      await this.client.send(new DeleteObjectsCommand({ Bucket: this.env.S3_BUCKET, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }));
    }
  }
}
