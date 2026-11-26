-- Modify "team_configs" table
ALTER TABLE `team_configs` ADD COLUMN `asset_owner_withdrawn` bool NOT NULL DEFAULT 0;
