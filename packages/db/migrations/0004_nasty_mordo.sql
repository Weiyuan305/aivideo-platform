CREATE TABLE "worker_heartbeats" (
	"id" uuid PRIMARY KEY NOT NULL,
	"queue_schema" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatch_at" timestamp with time zone,
	"error_at" timestamp with time zone,
	"transport_ready" boolean DEFAULT false NOT NULL,
	"stopped_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "jobs" SET "created_at"=coalesce(("payload"->>'createdAt')::timestamp,"updated_at");--> statement-breakpoint
CREATE INDEX "assets_owner_created" ON "assets" USING btree ("owner_user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "jobs_owner_created" ON "jobs" USING btree ("owner_user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);
