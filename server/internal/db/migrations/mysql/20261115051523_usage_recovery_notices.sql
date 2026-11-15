-- Modify "budget_events" table
ALTER TABLE `budget_events` MODIFY COLUMN `kind` enum('policy','reserve','settle','resolve','pending','late_usage') NOT NULL;
-- Modify "usage_requests" table
ALTER TABLE `usage_requests` MODIFY COLUMN `state` enum('running','settled','unpriced','pending','failed','estimated') NOT NULL DEFAULT "running", ADD COLUMN `deadline_at` datetime(6) NULL;
-- Create "budget_notices" table
CREATE TABLE `budget_notices` (`id` varchar(32) NOT NULL, `created_at` datetime(6) NOT NULL, `team_id` varchar(32) NOT NULL, `window_id` varchar(32) NOT NULL, `recipient_id` varchar(32) NOT NULL, `threshold` bigint NOT NULL, `data` json NOT NULL, `state` enum('pending','sending','sent','failed','skipped') NOT NULL DEFAULT "pending", `lease_id` varchar(32) NOT NULL DEFAULT "", `lease_until` datetime(6) NULL, `next_at` datetime(6) NOT NULL, `attempts` bigint NOT NULL DEFAULT 0, `last_error` varchar(64) NOT NULL DEFAULT "", PRIMARY KEY (`id`), INDEX `budgetnotice_state_next_at` (`state`, `next_at`), UNIQUE INDEX `budgetnotice_window_id_recipient_id_threshold` (`window_id`, `recipient_id`, `threshold`)) CHARSET utf8mb4 COLLATE utf8mb4_bin;
