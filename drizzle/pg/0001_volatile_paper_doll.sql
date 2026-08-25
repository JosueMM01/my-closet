ALTER TABLE "calendar_entries" ADD COLUMN "server_updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "garments" ADD COLUMN "server_updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "outfits" ADD COLUMN "server_updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "wardrobe_shares" ADD COLUMN "server_updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "calendar_user_server_updated_idx" ON "calendar_entries" USING btree ("user_id","server_updated_at","id");--> statement-breakpoint
CREATE INDEX "garments_user_server_updated_idx" ON "garments" USING btree ("user_id","server_updated_at","id");--> statement-breakpoint
CREATE INDEX "outfits_user_server_updated_idx" ON "outfits" USING btree ("user_id","server_updated_at","id");--> statement-breakpoint
CREATE INDEX "shares_grantor_server_updated_idx" ON "wardrobe_shares" USING btree ("grantor_id","server_updated_at","id");