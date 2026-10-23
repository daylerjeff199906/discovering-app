import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
export const catalogKey = ["travel-catalog"] as const;
export function useTravelCatalog() {
  return useQuery({ queryKey: catalogKey, queryFn: ({ signal }) => api.catalog.get({ signal }), staleTime: 30000 });
}
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = Math.PI / 180;
  const x = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lng - a.lng) * r / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
}
