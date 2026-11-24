-- Disable the enforcement of foreign-keys constraints
PRAGMA foreign_keys = off;
-- Create "new_knowledge_spaces" table
CREATE TABLE `new_knowledge_spaces` (`id` text NOT NULL, `created_at` datetime NOT NULL, `team_id` text NOT NULL, `name` text NOT NULL, `reading` text NOT NULL DEFAULT ('team'), `created_by` text NOT NULL, `templates_folder_id` text NOT NULL DEFAULT (''), PRIMARY KEY (`id`));
-- Copy rows from old table "knowledge_spaces" to new temporary table "new_knowledge_spaces"
INSERT INTO `new_knowledge_spaces` (`id`, `created_at`, `team_id`, `name`, `reading`, `created_by`) SELECT `id`, `created_at`, `team_id`, `name`, `reading`, `created_by` FROM `knowledge_spaces`;
-- Drop "knowledge_spaces" table after copying rows
DROP TABLE `knowledge_spaces`;
-- Rename temporary table "new_knowledge_spaces" to "knowledge_spaces"
ALTER TABLE `new_knowledge_spaces` RENAME TO `knowledge_spaces`;
-- Create index "knowledgespace_team_id_name" to table: "knowledge_spaces"
CREATE UNIQUE INDEX `knowledgespace_team_id_name` ON `knowledge_spaces` (`team_id`, `name`);
-- Enable back the enforcement of foreign-keys constraints
PRAGMA foreign_keys = on;
