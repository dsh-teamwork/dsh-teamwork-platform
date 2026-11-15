-- Modify "usage_requests" table
ALTER TABLE `usage_requests` ADD COLUMN `admitted_units` bigint NULL, ADD COLUMN `admitted_input` bigint NULL, ADD COLUMN `admitted_output` bigint NULL;
