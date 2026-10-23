import type {
  AssetDto,
  BookmarkItem,
  CapabilitiesDto,
  CopyResult,
  CreateJourneyInput,
  CreatePlaceInput,
  CreateStopInput,
  CreateUploadInput,
  CreateVisitInput,
  ExploreQuery,
  FinishRecordingInput,
  GeocodeResult,
  InterestDto,
  JourneyDto,
  JourneySummaryDto,
  MeDto,
  PlaceDto,
  ProposalDto,
  ProposalInput,
  PublicProfileDto,
  PublicRouteCard,
  PublicRouteDto,
  PublicationDraftDto,
  PublicationStateDto,
  PublishInput,
  RecordingDto,
  RegisterInput,
  ReorderInput,
  ReportDto,
  SessionDto,
  ShareLinkCreated,
  ShareLinkDto,
  TrackBatchInput,
  TrackBatchResult,
  TrackDto,
  UpdateJourneyInput,
  UpdateProfileInput,
  UpdateVisitInput,
  UploadAuthorization,
  Visibility,
  VisitDto,
  TravelCatalog,
} from "@por-aqui/contracts";
import type { HttpClient } from "./http";

type Page<T> = { items: T[]; nextCursor: string | null };
type Sig = { signal?: AbortSignal };
export interface Destination {
  label: string;
  locality: string;
  region: string | null;
  countryCode: string | null;
  placesCount: number;
  center: { lng: number; lat: number };
}

/** Capa tipada sobre HttpClient: una función por endpoint de la API. */
export function createApi(http: HttpClient) {
  return {
    catalog: {
      get: (o?: Sig) => http.get<TravelCatalog>("/catalog", o),
      admin: (o?: Sig) => http.get<TravelCatalog>("/catalog/admin", o),
      save: (data: TravelCatalog) => http.put<TravelCatalog>("/catalog/admin", data),
      savedPlaces: (o?: Sig) => http.get<PlaceDto[]>("/catalog/saved-places", o),
      savePlace: (id: string) => http.put<{ ok: true }>(`/catalog/saved-places/${id}`),
      unsavePlace: (id: string) => http.delete<{ ok: true }>(`/catalog/saved-places/${id}`),
    },
    meta: {
      capabilities: (o?: Sig) => http.get<CapabilitiesDto>("/meta/capabilities", o),
      interests: (o?: Sig) => http.get<InterestDto[]>("/meta/interests", o),
    },
    auth: {
      csrf: () => http.get<{ csrfToken: string }>("/auth/csrf"),
      register: (i: RegisterInput) => http.post<{ ok: true; requiresVerification: true }>("/auth/register", i),
      login: (i: { email: string; password: string }) => http.post<MeDto>("/auth/login", i),
      logout: () => http.post<{ ok: true }>("/auth/logout"),
      me: (o?: Sig) => http.get<MeDto>("/auth/me", o),
      verifyEmail: (token: string) => http.post<{ ok: true }>("/auth/verify-email", { token }),
      resendVerification: (email?: string) => http.post<{ ok: true }>("/auth/resend-verification", { email }),
      forgotPassword: (email: string) => http.post<{ ok: true }>("/auth/forgot-password", { email }),
      resetPassword: (i: { token: string; password: string; passwordConfirm: string }) => http.post<{ ok: true }>("/auth/reset-password", i),
      sessions: (o?: Sig) => http.get<SessionDto[]>("/auth/sessions", o),
      revokeSession: (id: string) => http.delete<{ ok: true }>(`/auth/sessions/${id}`),
      revokeOtherSessions: () => http.delete<{ ok: true }>("/auth/sessions"),
    },
    me: {
      updateProfile: (i: UpdateProfileInput) => http.patch<MeDto>("/me/profile", i),
      changePassword: (i: { currentPassword: string; newPassword: string; newPasswordConfirm: string }) => http.put<{ ok: true }>("/me/password", i),
      deleteAccount: (i: { password: string; confirmation: "ELIMINAR" }) => http.request<{ ok: true }>("DELETE", "/me/account", { body: i }),
      avatarUpload: (i: CreateUploadInput) => http.post<UploadAuthorization>("/me/avatar/uploads", i),
    },
    places: {
      search: (q: Record<string, string | number | undefined>, o?: Sig) => http.get<PlaceDto[]>("/places/search", { query: q, ...o }),
      destinations: (q?: string, o?: Sig) => http.get<Destination[]>("/places/destinations", { query: { q }, ...o }),
      create: (i: CreatePlaceInput) => http.post<PlaceDto>("/places", i),
      geocode: (q: string, o?: Sig) => http.get<GeocodeResult>("/places/geocode", { query: { q }, ...o }),
    },
    journeys: {
      list: (q?: { includeArchived?: boolean }, o?: Sig) => http.get<JourneySummaryDto[]>("/journeys", { query: { includeArchived: q?.includeArchived ? "true" : undefined }, ...o }),
      create: (i: CreateJourneyInput) => http.post<JourneyDto>("/journeys", i),
      get: (id: string, o?: Sig) => http.get<JourneyDto>(`/journeys/${id}`, o),
      update: (id: string, i: UpdateJourneyInput) => http.patch<JourneyDto>(`/journeys/${id}`, i),
      duplicate: (id: string) => http.post<JourneyDto>(`/journeys/${id}/duplicate`),
      remove: (id: string) => http.delete<{ ok: true }>(`/journeys/${id}`),
      archive: (id: string) => http.post<JourneyDto>(`/journeys/${id}/archive`),
      unarchive: (id: string) => http.post<JourneyDto>(`/journeys/${id}/unarchive`),
      addDay: (id: string, i: { expectedVersion: number; localDate?: string | null; destinationLabel?: string | null }) => http.post<JourneyDto>(`/journeys/${id}/days`, i),
      updateDay: (id: string, dayId: string, i: { expectedVersion: number; localDate?: string | null; destinationLabel?: string | null }) => http.patch<JourneyDto>(`/journeys/${id}/days/${dayId}`, i),
      deleteDay: (id: string, dayId: string, expectedVersion: number) => http.delete<JourneyDto>(`/journeys/${id}/days/${dayId}`, { query: { expectedVersion } }),
      addStop: (id: string, i: CreateStopInput) => http.post<JourneyDto>(`/journeys/${id}/stops`, i),
      updateStop: (id: string, stopId: string, i: { expectedVersion: number; visitDurationSeconds?: number | null }) => http.patch<JourneyDto>(`/journeys/${id}/stops/${stopId}`, i),
      deleteStop: (id: string, stopId: string, expectedVersion: number) => http.delete<JourneyDto>(`/journeys/${id}/stops/${stopId}`, { query: { expectedVersion } }),
      reorder: (id: string, i: ReorderInput, o?: Sig) => http.post<JourneyDto>(`/journeys/${id}/reorder`, i, o),
      setLeg: (id: string, i: { fromStopId: string; toStopId: string; mode: string; durationS: number | null; expectedVersion: number }) => http.put<JourneyDto>(`/journeys/${id}/legs`, i),
      recalculateLegs: (id: string, o?: Sig) => http.post<{ applied: boolean; reason: string; computed: number; journey: JourneyDto }>(`/journeys/${id}/legs/recalculate`, {}, o),
      propose: (id: string, i: ProposalInput, o?: Sig) => http.post<ProposalDto>(`/journeys/${id}/proposals`, i, o),
      applyProposal: (id: string, proposal: ProposalDto, expectedVersion: number) => http.post<JourneyDto>(`/journeys/${id}/proposals/apply`, { proposal, expectedVersion }),
    },
    recording: {
      get: (id: string, o?: Sig) => http.get<{ recording: RecordingDto | null }>(`/journeys/${id}/recording`, o),
      start: (id: string) => http.post<RecordingDto>(`/journeys/${id}/recording/start`),
      pause: (id: string) => http.post<RecordingDto>(`/journeys/${id}/recording/pause`),
      resume: (id: string) => http.post<RecordingDto>(`/journeys/${id}/recording/resume`),
      finish: (id: string, i: FinishRecordingInput) => http.post<RecordingDto>(`/journeys/${id}/recording/finish`, i),
      track: (recordingId: string, o?: Sig) => http.get<TrackDto>(`/recordings/${recordingId}/track`, o),
      trackBatch: (recordingId: string, i: TrackBatchInput) => http.post<TrackBatchResult>(`/recordings/${recordingId}/track-batches`, i),
    },
    visits: {
      listForJourney: (journeyId: string, o?: Sig) => http.get<VisitDto[]>(`/journeys/${journeyId}/visits`, o),
      create: (recordingId: string, i: CreateVisitInput) => http.post<VisitDto>(`/recordings/${recordingId}/visits`, i),
      get: (id: string, o?: Sig) => http.get<VisitDto>(`/visits/${id}`, o),
      update: (id: string, i: UpdateVisitInput) => http.patch<VisitDto>(`/visits/${id}`, i),
      remove: (id: string) => http.delete<{ ok: true }>(`/visits/${id}`),
    },
    media: {
      reserve: (visitId: string, i: CreateUploadInput) => http.post<UploadAuthorization>(`/visits/${visitId}/media/uploads`, i),
      complete: (id: string) => http.post<AssetDto>(`/media/${id}/complete`),
      status: (id: string, o?: Sig) => http.get<AssetDto>(`/media/${id}`, o),
      retry: (id: string) => http.post<AssetDto>(`/media/${id}/retry`),
      caption: (id: string, caption: string | null) => http.patch<AssetDto>(`/media/${id}`, { caption }),
      remove: (id: string) => http.delete<{ ok: true }>(`/media/${id}`),
    },
    publications: {
      draft: (journeyId: string, o?: Sig) => http.get<PublicationDraftDto>(`/journeys/${journeyId}/publication`, o),
      publish: (journeyId: string, i: PublishInput) => http.put<PublicationStateDto>(`/journeys/${journeyId}/publication`, i),
      remove: (journeyId: string) => http.delete<{ ok: true }>(`/journeys/${journeyId}/publication`),
      setVisibility: (id: string, visibility: Visibility) => http.put<PublicationStateDto>(`/publications/${id}/visibility`, { visibility }),
      links: (id: string, o?: Sig) => http.get<ShareLinkDto[]>(`/publications/${id}/share-links`, o),
      createLink: (id: string, expiresInDays?: number | null) => http.post<ShareLinkCreated>(`/publications/${id}/share-links`, { expiresInDays }),
      revokeLink: (id: string, linkId: string) => http.delete<{ ok: true }>(`/publications/${id}/share-links/${linkId}`),
      copy: (id: string, i: { clientMutationId: string; shareToken?: string }) => http.post<CopyResult>(`/publications/${id}/copy`, i),
    },
    public: {
      explore: (q: Partial<ExploreQuery>, o?: Sig) => http.get<Page<PublicRouteCard>>("/public/explore", { query: q as Record<string, string | number>, ...o }),
      route: (slug: string, o?: Sig) => http.get<PublicRouteDto>(`/public/routes/${encodeURIComponent(slug)}`, o),
      shared: (token: string, o?: Sig) => http.get<PublicRouteDto>(`/shared/${encodeURIComponent(token)}`, o),
      profile: (username: string, o?: Sig) => http.get<PublicProfileDto>(`/public/profiles/${encodeURIComponent(username)}`, o),
    },
    bookmarks: {
      list: (o?: Sig) => http.get<BookmarkItem[]>("/bookmarks", o),
      status: (publicationId: string, o?: Sig) => http.get<{ bookmarked: boolean }>(`/bookmarks/${publicationId}`, o),
      add: (publicationId: string) => http.post<{ bookmarked: true }>("/bookmarks", { publicationId }),
      remove: (publicationId: string) => http.delete<{ bookmarked: false }>(`/bookmarks/${publicationId}`),
    },
    reports: {
      create: (i: { publicationId: string; reason: string; detail?: string | null }) => http.post<{ ok: true }>("/reports", i),
    },
    moderation: {
      reports: (status: "OPEN" | "RESOLVED" | "DISMISSED" = "OPEN", o?: Sig) => http.get<ReportDto[]>("/moderation/reports", { query: { status }, ...o }),
      preview: (publicationId: string, o?: Sig) => http.get<PublicRouteDto>(`/moderation/publications/${publicationId}/preview`, o),
      act: (publicationId: string, i: { action: "HIDE" | "RESTORE"; reason: string; reportId?: string; resolveReport?: "RESOLVED" | "DISMISSED" }) =>
        http.post<{ ok: true; moderationStatus: "VISIBLE" | "HIDDEN" }>(`/moderation/publications/${publicationId}/actions`, i),
    },
  };
}

export type Api = ReturnType<typeof createApi>;
