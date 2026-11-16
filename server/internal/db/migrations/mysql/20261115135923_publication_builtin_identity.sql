-- Modify "config_revisions" table
ALTER TABLE `config_revisions` ADD COLUMN `builtin` varchar(40) NOT NULL DEFAULT "";
