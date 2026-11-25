-- Disable the enforcement of foreign-keys constraints
PRAGMA foreign_keys = off;
-- Create "new_team_configs" table
CREATE TABLE `new_team_configs` (`id` text NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `kind` text NOT NULL, `name` text NOT NULL, `builtin` text NULL, `data` json NOT NULL, `route_owner` text NOT NULL DEFAULT (''), `route_reference` text NOT NULL DEFAULT (''), `version` integer NOT NULL DEFAULT (1), `asset_owner_id` text NOT NULL DEFAULT (''), `asset_archived` bool NOT NULL DEFAULT (false), `team_id` text NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `team_configs_teams_configs` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`) ON DELETE CASCADE);
-- Copy rows from old table "team_configs" to new temporary table "new_team_configs"
INSERT INTO `new_team_configs` (`id`, `created_at`, `updated_at`, `kind`, `name`, `builtin`, `data`, `route_owner`, `route_reference`, `version`, `team_id`) SELECT `id`, `created_at`, `updated_at`, `kind`, `name`, `builtin`, `data`, `route_owner`, `route_reference`, `version`, `team_id` FROM `team_configs`;
-- Drop "team_configs" table after copying rows
DROP TABLE `team_configs`;
-- Rename temporary table "new_team_configs" to "team_configs"
ALTER TABLE `new_team_configs` RENAME TO `team_configs`;
-- Create index "teamconfig_team_id_kind_asset_owner_id_name" to table: "team_configs"
CREATE UNIQUE INDEX `teamconfig_team_id_kind_asset_owner_id_name` ON `team_configs` (`team_id`, `kind`, `asset_owner_id`, `name`);
-- Create index "teamconfig_team_id_builtin" to table: "team_configs"
CREATE UNIQUE INDEX `teamconfig_team_id_builtin` ON `team_configs` (`team_id`, `builtin`);
-- Create "asset_selections" table
CREATE TABLE `asset_selections` (`id` text NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `team_id` text NOT NULL, `config_id` text NOT NULL, `user_id` text NOT NULL, `version` integer NOT NULL DEFAULT (0), `disabled` bool NOT NULL DEFAULT (false), `name` text NOT NULL DEFAULT (''), PRIMARY KEY (`id`));
-- Create index "assetselection_team_id_user_id_config_id" to table: "asset_selections"
CREATE UNIQUE INDEX `assetselection_team_id_user_id_config_id` ON `asset_selections` (`team_id`, `user_id`, `config_id`);
-- Enable back the enforcement of foreign-keys constraints
PRAGMA foreign_keys = on;
