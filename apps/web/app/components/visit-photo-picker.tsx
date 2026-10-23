import { Alert, Button } from "@por-aqui/ui";
import { useQuery } from "@tanstack/react-query";
import { Camera, Plus, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { capabilitiesQuery } from "../lib/query";

export function VisitPhotoPicker({ files, onChange, disabled }: { files: File[]; onChange: (files: File[]) => void; disabled?: boolean }) {
  const caps = useQuery(capabilitiesQuery());
  const limit = caps.data?.media.maxPerVisit ?? 20;
  const maxBytes = caps.data?.media.maxBytes ?? 10485760;
  const upload = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<string[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { const urls = files.map((f) => URL.createObjectURL(f)); setPreviews(urls); return () => urls.forEach((url) => URL.revokeObjectURL(url)); }, [files]);
  const add = (incoming: FileList | null) => {
    if (!incoming) return;
    setError("");
    const next: File[] = [];
    const errors: string[] = [];
    for (const file of Array.from(incoming)) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { errors.push(`${file.name}: usa JPEG, PNG o WebP.`); continue; }
      if (file.size > maxBytes) { errors.push(`${file.name}: máximo ${Math.round(maxBytes / 1048576)} MB.`); continue; }
      if (files.length + next.length >= limit) { errors.push(`Máximo ${limit} fotos por visita.`); break; }
      next.push(file);
    }
    onChange([...files, ...next]);
    setError(errors.join(" "));
  };
  return <section className="visit-photo-component" aria-labelledby="staged-photo-title">
    <div className="visit-photo-heading"><h2 id="staged-photo-title">Fotos de tu visita</h2><span>{files.length} de {limit}</span></div>
    <input ref={upload} type="file" multiple accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-label="Subir fotos de la visita" disabled={disabled} onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
    <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-label="Tomar foto de la visita" disabled={disabled} onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
    <ul className="visit-photo-strip">{files.map((file, i) => <li key={`${file.name}-${i}`}><img src={previews[i]} alt={`Foto seleccionada ${i + 1}`} width={160} height={145} /><button type="button" aria-label={`Quitar foto ${i + 1}`} title="Quitar foto" disabled={disabled} onClick={() => onChange(files.filter((_, n) => n !== i))}><X size={15} aria-hidden="true" /></button></li>)}
      {files.length < limit ? <li><button type="button" className="visit-photo-add" aria-label="Añadir fotos" disabled={disabled} onClick={() => upload.current?.click()}><Plus size={28} strokeWidth={1.3} aria-hidden="true" /></button></li> : null}
    </ul>
    <div className="visit-photo-buttons"><Button variant="secondary" disabled={disabled || files.length >= limit} onClick={() => camera.current?.click()}><Camera size={18} aria-hidden="true" /> Tomar foto</Button><Button variant="outline" disabled={disabled || files.length >= limit} onClick={() => upload.current?.click()}><Upload size={18} aria-hidden="true" /> Subir fotos</Button></div>
    <p className="text-xs text-muted-foreground">Opcionales · JPEG, PNG o WebP · máximo {Math.round(maxBytes / 1048576)} MB por foto.</p>
    {error ? <Alert tone="warning" live="assertive">{error}</Alert> : null}
  </section>;
}
