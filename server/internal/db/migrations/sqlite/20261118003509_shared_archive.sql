-- Create "shared_archive_segments" table
CREATE TABLE `shared_archive_segments` (`id` text NOT NULL, `created_at` datetime NOT NULL, `host_id` text NOT NULL, `team_id` text NOT NULL, `seq` integer NOT NULL, `prev_digest` text NOT NULL, `digest` text NOT NULL, `data` blob NOT NULL, PRIMARY KEY (`id`));
-- Create index "shared_archive_host_seq" to table: "shared_archive_segments"
CREATE UNIQUE INDEX `shared_archive_host_seq` ON `shared_archive_segments` (`host_id`, `seq`);
-- Create index "shared_archive_team" to table: "shared_archive_segments"
CREATE INDEX `shared_archive_team` ON `shared_archive_segments` (`team_id`);
