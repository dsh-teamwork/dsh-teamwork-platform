-- Add column "deadline_at" to table: "usage_requests"
ALTER TABLE `usage_requests` ADD COLUMN `deadline_at` datetime NULL;
-- Create "budget_notices" table
CREATE TABLE `budget_notices` (`id` text NOT NULL, `created_at` datetime NOT NULL, `team_id` text NOT NULL, `window_id` text NOT NULL, `recipient_id` text NOT NULL, `threshold` integer NOT NULL, `data` json NOT NULL, `state` text NOT NULL DEFAULT ('pending'), `lease_id` text NOT NULL DEFAULT (''), `lease_until` datetime NULL, `next_at` datetime NOT NULL, `attempts` integer NOT NULL DEFAULT (0), `last_error` text NOT NULL DEFAULT (''), PRIMARY KEY (`id`));
-- Create index "budgetnotice_window_id_recipient_id_threshold" to table: "budget_notices"
CREATE UNIQUE INDEX `budgetnotice_window_id_recipient_id_threshold` ON `budget_notices` (`window_id`, `recipient_id`, `threshold`);
-- Create index "budgetnotice_state_next_at" to table: "budget_notices"
CREATE INDEX `budgetnotice_state_next_at` ON `budget_notices` (`state`, `next_at`);
