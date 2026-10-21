import type { MeDto } from "@por-aqui/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { ApiError, api } from "./api";
import { clearLocalData } from "./offline-queue";
import { meQuery } from "./query";

/** Usuario actual, o `null` si no hay sesión. `undefined` mientras carga. */
export function useMe(): { me: MeDto | null | undefined; isLoading: boolean } {
  const q = useQuery(meQuery());
  if (q.isLoading) return { me: undefined, isLoading: true };
  if (q.error instanceof ApiError && q.error.status === 401) return { me: null, isLoading: false };
  return { me: q.data ?? null, isLoading: false };
}

/** Protege rutas privadas: sin sesión se va a /ingresar conservando la intención (returnTo interno). */
export function useRequireAuth(opts: { role?: "MODERATOR" } = {}): MeDto | undefined {
  const { me } = useMe();
  const navigate = useNavigate();
  const loc = useLocation();
  useEffect(() => {
    if (me === null) navigate(`/ingresar?returnTo=${encodeURIComponent(loc.pathname + loc.search)}`, { replace: true });
  }, [me, navigate, loc.pathname, loc.search]);
  if (me && opts.role && me.role !== opts.role) return undefined;
  return me ?? undefined;
}

export function useLogout() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { me } = useMe();
  return useMutation({
    mutationFn: async () => {
      await api.auth.logout();
      // Limpieza al cerrar sesión: caché privada de Query y cola local de este usuario.
      qc.clear();
      if (me) await clearLocalData(me.id).catch(() => undefined);
    },
    onSettled: () => navigate("/", { replace: true }),
  });
}
