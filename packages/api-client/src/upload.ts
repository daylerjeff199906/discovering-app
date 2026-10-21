import type { UploadAuthorization } from "@por-aqui/contracts";

export interface UploadProgress {
  loaded: number;
  total: number;
}

/**
 * Sube el archivo directo al almacenamiento con el POST prefirmado (XHR para reportar progreso).
 * Devuelve el estado HTTP; la API verifica los bytes y el worker genera los derivados.
 */
export function uploadToStorage(auth: UploadAuthorization, file: Blob, onProgress?: (p: UploadProgress) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(auth.fields)) form.append(k, v);
    form.append("file", file); // el campo "file" debe ir al final
    const xhr = new XMLHttpRequest();
    xhr.open("POST", auth.url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.({ loaded: e.loaded, total: e.total });
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`UPLOAD_REJECTED_${xhr.status}`)));
    xhr.onerror = () => reject(new Error("UPLOAD_NETWORK"));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}
