import type { JourneyDto } from "@por-aqui/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, NetworkError } from "@por-aqui/api-client";
import { journeyQuery, qk } from "./query";
import { useUi } from "./stores";

export function useJourney(id: string) {
  return useQuery(journeyQuery(id));
}

/**
 * Mutaciones sobre un viaje. Se ejecutan EN SERIE por viaje (`scope`) y cada una lee la versión más reciente
 * de la caché al ejecutarse, de modo que ediciones rápidas consecutivas no se pisan a sí mismas.
 * Si el servidor responde 409 (otra pestaña/dispositivo editó), se recarga la versión vigente y se avisa.
 */
export function useJourneyMutation<V>(id: string, run: (vars: V, current: JourneyDto) => Promise<JourneyDto>, opts: { onConflict?: () => void; silent?: boolean } = {}) {
  const qc = useQueryClient();
  const setSave = useUi((s) => s.setSaveState);
  return useMutation({
    scope: { id: `journey:${id}` },
    mutationFn: async (vars: V) => {
      const current = qc.getQueryData<JourneyDto>(qk.journey(id));
      if (!current) throw new Error("El viaje todavía no se cargó");
      if (!opts.silent) setSave("saving");
      return run(vars, current);
    },
    onSuccess: (dto) => {
      qc.setQueryData(qk.journey(id), dto);
      void qc.invalidateQueries({ queryKey: ["journeys"] });
      if (!opts.silent) setSave("saved");
    },
    onError: (err) => {
      if (err instanceof ApiError && err.isConflict) {
        void qc.invalidateQueries({ queryKey: qk.journey(id) });
        opts.onConflict?.();
        setSave("idle");
      } else if (err instanceof NetworkError) setSave("offline");
      else setSave("idle");
    },
  });
}
