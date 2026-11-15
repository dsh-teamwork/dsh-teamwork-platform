-- Disable the enforcement of foreign-keys constraints
PRAGMA foreign_keys = off;
-- Create "new_config_revisions" table
CREATE TABLE `new_config_revisions` (`id` text NOT NULL, `created_at` datetime NOT NULL, `team_id` text NOT NULL, `config_id` text NOT NULL, `version` integer NOT NULL, `builtin` text NOT NULL DEFAULT (''), `kind` text NOT NULL, `name` text NOT NULL, `data` json NOT NULL, `author_id` text NOT NULL DEFAULT (''), `reviewer_id` text NOT NULL DEFAULT (''), `note` text NOT NULL DEFAULT (''), `source` text NOT NULL, PRIMARY KEY (`id`));
-- Copy rows from old table "config_revisions" to new temporary table "new_config_revisions"
INSERT INTO `new_config_revisions` (`id`, `created_at`, `team_id`, `config_id`, `version`, `kind`, `name`, `data`, `author_id`, `reviewer_id`, `note`, `source`) SELECT `id`, `created_at`, `team_id`, `config_id`, `version`, `kind`, `name`, `data`, `author_id`, `reviewer_id`, `note`, `source` FROM `config_revisions`;
-- Drop "config_revisions" table after copying rows
DROP TABLE `config_revisions`;
-- Rename temporary table "new_config_revisions" to "config_revisions"
ALTER TABLE `new_config_revisions` RENAME TO `config_revisions`;
-- Create index "configrevision_team_id_config_id_version" to table: "config_revisions"
CREATE UNIQUE INDEX `configrevision_team_id_config_id_version` ON `config_revisions` (`team_id`, `config_id`, `version`);
-- Create index "configrevision_team_id_created_at" to table: "config_revisions"
CREATE INDEX `configrevision_team_id_created_at` ON `config_revisions` (`team_id`, `created_at`);
-- Enable back the enforcement of foreign-keys constraints
PRAGMA foreign_keys = on;
