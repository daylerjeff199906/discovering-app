ALTER TABLE "publication_entries" ADD COLUMN "recommendation" text;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "expense_minor" integer;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "expense_currency" text;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "transport_mode" text;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "recommendation" text;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_expense_chk" CHECK (("visits"."expense_minor" is null and "visits"."expense_currency" is null) or ("visits"."expense_minor" >= 0 and "visits"."expense_currency" ~ '^[A-Z]{3}$'));--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_transport_chk" CHECK ("visits"."transport_mode" is null or "visits"."transport_mode" in ('WALK','BIKE','CAR','TRANSIT','BOAT','FLIGHT','OTHER'));