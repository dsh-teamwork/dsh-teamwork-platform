-- Modify "team_configs" table
ALTER TABLE `team_configs` ADD COLUMN `route_owner` varchar(40) NOT NULL DEFAULT "", ADD COLUMN `route_reference` varchar(100) NOT NULL DEFAULT "";
-- Modify "usage_requests" table
ALTER TABLE `usage_requests` ADD COLUMN `route_owner` varchar(40) NOT NULL DEFAULT "";
