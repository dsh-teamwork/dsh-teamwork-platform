-- Disable the enforcement of foreign-keys constraints
PRAGMA foreign_keys = off;
-- Create "new_budget_policies" table
CREATE TABLE `new_budget_policies` (`id` text NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `team_id` text NOT NULL, `scope` text NOT NULL, `subject_id` text NOT NULL DEFAULT (''), `period` text NOT NULL, `timezone` text NOT NULL, `previous_timezone` text NOT NULL DEFAULT (''), `timezone_effective_at` datetime NULL, `point_limit` integer NULL, `input_limit` integer NULL, `output_limit` integer NULL, `total_limit` integer NULL, `enabled` bool NOT NULL DEFAULT (true), `notify` text NOT NULL DEFAULT ('admins'), `revision` integer NOT NULL DEFAULT (1), PRIMARY KEY (`id`));
-- Copy rows from old table "budget_policies" to new temporary table "new_budget_policies"
INSERT INTO `new_budget_policies` (`id`, `created_at`, `updated_at`, `team_id`, `scope`, `subject_id`, `period`, `timezone`, `previous_timezone`, `timezone_effective_at`, `point_limit`, `input_limit`, `output_limit`, `total_limit`, `enabled`, `revision`) SELECT `id`, `created_at`, `updated_at`, `team_id`, `scope`, `subject_id`, `period`, `timezone`, `previous_timezone`, `timezone_effective_at`, `point_limit`, `input_limit`, `output_limit`, `total_limit`, `enabled`, `revision` FROM `budget_policies`;
-- Drop "budget_policies" table after copying rows
DROP TABLE `budget_policies`;
-- Rename temporary table "new_budget_policies" to "budget_policies"
ALTER TABLE `new_budget_policies` RENAME TO `budget_policies`;
-- Create index "budgetpolicy_team_id_scope_subject_id_period" to table: "budget_policies"
CREATE UNIQUE INDEX `budgetpolicy_team_id_scope_subject_id_period` ON `budget_policies` (`team_id`, `scope`, `subject_id`, `period`);
-- Enable back the enforcement of foreign-keys constraints
PRAGMA foreign_keys = on;
