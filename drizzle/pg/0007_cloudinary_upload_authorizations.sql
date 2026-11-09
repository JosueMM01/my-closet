CREATE TABLE "cloudinary_upload_authorizations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"image_id" text NOT NULL,
	"public_id" text NOT NULL,
	"folder" text NOT NULL,
	"signed_at" integer NOT NULL,
	"expires_at" text NOT NULL,
	"state" text DEFAULT 'AUTHORIZED' NOT NULL,
	"next_check_at" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "cloudinary_upload_authorizations_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE INDEX "cloudinary_upload_due_idx" ON "cloudinary_upload_authorizations" USING btree ("state","next_check_at");
--> statement-breakpoint
CREATE FUNCTION mc_revoke_cloudinary_uploads_on_disable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='ACTIVE' AND NEW.status='DISABLED' THEN
    UPDATE cloudinary_upload_authorizations SET state='REVOKED'
      WHERE user_id=NEW.id AND state IN ('AUTHORIZED','FINALIZED');
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER revoke_cloudinary_uploads_on_disable AFTER UPDATE OF status ON users
FOR EACH ROW EXECUTE FUNCTION mc_revoke_cloudinary_uploads_on_disable();
