-- Add column "admitted_units" to table: "usage_requests"
ALTER TABLE `usage_requests` ADD COLUMN `admitted_units` integer NULL;
-- Add column "admitted_input" to table: "usage_requests"
ALTER TABLE `usage_requests` ADD COLUMN `admitted_input` integer NULL;
-- Add column "admitted_output" to table: "usage_requests"
ALTER TABLE `usage_requests` ADD COLUMN `admitted_output` integer NULL;
