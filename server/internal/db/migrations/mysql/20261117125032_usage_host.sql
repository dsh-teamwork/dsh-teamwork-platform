-- Modify "usage_requests" table
ALTER TABLE `usage_requests` ADD COLUMN `host_id` varchar(32) NOT NULL DEFAULT "";
