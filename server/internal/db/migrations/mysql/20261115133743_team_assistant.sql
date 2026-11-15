-- Modify "team_configs" table
ALTER TABLE `team_configs` MODIFY COLUMN `name` varchar(480) NOT NULL, ADD COLUMN `builtin` varchar(40) NULL, ADD UNIQUE INDEX `teamconfig_team_id_builtin` (`team_id`, `builtin`);
