-- Modify "relay_hosts" table
ALTER TABLE `relay_hosts` ADD COLUMN `plugin_version` varchar(160) NULL;
