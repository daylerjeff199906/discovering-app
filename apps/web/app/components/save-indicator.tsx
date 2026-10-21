import { cn } from "@por-aqui/ui";
import { useEffect } from "react";
import { useUi, type SaveState } from "../lib/stores";

const LABEL: Record<SaveState, string> = { idle: "", saving: "Guardando…", saved: "Guardado", offline: "Sin conexión — reintentaremos", pending: "Cambios pendientes" };

/** Estados «Guardando», «Guardado», «Sin conexión» y «Cambios pendientes» (con texto, no solo color). */
export function SaveIndicator({ className }: { className?: string }) {
  const state = useUi((s) => s.saveState);
  const set = useUi((s) => s.setSaveState);
  useEffect(() => {
    if (state !== "saved") return;
    const t = setTimeout(() => set("idle"), 3000);
    return () => clearTimeout(t);
  }, [state, set]);
  useEffect(() => {
    const on = () => state === "offline" && set("pending");
    const off = () => set("offline");
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [state, set]);
  return (
    <p role="status" aria-live="polite" className={cn("min-h-6 text-sm font-semibold", state === "offline" ? "text-danger" : state === "pending" ? "text-warning" : "text-muted-foreground", className)}>
      {LABEL[state]}
    </p>
  );
}
