CREATE TABLE "email_change_tokens" (
	"user_id" text PRIMARY KEY NOT NULL,
	"new_email" text NOT NULL,
	"original_email" text NOT NULL,
	"credential_hash" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_change_tokens" ADD CONSTRAINT "email_change_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;