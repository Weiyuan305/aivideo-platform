CREATE TABLE "production_references" (
	"project_id" uuid NOT NULL,
	"resource_kind" text NOT NULL,
	"resource_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "productions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"payload" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "production_references" ADD CONSTRAINT "production_references_project_id_productions_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."productions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "productions" ADD CONSTRAINT "productions_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "production_ref_unique" ON "production_references" USING btree ("project_id","resource_kind","resource_id");--> statement-breakpoint
CREATE INDEX "production_ref_resource" ON "production_references" USING btree ("resource_kind","resource_id");--> statement-breakpoint
CREATE INDEX "productions_owner_updated" ON "productions" USING btree ("owner_user_id","updated_at");