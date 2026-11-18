-- Disable the enforcement of foreign-keys constraints
PRAGMA foreign_keys = off;
-- Create "new_usage_requests" table
CREATE TABLE `new_usage_requests` (`id` text NOT NULL, `created_at` datetime NOT NULL, `team_id` text NOT NULL, `user_id` text NOT NULL, `host_id` text NOT NULL DEFAULT (''), `app_url` text NOT NULL DEFAULT (''), `submitted_config_id` text NOT NULL, `config_id` text NOT NULL, `provider` text NOT NULL, `model` text NOT NULL, `stream` bool NOT NULL, `state` text NOT NULL DEFAULT ('running'), `deadline_at` datetime NULL, `rate_id` text NOT NULL DEFAULT (''), `route_owner` text NOT NULL DEFAULT (''), `admitted_units` integer NULL, `admitted_input` integer NULL, `admitted_output` integer NULL, `rates` json NULL, `point_units` integer NULL, `input_tokens` integer NULL, `cache_read_tokens` integer NULL, `cache_write_tokens` integer NULL, `output_tokens` integer NULL, `reasoning_tokens` integer NULL, `provider_request_id` text NOT NULL DEFAULT (''), `error_code` text NOT NULL DEFAULT (''), `finished_at` datetime NULL, `meter` text NOT NULL DEFAULT (''), `quantity` integer NULL, PRIMARY KEY (`id`));
-- Copy rows from old table "usage_requests" to new temporary table "new_usage_requests"
INSERT INTO `new_usage_requests` (`id`, `created_at`, `team_id`, `user_id`, `app_url`, `submitted_config_id`, `config_id`, `provider`, `model`, `stream`, `state`, `deadline_at`, `rate_id`, `route_owner`, `admitted_units`, `admitted_input`, `admitted_output`, `rates`, `point_units`, `input_tokens`, `cache_read_tokens`, `cache_write_tokens`, `output_tokens`, `reasoning_tokens`, `provider_request_id`, `error_code`, `finished_at`, `meter`, `quantity`) SELECT `id`, `created_at`, `team_id`, `user_id`, `app_url`, `submitted_config_id`, `config_id`, `provider`, `model`, `stream`, `state`, `deadline_at`, `rate_id`, `route_owner`, `admitted_units`, `admitted_input`, `admitted_output`, `rates`, `point_units`, `input_tokens`, `cache_read_tokens`, `cache_write_tokens`, `output_tokens`, `reasoning_tokens`, `provider_request_id`, `error_code`, `finished_at`, `meter`, `quantity` FROM `usage_requests`;
-- Drop "usage_requests" table after copying rows
DROP TABLE `usage_requests`;
-- Rename temporary table "new_usage_requests" to "usage_requests"
ALTER TABLE `new_usage_requests` RENAME TO `usage_requests`;
-- Create index "usagerequest_team_id_created_at" to table: "usage_requests"
CREATE INDEX `usagerequest_team_id_created_at` ON `usage_requests` (`team_id`, `created_at`);
-- Create index "usagerequest_team_id_user_id_created_at" to table: "usage_requests"
CREATE INDEX `usagerequest_team_id_user_id_created_at` ON `usage_requests` (`team_id`, `user_id`, `created_at`);
-- Create index "usagerequest_team_id_config_id_created_at" to table: "usage_requests"
CREATE INDEX `usagerequest_team_id_config_id_created_at` ON `usage_requests` (`team_id`, `config_id`, `created_at`);
-- Create index "usagerequest_state_created_at" to table: "usage_requests"
CREATE INDEX `usagerequest_state_created_at` ON `usage_requests` (`state`, `created_at`);
-- Enable back the enforcement of foreign-keys constraints
PRAGMA foreign_keys = on;
