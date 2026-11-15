-- Disable the enforcement of foreign-keys constraints
PRAGMA foreign_keys = off;
-- Create "new_team_configs" table
CREATE TABLE `new_team_configs` (`id` text NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `kind` text NOT NULL, `name` text NOT NULL, `data` json NOT NULL, `route_owner` text NOT NULL DEFAULT (''), `route_reference` text NOT NULL DEFAULT (''), `version` integer NOT NULL DEFAULT (1), `team_id` text NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `team_configs_teams_configs` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`) ON DELETE CASCADE);
-- Copy rows from old table "team_configs" to new temporary table "new_team_configs"
INSERT INTO `new_team_configs` (`id`, `created_at`, `updated_at`, `kind`, `name`, `data`, `version`, `team_id`) SELECT `id`, `created_at`, `updated_at`, `kind`, `name`, `data`, `version`, `team_id` FROM `team_configs`;
-- Drop "team_configs" table after copying rows
DROP TABLE `team_configs`;
-- Rename temporary table "new_team_configs" to "team_configs"
ALTER TABLE `new_team_configs` RENAME TO `team_configs`;
-- Create index "teamconfig_team_id_kind_name" to table: "team_configs"
CREATE UNIQUE INDEX `teamconfig_team_id_kind_name` ON `team_configs` (`team_id`, `kind`, `name`);
-- Create "new_usage_requests" table
CREATE TABLE `new_usage_requests` (`id` text NOT NULL, `created_at` datetime NOT NULL, `team_id` text NOT NULL, `user_id` text NOT NULL, `app_url` text NOT NULL DEFAULT (''), `submitted_config_id` text NOT NULL, `config_id` text NOT NULL, `provider` text NOT NULL, `model` text NOT NULL, `stream` bool NOT NULL, `state` text NOT NULL DEFAULT ('running'), `deadline_at` datetime NULL, `rate_id` text NOT NULL DEFAULT (''), `route_owner` text NOT NULL DEFAULT (''), `rates` json NULL, `point_units` integer NULL, `input_tokens` integer NULL, `cache_read_tokens` integer NULL, `cache_write_tokens` integer NULL, `output_tokens` integer NULL, `reasoning_tokens` integer NULL, `provider_request_id` text NOT NULL DEFAULT (''), `error_code` text NOT NULL DEFAULT (''), `finished_at` datetime NULL, PRIMARY KEY (`id`));
-- Copy rows from old table "usage_requests" to new temporary table "new_usage_requests"
INSERT INTO `new_usage_requests` (`id`, `created_at`, `team_id`, `user_id`, `app_url`, `submitted_config_id`, `config_id`, `provider`, `model`, `stream`, `state`, `deadline_at`, `rate_id`, `rates`, `point_units`, `input_tokens`, `cache_read_tokens`, `cache_write_tokens`, `output_tokens`, `reasoning_tokens`, `provider_request_id`, `error_code`, `finished_at`) SELECT `id`, `created_at`, `team_id`, `user_id`, `app_url`, `submitted_config_id`, `config_id`, `provider`, `model`, `stream`, `state`, `deadline_at`, `rate_id`, `rates`, `point_units`, `input_tokens`, `cache_read_tokens`, `cache_write_tokens`, `output_tokens`, `reasoning_tokens`, `provider_request_id`, `error_code`, `finished_at` FROM `usage_requests`;
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
