-- Modify "usage_requests" table
ALTER TABLE `usage_requests` ADD COLUMN `app_url` varchar(500) NOT NULL DEFAULT "";
