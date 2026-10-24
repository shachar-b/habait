CREATE TABLE `app_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`app_title` text DEFAULT 'הבית שלנו' NOT NULL,
	`announcement_text` text,
	`announcement_emoji` text,
	`announcement_updated_by` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`announcement_updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "app_settings_singleton" CHECK("app_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `one_off_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`assignee_id` integer NOT NULL,
	`created_by_id` integer NOT NULL,
	`title` text NOT NULL,
	`icon_emoji` text NOT NULL,
	`stars` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`issued_date` text NOT NULL,
	`issued_at` integer NOT NULL,
	`finished_date` text,
	`finished_at` integer,
	FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "one_off_tasks_stars_nonneg" CHECK("one_off_tasks"."stars" >= 0),
	CONSTRAINT "one_off_tasks_status_valid" CHECK("one_off_tasks"."status" IN ('PENDING', 'COMPLETED', 'CANCELED'))
);
--> statement-breakpoint
CREATE INDEX `one_off_tasks_assignee_status_idx` ON `one_off_tasks` (`assignee_id`,`status`);--> statement-breakpoint
CREATE INDEX `one_off_tasks_finished_date_idx` ON `one_off_tasks` (`finished_date`);--> statement-breakpoint
CREATE TABLE `peer_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`requester_id` integer NOT NULL,
	`recipient_id` integer NOT NULL,
	`title` text NOT NULL,
	`icon_emoji` text DEFAULT '🤝' NOT NULL,
	`status` text NOT NULL,
	`issued_date` text NOT NULL,
	`issued_at` integer NOT NULL,
	`finished_date` text,
	`finished_at` integer,
	FOREIGN KEY (`requester_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipient_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "peer_requests_not_self" CHECK("peer_requests"."requester_id" <> "peer_requests"."recipient_id"),
	CONSTRAINT "peer_requests_status_valid" CHECK("peer_requests"."status" IN ('PENDING', 'COMPLETED', 'DECLINED', 'CANCELED'))
);
--> statement-breakpoint
CREATE INDEX `peer_requests_recipient_status_idx` ON `peer_requests` (`recipient_id`,`status`);--> statement-breakpoint
CREATE INDEX `peer_requests_finished_date_idx` ON `peer_requests` (`finished_date`);--> statement-breakpoint
CREATE TABLE `pool_task_executions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pool_task_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`title_snapshot` text NOT NULL,
	`icon_emoji_snapshot` text NOT NULL,
	`stars_awarded` integer NOT NULL,
	`claimed_at` integer NOT NULL,
	`completed_at` integer NOT NULL,
	`logical_date` text NOT NULL,
	`reverted_at` integer,
	FOREIGN KEY (`pool_task_id`) REFERENCES `pool_tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "pool_task_executions_stars_nonneg" CHECK("pool_task_executions"."stars_awarded" >= 0)
);
--> statement-breakpoint
CREATE INDEX `pool_task_executions_date_idx` ON `pool_task_executions` (`logical_date`);--> statement-breakpoint
CREATE INDEX `pool_task_executions_user_date_idx` ON `pool_task_executions` (`user_id`,`logical_date`);--> statement-breakpoint
CREATE INDEX `pool_task_executions_task_idx` ON `pool_task_executions` (`pool_task_id`);--> statement-breakpoint
CREATE TABLE `pool_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`icon_emoji` text NOT NULL,
	`stars` integer NOT NULL,
	`reset_mode` text NOT NULL,
	`cooldown_minutes` integer DEFAULT 60 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`state` text DEFAULT 'AVAILABLE' NOT NULL,
	`claimed_by_user_id` integer,
	`claimed_at` integer,
	`claim_expires_at` integer,
	`cooldown_ends_at` integer,
	`last_completed_at` integer,
	`created_by_id` integer NOT NULL,
	FOREIGN KEY (`claimed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "pool_tasks_stars_nonneg" CHECK("pool_tasks"."stars" >= 0),
	CONSTRAINT "pool_tasks_cooldown_positive" CHECK("pool_tasks"."cooldown_minutes" > 0),
	CONSTRAINT "pool_tasks_state_valid" CHECK("pool_tasks"."state" IN ('AVAILABLE', 'CLAIMED', 'COOLDOWN')),
	CONSTRAINT "pool_tasks_reset_mode_valid" CHECK("pool_tasks"."reset_mode" IN ('COOLDOWN', 'AUTO_DISABLE')),
	CONSTRAINT "pool_tasks_claim_consistent" CHECK(("pool_tasks"."state" = 'CLAIMED') = ("pool_tasks"."claimed_by_user_id" IS NOT NULL AND "pool_tasks"."claimed_at" IS NOT NULL AND "pool_tasks"."claim_expires_at" IS NOT NULL)),
	CONSTRAINT "pool_tasks_cooldown_consistent" CHECK(("pool_tasks"."state" = 'COOLDOWN') = ("pool_tasks"."cooldown_ends_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pool_tasks_one_claim_per_user_uq` ON `pool_tasks` (`claimed_by_user_id`) WHERE "pool_tasks"."state" = 'CLAIMED';--> statement-breakpoint
CREATE INDEX `pool_tasks_active_state_idx` ON `pool_tasks` (`is_active`,`state`);--> statement-breakpoint
CREATE TABLE `routine_daily_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`routine_id` integer NOT NULL,
	`assignee_id` integer NOT NULL,
	`title_snapshot` text NOT NULL,
	`icon_emoji_snapshot` text NOT NULL,
	`time_window_snapshot` text NOT NULL,
	`logical_date` text NOT NULL,
	`status` text NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`routine_id`) REFERENCES `routine_templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "routine_daily_logs_status_valid" CHECK("routine_daily_logs"."status" IN ('COMPLETED', 'MISSED')),
	CONSTRAINT "routine_daily_logs_completed_at" CHECK(("routine_daily_logs"."status" = 'COMPLETED') = ("routine_daily_logs"."completed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `routine_daily_logs_routine_date_uq` ON `routine_daily_logs` (`routine_id`,`logical_date`);--> statement-breakpoint
CREATE INDEX `routine_daily_logs_date_idx` ON `routine_daily_logs` (`logical_date`);--> statement-breakpoint
CREATE INDEX `routine_daily_logs_assignee_date_idx` ON `routine_daily_logs` (`assignee_id`,`logical_date`);--> statement-breakpoint
CREATE TABLE `routine_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`assignee_id` integer NOT NULL,
	`title` text NOT NULL,
	`icon_emoji` text NOT NULL,
	`time_window` text NOT NULL,
	`days_of_week_json` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_by` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "routine_templates_window_valid" CHECK("routine_templates"."time_window" IN ('MORNING', 'AFTERNOON', 'EVENING', 'ALL_DAY')),
	CONSTRAINT "routine_templates_days_json" CHECK(json_valid("routine_templates"."days_of_week_json"))
);
--> statement-breakpoint
CREATE INDEX `routine_templates_assignee_idx` ON `routine_templates` (`assignee_id`,`is_active`);--> statement-breakpoint
CREATE TABLE `star_transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`source_type` text NOT NULL,
	`source_id` integer,
	`stars_delta` integer NOT NULL,
	`description` text NOT NULL,
	`logical_date` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "star_transactions_source_valid" CHECK("star_transactions"."source_type" IN ('ONE_OFF', 'POOL', 'REVERT', 'PARENT_ADJUSTMENT')),
	CONSTRAINT "star_transactions_delta_nonzero" CHECK("star_transactions"."stars_delta" <> 0)
);
--> statement-breakpoint
CREATE INDEX `star_transactions_user_idx` ON `star_transactions` (`user_id`);--> statement-breakpoint
CREATE INDEX `star_transactions_user_date_idx` ON `star_transactions` (`user_id`,`logical_date`);--> statement-breakpoint
CREATE INDEX `star_transactions_date_idx` ON `star_transactions` (`logical_date`);--> statement-breakpoint
CREATE INDEX `star_transactions_created_at_idx` ON `star_transactions` (`created_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`avatar_emoji` text NOT NULL,
	`avatar_bg_color` text NOT NULL,
	`role` text NOT NULL,
	`pin_hash` text,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "users_role_valid" CHECK("users"."role" IN ('PARENT', 'CHILD')),
	CONSTRAINT "users_parent_has_pin" CHECK("users"."role" <> 'PARENT' OR "users"."pin_hash" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `users_active_sort_idx` ON `users` (`is_active`,`sort_order`);