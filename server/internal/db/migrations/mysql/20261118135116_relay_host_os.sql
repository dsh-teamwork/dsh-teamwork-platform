-- Modify "relay_hosts" table
ALTER TABLE `relay_hosts` ADD COLUMN `os` enum('macos','windows','linux') NULL;
