import type { ImageCredit } from "@por-aqui/contracts";

/** Atribución de una foto con licencia libre del catálogo (autor, licencia y enlace a la fuente). */
export function PhotoCredit({ credit, compact = false }: { credit: ImageCredit | undefined; compact?: boolean }) {
  if (!credit) return null;
  if (compact) {
    return (
      <small className="photo-credit">
        Foto: <a href={credit.sourceUrl} target="_blank" rel="noreferrer noopener" aria-label={`Fuente de la foto: ${credit.author}, ${credit.license}`}>{credit.author} · {credit.license}</a>
      </small>
    );
  }
  return (
    <span className="photo-credit">
      Foto: <a href={credit.sourceUrl} target="_blank" rel="noreferrer noopener">«{credit.title}»</a> de {credit.author}, <a href={credit.licenseUrl} target="_blank" rel="noreferrer noopener">{credit.license}</a>. Recortada y comprimida.
    </span>
  );
}
