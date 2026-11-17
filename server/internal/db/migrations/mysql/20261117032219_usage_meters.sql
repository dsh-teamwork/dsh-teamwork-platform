-- Modify "usage_requests" table
ALTER TABLE `usage_requests` ADD COLUMN `meter` varchar(256) NOT NULL DEFAULT "", ADD COLUMN `quantity` bigint NULL;
