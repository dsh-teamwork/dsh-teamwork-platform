-- Create "model_rates" table
CREATE TABLE `model_rates` (`id` text NOT NULL, `created_at` datetime NOT NULL, `team_id` text NOT NULL, `config_id` text NOT NULL, `provider` text NOT NULL, `model` text NOT NULL, `revision` integer NOT NULL, `basis` text NOT NULL, `input_rate` integer NOT NULL, `cache_read_rate` integer NOT NULL, `cache_write_rate` integer NOT NULL, `output_rate` integer NOT NULL, `actor_id` text NOT NULL, PRIMARY KEY (`id`));
-- Create index "modelrate_team_id_config_id_revision" to table: "model_rates"
CREATE UNIQUE INDEX `modelrate_team_id_config_id_revision` ON `model_rates` (`team_id`, `config_id`, `revision`);
-- Create "usage_requests" table
CREATE TABLE `usage_requests` (`id` text NOT NULL, `created_at` datetime NOT NULL, `team_id` text NOT NULL, `user_id` text NOT NULL, `submitted_config_id` text NOT NULL, `config_id` text NOT NULL, `provider` text NOT NULL, `model` text NOT NULL, `stream` bool NOT NULL, `state` text NOT NULL DEFAULT ('running'), `rate_id` text NOT NULL DEFAULT (''), `rates` json NULL, `point_units` integer NULL, `input_tokens` integer NULL, `cache_read_tokens` integer NULL, `cache_write_tokens` integer NULL, `output_tokens` integer NULL, `reasoning_tokens` integer NULL, `provider_request_id` text NOT NULL DEFAULT (''), `error_code` text NOT NULL DEFAULT (''), `finished_at` datetime NULL, PRIMARY KEY (`id`));
-- Create index "usagerequest_team_id_created_at" to table: "usage_requests"
CREATE INDEX `usagerequest_team_id_created_at` ON `usage_requests` (`team_id`, `created_at`);
-- Create index "usagerequest_team_id_user_id_created_at" to table: "usage_requests"
CREATE INDEX `usagerequest_team_id_user_id_created_at` ON `usage_requests` (`team_id`, `user_id`, `created_at`);
-- Create index "usagerequest_team_id_config_id_created_at" to table: "usage_requests"
CREATE INDEX `usagerequest_team_id_config_id_created_at` ON `usage_requests` (`team_id`, `config_id`, `created_at`);
-- Create index "usagerequest_state_created_at" to table: "usage_requests"
CREATE INDEX `usagerequest_state_created_at` ON `usage_requests` (`state`, `created_at`);
