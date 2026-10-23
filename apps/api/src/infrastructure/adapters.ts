import type { Env } from "../config/env";
import { AppError } from "../common/errors";
import { GoogleOAuth, type GoogleOAuthPort } from "./auth/google";
import { createMailer, type MailerPort } from "./mail/mailer";
import { R2Storage, StoragePort } from "./storage/storage";

/** Sustitutos para las pruebas de integración (almacenamiento y correo en memoria). No se usan fuera de ellas. */
export interface AdapterOverrides {
  storage?: StoragePort;
  mailer?: MailerPort;
  google?: GoogleOAuthPort;
}

let overrides: AdapterOverrides = {};
export const setAdapterOverrides = (next: AdapterOverrides): void => {
  overrides = next;
};

const notConfigured = () => new AppError(503, "STORAGE_NOT_CONFIGURED", "El almacenamiento de fotos todavía no está configurado. Completa las variables R2_* del entorno.");

/** Mientras no haya claves de R2 (solo desarrollo), la app arranca y cualquier operación sobre archivos responde 503. */
class UnconfiguredStorage extends StoragePort {
  async checkBucket(): Promise<void> {
    console.warn(JSON.stringify({ level: "warn", msg: "Cloudflare R2 sin configurar: define R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY y R2_BUCKET" }));
  }
  createUploadUrl(): never {
    throw notConfigured();
  }
  head(): never {
    throw notConfigured();
  }
  getBuffer(): never {
    throw notConfigured();
  }
  getStream(): never {
    throw notConfigured();
  }
  put(): never {
    throw notConfigured();
  }
  deleteMany(): never {
    throw notConfigured();
  }
  deletePrefix(): never {
    throw notConfigured();
  }
  list(): never {
    throw notConfigured();
  }
}

export function createStorage(env: Env): StoragePort {
  if (overrides.storage) return overrides.storage;
  const configured = env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET;
  return configured ? new R2Storage(env) : new UnconfiguredStorage();
}

export function createGoogleAdapter(env: Env): GoogleOAuthPort {
  return overrides.google ?? new GoogleOAuth(env);
}

export function createMailerAdapter(env: Env): MailerPort {
  return overrides.mailer ?? createMailer(env);
}
