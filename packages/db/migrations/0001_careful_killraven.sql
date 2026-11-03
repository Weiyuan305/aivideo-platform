CREATE TABLE "job_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"delivered" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"status" text NOT NULL,
	"payload" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_operations" (
	"key" text PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"state" text NOT NULL,
	"request_id" text,
	"outputs" jsonb,
	"asset_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "sha256" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "source_job_id" uuid;--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN "history" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "job_outbox" ADD CONSTRAINT "job_outbox_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_operations" ADD CONSTRAINT "provider_operations_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_owner_key" ON "jobs" USING btree ("owner_user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "jobs_status" ON "jobs" USING btree ("status");--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_object_key_unique" UNIQUE("object_key");