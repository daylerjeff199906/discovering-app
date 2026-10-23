/**
 * Estructura de carpetas en Cloudflare R2: una raíz por perfil y, dentro, una carpeta por tipo de contenido.
 *
 *   users/{userId}/avatar/{assetId}/original            foto de perfil (subida original, nunca se sirve)
 *   users/{userId}/avatar/{assetId}/v1/thumb.webp       derivados versionados
 *   users/{userId}/avatar/{assetId}/v1/display.webp
 *   users/{userId}/places/{placeId}/{assetId}/…         fotos de visitas, agrupadas por lugar
 *
 * Todo lo de un archivo cuelga de `…/{assetId}/`, así que borrarlo es borrar ese prefijo. Todo lo de un perfil
 * cuelga de `users/{userId}/`, así que la purga de cuenta es un solo prefijo. Para añadir otro tipo (banner,
 * portadas…) basta con una carpeta nueva en `MediaFolder`.
 */
export type MediaFolder = { kind: "avatar" } | { kind: "place"; placeId: string };

export const USERS_ROOT = "users/";

export const userRoot = (userId: string): string => `${USERS_ROOT}${userId}/`;

const folderPath = (folder: MediaFolder): string => (folder.kind === "avatar" ? "avatar" : `places/${folder.placeId}`);

/** Prefijo (sin barra final) de todos los objetos de un archivo. */
export const assetPrefix = (userId: string, folder: MediaFolder, assetId: string): string => `${userRoot(userId)}${folderPath(folder)}/${assetId}`;

export const originalKey = (prefix: string): string => `${prefix}/original`;

export const derivedKey = (prefix: string, version: number, variant: "thumb" | "display"): string => `${prefix}/v${version}/${variant}.webp`;

/**
 * Prefijo de un archivo ya guardado, a partir de su clave original. Las claves anteriores a esta estructura
 * (`originals/{userId}/{assetId}`) no terminan en `/original`: no tienen carpeta propia y se tratan por clave.
 */
export function prefixOfOriginal(originalKeyValue: string): string | null {
  return originalKeyValue.endsWith("/original") && originalKeyValue.startsWith(USERS_ROOT) ? originalKeyValue.slice(0, -"/original".length) : null;
}

/** Id del archivo que contiene una clave de `users/…`, o null si la clave no sigue la estructura. */
export function assetIdOfKey(key: string): string | null {
  const m = /^users\/[^/]+\/(?:avatar|places\/[^/]+)\/([0-9a-f-]{36})\//.exec(key);
  return m ? m[1]! : null;
}
