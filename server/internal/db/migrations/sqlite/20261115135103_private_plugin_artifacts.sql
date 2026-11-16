-- Create "resource_artifacts" table
CREATE TABLE `resource_artifacts` (`id` text NOT NULL, `created_at` datetime NOT NULL, `team_id` text NOT NULL, `author_id` text NOT NULL, `package` text NOT NULL, `version` text NOT NULL, `sha256` text NOT NULL, `size` integer NOT NULL, `files` json NOT NULL, `published` bool NOT NULL DEFAULT (false), PRIMARY KEY (`id`));
-- Create index "resourceartifact_team_id_package_version" to table: "resource_artifacts"
CREATE UNIQUE INDEX `resourceartifact_team_id_package_version` ON `resource_artifacts` (`team_id`, `package`, `version`);
-- Create index "resourceartifact_team_id_author_id" to table: "resource_artifacts"
CREATE INDEX `resourceartifact_team_id_author_id` ON `resource_artifacts` (`team_id`, `author_id`);
