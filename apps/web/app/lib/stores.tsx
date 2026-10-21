import { createContext, useContext, useRef, type ReactNode } from "react";
import { createStore, useStore, type StoreApi } from "zustand";

export type SaveState = "idle" | "saving" | "saved" | "offline" | "pending";

/**
 * Estado de INTERFAZ únicamente (selección, paneles, indicadores). La verdad remota vive en TanStack Query.
 * El store se crea por montaje de la app (no es un singleton de módulo), así nunca se comparte entre peticiones SSR.
 */
export interface UiState {
  selectedStopId: string | null;
  mapOpen: boolean;
  addPanelOpen: boolean;
  saveState: SaveState;
  announcement: string;
  select: (id: string | null) => void;
  setMapOpen: (open: boolean) => void;
  setAddPanelOpen: (open: boolean) => void;
  setSaveState: (s: SaveState) => void;
  announce: (message: string) => void;
}

export function createUiStore() {
  return createStore<UiState>()((set) => ({
    selectedStopId: null,
    mapOpen: false,
    addPanelOpen: false,
    saveState: "idle",
    announcement: "",
    select: (id) => set({ selectedStopId: id }),
    setMapOpen: (mapOpen) => set({ mapOpen }),
    setAddPanelOpen: (addPanelOpen) => set({ addPanelOpen }),
    setSaveState: (saveState) => set({ saveState }),
    announce: (message) => {
      set({ announcement: "" }); // fuerza a los lectores de pantalla a re-anunciar mensajes repetidos
      setTimeout(() => set({ announcement: message }), 30);
    },
  }));
}

const Ctx = createContext<StoreApi<UiState> | null>(null);

export function UiStoreProvider({ children }: { children: ReactNode }) {
  const ref = useRef<StoreApi<UiState>>(null);
  ref.current ??= createUiStore();
  return <Ctx.Provider value={ref.current}>{children}</Ctx.Provider>;
}

export function useUi<T>(selector: (s: UiState) => T): T {
  const store = useContext(Ctx);
  if (!store) throw new Error("UiStoreProvider ausente");
  return useStore(store, selector);
}
