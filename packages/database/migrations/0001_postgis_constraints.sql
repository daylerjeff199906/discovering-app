-- Índices geográficos (radio en METROS: geography, no grados) -----------------
CREATE INDEX "places_location_geography_gist" ON "places" USING gist ((("location")::geography));--> statement-breakpoint
CREATE INDEX "publication_entries_location_gist" ON "publication_entries" USING gist ("public_location") WHERE "public_location" IS NOT NULL;--> statement-breakpoint

-- Posiciones únicas, pero reordenables dentro de una transacción -------------
ALTER TABLE "journey_days" DROP CONSTRAINT "journey_days_pos_uq";--> statement-breakpoint
ALTER TABLE "journey_days" ADD CONSTRAINT "journey_days_pos_uq" UNIQUE ("journey_id", "position") DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "journey_stops" DROP CONSTRAINT "journey_stops_pos_uq";--> statement-breakpoint
ALTER TABLE "journey_stops" ADD CONSTRAINT "journey_stops_pos_uq" UNIQUE ("day_id", "position") DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint

-- Quitar una parada conserva la visita: solo se anula stop_id (PG >= 15) -----
ALTER TABLE "visits" DROP CONSTRAINT "visits_stop_fk";--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_stop_fk" FOREIGN KEY ("stop_id", "journey_id") REFERENCES "journey_stops" ("id", "journey_id") ON DELETE SET NULL ("stop_id");--> statement-breakpoint

-- updated_at consistente desde la base de datos --------------------------------
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON "users" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON "profiles" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER places_set_updated_at BEFORE UPDATE ON "places" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER journeys_set_updated_at BEFORE UPDATE ON "journeys" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER journey_stops_set_updated_at BEFORE UPDATE ON "journey_stops" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER recordings_set_updated_at BEFORE UPDATE ON "recordings" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER visits_set_updated_at BEFORE UPDATE ON "visits" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER media_assets_set_updated_at BEFORE UPDATE ON "media_assets" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER publications_set_updated_at BEFORE UPDATE ON "publications" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

-- Defensa en profundidad: propiedad y acceso a lugares ----------------------------
CREATE FUNCTION check_visit_ownership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM journeys j WHERE j.id = NEW.journey_id AND j.owner_id = NEW.owner_id) THEN
    RAISE EXCEPTION 'La visita debe pertenecer al dueño del viaje' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM places p WHERE p.id = NEW.place_id AND (p.scope = 'CATALOG' OR p.owner_id = NEW.owner_id)) THEN
    RAISE EXCEPTION 'Lugar no accesible para el dueño de la visita' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER visits_check_ownership BEFORE INSERT OR UPDATE OF journey_id, owner_id, place_id ON "visits" FOR EACH ROW EXECUTE FUNCTION check_visit_ownership();--> statement-breakpoint

CREATE FUNCTION check_stop_place_access() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM journeys j JOIN places p ON p.id = NEW.place_id
    WHERE j.id = NEW.journey_id AND (p.scope = 'CATALOG' OR p.owner_id = j.owner_id)
  ) THEN
    RAISE EXCEPTION 'Lugar no accesible para el dueño del viaje' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER journey_stops_check_place BEFORE INSERT OR UPDATE OF journey_id, place_id ON "journey_stops" FOR EACH ROW EXECUTE FUNCTION check_stop_place_access();--> statement-breakpoint

-- Las versiones publicadas son inmutables ----------------------------------------
CREATE FUNCTION forbid_version_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Las versiones de publicación son inmutables' USING ERRCODE = '23514';
END $$;--> statement-breakpoint
CREATE TRIGGER publication_versions_immutable BEFORE UPDATE ON "publication_versions" FOR EACH ROW EXECUTE FUNCTION forbid_version_update();--> statement-breakpoint

-- La foto de perfil y la portada deben ser del mismo dueño -----------------------------
CREATE FUNCTION check_avatar_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.avatar_asset_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM media_assets m WHERE m.id = NEW.avatar_asset_id AND m.owner_id = NEW.user_id AND m.purpose = 'AVATAR'
  ) THEN
    RAISE EXCEPTION 'El avatar debe ser un archivo propio con propósito AVATAR' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER profiles_check_avatar BEFORE INSERT OR UPDATE OF avatar_asset_id ON "profiles" FOR EACH ROW EXECUTE FUNCTION check_avatar_owner();
