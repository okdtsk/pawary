CREATE TABLE `activities` (
	`id` text PRIMARY KEY NOT NULL,
	`pet_id` text NOT NULL,
	`category` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`tz_offset_min` integer NOT NULL,
	`memo` text,
	`details` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`pet_id`) REFERENCES `pets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_activities_pet_time` ON `activities` (`pet_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_activities_pet_cat_time` ON `activities` (`pet_id`,`category`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `activity_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`activity_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`width` integer,
	`height` integer,
	`content_type` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`pet_id` text NOT NULL,
	`user_id` text NOT NULL,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`diff` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `care_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`pet_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`category_link` text NOT NULL,
	`details_template` text NOT NULL,
	`recurrence_unit` text NOT NULL,
	`recurrence_n` integer,
	`next_due_at` integer NOT NULL,
	`end_at` integer,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`pet_id`) REFERENCES `pets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_schedules_pet_active_due` ON `care_schedules` (`pet_id`,`active`,`next_due_at`);--> statement-breakpoint
CREATE TABLE `pet_members` (
	`pet_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`pet_id`, `user_id`),
	FOREIGN KEY (`pet_id`) REFERENCES `pets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pet_targets` (
	`pet_id` text PRIMARY KEY NOT NULL,
	`food_g_per_day` real,
	`water_ml_per_day` real,
	FOREIGN KEY (`pet_id`) REFERENCES `pets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`species` text NOT NULL,
	`breed` text,
	`sex` text,
	`birthday` text,
	`avatar_r2_key` text,
	`archived_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `quick_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`pet_id` text NOT NULL,
	`category` text NOT NULL,
	`label` text NOT NULL,
	`details` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`pet_id`) REFERENCES `pets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`csrf_token` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`google_sub` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`avatar_url` text,
	`locale` text DEFAULT 'system' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_google_sub_unique` ON `users` (`google_sub`);