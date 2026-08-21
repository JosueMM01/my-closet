CREATE TABLE `auth_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_subject` text NOT NULL,
	`provider_email` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "auth_accounts_provider_check" CHECK(`provider` = 'GOOGLE')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_accounts_provider_subject_unique` ON `auth_accounts` (`provider`,`provider_subject`);--> statement-breakpoint
CREATE UNIQUE INDEX `auth_accounts_user_provider_unique` ON `auth_accounts` (`user_id`,`provider`);
