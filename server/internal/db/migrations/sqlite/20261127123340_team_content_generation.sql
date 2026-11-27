-- Disable the enforcement of foreign-keys constraints
PRAGMA foreign_keys = off;
-- Create "new_teams" table
CREATE TABLE `new_teams` (`id` text NOT NULL, `created_at` datetime NOT NULL, `name` text NOT NULL, `content_generation` integer NOT NULL DEFAULT (0), PRIMARY KEY (`id`));
-- Copy rows from old table "teams" to new temporary table "new_teams"
INSERT INTO `new_teams` (`id`, `created_at`, `name`) SELECT `id`, `created_at`, `name` FROM `teams`;
-- Drop "teams" table after copying rows
DROP TABLE `teams`;
-- Rename temporary table "new_teams" to "teams"
ALTER TABLE `new_teams` RENAME TO `teams`;
-- Enable back the enforcement of foreign-keys constraints
PRAGMA foreign_keys = on;
