CREATE TABLE "account_deletion_proofs" (
	"user_id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"session_hash" text NOT NULL,
	"credential_hash" text NOT NULL,
	"google_subject" text NOT NULL,
	"expires_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_deletions" (
	"user_id" text PRIMARY KEY NOT NULL,
	"deleted_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "image_deletion_jobs" (
	"image_id" text PRIMARY KEY NOT NULL,
	"storage_provider" text NOT NULL,
	"storage_key" text,
	"remote_url" text,
	"state" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "image_deletion_jobs_due_idx" ON "image_deletion_jobs" USING btree ("state","next_attempt_at");
--> statement-breakpoint
-- Row locks serialize late writes with account deletion. Check after acquiring the
-- lock so READ COMMITTED observes a deletion that committed while we waited.
CREATE FUNCTION mc_require_undeleted_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id text := to_jsonb(NEW)->>TG_ARGV[0];
BEGIN
  IF owner_id IS NULL THEN RETURN NEW; END IF;
  PERFORM id FROM users WHERE id=owner_id FOR SHARE;
  IF EXISTS (SELECT 1 FROM account_deletions WHERE user_id=owner_id) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETED' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE spec record;
BEGIN
  FOR spec IN SELECT * FROM (VALUES
    ('users','id'), ('garments','user_id'), ('outfits','user_id'),
    ('calendar_entries','user_id'), ('images','user_id'), ('sessions','user_id'),
    ('auth_accounts','user_id'), ('password_reset_tokens','user_id'),
    ('email_change_tokens','user_id'), ('account_deletion_proofs','user_id'),
    ('wardrobe_shares','grantor_id')
  ) AS owners(table_name, column_name) LOOP
    EXECUTE format('CREATE TRIGGER account_active_owner BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION mc_require_undeleted_owner(%L)', spec.table_name, spec.column_name);
  END LOOP;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER account_active_grantee BEFORE INSERT OR UPDATE ON wardrobe_shares
FOR EACH ROW EXECUTE FUNCTION mc_require_undeleted_owner('grantee_id');
--> statement-breakpoint
CREATE FUNCTION mc_require_available_image() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE photo text := to_jsonb(NEW)->>TG_ARGV[0];
BEGIN
  IF photo IS NULL THEN RETURN NEW; END IF;
  -- Same image -> job locking order as the cleanup worker.
  PERFORM id FROM images WHERE id=photo FOR SHARE;
  PERFORM image_id FROM image_deletion_jobs WHERE image_id=photo FOR SHARE;
  IF EXISTS (SELECT 1 FROM image_deletion_jobs WHERE image_id=photo AND state IN ('PROCESSING','DONE','BLOCKED')) THEN
    RAISE EXCEPTION 'IMAGE_DELETING' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER account_image_guard BEFORE INSERT OR UPDATE ON garments
FOR EACH ROW EXECUTE FUNCTION mc_require_available_image('photo_id');
--> statement-breakpoint
CREATE TRIGGER account_image_guard BEFORE INSERT OR UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION mc_require_available_image('profile_image_id');
--> statement-breakpoint
CREATE FUNCTION mc_require_available_asset() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Lock original identities too: a new image ID may reuse a shared storage key.
  PERFORM id FROM images WHERE id=NEW.id
    OR (storage_provider=NEW.storage_provider AND storage_key=NEW.storage_key)
    OR (remote_url IS NOT NULL AND remote_url=NEW.remote_url)
    ORDER BY id FOR SHARE;
  PERFORM image_id FROM image_deletion_jobs WHERE image_id=NEW.id
    OR (storage_provider=NEW.storage_provider AND storage_key=NEW.storage_key)
    OR (remote_url IS NOT NULL AND remote_url=NEW.remote_url)
    ORDER BY image_id FOR SHARE;
  IF EXISTS (SELECT 1 FROM image_deletion_jobs WHERE state IN ('PROCESSING','DONE','BLOCKED') AND
    (image_id=NEW.id OR (storage_provider=NEW.storage_provider AND storage_key=NEW.storage_key)
      OR (remote_url IS NOT NULL AND remote_url=NEW.remote_url))) THEN
    RAISE EXCEPTION 'IMAGE_DELETING' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER account_image_guard BEFORE INSERT OR UPDATE ON images
FOR EACH ROW EXECUTE FUNCTION mc_require_available_asset();
