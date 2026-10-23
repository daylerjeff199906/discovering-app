import type { UploadAuthorization } from "@por-aqui/contracts";
import { uploadToStorage } from "@por-aqui/api-client";
import { api } from "./api";
export interface VisitPhotoUpload { authorization?: UploadAuthorization; uploaded?: boolean; done?: boolean }
export async function uploadVisitPhoto(visitId: string, file: File, state: VisitPhotoUpload, progress: (message: string) => void) {
  if (state.done) return;
  if (!state.authorization || (!state.uploaded && new Date(state.authorization.expiresAt).getTime() < Date.now())) {
    state.authorization = await api.media.reserve(visitId, { mimeType: file.type as "image/jpeg" | "image/png" | "image/webp", sizeBytes: file.size, fileName: file.name });
    state.uploaded = false;
  }
  if (!state.uploaded) {
    await uploadToStorage(state.authorization, file, (p) => progress(`Subiendo ${file.name}: ${Math.round(p.loaded / p.total * 100)}%`));
    state.uploaded = true;
  }
  let asset = await api.media.complete(state.authorization.assetId);
  if (asset.status === "FAILED" && asset.failureCode === "PROCESSING_ERROR") { await api.media.retry(asset.id); asset = await api.media.status(asset.id); }
  for (let attempt = 0; attempt < 60 && asset.status !== "READY" && asset.status !== "FAILED"; attempt++) {
    progress(`Preparando ${file.name}…`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    asset = await api.media.status(asset.id);
  }
  if (asset.status !== "READY") throw new Error(`La visita está guardada, pero no terminó la subida de ${file.name}. Puedes reintentar o quitar esta foto.`);
  state.done = true;
}
