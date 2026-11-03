-- Assets previously used the database session's local now(); preserve that instant.
ALTER TABLE "assets" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE current_setting('TimeZone');--> statement-breakpoint
ALTER TABLE "assets" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
-- Task snapshots have canonical ISO instants; the new sort column follows those.
ALTER TABLE "jobs" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
UPDATE "jobs" SET "created_at"=("payload"->>'createdAt')::timestamptz WHERE "payload"->>'createdAt' IS NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "created_at" SET DEFAULT now();
