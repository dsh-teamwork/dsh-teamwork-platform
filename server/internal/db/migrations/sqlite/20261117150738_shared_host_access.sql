-- Disable the enforcement of foreign-keys constraints
PRAGMA foreign_keys = off;
-- Create "new_shared_hosts" table
CREATE TABLE `new_shared_hosts` (`id` text NOT NULL, `created_at` datetime NOT NULL, `team_id` text NOT NULL, `name` text NOT NULL, `key_hash` text NOT NULL, `identity_key` text NULL, `created_by` text NOT NULL, `bound_at` datetime NULL, `last_seen_at` datetime NULL, `access` text NOT NULL DEFAULT ('team'), PRIMARY KEY (`id`));
-- Copy rows from old table "shared_hosts" to new temporary table "new_shared_hosts"
INSERT INTO `new_shared_hosts` (`id`, `created_at`, `team_id`, `name`, `key_hash`, `identity_key`, `created_by`, `bound_at`, `last_seen_at`) SELECT `id`, `created_at`, `team_id`, `name`, `key_hash`, `identity_key`, `created_by`, `bound_at`, `last_seen_at` FROM `shared_hosts`;
-- Drop "shared_hosts" table after copying rows
DROP TABLE `shared_hosts`;
-- Rename temporary table "new_shared_hosts" to "shared_hosts"
ALTER TABLE `new_shared_hosts` RENAME TO `shared_hosts`;
-- Create index "shared_hosts_team" to table: "shared_hosts"
CREATE INDEX `shared_hosts_team` ON `shared_hosts` (`team_id`);
-- Create "shared_host_members" table
CREATE TABLE `shared_host_members` (`id` text NOT NULL, `created_at` datetime NOT NULL, `host_id` text NOT NULL, `user_id` text NOT NULL, `added_by` text NOT NULL, PRIMARY KEY (`id`));
-- Create index "shared_host_members_host_user" to table: "shared_host_members"
CREATE UNIQUE INDEX `shared_host_members_host_user` ON `shared_host_members` (`host_id`, `user_id`);
-- Enable back the enforcement of foreign-keys constraints
PRAGMA foreign_keys = on;
