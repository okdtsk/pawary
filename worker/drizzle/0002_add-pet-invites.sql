CREATE TABLE `pet_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`pet_id` text NOT NULL,
	`role` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`used_by` text,
	FOREIGN KEY (`pet_id`) REFERENCES `pets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`used_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pet_invites_token_hash_unique` ON `pet_invites` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_pet_invites_pet` ON `pet_invites` (`pet_id`);