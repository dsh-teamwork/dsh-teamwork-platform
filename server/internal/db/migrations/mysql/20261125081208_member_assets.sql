-- Modify "team_configs" table
ALTER TABLE `team_configs` ADD COLUMN `asset_owner_id` varchar(32) NOT NULL DEFAULT "", ADD COLUMN `asset_archived` bool NOT NULL DEFAULT 0, ADD UNIQUE INDEX `teamconfig_team_id_kind_asset_owner_id_name` (`team_id`, `kind`, `asset_owner_id`, `name`);
ALTER TABLE `team_configs` DROP INDEX `teamconfig_team_id_kind_name`;
-- Create "asset_selections" table
CREATE TABLE `asset_selections` (`id` varchar(32) NOT NULL, `created_at` datetime(6) NOT NULL, `updated_at` datetime(6) NOT NULL, `team_id` varchar(32) NOT NULL, `config_id` varchar(32) NOT NULL, `user_id` varchar(32) NOT NULL, `version` bigint NOT NULL DEFAULT 0, `disabled` bool NOT NULL DEFAULT 0, `name` varchar(480) NOT NULL DEFAULT "", PRIMARY KEY (`id`), UNIQUE INDEX `assetselection_team_id_user_id_config_id` (`team_id`, `user_id`, `config_id`)) CHARSET utf8mb4 COLLATE utf8mb4_bin;
