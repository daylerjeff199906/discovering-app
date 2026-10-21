CREATE EXTENSION IF NOT EXISTS postgis;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "auth_tokens_purpose_chk" CHECK ("auth_tokens"."purpose" in ('VERIFY_EMAIL','RESET_PASSWORD'))
);
--> statement-breakpoint
CREATE TABLE "bookmarks" (
	"user_id" uuid NOT NULL,
	"publication_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookmarks_user_id_publication_id_pk" PRIMARY KEY("user_id","publication_id")
);
--> statement-breakpoint
CREATE TABLE "interests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"label_es" text NOT NULL,
	CONSTRAINT "interests_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "journey_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journey_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"local_date" date,
	"timezone" text NOT NULL,
	"destination_label" text,
	CONSTRAINT "journey_days_pos_uq" UNIQUE("journey_id","position"),
	CONSTRAINT "journey_days_id_journey_uq" UNIQUE("id","journey_id"),
	CONSTRAINT "journey_days_pos_chk" CHECK ("journey_days"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "journey_legs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journey_id" uuid NOT NULL,
	"from_stop_id" uuid NOT NULL,
	"to_stop_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"distance_m" double precision,
	"duration_s" integer,
	"geometry" jsonb,
	"source" text NOT NULL,
	"quality" text NOT NULL,
	"calculated_for_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journey_legs_pair_uq" UNIQUE("from_stop_id","to_stop_id"),
	CONSTRAINT "journey_legs_distinct_chk" CHECK ("journey_legs"."from_stop_id" <> "journey_legs"."to_stop_id"),
	CONSTRAINT "journey_legs_mode_chk" CHECK ("journey_legs"."mode" in ('WALK','BIKE','CAR','TRANSIT','BOAT','FLIGHT','OTHER')),
	CONSTRAINT "journey_legs_quality_chk" CHECK ("journey_legs"."quality" in ('PROVIDER','ESTIMATED','MANUAL','UNKNOWN')),
	CONSTRAINT "journey_legs_nonneg_chk" CHECK (("journey_legs"."distance_m" is null or "journey_legs"."distance_m" >= 0) and ("journey_legs"."duration_s" is null or "journey_legs"."duration_s" >= 0))
);
--> statement-breakpoint
CREATE TABLE "journey_stops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journey_id" uuid NOT NULL,
	"day_id" uuid NOT NULL,
	"place_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"visit_duration_seconds" integer,
	"place_snapshot_json" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journey_stops_pos_uq" UNIQUE("day_id","position"),
	CONSTRAINT "journey_stops_id_journey_uq" UNIQUE("id","journey_id"),
	CONSTRAINT "journey_stops_pos_chk" CHECK ("journey_stops"."position" >= 0),
	CONSTRAINT "journey_stops_dur_chk" CHECK ("journey_stops"."visit_duration_seconds" is null or "journey_stops"."visit_duration_seconds" > 0)
);
--> statement-breakpoint
CREATE TABLE "journeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"creation_mode" text NOT NULL,
	"plan_status" text DEFAULT 'DRAFT' NOT NULL,
	"preferences_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"source_publication_id" uuid,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journeys_mode_chk" CHECK ("journeys"."creation_mode" in ('AUTOMATIC','MANUAL','FREE')),
	CONSTRAINT "journeys_plan_chk" CHECK ("journeys"."plan_status" in ('DRAFT','READY'))
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"original_key" text NOT NULL,
	"mime_claimed" text NOT NULL,
	"mime_verified" text,
	"size_bytes" bigint,
	"width" integer,
	"height" integer,
	"checksum" text,
	"thumbnail_key" text,
	"display_key" text,
	"derivative_version" integer DEFAULT 0 NOT NULL,
	"upload_expires_at" timestamp with time zone NOT NULL,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_assets_original_key_unique" UNIQUE("original_key"),
	CONSTRAINT "media_assets_id_owner_uq" UNIQUE("id","owner_id"),
	CONSTRAINT "media_assets_purpose_chk" CHECK ("media_assets"."purpose" in ('VISIT_PHOTO','AVATAR')),
	CONSTRAINT "media_assets_status_chk" CHECK ("media_assets"."status" in ('PENDING','UPLOADED','PROCESSING','READY','FAILED'))
);
--> statement-breakpoint
CREATE TABLE "moderation_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"moderator_id" uuid NOT NULL,
	"publication_id" uuid NOT NULL,
	"report_id" uuid,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_actions_action_chk" CHECK ("moderation_actions"."action" in ('HIDE','RESTORE'))
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic" text NOT NULL,
	"aggregate_id" uuid,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"last_error_code" text
);
--> statement-breakpoint
CREATE TABLE "place_interests" (
	"place_id" uuid NOT NULL,
	"interest_id" uuid NOT NULL,
	CONSTRAINT "place_interests_place_id_interest_id_pk" PRIMARY KEY("place_id","interest_id")
);
--> statement-breakpoint
CREATE TABLE "places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid,
	"scope" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"country_code" text,
	"region" text,
	"locality" text,
	"address" text,
	"location" geometry(Point,4326) NOT NULL,
	"timezone" text,
	"provider" text,
	"provider_place_id" text,
	"source_url" text,
	"verified_at" timestamp with time zone,
	"opening_hours" jsonb,
	"typical_visit_minutes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "places_scope_chk" CHECK ("places"."scope" in ('CATALOG','PERSONAL')),
	CONSTRAINT "places_owner_chk" CHECK (("places"."scope" = 'PERSONAL' and "places"."owner_id" is not null) or ("places"."scope" = 'CATALOG' and "places"."owner_id" is null)),
	CONSTRAINT "places_country_chk" CHECK ("places"."country_code" is null or "places"."country_code" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"username_normalized" text NOT NULL,
	"display_name" text NOT NULL,
	"bio" text,
	"avatar_asset_id" uuid,
	"locale" text DEFAULT 'es' NOT NULL,
	"timezone" text DEFAULT 'America/Lima' NOT NULL,
	"preferences_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"onboarding_completed_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_username_normalized_unique" UNIQUE("username_normalized"),
	CONSTRAINT "profiles_username_chk" CHECK ("profiles"."username" ~ '^[A-Za-z0-9_]{3,24}$')
);
--> statement-breakpoint
CREATE TABLE "publication_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"display_name" text NOT NULL,
	"location_label" text,
	"public_location" geometry(Point,4326),
	"location_precision" text NOT NULL,
	"note" text,
	"visited_local_date" date,
	"catalog_place_id" uuid,
	CONSTRAINT "publication_entries_pos_uq" UNIQUE("version_id","position"),
	CONSTRAINT "publication_entries_precision_chk" CHECK ("publication_entries"."location_precision" in ('EXACT','APPROXIMATE','HIDDEN'))
);
--> statement-breakpoint
CREATE TABLE "publication_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"caption" text,
	"alt_text" text,
	CONSTRAINT "publication_media_pos_uq" UNIQUE("entry_id","position")
);
--> statement-breakpoint
CREATE TABLE "publication_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"publication_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"author_display_snapshot" jsonb NOT NULL,
	"cover_asset_id" uuid,
	"location_label" text,
	"transport_summary" text,
	"transport_mode" text,
	"pace" text,
	"interest_slugs" text[] DEFAULT '{}'::text[] NOT NULL,
	"duration_days" integer,
	"share_exact_track" boolean DEFAULT false NOT NULL,
	"sanitized_track" jsonb,
	"selection_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publication_versions_rev_uq" UNIQUE("publication_id","revision"),
	CONSTRAINT "publication_versions_id_pub_uq" UNIQUE("id","publication_id"),
	CONSTRAINT "publication_versions_mode_chk" CHECK ("publication_versions"."transport_mode" is null or "publication_versions"."transport_mode" in ('WALK','BIKE','CAR','TRANSIT','BOAT','FLIGHT','OTHER')),
	CONSTRAINT "publication_versions_pace_chk" CHECK ("publication_versions"."pace" is null or "publication_versions"."pace" in ('RELAXED','MODERATE','INTENSE'))
);
--> statement-breakpoint
CREATE TABLE "publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journey_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"visibility" text DEFAULT 'PRIVATE' NOT NULL,
	"moderation_status" text DEFAULT 'VISIBLE' NOT NULL,
	"active_version_id" uuid,
	"revision" integer DEFAULT 0 NOT NULL,
	"first_published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publications_journey_id_unique" UNIQUE("journey_id"),
	CONSTRAINT "publications_slug_unique" UNIQUE("slug"),
	CONSTRAINT "publications_visibility_chk" CHECK ("publications"."visibility" in ('PRIVATE','UNLISTED','PUBLIC')),
	CONSTRAINT "publications_moderation_chk" CHECK ("publications"."moderation_status" in ('VISIBLE','HIDDEN'))
);
--> statement-breakpoint
CREATE TABLE "recordings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journey_id" uuid NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"paused_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"track_watermarks" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recordings_journey_id_unique" UNIQUE("journey_id"),
	CONSTRAINT "recordings_id_journey_uq" UNIQUE("id","journey_id"),
	CONSTRAINT "recordings_status_chk" CHECK ("recordings"."status" in ('ACTIVE','PAUSED','COMPLETED')),
	CONSTRAINT "recordings_ended_chk" CHECK (("recordings"."status" = 'COMPLETED') = ("recordings"."ended_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid NOT NULL,
	"publication_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"detail" text,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_reason_chk" CHECK ("reports"."reason" in ('INAPPROPRIATE','PRIVACY','SPAM','COPYRIGHT','OTHER')),
	CONSTRAINT "reports_status_chk" CHECK ("reports"."status" in ('OPEN','RESOLVED','DISMISSED'))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"user_agent_label" text,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"publication_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "track_points" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "track_points_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"segment_id" uuid NOT NULL,
	"client_sequence" integer NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"location" geometry(Point,4326) NOT NULL,
	"accuracy_m" double precision,
	CONSTRAINT "track_points_seq_uq" UNIQUE("segment_id","client_sequence"),
	CONSTRAINT "track_points_acc_chk" CHECK ("track_points"."accuracy_m" is null or "track_points"."accuracy_m" >= 0)
);
--> statement-breakpoint
CREATE TABLE "track_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recording_id" uuid NOT NULL,
	"client_segment_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"source" text DEFAULT 'GPS' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "track_segments_client_uq" UNIQUE("recording_id","client_segment_id"),
	CONSTRAINT "track_segments_source_chk" CHECK ("track_segments"."source" in ('GPS'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_original" text NOT NULL,
	"email_normalized" text NOT NULL,
	"password_hash" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"role" text DEFAULT 'USER' NOT NULL,
	"account_status" text DEFAULT 'ACTIVE' NOT NULL,
	"terms_version" text NOT NULL,
	"terms_accepted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_normalized_unique" UNIQUE("email_normalized"),
	CONSTRAINT "users_role_chk" CHECK ("users"."role" in ('USER','MODERATOR')),
	CONSTRAINT "users_status_chk" CHECK ("users"."account_status" in ('ACTIVE','DISABLED','DELETION_PENDING'))
);
--> statement-breakpoint
CREATE TABLE "visit_media" (
	"visit_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"caption" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visit_media_visit_id_asset_id_pk" PRIMARY KEY("visit_id","asset_id"),
	CONSTRAINT "visit_media_asset_id_unique" UNIQUE("asset_id"),
	CONSTRAINT "visit_media_pos_uq" UNIQUE("visit_id","position")
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recording_id" uuid NOT NULL,
	"journey_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"stop_id" uuid,
	"place_id" uuid NOT NULL,
	"visited_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"timezone" text NOT NULL,
	"note" text,
	"place_snapshot_json" jsonb NOT NULL,
	"client_mutation_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visits_idem_uq" UNIQUE("recording_id","client_mutation_id"),
	CONSTRAINT "visits_id_owner_uq" UNIQUE("id","owner_id"),
	CONSTRAINT "visits_end_chk" CHECK ("visits"."ended_at" is null or "visits"."ended_at" >= "visits"."visited_at")
);
--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_days" ADD CONSTRAINT "journey_days_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_legs" ADD CONSTRAINT "journey_legs_journey_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_legs" ADD CONSTRAINT "journey_legs_from_fk" FOREIGN KEY ("from_stop_id","journey_id") REFERENCES "public"."journey_stops"("id","journey_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_legs" ADD CONSTRAINT "journey_legs_to_fk" FOREIGN KEY ("to_stop_id","journey_id") REFERENCES "public"."journey_stops"("id","journey_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_stops" ADD CONSTRAINT "journey_stops_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_stops" ADD CONSTRAINT "journey_stops_day_fk" FOREIGN KEY ("day_id","journey_id") REFERENCES "public"."journey_days"("id","journey_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_stops" ADD CONSTRAINT "journey_stops_journey_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_moderator_id_users_id_fk" FOREIGN KEY ("moderator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_interests" ADD CONSTRAINT "place_interests_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_interests" ADD CONSTRAINT "place_interests_interest_id_interests_id_fk" FOREIGN KEY ("interest_id") REFERENCES "public"."interests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_avatar_asset_id_media_assets_id_fk" FOREIGN KEY ("avatar_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_entries" ADD CONSTRAINT "publication_entries_version_id_publication_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."publication_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_entries" ADD CONSTRAINT "publication_entries_catalog_place_id_places_id_fk" FOREIGN KEY ("catalog_place_id") REFERENCES "public"."places"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_media" ADD CONSTRAINT "publication_media_entry_id_publication_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."publication_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_media" ADD CONSTRAINT "publication_media_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_versions" ADD CONSTRAINT "publication_versions_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_versions" ADD CONSTRAINT "publication_versions_cover_asset_id_media_assets_id_fk" FOREIGN KEY ("cover_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_active_version_fk" FOREIGN KEY ("active_version_id","id") REFERENCES "public"."publication_versions"("id","publication_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_points" ADD CONSTRAINT "track_points_segment_id_track_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."track_segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_segments" ADD CONSTRAINT "track_segments_recording_id_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recordings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_media" ADD CONSTRAINT "visit_media_visit_fk" FOREIGN KEY ("visit_id","owner_id") REFERENCES "public"."visits"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_media" ADD CONSTRAINT "visit_media_asset_fk" FOREIGN KEY ("asset_id","owner_id") REFERENCES "public"."media_assets"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_recording_fk" FOREIGN KEY ("recording_id","journey_id") REFERENCES "public"."recordings"("id","journey_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_stop_fk" FOREIGN KEY ("stop_id","journey_id") REFERENCES "public"."journey_stops"("id","journey_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_tokens_user_idx" ON "auth_tokens" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE INDEX "journey_legs_journey_idx" ON "journey_legs" USING btree ("journey_id");--> statement-breakpoint
CREATE INDEX "journey_stops_journey_idx" ON "journey_stops" USING btree ("journey_id");--> statement-breakpoint
CREATE INDEX "journeys_owner_updated_idx" ON "journeys" USING btree ("owner_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "journeys_idem_uidx" ON "journeys" USING btree ("owner_id","idempotency_key") WHERE "journeys"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "media_assets_owner_idx" ON "media_assets" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox_events" USING btree ("next_attempt_at") WHERE "outbox_events"."delivered_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "places_provider_uidx" ON "places" USING btree ("provider","provider_place_id") WHERE "places"."provider_place_id" is not null;--> statement-breakpoint
CREATE INDEX "places_location_gist" ON "places" USING gist ("location");--> statement-breakpoint
CREATE INDEX "places_scope_idx" ON "places" USING btree ("scope","country_code","locality");--> statement-breakpoint
CREATE INDEX "places_owner_idx" ON "places" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "publication_media_asset_idx" ON "publication_media" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "publication_versions_interests_gin" ON "publication_versions" USING gin ("interest_slugs");--> statement-breakpoint
CREATE INDEX "publications_feed_idx" ON "publications" USING btree ("first_published_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "publications"."visibility" = 'PUBLIC' and "publications"."moderation_status" = 'VISIBLE';--> statement-breakpoint
CREATE INDEX "publications_author_idx" ON "publications" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "reports_status_idx" ON "reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_open_uidx" ON "reports" USING btree ("reporter_id","publication_id") WHERE "reports"."status" = 'OPEN';--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "share_links_pub_idx" ON "share_links" USING btree ("publication_id");--> statement-breakpoint
CREATE INDEX "track_points_time_idx" ON "track_points" USING btree ("segment_id","recorded_at");--> statement-breakpoint
CREATE INDEX "track_points_location_gist" ON "track_points" USING gist ("location");--> statement-breakpoint
CREATE INDEX "visits_recording_time_idx" ON "visits" USING btree ("recording_id","visited_at","id");--> statement-breakpoint
CREATE INDEX "visits_place_idx" ON "visits" USING btree ("place_id");