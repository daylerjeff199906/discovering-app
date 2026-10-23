import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { geometryPoint } from "./geometry";

const pk = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () =>
  ts("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/* ─────────────────────────── Identidad ─────────────────────────── */

export const users = pgTable(
  "users",
  {
    id: pk(),
    emailOriginal: text("email_original").notNull(),
    emailNormalized: text("email_normalized").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    emailVerifiedAt: ts("email_verified_at"),
    role: text("role").notNull().default("USER"),
    accountStatus: text("account_status").notNull().default("ACTIVE"),
    termsVersion: text("terms_version").notNull(),
    termsAcceptedAt: ts("terms_accepted_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("users_role_chk", sql`${t.role} in ('USER','MODERATOR')`),
    check("users_status_chk", sql`${t.accountStatus} in ('ACTIVE','DISABLED','DELETION_PENDING')`),
  ],
);

export const profiles = pgTable(
  "profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    username: text("username").notNull(),
    usernameNormalized: text("username_normalized").notNull().unique(),
    displayName: text("display_name").notNull(),
    bio: text("bio"),
    avatarAssetId: uuid("avatar_asset_id").references((): AnyPgColumn => mediaAssets.id, { onDelete: "set null" }),
    locale: text("locale").notNull().default("es"),
    timezone: text("timezone").notNull().default("America/Lima"),
    preferencesJson: jsonb("preferences_json").$type<{ interests?: string[] }>().notNull().default({}),
    onboardingCompletedAt: ts("onboarding_completed_at"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("profiles_username_chk", sql`${t.username} ~ '^[A-Za-z0-9_]{3,24}$'`)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: createdAt(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
    userAgentLabel: text("user_agent_label"),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expires_idx").on(t.expiresAt)],
);

export const authTokens = pgTable(
  "auth_tokens",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: ts("expires_at").notNull(),
    consumedAt: ts("consumed_at"),
    createdAt: createdAt(),
  },
  (t) => [
    check("auth_tokens_purpose_chk", sql`${t.purpose} in ('VERIFY_EMAIL','RESET_PASSWORD')`),
    index("auth_tokens_user_idx").on(t.userId, t.purpose),
  ],
);

/* ─────────────────────────── Lugares ─────────────────────────── */

export const places = pgTable(
  "places",
  {
    id: pk(),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    countryCode: text("country_code"),
    region: text("region"),
    locality: text("locality"),
    address: text("address"),
    location: geometryPoint("location").notNull(),
    timezone: text("timezone"),
    provider: text("provider"),
    providerPlaceId: text("provider_place_id"),
    sourceUrl: text("source_url"),
    verifiedAt: ts("verified_at"),
    openingHours: jsonb("opening_hours").$type<Record<string, [string, string][]>>(),
    typicalVisitMinutes: integer("typical_visit_minutes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("places_scope_chk", sql`${t.scope} in ('CATALOG','PERSONAL')`),
    check(
      "places_owner_chk",
      sql`(${t.scope} = 'PERSONAL' and ${t.ownerId} is not null) or (${t.scope} = 'CATALOG' and ${t.ownerId} is null)`,
    ),
    check("places_country_chk", sql`${t.countryCode} is null or ${t.countryCode} ~ '^[A-Z]{2}$'`),
    uniqueIndex("places_provider_uidx").on(t.provider, t.providerPlaceId).where(sql`${t.providerPlaceId} is not null`),
    index("places_location_gist").using("gist", t.location),
    index("places_scope_idx").on(t.scope, t.countryCode, t.locality),
    index("places_owner_idx").on(t.ownerId),
  ],
);

export const interests = pgTable("interests", {
  id: pk(),
  slug: text("slug").notNull().unique(),
  labelEs: text("label_es").notNull(),
});

export const placeInterests = pgTable(
  "place_interests",
  {
    placeId: uuid("place_id")
      .notNull()
      .references(() => places.id, { onDelete: "cascade" }),
    interestId: uuid("interest_id")
      .notNull()
      .references(() => interests.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.placeId, t.interestId] })],
);

export const catalogContent = pgTable("catalog_content", {
  key: text("key").primaryKey(),
  data: jsonb("data").notNull(),
  updatedAt: updatedAt(),
});
export const savedPlaces = pgTable("saved_places", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  placeId: uuid("place_id").notNull().references(() => places.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.userId, t.placeId] })]);

/* ─────────────────────────── Planificación ─────────────────────────── */

export const journeys = pgTable(
  "journeys",
  {
    id: pk(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    creationMode: text("creation_mode").notNull(),
    planStatus: text("plan_status").notNull().default("DRAFT"),
    preferencesJson: jsonb("preferences_json").notNull().default({}),
    version: integer("version").notNull().default(1),
    archivedAt: ts("archived_at"),
    sourcePublicationId: uuid("source_publication_id"),
    idempotencyKey: text("idempotency_key"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("journeys_mode_chk", sql`${t.creationMode} in ('AUTOMATIC','MANUAL','FREE')`),
    check("journeys_plan_chk", sql`${t.planStatus} in ('DRAFT','READY')`),
    index("journeys_owner_updated_idx").on(t.ownerId, t.updatedAt),
    uniqueIndex("journeys_idem_uidx").on(t.ownerId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
  ],
);

export const journeyDays = pgTable(
  "journey_days",
  {
    id: pk(),
    journeyId: uuid("journey_id")
      .notNull()
      .references(() => journeys.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    localDate: date("local_date", { mode: "string" }),
    timezone: text("timezone").notNull(),
    destinationLabel: text("destination_label"),
  },
  (t) => [
    unique("journey_days_pos_uq").on(t.journeyId, t.position),
    unique("journey_days_id_journey_uq").on(t.id, t.journeyId),
    check("journey_days_pos_chk", sql`${t.position} >= 0`),
  ],
);

export const journeyStops = pgTable(
  "journey_stops",
  {
    id: pk(),
    journeyId: uuid("journey_id").notNull(),
    dayId: uuid("day_id").notNull(),
    placeId: uuid("place_id")
      .notNull()
      .references(() => places.id),
    position: integer("position").notNull(),
    visitDurationSeconds: integer("visit_duration_seconds"),
    placeSnapshotJson: jsonb("place_snapshot_json").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({ columns: [t.dayId, t.journeyId], foreignColumns: [journeyDays.id, journeyDays.journeyId], name: "journey_stops_day_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.journeyId], foreignColumns: [journeys.id], name: "journey_stops_journey_fk" }).onDelete("cascade"),
    unique("journey_stops_pos_uq").on(t.dayId, t.position),
    unique("journey_stops_id_journey_uq").on(t.id, t.journeyId),
    check("journey_stops_pos_chk", sql`${t.position} >= 0`),
    check("journey_stops_dur_chk", sql`${t.visitDurationSeconds} is null or ${t.visitDurationSeconds} > 0`),
    index("journey_stops_journey_idx").on(t.journeyId),
  ],
);

export const journeyLegs = pgTable(
  "journey_legs",
  {
    id: pk(),
    journeyId: uuid("journey_id").notNull(),
    fromStopId: uuid("from_stop_id").notNull(),
    toStopId: uuid("to_stop_id").notNull(),
    mode: text("mode").notNull(),
    distanceM: doublePrecision("distance_m"),
    durationS: integer("duration_s"),
    geometry: jsonb("geometry").$type<[number, number][]>(),
    source: text("source").notNull(),
    quality: text("quality").notNull(),
    calculatedForVersion: integer("calculated_for_version").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ columns: [t.journeyId], foreignColumns: [journeys.id], name: "journey_legs_journey_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.fromStopId, t.journeyId], foreignColumns: [journeyStops.id, journeyStops.journeyId], name: "journey_legs_from_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.toStopId, t.journeyId], foreignColumns: [journeyStops.id, journeyStops.journeyId], name: "journey_legs_to_fk" }).onDelete("cascade"),
    unique("journey_legs_pair_uq").on(t.fromStopId, t.toStopId),
    check("journey_legs_distinct_chk", sql`${t.fromStopId} <> ${t.toStopId}`),
    check("journey_legs_mode_chk", sql`${t.mode} in ('WALK','BIKE','CAR','TRANSIT','BOAT','FLIGHT','OTHER')`),
    check("journey_legs_quality_chk", sql`${t.quality} in ('PROVIDER','ESTIMATED','MANUAL','UNKNOWN')`),
    check("journey_legs_nonneg_chk", sql`(${t.distanceM} is null or ${t.distanceM} >= 0) and (${t.durationS} is null or ${t.durationS} >= 0)`),
    index("journey_legs_journey_idx").on(t.journeyId),
  ],
);

/* ─────────────────────────── Ejecución y recuerdos ─────────────────────────── */

export const recordings = pgTable(
  "recordings",
  {
    id: pk(),
    journeyId: uuid("journey_id")
      .notNull()
      .unique()
      .references(() => journeys.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    startedAt: ts("started_at").notNull(),
    pausedAt: ts("paused_at"),
    endedAt: ts("ended_at"),
    version: integer("version").notNull().default(1),
    /** Watermarks finales por segmento, fijados al finalizar. */
    trackWatermarks: jsonb("track_watermarks").$type<Record<string, number>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("recordings_id_journey_uq").on(t.id, t.journeyId),
    check("recordings_status_chk", sql`${t.status} in ('ACTIVE','PAUSED','COMPLETED')`),
    check("recordings_ended_chk", sql`(${t.status} = 'COMPLETED') = (${t.endedAt} is not null)`),
  ],
);

export const visits = pgTable(
  "visits",
  {
    id: pk(),
    recordingId: uuid("recording_id").notNull(),
    journeyId: uuid("journey_id").notNull(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    stopId: uuid("stop_id"),
    placeId: uuid("place_id")
      .notNull()
      .references(() => places.id),
    visitedAt: ts("visited_at").notNull(),
    endedAt: ts("ended_at"),
    timezone: text("timezone").notNull(),
    note: text("note"),
    /** Gasto opcional en unidad menor (céntimos) + moneda ISO. Siempre privado: nunca se publica. */
    expenseMinor: integer("expense_minor"),
    expenseCurrency: text("expense_currency"),
    /** Cómo llegó a este lugar (opcional, privado). */
    transportMode: text("transport_mode"),
    /** Consejo para quien visite el lugar (opcional; se publica solo si el autor lo elige). */
    recommendation: text("recommendation"),
    placeSnapshotJson: jsonb("place_snapshot_json").notNull(),
    clientMutationId: text("client_mutation_id").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({ columns: [t.recordingId, t.journeyId], foreignColumns: [recordings.id, recordings.journeyId], name: "visits_recording_fk" }).onDelete("cascade"),
    // La FK de stop_id se redefine en la migración 0001 con ON DELETE SET NULL (stop_id).
    foreignKey({ columns: [t.stopId, t.journeyId], foreignColumns: [journeyStops.id, journeyStops.journeyId], name: "visits_stop_fk" }),
    unique("visits_idem_uq").on(t.recordingId, t.clientMutationId),
    unique("visits_id_owner_uq").on(t.id, t.ownerId),
    index("visits_recording_time_idx").on(t.recordingId, t.visitedAt, t.id),
    index("visits_place_idx").on(t.placeId),
    check("visits_end_chk", sql`${t.endedAt} is null or ${t.endedAt} >= ${t.visitedAt}`),
    check("visits_expense_chk", sql`(${t.expenseMinor} is null and ${t.expenseCurrency} is null) or (${t.expenseMinor} >= 0 and ${t.expenseCurrency} ~ '^[A-Z]{3}$')`),
    check("visits_transport_chk", sql`${t.transportMode} is null or ${t.transportMode} in ('WALK','BIKE','CAR','TRANSIT','BOAT','FLIGHT','OTHER')`),
  ],
);

export const trackSegments = pgTable(
  "track_segments",
  {
    id: pk(),
    recordingId: uuid("recording_id")
      .notNull()
      .references(() => recordings.id, { onDelete: "cascade" }),
    clientSegmentId: text("client_segment_id").notNull(),
    startedAt: ts("started_at").notNull(),
    endedAt: ts("ended_at"),
    source: text("source").notNull().default("GPS"),
    createdAt: createdAt(),
  },
  (t) => [unique("track_segments_client_uq").on(t.recordingId, t.clientSegmentId), check("track_segments_source_chk", sql`${t.source} in ('GPS')`)],
);

export const trackPoints = pgTable(
  "track_points",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    segmentId: uuid("segment_id")
      .notNull()
      .references(() => trackSegments.id, { onDelete: "cascade" }),
    clientSequence: integer("client_sequence").notNull(),
    recordedAt: ts("recorded_at").notNull(),
    location: geometryPoint("location").notNull(),
    accuracyM: doublePrecision("accuracy_m"),
  },
  (t) => [
    unique("track_points_seq_uq").on(t.segmentId, t.clientSequence),
    check("track_points_acc_chk", sql`${t.accuracyM} is null or ${t.accuracyM} >= 0`),
    index("track_points_time_idx").on(t.segmentId, t.recordedAt),
    index("track_points_location_gist").using("gist", t.location),
  ],
);

/* ─────────────────────────── Medios ─────────────────────────── */

export const mediaAssets = pgTable(
  "media_assets",
  {
    id: pk(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(),
    status: text("status").notNull().default("PENDING"),
    originalKey: text("original_key").notNull().unique(),
    mimeClaimed: text("mime_claimed").notNull(),
    mimeVerified: text("mime_verified"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    width: integer("width"),
    height: integer("height"),
    checksum: text("checksum"),
    thumbnailKey: text("thumbnail_key"),
    displayKey: text("display_key"),
    derivativeVersion: integer("derivative_version").notNull().default(0),
    uploadExpiresAt: ts("upload_expires_at").notNull(),
    failureCode: text("failure_code"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("media_assets_id_owner_uq").on(t.id, t.ownerId),
    check("media_assets_purpose_chk", sql`${t.purpose} in ('VISIT_PHOTO','AVATAR')`),
    check("media_assets_status_chk", sql`${t.status} in ('PENDING','UPLOADED','PROCESSING','READY','FAILED')`),
    index("media_assets_owner_idx").on(t.ownerId, t.status),
  ],
);

export const visitMedia = pgTable(
  "visit_media",
  {
    visitId: uuid("visit_id").notNull(),
    assetId: uuid("asset_id").notNull().unique(),
    ownerId: uuid("owner_id").notNull(),
    position: integer("position").notNull(),
    caption: text("caption"),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.visitId, t.assetId] }),
    foreignKey({ columns: [t.visitId, t.ownerId], foreignColumns: [visits.id, visits.ownerId], name: "visit_media_visit_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.assetId, t.ownerId], foreignColumns: [mediaAssets.id, mediaAssets.ownerId], name: "visit_media_asset_fk" }).onDelete("cascade"),
    unique("visit_media_pos_uq").on(t.visitId, t.position),
  ],
);

/* ─────────────────────────── Publicación y comunidad ─────────────────────────── */

export const publications = pgTable(
  "publications",
  {
    id: pk(),
    journeyId: uuid("journey_id")
      .notNull()
      .unique()
      .references(() => journeys.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    slug: text("slug").notNull().unique(),
    visibility: text("visibility").notNull().default("PRIVATE"),
    moderationStatus: text("moderation_status").notNull().default("VISIBLE"),
    activeVersionId: uuid("active_version_id"),
    revision: integer("revision").notNull().default(0),
    firstPublishedAt: ts("first_published_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({ columns: [t.activeVersionId, t.id], foreignColumns: [publicationVersions.id, publicationVersions.publicationId], name: "publications_active_version_fk" }),
    check("publications_visibility_chk", sql`${t.visibility} in ('PRIVATE','UNLISTED','PUBLIC')`),
    check("publications_moderation_chk", sql`${t.moderationStatus} in ('VISIBLE','HIDDEN')`),
    index("publications_feed_idx").on(t.firstPublishedAt.desc(), t.id.desc()).where(sql`${t.visibility} = 'PUBLIC' and ${t.moderationStatus} = 'VISIBLE'`),
    index("publications_author_idx").on(t.authorId),
  ],
);

export const publicationVersions = pgTable(
  "publication_versions",
  {
    id: pk(),
    publicationId: uuid("publication_id")
      .notNull()
      .references((): AnyPgColumn => publications.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    authorDisplaySnapshot: jsonb("author_display_snapshot").$type<{ username: string; displayName: string; avatarAssetId: string | null; isDemo: boolean }>().notNull(),
    coverAssetId: uuid("cover_asset_id").references(() => mediaAssets.id),
    locationLabel: text("location_label"),
    transportSummary: text("transport_summary"),
    transportMode: text("transport_mode"),
    pace: text("pace"),
    interestSlugs: text("interest_slugs").array().notNull().default(sql`'{}'::text[]`),
    durationDays: integer("duration_days"),
    shareExactTrack: boolean("share_exact_track").notNull().default(false),
    sanitizedTrack: jsonb("sanitized_track").$type<[number, number][][]>(),
    selectionJson: jsonb("selection_json"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("publication_versions_rev_uq").on(t.publicationId, t.revision),
    unique("publication_versions_id_pub_uq").on(t.id, t.publicationId),
    check("publication_versions_mode_chk", sql`${t.transportMode} is null or ${t.transportMode} in ('WALK','BIKE','CAR','TRANSIT','BOAT','FLIGHT','OTHER')`),
    check("publication_versions_pace_chk", sql`${t.pace} is null or ${t.pace} in ('RELAXED','MODERATE','INTENSE')`),
    index("publication_versions_interests_gin").using("gin", t.interestSlugs),
  ],
);

export const publicationEntries = pgTable(
  "publication_entries",
  {
    id: pk(),
    versionId: uuid("version_id")
      .notNull()
      .references(() => publicationVersions.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    displayName: text("display_name").notNull(),
    locationLabel: text("location_label"),
    publicLocation: geometryPoint("public_location"),
    locationPrecision: text("location_precision").notNull(),
    note: text("note"),
    recommendation: text("recommendation"),
    visitedLocalDate: date("visited_local_date", { mode: "string" }),
    catalogPlaceId: uuid("catalog_place_id").references(() => places.id, { onDelete: "set null" }),
  },
  (t) => [
    unique("publication_entries_pos_uq").on(t.versionId, t.position),
    check("publication_entries_precision_chk", sql`${t.locationPrecision} in ('EXACT','APPROXIMATE','HIDDEN')`),
  ],
);

export const publicationMedia = pgTable(
  "publication_media",
  {
    id: pk(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => publicationEntries.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => mediaAssets.id),
    position: integer("position").notNull(),
    caption: text("caption"),
    altText: text("alt_text"),
  },
  (t) => [unique("publication_media_pos_uq").on(t.entryId, t.position), index("publication_media_asset_idx").on(t.assetId)],
);

export const shareLinks = pgTable(
  "share_links",
  {
    id: pk(),
    publicationId: uuid("publication_id")
      .notNull()
      .references(() => publications.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: ts("expires_at"),
    revokedAt: ts("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [index("share_links_pub_idx").on(t.publicationId)],
);

export const bookmarks = pgTable(
  "bookmarks",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    publicationId: uuid("publication_id")
      .notNull()
      .references(() => publications.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.publicationId] })],
);

export const reports = pgTable(
  "reports",
  {
    id: pk(),
    reporterId: uuid("reporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    publicationId: uuid("publication_id")
      .notNull()
      .references(() => publications.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    detail: text("detail"),
    status: text("status").notNull().default("OPEN"),
    createdAt: createdAt(),
  },
  (t) => [
    check("reports_reason_chk", sql`${t.reason} in ('INAPPROPRIATE','PRIVACY','SPAM','COPYRIGHT','OTHER')`),
    check("reports_status_chk", sql`${t.status} in ('OPEN','RESOLVED','DISMISSED')`),
    index("reports_status_idx").on(t.status, t.createdAt),
    uniqueIndex("reports_open_uidx").on(t.reporterId, t.publicationId).where(sql`${t.status} = 'OPEN'`),
  ],
);

export const moderationActions = pgTable(
  "moderation_actions",
  {
    id: pk(),
    moderatorId: uuid("moderator_id")
      .notNull()
      .references(() => users.id),
    publicationId: uuid("publication_id")
      .notNull()
      .references(() => publications.id, { onDelete: "cascade" }),
    reportId: uuid("report_id").references(() => reports.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    reason: text("reason").notNull(),
    createdAt: createdAt(),
  },
  (t) => [check("moderation_actions_action_chk", sql`${t.action} in ('HIDE','RESTORE')`)],
);

/* ─────────────────────────── Mensajería interna ─────────────────────────── */

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: pk(),
    topic: text("topic").notNull(),
    aggregateId: uuid("aggregate_id"),
    payloadJson: jsonb("payload_json").notNull().default({}),
    createdAt: createdAt(),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: ts("next_attempt_at").notNull().defaultNow(),
    deliveredAt: ts("delivered_at"),
    processedAt: ts("processed_at"),
    lastErrorCode: text("last_error_code"),
  },
  (t) => [index("outbox_pending_idx").on(t.nextAttemptAt).where(sql`${t.deliveredAt} is null`)],
);

export type DbUser = typeof users.$inferSelect;
export type DbProfile = typeof profiles.$inferSelect;
export type DbPlace = typeof places.$inferSelect;
export type DbJourney = typeof journeys.$inferSelect;
export type DbMediaAsset = typeof mediaAssets.$inferSelect;
