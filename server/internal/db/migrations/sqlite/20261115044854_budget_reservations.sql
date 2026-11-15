-- Create "budget_events" table
CREATE TABLE `budget_events` (`id` text NOT NULL, `created_at` datetime NOT NULL, `team_id` text NOT NULL, `window_id` text NOT NULL DEFAULT (''), `request_id` text NOT NULL DEFAULT (''), `policy_id` text NOT NULL DEFAULT (''), `action_key` text NOT NULL, `actor_id` text NOT NULL DEFAULT (''), `kind` text NOT NULL, `data` json NOT NULL, PRIMARY KEY (`id`));
-- Create index "budget_events_action_key_key" to table: "budget_events"
CREATE UNIQUE INDEX `budget_events_action_key_key` ON `budget_events` (`action_key`);
-- Create index "budgetevent_team_id_created_at" to table: "budget_events"
CREATE INDEX `budgetevent_team_id_created_at` ON `budget_events` (`team_id`, `created_at`);
-- Create index "budgetevent_window_id_created_at" to table: "budget_events"
CREATE INDEX `budgetevent_window_id_created_at` ON `budget_events` (`window_id`, `created_at`);
-- Create "budget_gates" table
CREATE TABLE `budget_gates` (`id` text NOT NULL, `created_at` datetime NOT NULL, `revision` integer NOT NULL DEFAULT (0), PRIMARY KEY (`id`));
-- Create "budget_policies" table
CREATE TABLE `budget_policies` (`id` text NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `team_id` text NOT NULL, `scope` text NOT NULL, `subject_id` text NOT NULL DEFAULT (''), `period` text NOT NULL, `timezone` text NOT NULL, `previous_timezone` text NOT NULL DEFAULT (''), `timezone_effective_at` datetime NULL, `point_limit` integer NULL, `input_limit` integer NULL, `output_limit` integer NULL, `total_limit` integer NULL, `enabled` bool NOT NULL DEFAULT (true), `revision` integer NOT NULL DEFAULT (1), PRIMARY KEY (`id`));
-- Create index "budgetpolicy_team_id_scope_subject_id_period" to table: "budget_policies"
CREATE UNIQUE INDEX `budgetpolicy_team_id_scope_subject_id_period` ON `budget_policies` (`team_id`, `scope`, `subject_id`, `period`);
-- Create "budget_reservations" table
CREATE TABLE `budget_reservations` (`id` text NOT NULL, `created_at` datetime NOT NULL, `request_id` text NOT NULL, `window_id` text NOT NULL, `policy_id` text NOT NULL, `policy_revision` integer NOT NULL, `point_units` integer NOT NULL DEFAULT (0), `input_tokens` integer NOT NULL DEFAULT (0), `output_tokens` integer NOT NULL DEFAULT (0), `unbounded` bool NOT NULL DEFAULT (false), `unpriced` bool NOT NULL DEFAULT (false), `settled` bool NOT NULL DEFAULT (false), PRIMARY KEY (`id`));
-- Create index "budgetreservation_request_id_window_id" to table: "budget_reservations"
CREATE UNIQUE INDEX `budgetreservation_request_id_window_id` ON `budget_reservations` (`request_id`, `window_id`);
-- Create index "budgetreservation_window_id_settled" to table: "budget_reservations"
CREATE INDEX `budgetreservation_window_id_settled` ON `budget_reservations` (`window_id`, `settled`);
-- Create "budget_windows" table
CREATE TABLE `budget_windows` (`id` text NOT NULL, `created_at` datetime NOT NULL, `team_id` text NOT NULL, `scope` text NOT NULL, `subject_id` text NOT NULL DEFAULT (''), `period` text NOT NULL, `starts_at` datetime NOT NULL, `ends_at` datetime NOT NULL, `spent_units` integer NOT NULL DEFAULT (0), `reserved_units` integer NOT NULL DEFAULT (0), `spent_input` integer NOT NULL DEFAULT (0), `reserved_input` integer NOT NULL DEFAULT (0), `spent_output` integer NOT NULL DEFAULT (0), `reserved_output` integer NOT NULL DEFAULT (0), `unpriced_count` integer NOT NULL DEFAULT (0), `unbounded_count` integer NOT NULL DEFAULT (0), PRIMARY KEY (`id`));
-- Create index "budgetwindow_team_id_scope_subject_id_period_starts_at" to table: "budget_windows"
CREATE UNIQUE INDEX `budgetwindow_team_id_scope_subject_id_period_starts_at` ON `budget_windows` (`team_id`, `scope`, `subject_id`, `period`, `starts_at`);
-- Create index "budgetwindow_team_id_ends_at" to table: "budget_windows"
CREATE INDEX `budgetwindow_team_id_ends_at` ON `budget_windows` (`team_id`, `ends_at`);
