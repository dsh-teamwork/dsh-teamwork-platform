-- Create "asset_exclusions" table
CREATE TABLE `asset_exclusions` (`id` text NOT NULL, `created_at` datetime NOT NULL, `team_id` text NOT NULL, `user_id` text NOT NULL, `config_id` text NOT NULL, `host_id` text NOT NULL, PRIMARY KEY (`id`));
-- Create index "assetexclusion_team_id_user_id_config_id_host_id" to table: "asset_exclusions"
CREATE UNIQUE INDEX `assetexclusion_team_id_user_id_config_id_host_id` ON `asset_exclusions` (`team_id`, `user_id`, `config_id`, `host_id`);
-- Create index "assetexclusion_host_id" to table: "asset_exclusions"
CREATE INDEX `assetexclusion_host_id` ON `asset_exclusions` (`host_id`);
