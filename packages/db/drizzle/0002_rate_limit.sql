CREATE TABLE IF NOT EXISTS "zenhyre2"."rate_limit" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
