-- Add column "plugin_version" to table: "relay_hosts"
ALTER TABLE `relay_hosts` ADD COLUMN `plugin_version` text NULL;
