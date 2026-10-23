import { Alert, Button, Dialog } from "@por-aqui/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { api, errorMessage } from "../lib/api";
import { useMe } from "../lib/auth";
import { discardJourneyData } from "../lib/offline-queue";

export function DeleteJourneyButton({ id, title, onDeleted, size = "sm", diary = false, iconOnly = false }: { id: string; title: string; onDeleted?: () => void; size?: "sm" | "md"; diary?: boolean; iconOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  const { me } = useMe();
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: async () => {
      const detail = await api.journeys.get(id);
      await api.journeys.remove(id);
      if (me) await discardJourneyData(me.id, id, detail.recording?.id).catch(() => undefined);
      return detail.recording?.id;
    },
    onSuccess: async (recordingId) => {
      setOpen(false);
      onDeleted?.();
      for (const key of ["journey", "visits", "publication-draft"]) qc.removeQueries({ queryKey: [key, id] });
      if (recordingId) qc.removeQueries({ queryKey: ["track", recordingId] });
      await Promise.all(["journeys", "explore", "route", "shared", "profile", "bookmarks"].map((key) => qc.invalidateQueries({ queryKey: [key] })));
    },
  });
  return <>
    <Button size={iconOnly ? "icon" : size} variant="ghost" className="text-danger" aria-label={`${diary ? "Eliminar diario" : "Eliminar aventura"}: ${title}`} title={diary ? "Eliminar diario" : "Eliminar aventura"} onClick={() => { remove.reset(); setOpen(true); }}><Trash2 className="size-4" aria-hidden="true" /> {!iconOnly ? diary ? "Eliminar diario" : "Eliminar aventura" : null}</Button>
    <Dialog open={open} onClose={() => { if (!remove.isPending) setOpen(false); }} title={diary ? "¿Eliminar este diario y su aventura?" : "¿Eliminar esta aventura?"} description={title}
      footer={<><Button variant="outline" disabled={remove.isPending} onClick={() => setOpen(false)}>Conservar aventura</Button><Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>Eliminar definitivamente</Button></>}>
      <p>Se eliminarán sus paradas, visitas, fotos y trayecto GPS. Si lo compartiste, su publicación también dejará de estar disponible. Esta acción no se puede deshacer.</p>
      {remove.isError ? <Alert tone="danger" live="assertive" className="mt-4">{errorMessage(remove.error)}</Alert> : null}
    </Dialog>
  </>;
}
