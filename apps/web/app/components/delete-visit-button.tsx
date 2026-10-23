import { Alert, Button, Dialog } from "@por-aqui/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { ApiError, api, errorMessage } from "../lib/api";
import { qk } from "../lib/query";

export function DeleteVisitButton({ journeyId, visitId, placeName }: { journeyId: string; visitId: string; placeName: string }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api.visits.remove(visitId),
    onSuccess: async () => {
      setOpen(false);
      qc.removeQueries({ queryKey: ["visit", visitId] });
      await Promise.all([
        qc.invalidateQueries({ queryKey: qk.visits(journeyId) }),
        qc.invalidateQueries({ queryKey: qk.journey(journeyId) }),
        qc.invalidateQueries({ queryKey: ["journeys"] }),
      ]);
    },
  });
  return <>
    <Button size="icon" variant="ghost" className="text-danger" onClick={() => { remove.reset(); setOpen(true); }} title="Eliminar visita" aria-label={`Eliminar visita a ${placeName}`}><Trash2 className="size-4" aria-hidden="true" /></Button>
    <Dialog open={open} onClose={() => { if (!remove.isPending) setOpen(false); }} title="¿Eliminar esta visita del diario?" description={placeName}
      footer={<><Button variant="outline" disabled={remove.isPending} onClick={() => setOpen(false)}>Conservar visita</Button><Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>Eliminar visita</Button></>}>
      <p>Se eliminarán esta visita, su nota y sus fotos. El resto del diario y el plan del viaje se conservarán. Esta acción no se puede deshacer.</p>
      {remove.isError ? <Alert tone="danger" live="assertive" className="mt-4">{remove.error instanceof ApiError && remove.error.code === "MEDIA_IN_PUBLICATION" ? "Una foto de esta visita está en una publicación. Actualiza o retira esa publicación antes de eliminar la visita." : errorMessage(remove.error)}</Alert> : null}
    </Dialog>
  </>;
}
