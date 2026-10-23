import type { UploadAuthorization } from "@por-aqui/contracts";

export interface UploadProgress {
  loaded: number;
  total: number;
}

/**
 * Sube el archivo directo a Cloudflare R2 con la URL PUT prefirmada (XHR para reportar progreso).
 * La API verifica los bytes al confirmar y el worker genera los derivados.
 */
export function uploadToStorage(auth: UploadAuthorization, file: Blob, onProgress?: (p: UploadProgress) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(auth.method, auth.url);
    for (const [name, value] of Object.entries(auth.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.({ loaded: e.loaded, total: e.total });
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`UPLOAD_REJECTED_${xhr.status}`)));
    xhr.onerror = () => reject(new Error("UPLOAD_NETWORK"));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}
