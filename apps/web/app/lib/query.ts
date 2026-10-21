import { QueryClient, queryOptions } from "@tanstack/react-query";
import type { ExploreQuery } from "@por-aqui/contracts";
import { ApiError, api } from "./api";

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
      },
    },
  });
}

export const qk = {
  me: ["me"] as const,
  interests: ["interests"] as const,
  capabilities: ["capabilities"] as const,
  journeys: (archived: boolean) => ["journeys", { archived }] as const,
  journey: (id: string) => ["journey", id] as const,
  visits: (journeyId: string) => ["visits", journeyId] as const,
  draft: (journeyId: string) => ["publication-draft", journeyId] as const,
  explore: (q: Partial<ExploreQuery>) => ["explore", q] as const,
  route: (slug: string) => ["route", slug] as const,
  shared: (token: string) => ["shared", token] as const,
  profile: (username: string) => ["profile", username] as const,
  bookmarks: ["bookmarks"] as const,
  bookmark: (id: string) => ["bookmark", id] as const,
  sessions: ["sessions"] as const,
  destinations: (q: string) => ["destinations", q] as const,
};

export const meQuery = () => queryOptions({ queryKey: qk.me, queryFn: ({ signal }) => api.auth.me({ signal }), retry: false, staleTime: 60_000 });
export const interestsQuery = () => queryOptions({ queryKey: qk.interests, queryFn: ({ signal }) => api.meta.interests({ signal }), staleTime: 3_600_000 });
export const capabilitiesQuery = () => queryOptions({ queryKey: qk.capabilities, queryFn: ({ signal }) => api.meta.capabilities({ signal }), staleTime: 600_000 });
export const journeyQuery = (id: string) => queryOptions({ queryKey: qk.journey(id), queryFn: ({ signal }) => api.journeys.get(id, { signal }), staleTime: 0, retry: (n, e) => !(e instanceof ApiError) && n < 2 });
export const visitsQuery = (journeyId: string) => queryOptions({ queryKey: qk.visits(journeyId), queryFn: ({ signal }) => api.visits.listForJourney(journeyId, { signal }) });
export const exploreQuery = (q: Partial<ExploreQuery>) =>
  ({
    queryKey: qk.explore(q),
    queryFn: ({ signal, pageParam }: { signal: AbortSignal; pageParam?: string }) => api.public.explore({ ...q, cursor: pageParam }, { signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: { nextCursor: string | null }) => last.nextCursor ?? undefined,
  }) as const;
export const routeQuery = (slug: string) => queryOptions({ queryKey: qk.route(slug), queryFn: ({ signal }) => api.public.route(slug, { signal }) });
export const sharedQuery = (token: string) => queryOptions({ queryKey: qk.shared(token), queryFn: ({ signal }) => api.public.shared(token, { signal }), staleTime: 0 });
export const profileQuery = (username: string) => queryOptions({ queryKey: qk.profile(username), queryFn: ({ signal }) => api.public.profile(username, { signal }) });
