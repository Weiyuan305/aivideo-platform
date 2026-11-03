CREATE TABLE "provider_events" (
	"id" text PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
