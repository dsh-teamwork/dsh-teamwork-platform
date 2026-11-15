-- Modify "config_revisions" table
ALTER TABLE "config_revisions" ADD COLUMN "builtin" character varying NOT NULL DEFAULT '';
