CREATE TABLE IF NOT EXISTS "auth_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"provider" text NOT NULL,
	"provider_subject" text NOT NULL,
	"provider_email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_accounts_provider_check" CHECK("auth_accounts"."provider" = 'GOOGLE')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_accounts_provider_subject_unique" ON "auth_accounts" ("provider", "provider_subject");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_accounts_user_provider_unique" ON "auth_accounts" ("user_id", "provider");
