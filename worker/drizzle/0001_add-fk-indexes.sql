CREATE INDEX `idx_activity_photos_activity` ON `activity_photos` (`activity_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_pet` ON `audit_log` (`pet_id`);--> statement-breakpoint
CREATE INDEX `idx_pet_members_user` ON `pet_members` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_quick_presets_pet` ON `quick_presets` (`pet_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_user` ON `sessions` (`user_id`);