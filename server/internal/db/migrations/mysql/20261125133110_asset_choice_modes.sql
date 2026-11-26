-- Modify "asset_selections" table
ALTER TABLE `asset_selections` ADD COLUMN `mode` enum('latest','pinned','removed') NOT NULL DEFAULT "pinned";
-- Drop the superseded "disabled" column; "mode" holds removal now
ALTER TABLE `asset_selections` DROP COLUMN `disabled`;
