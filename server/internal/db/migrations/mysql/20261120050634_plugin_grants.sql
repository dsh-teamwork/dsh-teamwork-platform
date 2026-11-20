-- Modify "relay_hosts" table
ALTER TABLE `relay_hosts` ADD COLUMN `grant_id` varchar(32) NULL;
-- Create "plugin_grants" table
CREATE TABLE `plugin_grants` (`id` varchar(32) NOT NULL, `created_at` datetime(6) NOT NULL, `via` varchar(32) NOT NULL, `used_at` datetime(6) NOT NULL, `user_id` varchar(32) NOT NULL, PRIMARY KEY (`id`), INDEX `plugingrant_user_id` (`user_id`), CONSTRAINT `plugin_grants_users_plugin_grants` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON UPDATE NO ACTION ON DELETE CASCADE) CHARSET utf8mb4 COLLATE utf8mb4_bin;
