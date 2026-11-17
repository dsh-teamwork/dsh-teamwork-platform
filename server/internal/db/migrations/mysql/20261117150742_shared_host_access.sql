-- Modify "shared_hosts" table
ALTER TABLE `shared_hosts` ADD COLUMN `access` enum('team','listed') NOT NULL DEFAULT "team";
-- Create "shared_host_members" table
CREATE TABLE `shared_host_members` (`id` varchar(32) NOT NULL, `created_at` datetime(6) NOT NULL, `host_id` varchar(32) NOT NULL, `user_id` varchar(32) NOT NULL, `added_by` varchar(32) NOT NULL, PRIMARY KEY (`id`), UNIQUE INDEX `shared_host_members_host_user` (`host_id`, `user_id`)) CHARSET utf8mb4 COLLATE utf8mb4_bin;
