import { Dialog } from "@por-aqui/ui";
import { ChevronRight, Link as LinkIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

export function ShareStorySheet({ open, onClose, journeyId }: { open: boolean; onClose: () => void; journeyId: string }) {
  const [hideTrack, setHideTrack] = useState(true);
  return <Dialog open={open} onClose={onClose} variant="sheet" title="Compartir historia" className="share-story-sheet">
    <Link to={`/app/viajes/${journeyId}/compartir?visibilidad=UNLISTED&ocultarTrayecto=${hideTrack ? "1" : "0"}`} className="share-story-link"><LinkIcon size={20} aria-hidden="true" /><span>Crear enlace</span><ChevronRight size={18} aria-hidden="true" /></Link>
    <label className="adventure-gps"><span><strong>Ocultar trayecto exacto</strong><small>Decide si quieres incluir el trayecto GPS al compartir.</small></span><input type="checkbox" role="switch" checked={hideTrack} onChange={(e) => setHideTrack(e.target.checked)} /></label>
    <p className="text-sm text-muted-foreground">Antes de crear el enlace revisarás qué visitas, notas y fotos quieres compartir. Tu diario sigue siendo privado hasta que lo confirmes.</p>
  </Dialog>;
}
