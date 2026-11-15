-- Create "config_revisions" table
CREATE TABLE `config_revisions` (`id` text NOT NULL, `created_at` datetime NOT NULL, `team_id` text NOT NULL, `config_id` text NOT NULL, `version` integer NOT NULL, `kind` text NOT NULL, `name` text NOT NULL, `data` json NOT NULL, `author_id` text NOT NULL DEFAULT (''), `reviewer_id` text NOT NULL DEFAULT (''), `note` text NOT NULL DEFAULT (''), `source` text NOT NULL, PRIMARY KEY (`id`));
-- Create index "configrevision_team_id_config_id_version" to table: "config_revisions"
CREATE UNIQUE INDEX `configrevision_team_id_config_id_version` ON `config_revisions` (`team_id`, `config_id`, `version`);
-- Create index "configrevision_team_id_created_at" to table: "config_revisions"
CREATE INDEX `configrevision_team_id_created_at` ON `config_revisions` (`team_id`, `created_at`);
-- Create "resource_submissions" table
CREATE TABLE `resource_submissions` (`id` text NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `team_id` text NOT NULL, `author_id` text NOT NULL, `config_id` text NOT NULL, `base_version` integer NOT NULL DEFAULT (0), `proposal` json NOT NULL, `note` text NOT NULL DEFAULT (''), `state` text NOT NULL DEFAULT ('draft'), `revision` integer NOT NULL DEFAULT (1), `reviewer_id` text NOT NULL DEFAULT (''), `reason` text NOT NULL DEFAULT (''), `decided_at` datetime NULL, PRIMARY KEY (`id`));
-- Create index "resourcesubmission_team_id_author_id" to table: "resource_submissions"
CREATE INDEX `resourcesubmission_team_id_author_id` ON `resource_submissions` (`team_id`, `author_id`);
-- Create index "resourcesubmission_team_id_state" to table: "resource_submissions"
CREATE INDEX `resourcesubmission_team_id_state` ON `resource_submissions` (`team_id`, `state`);
