CREATE TABLE `calendar_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`outfit_id` text NOT NULL,
	`worn_at` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `calendar_user_date_idx` ON `calendar_entries` (`user_id`,`date`);--> statement-breakpoint
CREATE INDEX `calendar_updated_idx` ON `calendar_entries` (`updated_at`);--> statement-breakpoint
CREATE TABLE `garments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`shareable_id` text NOT NULL,
	`name` text,
	`category` text NOT NULL,
	`colors` text DEFAULT '[]' NOT NULL,
	`brand` text,
	`size` text,
	`notes` text,
	`washing_instructions` text,
	`date_acquired` text,
	`archived` integer DEFAULT false NOT NULL,
	`photo_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `garments_user_idx` ON `garments` (`user_id`);--> statement-breakpoint
CREATE INDEX `garments_updated_idx` ON `garments` (`updated_at`);--> statement-breakpoint
CREATE TABLE `images` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`data` blob NOT NULL,
	`remote_url` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `outfits` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`shareable_id` text NOT NULL,
	`name` text,
	`notes` text,
	`slots` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `outfits_user_idx` ON `outfits` (`user_id`);--> statement-breakpoint
CREATE INDEX `outfits_updated_idx` ON `outfits` (`updated_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `wardrobe_shares` (
	`id` text PRIMARY KEY NOT NULL,
	`grantor_id` text NOT NULL,
	`grantee_id` text,
	`grantee_email` text,
	`permission` text NOT NULL,
	`invite_token` text NOT NULL,
	`accepted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`grantor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shares_grantor_invite_idx` ON `wardrobe_shares` (`grantor_id`,`invite_token`);--> statement-breakpoint
CREATE INDEX `shares_updated_idx` ON `wardrobe_shares` (`updated_at`);