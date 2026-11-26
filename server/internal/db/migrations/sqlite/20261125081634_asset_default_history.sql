-- Disable the enforcement of foreign-keys constraints
PRAGMA foreign_keys = off;
-- Create "new_asset_selections" table
CREATE TABLE `new_asset_selections` (`id` text NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `team_id` text NOT NULL, `config_id` text NOT NULL, `user_id` text NOT NULL, `version` integer NOT NULL DEFAULT (0), `disabled` bool NOT NULL DEFAULT (false), `name` text NOT NULL DEFAULT (''), `history` json NULL, `revision` integer NOT NULL DEFAULT (0), PRIMARY KEY (`id`));
-- Copy rows from old table "asset_selections" to new temporary table "new_asset_selections"
INSERT INTO `new_asset_selections` (`id`, `created_at`, `updated_at`, `team_id`, `config_id`, `user_id`, `version`, `disabled`, `name`) SELECT `id`, `created_at`, `updated_at`, `team_id`, `config_id`, `user_id`, `version`, `disabled`, `name` FROM `asset_selections`;
-- Drop "asset_selections" table after copying rows
DROP TABLE `asset_selections`;
-- Rename temporary table "new_asset_selections" to "asset_selections"
ALTER TABLE `new_asset_selections` RENAME TO `asset_selections`;
-- Create index "assetselection_team_id_user_id_config_id" to table: "asset_selections"
CREATE UNIQUE INDEX `assetselection_team_id_user_id_config_id` ON `asset_selections` (`team_id`, `user_id`, `config_id`);
-- Enable back the enforcement of foreign-keys constraints
PRAGMA foreign_keys = on;
