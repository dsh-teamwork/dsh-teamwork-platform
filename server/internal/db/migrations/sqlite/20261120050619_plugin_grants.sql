-- Add column "grant_id" to table: "relay_hosts"
ALTER TABLE `relay_hosts` ADD COLUMN `grant_id` text NULL;
-- Create "plugin_grants" table
CREATE TABLE `plugin_grants` (`id` text NOT NULL, `created_at` datetime NOT NULL, `via` text NOT NULL, `used_at` datetime NOT NULL, `user_id` text NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `plugin_grants_users_plugin_grants` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE);
-- Create index "plugingrant_user_id" to table: "plugin_grants"
CREATE INDEX `plugingrant_user_id` ON `plugin_grants` (`user_id`);
