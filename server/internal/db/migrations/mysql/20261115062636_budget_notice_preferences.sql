-- Modify "budget_policies" table
ALTER TABLE `budget_policies` ADD COLUMN `notify` enum('admins','owner','both','none') NOT NULL DEFAULT "admins";
