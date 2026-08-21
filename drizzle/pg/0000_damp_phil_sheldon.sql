CREATE TABLE "account_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"created_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"accepted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "account_invitations_role_check" CHECK ("account_invitations"."role" IN ('USER', 'ADMIN'))
);
--> statement-breakpoint
CREATE TABLE "auth_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_subject" text NOT NULL,
	"provider_email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_accounts_provider_check" CHECK ("auth_accounts"."provider" = 'GOOGLE')
);
--> statement-breakpoint
CREATE TABLE "calendar_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"date" text NOT NULL,
	"outfit_id" text NOT NULL,
	"worn_at" text,
	"notes" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "garments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"shareable_id" text NOT NULL,
	"name" text,
	"category" text NOT NULL,
	"colors" text DEFAULT '[]' NOT NULL,
	"brand" text,
	"size" text,
	"notes" text,
	"washing_instructions" text,
	"date_acquired" text,
	"archived" boolean DEFAULT false NOT NULL,
	"favorite" boolean DEFAULT false NOT NULL,
	"photo_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "images" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"mime_type" text NOT NULL,
	"width" integer,
	"height" integer,
	"byte_size" integer NOT NULL,
	"data" text,
	"remote_url" text,
	"storage_provider" text DEFAULT 'local' NOT NULL,
	"storage_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "images_storage_provider_check" CHECK ("images"."storage_provider" IN ('local', 'cloudinary'))
);
--> statement-breakpoint
CREATE TABLE "outfits" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"shareable_id" text NOT NULL,
	"name" text,
	"notes" text,
	"slots" text DEFAULT '[]' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'USER' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"admin_slot" integer,
	"profile_image_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_role_check" CHECK ("users"."role" IN ('USER', 'ADMIN')),
	CONSTRAINT "users_status_check" CHECK ("users"."status" IN ('ACTIVE', 'DISABLED')),
	CONSTRAINT "users_admin_state_check" CHECK ((("users"."role" = 'ADMIN' AND "users"."status" = 'ACTIVE' AND "users"."admin_slot" IN (1, 2)) OR (("users"."role" <> 'ADMIN' OR "users"."status" <> 'ACTIVE') AND "users"."admin_slot" IS NULL)))
);
--> statement-breakpoint
CREATE TABLE "wardrobe_shares" (
	"id" text PRIMARY KEY NOT NULL,
	"grantor_id" text NOT NULL,
	"grantee_id" text,
	"grantee_email" text,
	"permission" text NOT NULL,
	"invite_token" text NOT NULL,
	"accepted_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" text,
	CONSTRAINT "wardrobe_shares_permission_check" CHECK ("wardrobe_shares"."permission" IN ('VIEW', 'MANAGE'))
);
--> statement-breakpoint
ALTER TABLE "account_invitations" ADD CONSTRAINT "account_invitations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_invitations" ADD CONSTRAINT "account_invitations_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_entries" ADD CONSTRAINT "calendar_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "garments" ADD CONSTRAINT "garments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outfits" ADD CONSTRAINT "outfits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wardrobe_shares" ADD CONSTRAINT "wardrobe_shares_grantor_id_users_id_fk" FOREIGN KEY ("grantor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_invitations_email_idx" ON "account_invitations" USING btree ("email");--> statement-breakpoint
CREATE INDEX "account_invitations_created_by_idx" ON "account_invitations" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_accounts_provider_subject_unique" ON "auth_accounts" USING btree ("provider","provider_subject");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_accounts_user_provider_unique" ON "auth_accounts" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "calendar_user_date_idx" ON "calendar_entries" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "calendar_updated_idx" ON "calendar_entries" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "garments_user_idx" ON "garments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "garments_updated_idx" ON "garments" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "images_user_updated_idx" ON "images" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "outfits_user_idx" ON "outfits" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "outfits_updated_idx" ON "outfits" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_idx" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_expiry_idx" ON "password_reset_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_admin_slot_unique" ON "users" USING btree ("admin_slot");--> statement-breakpoint
CREATE UNIQUE INDEX "shares_grantor_invite_idx" ON "wardrobe_shares" USING btree ("grantor_id","invite_token");--> statement-breakpoint
CREATE INDEX "shares_updated_idx" ON "wardrobe_shares" USING btree ("updated_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_last_active_admin() RETURNS trigger AS $$
BEGIN
  IF OLD.role = 'ADMIN' AND OLD.status = 'ACTIVE' THEN
    IF TG_OP = 'DELETE' OR NEW.role <> 'ADMIN' OR NEW.status <> 'ACTIVE' THEN
      IF (SELECT COUNT(*) FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' AND id <> OLD.id) = 0 THEN
        RAISE EXCEPTION 'No se puede eliminar o desactivar el último administrador activo';
      END IF;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER users_last_admin_update
BEFORE UPDATE OF role, status ON users
FOR EACH ROW EXECUTE FUNCTION protect_last_active_admin();
--> statement-breakpoint
CREATE TRIGGER users_last_admin_delete
BEFORE DELETE ON users
FOR EACH ROW EXECUTE FUNCTION protect_last_active_admin();
